// Unified agents hook for fetching both marketplace and local agents

import type { RemoteAgentConfig } from '@talkcody/shared/types/remote-agents';
import { useCallback, useMemo, useState } from 'react';
import { logger } from '@/lib/logger';
import { agentRegistry } from '@/services/agents/agent-registry';
import { agentService } from '@/services/database/agent-service';
import { useAgentStore } from '@/stores/agent-store';
import type { Agent } from '@/types';
import { useMarketplace } from './use-marketplace';

export type UnifiedAgent =
  | (RemoteAgentConfig & { _type: 'marketplace' })
  | (Agent & { _type: 'local' });

interface UseUnifiedAgentsReturn {
  // Marketplace agents
  marketplaceAgents: (RemoteAgentConfig & { _type: 'marketplace' })[];
  // Local agents
  localAgents: (Agent & { _type: 'local' })[];
  // All agents (for "All Agents" tab - marketplace only)
  allAgents: UnifiedAgent[];
  // My agents (local + installed from marketplace)
  myAgents: (Agent & { _type: 'local' })[];
  // Featured agents
  featuredAgents: (RemoteAgentConfig & { _type: 'marketplace' })[];
  // Loading states
  isLoading: boolean;
  // Methods from marketplace
  loadMarketplaceAgents: ReturnType<typeof useMarketplace>['loadAgents'];
  loadCategories: ReturnType<typeof useMarketplace>['loadCategories'];
  loadTags: ReturnType<typeof useMarketplace>['loadTags'];
  loadFeaturedAgents: ReturnType<typeof useMarketplace>['loadFeaturedAgents'];
  getAgentBySlug: ReturnType<typeof useMarketplace>['getAgentBySlug'];
  installAgent: ReturnType<typeof useMarketplace>['installAgent'];
  // Local agent methods
  refreshLocalAgents: () => Promise<void>;
  // Other data
  categories: ReturnType<typeof useMarketplace>['categories'];
  tags: ReturnType<typeof useMarketplace>['tags'];
  error: string | null;
}

export function useUnifiedAgents(): UseUnifiedAgentsReturn {
  const marketplace = useMarketplace();

  // Subscribe to agent store state to trigger refresh when agents change
  const loadAgents = useAgentStore((state) => state.loadAgents);
  const agentsMap = useAgentStore((state) => state.agents);

  const [localAgents, setLocalAgents] = useState<Agent[]>([]);
  const [isLoadingLocal, setIsLoadingLocal] = useState(false);

  const refreshLocalAgents = useCallback(async () => {
    setIsLoadingLocal(true);
    try {
      // Ensure registry and store are loaded
      await loadAgents();

      // Get all agents from database (user agents only)
      const dbAgents = await agentService.listAgents({ includeHidden: false });

      // Get system agents from store (exclude hidden agents)
      const allAgents = Array.from(agentsMap.values());
      const systemAgents = allAgents.filter((agent) => agent.isDefault && !agent.hidden);

      // Convert system agents to Agent type with source_type='system'
      const systemAgentsAsDbType: Agent[] = systemAgents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        description: agent.description || '',
        model_type: agent.modelType,
        system_prompt: typeof agent.systemPrompt === 'string' ? agent.systemPrompt : '',
        tools_config: JSON.stringify(agent.tools || {}),
        rules: agent.rules || '',
        output_format: agent.outputFormat || '',
        is_hidden: agent.hidden || false,
        is_default: true,
        is_enabled: agentRegistry.isSystemAgentEnabled(agent.id),
        source_type: 'system',
        is_shared: false,
        created_at: Date.now(),
        updated_at: Date.now(),
        created_by: 'system',
        usage_count: 0,
        categories: '[]',
        tags: '[]',
      }));

      // Combine database agents and system agents
      setLocalAgents([...dbAgents, ...systemAgentsAsDbType]);
    } catch (error) {
      logger.error('Failed to load local agents:', error);
    } finally {
      setIsLoadingLocal(false);
    }
  }, [loadAgents, agentsMap]);

  // Note: We don't automatically load local agents on mount anymore
  // This is now handled explicitly by the component when needed

  // Mark marketplace agents with _type
  const marketplaceAgents = useMemo(
    () => marketplace.agents.map((agent) => ({ ...agent, _type: 'marketplace' as const })),
    [marketplace.agents]
  );

  // Mark featured agents with _type
  const featuredAgents = useMemo(
    () => marketplace.featuredAgents.map((agent) => ({ ...agent, _type: 'marketplace' as const })),
    [marketplace.featuredAgents]
  );

  // Mark local agents with _type
  const localAgentsWithType = useMemo(
    () => localAgents.map((agent) => ({ ...agent, _type: 'local' as const })),
    [localAgents]
  );

  // All agents (marketplace only for the "All Agents" tab)
  const allAgents = useMemo(() => marketplaceAgents as UnifiedAgent[], [marketplaceAgents]);

  // My agents (local + installed from marketplace + system agents)
  const myAgents = useMemo(
    () =>
      localAgentsWithType.filter(
        (agent) =>
          agent.source_type === 'local' ||
          agent.source_type === 'marketplace' ||
          agent.source_type === 'system'
      ),
    [localAgentsWithType]
  );

  return {
    marketplaceAgents,
    localAgents: localAgentsWithType,
    allAgents,
    myAgents,
    featuredAgents,
    isLoading: marketplace.isLoading || isLoadingLocal,
    loadMarketplaceAgents: marketplace.loadAgents,
    loadCategories: marketplace.loadCategories,
    loadTags: marketplace.loadTags,
    loadFeaturedAgents: marketplace.loadFeaturedAgents,
    getAgentBySlug: marketplace.getAgentBySlug,
    installAgent: marketplace.installAgent,
    refreshLocalAgents,
    categories: marketplace.categories,
    tags: marketplace.tags,
    error: marketplace.error,
  };
}
