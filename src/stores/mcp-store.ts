import { create } from 'zustand';
import { logger } from '@/lib/logger';
import { type MCPToolInfo, multiMCPAdapter } from '@/lib/mcp/multi-mcp-adapter';
import { databaseService, type MCPServer } from '@/services/database-service';

export interface MCPServerWithTools {
  server: MCPServer;
  tools: MCPToolInfo[];
  isConnected: boolean;
  error?: string;
  toolCount: number;
}

interface MCPState {
  servers: MCPServerWithTools[];
  isLoading: boolean;
  error: string | null;
  isHealthy: boolean;
  isInitialized: boolean;
}

interface MCPStore extends MCPState {
  // Actions
  loadMCPData: () => Promise<void>;
  refreshTools: () => Promise<void>;
  refreshServer: (serverId: string) => Promise<void>;
  enableServer: (serverId: string) => Promise<void>;
  disableServer: (serverId: string) => Promise<void>;
  reloadData: () => Promise<void>;
}

/**
 * Build MCPServerWithTools[] from database servers and adapter statuses.
 * Extracted to eliminate repeated ~20-line data loading blocks.
 */
async function buildServerData(): Promise<{ serverData: MCPServerWithTools[]; healthy: boolean }> {
  const healthy = await multiMCPAdapter.healthCheck();
  const allServers = await databaseService.getMCPServers();
  const statuses = multiMCPAdapter.getAllServerStatuses();

  const serverData: MCPServerWithTools[] = [];

  for (const server of allServers) {
    const status = statuses[server.id] || {
      isConnected: false,
      toolCount: 0,
    };

    let tools: MCPToolInfo[] = [];
    if (status.isConnected) {
      try {
        tools = await multiMCPAdapter.listServerTools(server.id);
      } catch (error) {
        logger.warn(`Failed to get tools for server '${server.id}':`, error);
      }
    }

    serverData.push({
      server,
      tools,
      isConnected: status.isConnected,
      error: status.error,
      toolCount: status.toolCount,
    });
  }

  return { serverData, healthy };
}

/**
 * Refresh planner tools in the agent registry after MCP connection changes.
 */
async function refreshAgentPlannerTools(): Promise<void> {
  const { agentRegistry } = await import('@/services/agents/agent-registry');
  await agentRegistry.refreshPlannerTools();
}

export const useMCPStore = create<MCPStore>((set, get) => ({
  // Initial state
  servers: [],
  isLoading: false,
  error: null,
  isHealthy: false,
  isInitialized: false,

  /**
   * Load MCP servers and their tools
   * Only loads once unless explicitly refreshed
   */
  loadMCPData: async () => {
    const { isInitialized, isLoading } = get();

    // Prevent duplicate loading
    if (isInitialized || isLoading) {
      return;
    }

    try {
      set({ isLoading: true, error: null });

      const { serverData, healthy } = await buildServerData();

      set({
        servers: serverData,
        isHealthy: healthy,
        isLoading: false,
        isInitialized: true,
      });
      logger.info(`Loaded ${serverData.length} MCP servers for UI`);
    } catch (error) {
      logger.error('Failed to load MCP data:', error);
      set({
        error: error instanceof Error ? error.message : 'Unknown error',
        servers: [],
        isHealthy: false,
        isLoading: false,
        isInitialized: true,
      });
    }
  },

  /**
   * Refresh all MCP connections and reload data
   */
  refreshTools: async () => {
    try {
      set({ isLoading: true, error: null });
      await multiMCPAdapter.refreshConnections();

      const { serverData, healthy } = await buildServerData();

      set({
        servers: serverData,
        isHealthy: healthy,
        isLoading: false,
      });

      // Refresh agent planner tools to pick up new MCP connections
      await refreshAgentPlannerTools();

      logger.info(`Refreshed ${serverData.length} MCP servers for UI`);
    } catch (error) {
      logger.error('Failed to refresh MCP tools:', error);
      set({
        error: error instanceof Error ? error.message : 'Failed to refresh tools',
        isLoading: false,
      });
    }
  },

  /**
   * Refresh a specific MCP server and reload data
   */
  refreshServer: async (serverId: string) => {
    try {
      set({ isLoading: true, error: null });
      await multiMCPAdapter.refreshServer(serverId);

      // Refresh agent planner tools to pick up new MCP connections
      await refreshAgentPlannerTools();

      // Reload data after refresh
      await get().reloadData();
    } catch (error) {
      logger.error(`Failed to refresh MCP server ${serverId}:`, error);
      set({
        error: error instanceof Error ? error.message : `Failed to refresh server ${serverId}`,
        isLoading: false,
      });
    }
  },

  /**
   * Enable a MCP server and reload data
   */
  enableServer: async (serverId: string) => {
    try {
      set({ isLoading: true, error: null });
      await databaseService.enableMCPServer(serverId);
      await multiMCPAdapter.refreshServer(serverId);

      // Refresh agent planner tools to pick up new MCP connections
      await refreshAgentPlannerTools();

      // Reload data after enabling
      await get().reloadData();
    } catch (error) {
      logger.error(`Failed to enable MCP server ${serverId}:`, error);
      set({
        error: error instanceof Error ? error.message : `Failed to enable server ${serverId}`,
        isLoading: false,
      });
    }
  },

  /**
   * Disable a MCP server and reload data
   */
  disableServer: async (serverId: string) => {
    try {
      set({ isLoading: true, error: null });
      await databaseService.disableMCPServer(serverId);
      await multiMCPAdapter.refreshServer(serverId);

      // Refresh agent planner tools to pick up new MCP connections
      await refreshAgentPlannerTools();

      // Reload data after disabling
      await get().reloadData();
    } catch (error) {
      logger.error(`Failed to disable MCP server ${serverId}:`, error);
      set({
        error: error instanceof Error ? error.message : `Failed to disable server ${serverId}`,
        isLoading: false,
      });
    }
  },

  /**
   * Force reload MCP data
   * Used internally and can be exposed for manual refresh
   */
  reloadData: async () => {
    try {
      set({ isLoading: true, error: null });

      const { serverData, healthy } = await buildServerData();

      set({
        servers: serverData,
        isHealthy: healthy,
        isLoading: false,
      });
      logger.info(`Reloaded ${serverData.length} MCP servers for UI`);
    } catch (error) {
      logger.error('Failed to reload MCP data:', error);
      set({
        error: error instanceof Error ? error.message : 'Unknown error',
        isLoading: false,
      });
    }
  },
}));
