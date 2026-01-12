// Marketplace hook for fetching and managing marketplace data

import type { RemoteAgentConfig } from '@talkcody/shared/types/remote-agents';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { API_BASE_URL } from '@/lib/config';
import { logger } from '@/lib/logger';
import { simpleFetch } from '@/lib/tauri-fetch';
import { agentRegistry } from '@/services/agents/agent-registry';
import type { AgentToolSet } from '@/types/agent';
import type { ModelType } from '@/types/model-types';

interface UseMarketplaceReturn {
  agents: RemoteAgentConfig[];
  categories: string[];
  tags: string[];
  featuredAgents: RemoteAgentConfig[];
  isLoading: boolean;
  error: string | null;
  loadAgents: () => Promise<void>;
  loadCategories: () => Promise<void>;
  loadTags: () => Promise<void>;
  loadFeaturedAgents: () => Promise<void>;
  getAgentBySlug: (slug: string) => Promise<RemoteAgentConfig | null>;
  installAgent: (slug: string, version: string) => Promise<void>;
  downloadAgent: (slug: string) => Promise<void>;
}

export function useMarketplace(): UseMarketplaceReturn {
  const [agents, setAgents] = useState<RemoteAgentConfig[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [featuredAgents, setFeaturedAgents] = useState<RemoteAgentConfig[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAgents = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await simpleFetch(`${API_BASE_URL}/api/remote-agents/configs`);

      if (!response.ok) {
        throw new Error('Failed to load agents');
      }

      const data = await response.json();
      setAgents(data.remoteAgents || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      logger.error('Load agents error:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadCategories = useCallback(async () => {
    try {
      const response = await simpleFetch(`${API_BASE_URL}/api/marketplace/categories`);

      if (!response.ok) {
        throw new Error('Failed to load categories');
      }

      const data = await response.json();
      setCategories(data.categories || []);
    } catch (err) {
      logger.error('Load categories error:', err);
    }
  }, []);

  const loadTags = useCallback(async () => {
    try {
      const response = await simpleFetch(`${API_BASE_URL}/api/marketplace/tags`);

      if (!response.ok) {
        throw new Error('Failed to load tags');
      }

      const data = await response.json();
      setTags(data.tags || []);
    } catch (err) {
      logger.error('Load tags error:', err);
    }
  }, []);

  const loadFeaturedAgents = useCallback(async () => {
    try {
      const response = await simpleFetch(
        `${API_BASE_URL}/api/marketplace/agents/featured?limit=10`
      );

      if (!response.ok) {
        throw new Error('Failed to load featured agents');
      }

      const data = await response.json();
      setFeaturedAgents(data.agents || []);
    } catch (err) {
      logger.error('Load featured agents error:', err);
    }
  }, []);

  const getAgentBySlug = useCallback(async (slug: string): Promise<RemoteAgentConfig | null> => {
    try {
      const response = await simpleFetch(`${API_BASE_URL}/api/remote-agents/${slug}`);

      if (!response.ok) {
        throw new Error('Failed to load agent');
      }

      const data = await response.json();
      return data;
    } catch (err) {
      logger.error('Get agent error:', err);
      return null;
    }
  }, []);

  const installAgent = useCallback(async (slug: string, _version: string) => {
    try {
      const agentResponse = await simpleFetch(`${API_BASE_URL}/api/remote-agents/${slug}`);

      if (!agentResponse.ok) {
        throw new Error('Failed to download agent configuration');
      }

      const remoteAgent: RemoteAgentConfig = await agentResponse.json();

      // Generate unique local ID based on slug
      const baseId = remoteAgent.id
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');

      let localId = baseId;
      let counter = 1;
      while (await agentRegistry.get(localId)) {
        localId = `${baseId}-${counter++}`;
      }

      const agentDefinition = {
        id: localId,
        name: remoteAgent.name,
        description: remoteAgent.description || '',
        modelType: remoteAgent.modelType as ModelType,
        systemPrompt: remoteAgent.systemPrompt,
        tools: (remoteAgent.tools || {}) as AgentToolSet,
        hidden: remoteAgent.hidden || false,
        rules: remoteAgent.rules,
        outputFormat: remoteAgent.outputFormat,
        isDefault: false,
        dynamicPrompt: remoteAgent.dynamicPrompt,
        defaultSkills: remoteAgent.defaultSkills,
        isBeta: remoteAgent.isBeta,
        role: remoteAgent.role,
        canBeSubagent: remoteAgent.canBeSubagent,
      };

      await agentRegistry.forceRegister(agentDefinition);

      logger.info(`Successfully installed remote agent ${slug} as ${localId}`);
      toast.success(`Agent "${remoteAgent.name}" installed successfully!`);

      // Refresh agent store to sync with database
      const { useAgentStore } = await import('@/stores/agent-store');
      await useAgentStore.getState().refreshAgents();
    } catch (err) {
      logger.error('Install agent error:', err);
      toast.error('Failed to install agent. Please try again.');
      throw err;
    }
  }, []);

  const downloadAgent = useCallback(async (_slug: string) => {
    // Tracking disabled
  }, []);

  return {
    agents,
    categories,
    tags,
    featuredAgents,
    isLoading,
    error,
    loadAgents,
    loadCategories,
    loadTags,
    loadFeaturedAgents,
    getAgentBySlug,
    installAgent,
    downloadAgent,
  };
}
