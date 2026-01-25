// Marketplace hook for fetching and managing marketplace data

import type {
  RemoteAgentConfig,
  RemoteAgentsConfiguration,
} from '@talkcody/shared/types/remote-agents';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { API_BASE_URL } from '@/lib/config';
import { logger } from '@/lib/logger';
import { simpleFetch } from '@/lib/tauri-fetch';
import { agentRegistry } from '@/services/agents/agent-registry';
import {
  importAgentFromGitHub,
  resolveAgentTools,
} from '@/services/agents/github-import-agent-service';
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

  const fetchRemoteAgentsConfig = useCallback(async (): Promise<RemoteAgentsConfiguration> => {
    const response = await simpleFetch(`${API_BASE_URL}/api/remote-agents/configs`);

    if (!response.ok) {
      throw new Error('Failed to load agents');
    }

    return (await response.json()) as RemoteAgentsConfiguration;
  }, []);

  const normalizeRemoteAgent = useCallback(
    (agent: RemoteAgentsConfiguration['remoteAgents'][number]): RemoteAgentConfig => ({
      ...agent,
      modelType: 'main_model',
      systemPrompt: '',
    }),
    []
  );

  const loadAgents = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const data = await fetchRemoteAgentsConfig();
      setAgents(data.remoteAgents.map(normalizeRemoteAgent));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      logger.error('Load agents error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [fetchRemoteAgentsConfig, normalizeRemoteAgent]);

  const loadCategories = useCallback(async () => {
    try {
      const data = await fetchRemoteAgentsConfig();
      const uniqueCategories = Array.from(
        new Set(data.remoteAgents.map((agent) => agent.category).filter(Boolean))
      ).sort();
      setCategories(uniqueCategories);
    } catch (err) {
      logger.error('Load categories error:', err);
      setCategories([]);
    }
  }, [fetchRemoteAgentsConfig]);

  const loadTags = useCallback(async () => {
    setTags([]);
  }, []);

  const loadFeaturedAgents = useCallback(async () => {
    setFeaturedAgents([]);
  }, []);

  const getAgentBySlug = useCallback(
    async (slug: string): Promise<RemoteAgentConfig | null> => {
      try {
        const data = await fetchRemoteAgentsConfig();
        const match = data.remoteAgents.find((agent) => agent.id === slug) || null;
        return match ? normalizeRemoteAgent(match) : null;
      } catch (err) {
        logger.error('Get agent error:', err);
        return null;
      }
    },
    [fetchRemoteAgentsConfig, normalizeRemoteAgent]
  );

  const installAgent = useCallback(async (slug: string, _version: string) => {
    try {
      // Step 1: Get agent metadata from API
      const agentResponse = await simpleFetch(`${API_BASE_URL}/api/remote-agents/${slug}`);

      if (!agentResponse.ok) {
        throw new Error('Failed to download agent configuration');
      }

      const remoteAgentMetadata: RemoteAgentConfig = await agentResponse.json();

      // Step 2: Fetch full agent details from GitHub using the existing github-import logic
      // This ensures tools, systemPrompt, and other fields are properly parsed
      const repository = remoteAgentMetadata.repository;
      const githubPath = remoteAgentMetadata.githubPath;

      if (!repository || !githubPath) {
        throw new Error('Invalid agent configuration: missing repository or githubPath');
      }

      // Use importAgentFromGitHub to properly parse the agent from GitHub
      // This handles tools parsing, frontmatter extraction, etc.
      const fullAgentConfigs = await importAgentFromGitHub({
        repository,
        path: githubPath,
        agentId: slug,
      });

      if (fullAgentConfigs.length === 0) {
        throw new Error('Failed to parse agent from GitHub');
      }

      const remoteAgent = fullAgentConfigs[0];
      if (!remoteAgent) {
        throw new Error('Failed to parse agent from GitHub');
      }

      // Convert tool IDs to actual tool references using shared resolver
      const tools = await resolveAgentTools(remoteAgent);

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
        // Default modelType to 'main_model' if not provided (fixes NOT NULL constraint)
        modelType: (remoteAgent.modelType as ModelType) || ('main_model' as ModelType),
        systemPrompt: remoteAgent.systemPrompt,
        tools,
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
