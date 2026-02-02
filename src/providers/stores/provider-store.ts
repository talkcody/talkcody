// src/providers/stores/provider-store.ts
// Unified state management for providers and models

import { create } from 'zustand';
import { logger } from '@/lib/logger';
import { ensureModelsInitialized } from '@/providers/config/model-config';
import {
  PROVIDERS_WITH_CODING_PLAN,
  PROVIDERS_WITH_INTERNATIONAL,
} from '@/providers/config/provider-config';
import {
  type OAuthConfig,
  type ProviderFactory,
  parseModelIdentifier,
} from '@/providers/core/provider-utils';
import { modelSyncService } from '@/providers/models/model-sync-service';
import { remoteAgentsSyncService } from '@/providers/remote-agents/remote-agents-sync-service';
import { remoteSkillsSyncService } from '@/providers/remote-skills/remote-skills-sync-service';
import { llmClient } from '@/services/llm/llm-client';
import type { ProviderConfig as RustProviderConfig } from '@/services/llm/types';
import type { ProviderDefinition } from '@/types';
import type { AvailableModel } from '@/types/api-keys';
import type { CustomProviderConfig } from '@/types/custom-provider';
import { isValidModelType, type ModelType } from '@/types/model-types';
import type { ModelConfig } from '@/types/models';

// ===== Types =====

interface ProviderStoreState {
  // Provider instances (legacy placeholder map)
  providers: Map<string, ProviderFactory>;

  // Provider configurations (built-in + custom)
  providerConfigs: Map<string, ProviderDefinition>;

  // API Keys from settings
  apiKeys: Record<string, string | undefined>;

  // Base URLs for providers
  baseUrls: Map<string, string>;

  // Use coding plan settings (for Zhipu)
  useCodingPlanSettings: Map<string, boolean>;

  // Use international settings (for MiniMax, Moonshot)
  useInternationalSettings: Map<string, boolean>;

  // Custom providers from file
  customProviders: CustomProviderConfig[];

  // Custom models from file
  customModels: Record<string, ModelConfig>;

  // OAuth configuration (for Claude Pro/Max)
  oauthConfig: OAuthConfig;

  // Computed available models
  availableModels: AvailableModel[];

  // Initialization state
  isInitialized: boolean;
  isLoading: boolean;
  error: string | null;
}

interface ProviderStoreActions {
  // Initialization
  initialize: () => Promise<void>;

  // OAuth sync
  syncOAuthStatus: () => Promise<void>;

  // Synchronous getters (legacy placeholders)
  getProviderModel: (modelIdentifier: string) => ReturnType<ProviderFactory>;
  isModelAvailable: (modelIdentifier: string) => boolean;
  getBestProviderForModel: (modelKey: string) => string | null;
  getAvailableModel: () => AvailableModel | null;

  // Async mutations
  setApiKey: (providerId: string, apiKey: string) => Promise<void>;
  setBaseUrl: (providerId: string, baseUrl: string) => Promise<void>;
  addCustomProvider: (config: CustomProviderConfig) => Promise<void>;
  updateCustomProvider: (
    providerId: string,
    config: Partial<CustomProviderConfig>
  ) => Promise<void>;
  removeCustomProvider: (providerId: string) => Promise<void>;

  // Refresh
  refresh: () => Promise<void>;
  rebuildProviders: () => void;
}

type ProviderStore = ProviderStoreState & ProviderStoreActions;

// ===== Helper functions =====

async function loadApiKeys(): Promise<Record<string, string | undefined>> {
  const { useSettingsStore } = await import('@/stores/settings-store');
  return useSettingsStore.getState().getApiKeys();
}

function mapRustProviderConfigs(configs: RustProviderConfig[]): Map<string, ProviderDefinition> {
  const mapped = new Map<string, ProviderDefinition>();
  for (const cfg of configs) {
    const providerType = cfg.id === 'talkcody' ? 'custom' : 'openai-compatible';
    mapped.set(cfg.id, {
      id: cfg.id,
      name: cfg.name,
      apiKeyName: cfg.apiKeyName,
      baseUrl: cfg.baseUrl,
      required: false,
      type: providerType,
      supportsOAuth: cfg.supportsOAuth,
      supportsCodingPlan: cfg.supportsCodingPlan,
      supportsInternational: cfg.supportsInternational,
      codingPlanBaseUrl: cfg.codingPlanBaseUrl || undefined,
      internationalBaseUrl: cfg.internationalBaseUrl || undefined,
    });
  }
  return mapped;
}

