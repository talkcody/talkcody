// src/lib/mcp/multi-mcp-adapter.ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { logger } from '@/lib/logger';
import { databaseService } from '@/services/database-service';
import type { MCPServer } from '@/types';
import { type MCPTransport, TransportFactory } from './transport-factory';

export interface MCPToolInfo {
  id: string;
  name: string;
  description: string;
  prefixedName: string;
  serverId: string;
  serverName: string;
  isAvailable: boolean;
}

export interface MCPServerConnection {
  server: MCPServer;
  tools: Record<string, MCPToolInfo>;
  /** Cached tool schemas (inputSchema) from MCP server, keyed by tool name */
  toolSchemas: Record<string, { inputSchema?: unknown; description?: string }>;
  isConnected: boolean;
  lastError?: string;
  client?: Client;
  transport?: MCPTransport;
}

/**
 * Multi-MCP Adapter (SDK-backed)
 * Manages connections to MCP servers through MCP client transports.
 */
export class MultiMCPAdapter {
  private connections: Map<string, MCPServerConnection> = new Map();
  private isInitialized = false;
  private initializationPromise: Promise<void> | null = null;

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = this._doInitialize();
    return this.initializationPromise;
  }

  private async _doInitialize(): Promise<void> {
    try {
      const servers = await databaseService.getEnabledMCPServers();
      await this.initializeConnections(servers);
      this.isInitialized = true;
      logger.info('Multi-MCP Adapter initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Multi-MCP Adapter:', error);
      this.initializationPromise = null;
      throw error;
    }
  }

  private async initializeConnections(servers: MCPServer[]): Promise<void> {
    const connectionPromises = servers.map((server) => this.connectToServer(server));
    await Promise.allSettled(connectionPromises);
  }

  private async connectToServer(server: MCPServer): Promise<void> {
    try {
      const existing = this.connections.get(server.id);
      if (existing?.transport) {
        try {
          await existing.transport.close();
        } catch (error) {
          logger.warn(`Failed to close existing MCP transport for ${server.id}:`, error);
        }
      }

      const transport = TransportFactory.createTransport(server);
      const client = new Client({
        name: 'talkcody-mcp-client',
        version: '1.0.0',
      });

      await client.connect(transport);

      const toolsResult = await client.listTools();
      const toolMap: Record<string, MCPToolInfo> = {};
      const toolSchemas: Record<string, { inputSchema?: unknown; description?: string }> = {};

      for (const tool of toolsResult.tools) {
        const prefixedName = `${server.id}__${tool.name}`;
        toolMap[tool.name] = {
          id: tool.name,
          name: tool.name,
          description: tool.description || tool.title || `Tool from ${server.name}`,
          prefixedName,
          serverId: server.id,
          serverName: server.name,
          isAvailable: true,
        };
        toolSchemas[tool.name] = {
          inputSchema: tool.inputSchema,
          description: tool.description || tool.title,
        };
      }

      this.connections.set(server.id, {
        server,
        tools: toolMap,
        toolSchemas,
        isConnected: true,
        lastError: undefined,
        client,
        transport,
      });

      logger.info(
        `Connected to MCP server ${server.id} (${server.name}) with ${toolsResult.tools.length} tools`
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to connect to MCP server ${server.id}:`, error);

      this.connections.set(server.id, {
        server,
        tools: {},
        toolSchemas: {},
        isConnected: false,
        lastError: errorMessage,
      });
    }
  }

  async getAdaptedTools(): Promise<Record<string, any>> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const allTools: Record<string, any> = {};

    for (const connection of this.connections.values()) {
      if (connection.isConnected && connection.tools) {
        for (const toolInfo of Object.values(connection.tools)) {
          allTools[toolInfo.prefixedName] = {
            description: toolInfo.description,
            inputSchema: { type: 'object', properties: {} },
          };
        }
      }
    }

    return allTools;
  }

  async getAdaptedTool(prefixedName: string): Promise<any> {
    const { serverId, toolName } = this.parsePrefixedName(prefixedName);

    if (!this.isInitialized) {
      await this.initialize();
    }

    const connection = this.connections.get(serverId);
    if (!connection || !connection.isConnected || !connection.client) {
      throw new Error(`MCP server '${serverId}' is not connected`);
    }

    const tool = connection.tools[toolName];
    if (!tool) {
      throw new Error(`Tool '${toolName}' not found in MCP server '${serverId}'`);
    }

    // Use cached tool schema instead of calling listTools() every time
    const cachedSchema = connection.toolSchemas[toolName];
    const inputSchema = cachedSchema?.inputSchema || { type: 'object', properties: {} };
    const description = cachedSchema?.description || tool.description;

    // Capture client reference for the closure
    const client = connection.client;

    return {
      name: toolName,
      description,
      inputSchema,
      serverId,
      serverName: tool.serverName,
      prefixedName,
      execute: async (args: Record<string, unknown>) => {
        // Explicitly check client availability instead of silent failure via optional chaining
        if (!client) {
          throw new Error(
            `MCP server '${serverId}' client is no longer available. The server may have disconnected.`
          );
        }
        const result = await client.callTool({
          name: toolName,
          arguments: args,
        });
        return result;
      },
      // Provide default UI render methods for consistency with ToolWithUI interface
      renderToolDoing: () => null,
      renderToolResult: () => null,
      canConcurrent: true,
    };
  }

  async listMCPTools(): Promise<MCPToolInfo[]> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const toolInfos: MCPToolInfo[] = [];

    for (const connection of this.connections.values()) {
      for (const toolInfo of Object.values(connection.tools)) {
        toolInfos.push(toolInfo);
      }
    }

    return toolInfos;
  }

  async listServerTools(serverId: string): Promise<MCPToolInfo[]> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const connection = this.connections.get(serverId);
    if (!connection || !connection.client) {
      return [];
    }

    try {
      const toolsResult = await connection.client.listTools();
      const toolMap: Record<string, MCPToolInfo> = {};
      const toolSchemas: Record<string, { inputSchema?: unknown; description?: string }> = {};

      for (const tool of toolsResult.tools) {
        const prefixedName = `${serverId}__${tool.name}`;
        toolMap[tool.name] = {
          id: tool.name,
          name: tool.name,
          description: tool.description || tool.title || `Tool from ${connection.server.name}`,
          prefixedName,
          serverId,
          serverName: connection.server.name,
          isAvailable: true,
        };
        toolSchemas[tool.name] = {
          inputSchema: tool.inputSchema,
          description: tool.description || tool.title,
        };
      }

      connection.tools = toolMap;
      connection.toolSchemas = toolSchemas;
      return Object.values(connection.tools);
    } catch (error) {
      logger.warn(`Failed to list tools for server '${serverId}':`, error);
      return Object.values(connection.tools);
    }
  }

  getToolInfo(prefixedName: string): Promise<any> {
    return this.getAdaptedTool(prefixedName);
  }

  getServerStatus(serverId: string): { isConnected: boolean; error?: string } {
    const connection = this.connections.get(serverId);
    if (!connection) {
      return { isConnected: false, error: 'Server not found' };
    }

    return {
      isConnected: connection.isConnected,
      error: connection.lastError,
    };
  }

  getAllServerStatuses(): Record<
    string,
    { isConnected: boolean; error?: string; toolCount: number }
  > {
    const statuses: Record<string, { isConnected: boolean; error?: string; toolCount: number }> =
      {};

    for (const [serverId, connection] of this.connections) {
      statuses[serverId] = {
        isConnected: connection.isConnected,
        error: connection.lastError,
        toolCount: Object.keys(connection.tools).length,
      };
    }

    return statuses;
  }

  async refreshConnections(): Promise<void> {
    try {
      for (const connection of this.connections.values()) {
        if (connection.transport) {
          try {
            await connection.transport.close();
          } catch (error) {
            logger.warn(`Failed to close MCP transport for ${connection.server.id}:`, error);
          }
        }
      }

      const servers = await databaseService.getEnabledMCPServers();
      this.connections.clear();
      await this.initializeConnections(servers);
      this.isInitialized = true;
      logger.info('All MCP connections refreshed');
    } catch (error) {
      logger.error('Failed to refresh MCP connections:', error);
      throw error;
    }
  }

  async refreshServer(serverId: string): Promise<void> {
    try {
      const server = await databaseService.getMCPServer(serverId);
      if (!server || !server.is_enabled) {
        logger.info(`Server ${serverId} is disabled or not found, skipping refresh`);
        return;
      }

      await this.connectToServer(server);
      logger.info(`Refreshed connection to MCP server ${serverId}`);
    } catch (error) {
      logger.error(`Failed to refresh MCP server ${serverId}:`, error);
      throw error;
    }
  }

  async testConnection(
    server: MCPServer
  ): Promise<{ success: boolean; error?: string; toolCount?: number }> {
    try {
      await this.connectToServer(server);
      const connection = this.connections.get(server.id);
      return {
        success: connection?.isConnected ?? false,
        error: connection?.lastError,
        toolCount: connection ? Object.keys(connection.tools).length : 0,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.warn(`Test connection failed for server ${server.id}:`, error);

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  async healthCheck(): Promise<boolean> {
    if (!this.isInitialized) {
      try {
        await this.initialize();
      } catch {
        return false;
      }
    }

    return true;
  }

  private parsePrefixedName(prefixedName: string): {
    serverId: string;
    toolName: string;
  } {
    const parts = prefixedName.split('__');
    if (parts.length < 2) {
      throw new Error(
        `Invalid prefixed tool name format: ${prefixedName}. Expected format: {server_id}__{tool_name}`
      );
    }

    const serverId = parts[0] ?? '';
    const toolName = parts.slice(1).join('__');

    return { serverId, toolName };
  }
}

// Export singleton instance
export const multiMCPAdapter = new MultiMCPAdapter();

/**
 * Check if a tool name is an MCP tool (has server prefix)
 * Format: {server_id}__{tool_name}
 */
export const isMCPTool = (toolName: string): boolean => {
  return toolName.includes('__') && toolName.split('__').length >= 2;
};

/**
 * Extract the original MCP tool name from the prefixed name
 */
export const extractMCPToolName = (prefixedName: string): string => {
  const parts = prefixedName.split('__');
  return parts.slice(1).join('__');
};

/**
 * Extract the server ID from the prefixed name
 */
export const extractMCPServerId = (prefixedName: string): string => {
  const parts = prefixedName.split('__');
  return parts[0] ?? '';
};
