import { create } from 'zustand';
import { logger } from '@/lib/logger';
import { agentRegistry } from '@/services/agents/agent-registry';
import type { AgentDefinition } from '@/types/agent';

interface AgentState {
  agents: Map<string, AgentDefinition>;
  isLoading: boolean;
  error: string | null;
  isInitialized: boolean;
  refreshToken: number;
}

interface AgentStore extends AgentState {
  // Read operations
  getAgent: (id: string) => AgentDefinition | undefined;
  listAgents: () => AgentDefinition[];

  // Mutate operations
  loadAgents: () => Promise<void>;
  updateAgent: (id: string, partial: Partial<AgentDefinition>) => Promise<void>;
  createAgent: (agent: AgentDefinition) => Promise<void>;
  deleteAgent: (id: string) => Promise<void>;

  // Refresh
  refreshAgents: () => Promise<void>;
}

export const useAgentStore = create<AgentStore>((set, get) => ({
  // Initial state
  agents: new Map(),
  isLoading: false,
  error: null,
  isInitialized: false,
  refreshToken: 0,

  /**
   * Get a single agent by ID from store
   */
  getAgent: (id: string) => {
    return get().agents.get(id);
  },

  /**
   * Get all agents as an array
   */
  listAgents: () => {
    return Array.from(get().agents.values());
  },

  /**
   * Load agents from agent registry
   * Only loads once unless explicitly refreshed
   */
  loadAgents: async () => {
    const { isInitialized, isLoading } = get();

    // Prevent duplicate loading
    if (isInitialized || isLoading) {
      return;
    }

    try {
      set({ isLoading: true, error: null });

      // Load agents from database into registry
      await agentRegistry.loadAllAgents();

      // Get agents from registry and populate store
      const agentList = agentRegistry.list();
      const agentsMap = new Map(agentList.map((agent) => [agent.id, agent]));

      set((state) => ({
        agents: agentsMap,
        isLoading: false,
        isInitialized: true,
        refreshToken: state.refreshToken + 1,
      }));

      logger.info(`Loaded ${agentList.length} agents successfully into store`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to load agents';
      logger.error('Failed to load agents:', errorMessage);
      set({
        error: errorMessage,
        isLoading: false,
        isInitialized: true,
      });
    }
  },

  /**
   * Update an agent
   * Updates both the registry and the store state
   */
  updateAgent: async (id: string, partial: Partial<AgentDefinition>) => {
    try {
      // Update in registry (which updates database)
      await agentRegistry.update(id, partial);

      // Get the updated agent from registry
      const updatedAgent = await agentRegistry.get(id);

      if (updatedAgent) {
        // Update store state - this triggers re-render in subscribed components
        set((state) => {
          const newAgents = new Map(state.agents);
          newAgents.set(id, updatedAgent);
          return { agents: newAgents };
        });

        logger.info(`Updated agent ${id} in store`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to update agent';
      logger.error(`Failed to update agent ${id}:`, errorMessage);
      set({ error: errorMessage });
      throw error;
    }
  },

  /**
   * Create a new agent
   */
  createAgent: async (agent: AgentDefinition) => {
    try {
      // Register in registry (which persists to database)
      await agentRegistry.register(agent);

      // Update store state
      set((state) => {
        const newAgents = new Map(state.agents);
        newAgents.set(agent.id, agent);
        return { agents: newAgents };
      });

      logger.info(`Created agent ${agent.id} in store`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to create agent';
      logger.error(`Failed to create agent ${agent.id}:`, errorMessage);
      set({ error: errorMessage });
      throw error;
    }
  },

  /**
   * Delete an agent
   */
  deleteAgent: async (id: string) => {
    try {
      // Delete from registry (which removes from database)
      await agentRegistry.delete(id);

      // Update store state
      set((state) => {
        const newAgents = new Map(state.agents);
        newAgents.delete(id);
        return { agents: newAgents };
      });

      logger.info(`Deleted agent ${id} from store`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to delete agent';
      logger.error(`Failed to delete agent ${id}:`, errorMessage);
      set({ error: errorMessage });
      throw error;
    }
  },

  /**
   * Force refresh agents from registry
   * Used when agents might have been modified externally
   */
  refreshAgents: async () => {
    try {
      set({ isLoading: true, error: null });

      // Reload from database
      await agentRegistry.loadAllAgents();

      // Get fresh agents from registry
      const agentList = agentRegistry.list();
      const agentsMap = new Map(agentList.map((agent) => [agent.id, agent]));

      set((state) => ({
        agents: agentsMap,
        isLoading: false,
        refreshToken: state.refreshToken + 1,
      }));

      logger.info(`Refreshed ${agentList.length} agents successfully`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to refresh agents';
      logger.error('Failed to refresh agents:', errorMessage);
      set({
        error: errorMessage,
        isLoading: false,
      });
    }
  },
}));