async function loadBaseUrls(): Promise<Map<string, string>> {
  const { settingsDb } = await import('@/stores/settings-store');
  await settingsDb.initialize();

  const providerConfigs = await llmClient.getProviderConfigs();
  const keys = providerConfigs.map((config) => `base_url_${config.id}`);
  const rows = await settingsDb.getBatch(keys);

  const baseUrls = new Map<string, string>();
  for (const [key, value] of Object.entries(rows)) {
    if (key.startsWith('base_url_') && value) {
      const providerId = key.replace('base_url_', '');
      baseUrls.set(providerId, value);
    }
  }

  return baseUrls;
}

async function loadUseCodingPlanSettings(): Promise<Map<string, boolean>> {
  const { settingsDb } = await import('@/stores/settings-store');
  await settingsDb.initialize();

  const keys = PROVIDERS_WITH_CODING_PLAN.map((id) => `use_coding_plan_${id}`);
  const values = await settingsDb.getBatch(keys);

  const settings = new Map<string, boolean>();
  for (const providerId of PROVIDERS_WITH_CODING_PLAN) {
    const value = values[`use_coding_plan_${providerId}`];
    if (value !== undefined && value !== '') {
      settings.set(providerId, value === 'true');
    }
  }

  return settings;
}

async function loadUseInternationalSettings(): Promise<Map<string, boolean>> {
  const { settingsDb } = await import('@/stores/settings-store');
  await settingsDb.initialize();

  // Batch query all international settings in a single database call
  const keys = PROVIDERS_WITH_INTERNATIONAL.map((id) => `use_international_${id}`);
  const values = await settingsDb.getBatch(keys);

  const settings = new Map<string, boolean>();
  for (const providerId of PROVIDERS_WITH_INTERNATIONAL) {
    const value = values[`use_international_${providerId}`];
    if (value !== undefined && value !== '') {
      settings.set(providerId, value === 'true');
    }
  }

  return settings;
}

async function loadCustomProviders(): Promise<CustomProviderConfig[]> {
  const { customProviderService } = await import('@/providers/custom/custom-provider-service');

  return customProviderService.getEnabledCustomProviders();
}

async function loadCustomModels(): Promise<Record<string, ModelConfig>> {
  try {
    const { customModelService } = await import('@/providers/custom/custom-model-service');
    const config = await customModelService.getCustomModels();
    return config.models;
  } catch (error) {
    logger.warn('Failed to load custom models:', error);
    return {};
  }
}

async function loadOAuthConfig(): Promise<OAuthConfig> {
  try {
    const snapshot = await llmClient.getOAuthStatus();
    return {
      anthropicIsConnected: snapshot?.anthropic?.isConnected || false,
      openaiIsConnected: snapshot?.openai?.isConnected || false,
      openaiAccountId: snapshot?.openai?.accountId || null,
      qwenIsConnected: snapshot?.qwen?.isConnected || false,
      githubCopilotIsConnected: snapshot?.githubCopilot?.isConnected || false,
    };
  } catch (error) {
    logger.warn('Failed to load OAuth config:', error);
    return {};
  }
}

async function saveApiKeyToDb(providerId: string, apiKey: string): Promise<void> {
  const { settingsManager } = await import('@/stores/settings-store');
  await settingsManager.setProviderApiKey(providerId, apiKey);
}

async function saveBaseUrlToDb(providerId: string, baseUrl: string): Promise<void> {
  const { settingsManager } = await import('@/stores/settings-store');
  await settingsManager.setProviderBaseUrl(providerId, baseUrl);
}

// ===== Store Implementation =====

export const useProviderStore = create<ProviderStore>((set, get) => ({
  // Initial state
  providers: new Map(),
  providerConfigs: new Map(),
  apiKeys: {},
  baseUrls: new Map(),
  useCodingPlanSettings: new Map(),
  useInternationalSettings: new Map(),
  customProviders: [],
  customModels: {},
  oauthConfig: {} as OAuthConfig,
  availableModels: [],
  isInitialized: false,
  isLoading: false,
  error: null,

  // Initialize all provider/model state
  initialize: async () => {
    const { isInitialized, isLoading } = get();

    if (isInitialized || isLoading) {
      logger.debug('[ProviderStore] Already initialized or loading, skipping');
      return;
    }

    set({ isLoading: true, error: null });

    try {
      logger.info('[ProviderStore] Starting initialization...');

      // Ensure models are loaded first
      await ensureModelsInitialized();

      // Initialize model sync service (non-blocking, for hot-reload)
      modelSyncService.initialize().catch((err) => {
        logger.warn('[ProviderStore] Model sync initialization failed:', err);
      });

      // Initialize remote skills sync service (non-blocking, for hot-reload)
      remoteSkillsSyncService.initialize().catch((err) => {
        logger.warn('[ProviderStore] Remote skills sync initialization failed:', err);
      });

      // Initialize remote agents sync service (non-blocking, for hot-reload)
      remoteAgentsSyncService.initialize().catch((err) => {
        logger.warn('[ProviderStore] Remote agents sync initialization failed:', err);
      });

      // Load all data in parallel (including OAuth)
      const [
        apiKeys,
        baseUrls,
        useCodingPlanSettings,
        useInternationalSettings,
        customProviders,
        customModels,
        oauthConfig,
      ] = await Promise.all([
        loadApiKeys(),
        loadBaseUrls(),
        loadUseCodingPlanSettings(),
        loadUseInternationalSettings(),
        loadCustomProviders(),
        loadCustomModels(),
        loadOAuthConfig(),
      ]);

      logger.info('[ProviderStore] Data loaded', {
        apiKeyCount: Object.keys(apiKeys).filter((k) => apiKeys[k]).length,
        baseUrlCount: baseUrls.size,
        customProviderCount: customProviders.length,
        customModelCount: Object.keys(customModels).length,
        hasOAuth: !!oauthConfig.anthropicIsConnected,
      });

      const providerConfigs = mapRustProviderConfigs(await llmClient.getProviderConfigs());

      const providers = new Map<string, ProviderFactory>();
      for (const [providerId, config] of providerConfigs) {
        providers.set(providerId, (_modelName: string) => ({
          provider: providerId,
          config,
        }));
      }

      const availableModels = await llmClient.listAvailableModels();

      logger.info('[ProviderStore] Initialization complete', {
        providerCount: providers.size,
        availableModelCount: availableModels.length,
      });

      set({
        providers,
        providerConfigs,
        apiKeys,
        baseUrls,
        useCodingPlanSettings,
        useInternationalSettings,
        customProviders,
        customModels,
        oauthConfig,
        availableModels,
        isInitialized: true,
        isLoading: false,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[ProviderStore] Initialization failed:', error);
      set({
        error: errorMessage,
        isLoading: false,
        isInitialized: true, // Mark as initialized even on error to avoid infinite retries
      });
    }
  },

  syncOAuthStatus: async () => {
    try {
      const oauthConfig = await loadOAuthConfig();
      set({ oauthConfig });
    } catch (error) {
      logger.error('[ProviderStore] OAuth sync failed:', error);
    }
  },

  // Get provider model instance (legacy placeholder)
  getProviderModel: (modelIdentifier: string) => {
    const state = get();
    const { providerId: explicitProviderId } = parseModelIdentifier(modelIdentifier);
    const providerId = explicitProviderId || state.availableModels[0]?.provider;

    if (!providerId) {
      throw new Error(`No available provider for model: ${modelIdentifier}`);
    }

    const provider = state.providers.get(providerId);
    if (!provider) {
      throw new Error(`Provider ${providerId} not initialized for model: ${modelIdentifier}`);
    }

    return provider(modelIdentifier);
  },

  // Check if model is available (synchronous)
  isModelAvailable: (modelIdentifier: string) => {
    const state = get();
    const { modelKey, providerId } = parseModelIdentifier(modelIdentifier);

    if (providerId) {
      return state.availableModels.some(
        (model) => model.key === modelKey && model.provider === providerId
      );
    }
    return state.availableModels.some((model) => model.key === modelKey);
  },

  // Get best provider for a model (synchronous)
  getBestProviderForModel: (modelKey: string) => {
    const state = get();
    return state.availableModels.find((model) => model.key === modelKey)?.provider ?? null;
  },

  // Get the lowest cost available model (synchronous)
  // Used for fallback when a specific model is not configured
  getAvailableModel: () => {
    const state = get();
    const models = state.availableModels;

    // Filter models with input pricing info
    const modelsWithPricing = models.filter((m) => m.inputPricing !== undefined);

    if (modelsWithPricing.length === 0) {
      return null;
    }

    // Sort by input price (ascending) and return the cheapest
    const sorted = modelsWithPricing.sort((a, b) => {
      const priceA = Number.parseFloat(a.inputPricing ?? 'Infinity') || 0;
      const priceB = Number.parseFloat(b.inputPricing ?? 'Infinity') || 0;
      return priceA - priceB;
    });
    return sorted[0] ?? null;
  },

  // Set API key and rebuild providers
  setApiKey: async (providerId: string, apiKey: string) => {
    await saveApiKeyToDb(providerId, apiKey);

    const state = get();
    const newApiKeys = { ...state.apiKeys, [providerId]: apiKey };

    const availableModels = await llmClient.listAvailableModels();
    const providers = new Map<string, ProviderFactory>();
    for (const [id, config] of state.providerConfigs) {
      providers.set(id, (_modelName: string) => ({ provider: id, config }));
    }

    logger.info('[ProviderStore] API key updated', {
      providerId,
      hasKey: !!apiKey,
      newProviderCount: providers.size,
      newModelCount: availableModels.length,
    });

    set({
      apiKeys: newApiKeys,
      providers,
      availableModels,
    });
  },

  // Set base URL and rebuild providers
  setBaseUrl: async (providerId: string, baseUrl: string) => {
    await saveBaseUrlToDb(providerId, baseUrl);
    await llmClient.setSetting(`base_url_${providerId}`, baseUrl);

    const state = get();
    const newBaseUrls = new Map(state.baseUrls);
    if (baseUrl) {
      newBaseUrls.set(providerId, baseUrl);
    } else {
      newBaseUrls.delete(providerId);
    }

    const providers = new Map<string, ProviderFactory>();
    for (const [id, config] of state.providerConfigs) {
      providers.set(id, (_modelName: string) => ({ provider: id, config }));
    }

    logger.info('[ProviderStore] Base URL updated', {
      providerId,
      hasBaseUrl: !!baseUrl,
    });

    set({
      baseUrls: newBaseUrls,
      providers,
    });
  },

  // Add custom provider
  addCustomProvider: async (config: CustomProviderConfig) => {
    const { customProviderService } = await import('@/providers/custom/custom-provider-service');
    await customProviderService.addCustomProvider(config.id, config);
    await llmClient.registerCustomProvider({
      id: config.id,
      name: config.name,
      type: config.type,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      enabled: config.enabled,
      description: config.description,
    });

    // Reload and rebuild
    await get().refresh();
  },

  // Update custom provider
  updateCustomProvider: async (providerId: string, config: Partial<CustomProviderConfig>) => {
    const { customProviderService } = await import('@/providers/custom/custom-provider-service');
    await customProviderService.updateCustomProvider(providerId, config);

    if (config.baseUrl || config.apiKey || config.name || config.type || config.enabled) {
      const updated = await customProviderService.getCustomProvider(providerId);
      if (updated) {
        await llmClient.registerCustomProvider({
          id: updated.id,
          name: updated.name,
          type: updated.type,
          baseUrl: updated.baseUrl,
          apiKey: updated.apiKey,
          enabled: updated.enabled,
          description: updated.description,
        });
      }
    }

    // Reload and rebuild
    await get().refresh();
  },

  // Remove custom provider
  removeCustomProvider: async (providerId: string) => {
    const { customProviderService } = await import('@/providers/custom/custom-provider-service');
    await customProviderService.removeCustomProvider(providerId);

    // Reload and rebuild
    await get().refresh();
  },

  // Full refresh of all state
  refresh: async () => {
    logger.info('[ProviderStore] Refreshing all state...');

    try {
      const [
        apiKeys,
        baseUrls,
        useCodingPlanSettings,
        useInternationalSettings,
        customProviders,
        customModels,
        oauthConfig,
      ] = await Promise.all([
        loadApiKeys(),
        loadBaseUrls(),
        loadUseCodingPlanSettings(),
        loadUseInternationalSettings(),
        loadCustomProviders(),
        loadCustomModels(),
        loadOAuthConfig(),
      ]);

      const providerConfigs = mapRustProviderConfigs(await llmClient.getProviderConfigs());

      const providers = new Map<string, ProviderFactory>();
      for (const [providerId, config] of providerConfigs) {
        providers.set(providerId, (_modelName: string) => ({
          provider: providerId,
          config,
        }));
      }

      const availableModels = await llmClient.listAvailableModels();

      logger.info('[ProviderStore] Refresh complete', {
        providerCount: providers.size,
        availableModelCount: availableModels.length,
        hasOAuth: !!oauthConfig.anthropicIsConnected,
      });

      set({
        providers,
        providerConfigs,
        apiKeys,
        baseUrls,
        useCodingPlanSettings,
        useInternationalSettings,
        customProviders,
        customModels,
        oauthConfig,
        availableModels,
      });
    } catch (error) {
      logger.error('[ProviderStore] Refresh failed:', error);
    }
  },

  // Rebuild providers without reloading from database (for immediate state updates)
  rebuildProviders: () => {
    const state = get();

    const providers = new Map<string, ProviderFactory>();
    for (const [providerId, config] of state.providerConfigs) {
      providers.set(providerId, (_modelName: string) => ({
        provider: providerId,
        config,
      }));
    }

    logger.info('[ProviderStore] Providers rebuilt', {
      providerCount: providers.size,
      availableModelCount: state.availableModels.length,
    });

    set({ providers });
  },
}));

// ===== Backward Compatibility Exports =====

/**
 * modelService compatibility layer
 * @deprecated Use useProviderStore directly
 */
export const modelService = {
  getAvailableModels: async () => {
    await useProviderStore.getState().initialize();
    return useProviderStore.getState().availableModels;
  },

  isModelAvailable: async (modelIdentifier: string) => {
    await useProviderStore.getState().initialize();
    return useProviderStore.getState().isModelAvailable(modelIdentifier);
  },

  isModelAvailableSync: (modelIdentifier: string) =>
    useProviderStore.getState().isModelAvailable(modelIdentifier),

  // Methods that need agent/settings integration - import dynamically to avoid cycles
  getCurrentModel: async () => {
    const { settingsManager } = await import('@/stores/settings-store');
    const { agentRegistry } = await import('@/services/agents/agent-registry');
    const { modelTypeService } = await import('@/providers/models/model-type-service');

    const agentId = await settingsManager.getAgentId();
    let agent = await agentRegistry.getWithResolvedTools(agentId);

    if (!agent) {
      logger.warn(`Agent with ID "${agentId}" not found, falling back to default 'planner' agent`);
      agent = await agentRegistry.getWithResolvedTools('planner');
    }

    if (!agent) {
      logger.error('Unable to resolve any agent');
      return '';
    }

    if (!agent.modelType) {
      logger.warn('Agent has no modelType defined');
      return '';
    }

    const modelType = await modelTypeService.resolveModelType(agent.modelType);

    if (!modelType) {
      throw new Error(`No models configured for type: ${agent.modelType}`);
    }

    return modelType;
  },

  getBestProviderForModel: async (modelKey: string) => {
    await useProviderStore.getState().initialize();
    return useProviderStore.getState().getBestProviderForModel(modelKey);
  },
};
