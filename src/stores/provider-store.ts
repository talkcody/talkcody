// src/stores/provider-store.ts
// Unified state management for providers and models

import { create } from 'zustand';
import { logger } from '@/lib/logger';
import { ensureModelsInitialized, MODEL_CONFIGS } from '@/lib/models';
import {
  buildProviderConfigs,
  isModelAvailable as checkModelAvailable,
  computeAvailableModels,
  createProviders,
  getBestProvider,
  type ProviderFactory,
  parseModelIdentifier,
  resolveProviderModelName,
} from '@/lib/provider-utils';
import { PROVIDER_CONFIGS, PROVIDERS_WITH_CODING_PLAN } from '@/providers/provider_config';
import { modelSyncService } from '@/services/model-sync-service';
import type { ProviderDefinition } from '@/types';
import type { AvailableModel } from '@/types/api-keys';
import type { CustomProviderConfig } from '@/types/custom-provider';
import { isValidModelType, type ModelType } from '@/types/model-types';
import type { ModelConfig } from '@/types/models';

// ===== Types =====

interface ProviderStoreState {
  // Provider instances (ready to use)
  providers: Map<string, ProviderFactory>;

  // Provider configurations (built-in + custom)
  providerConfigs: Map<string, ProviderDefinition>;

  // API Keys from settings
  apiKeys: Record<string, string | undefined>;

  // Base URLs for providers
  baseUrls: Map<string, string>;

  // Use coding plan settings (for Zhipu)
  useCodingPlanSettings: Map<string, boolean>;

  // Custom providers from file
  customProviders: CustomProviderConfig[];

  // Custom models from file
  customModels: Record<string, ModelConfig>;

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

  // Synchronous getters (main API for LLM service)
  getProviderModel: (modelIdentifier: string) => ReturnType<ProviderFactory>;
  isModelAvailable: (modelIdentifier: string) => boolean;
  getBestProviderForModel: (modelKey: string) => string | null;

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

async function loadBaseUrls(): Promise<Map<string, string>> {
  const { settingsDb } = await import('@/stores/settings-store');
  await settingsDb.initialize();

  const providerIds = Object.keys(PROVIDER_CONFIGS);

  // Batch query all base URLs in a single database call
  const keys = providerIds.map((id) => `base_url_${id}`);
  const values = await settingsDb.getBatch(keys);

  const baseUrls = new Map<string, string>();
  for (const providerId of providerIds) {
    const baseUrl = values[`base_url_${providerId}`];
    if (baseUrl) {
      baseUrls.set(providerId, baseUrl);
    }
  }

  return baseUrls;
}

async function loadUseCodingPlanSettings(): Promise<Map<string, boolean>> {
  const { settingsDb } = await import('@/stores/settings-store');
  await settingsDb.initialize();

  // Batch query all coding plan settings in a single database call
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

async function loadCustomProviders(): Promise<CustomProviderConfig[]> {
  const { customProviderService } = await import('@/services/custom-provider-service');

  return customProviderService.getEnabledCustomProviders();
}

async function loadCustomModels(): Promise<Record<string, ModelConfig>> {
  try {
    const { customModelService } = await import('@/services/custom-model-service');
    const config = await customModelService.getCustomModels();
    return config.models;
  } catch (error) {
    logger.warn('Failed to load custom models:', error);
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
  customProviders: [],
  customModels: {},
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

      // Load all data in parallel
      const [apiKeys, baseUrls, useCodingPlanSettings, customProviders, customModels] =
        await Promise.all([
          loadApiKeys(),
          loadBaseUrls(),
          loadUseCodingPlanSettings(),
          loadCustomProviders(),
          loadCustomModels(),
        ]);

      logger.info('[ProviderStore] Data loaded', {
        apiKeyCount: Object.keys(apiKeys).filter((k) => apiKeys[k]).length,
        baseUrlCount: baseUrls.size,
        customProviderCount: customProviders.length,
        customModelCount: Object.keys(customModels).length,
      });

      // Build provider configs (built-in + custom)
      const providerConfigs = buildProviderConfigs(customProviders);

      // Create provider instances
      const providers = createProviders(apiKeys, providerConfigs, baseUrls, useCodingPlanSettings);

      // Compute available models
      const availableModels = computeAvailableModels(
        apiKeys,
        providerConfigs,
        customProviders,
        customModels
      );

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
        customProviders,
        customModels,
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

  // Get provider model instance (synchronous - main API for LLM service)
  getProviderModel: (modelIdentifier: string) => {
    const state = get();
    const { modelKey, providerId: explicitProviderId } = parseModelIdentifier(modelIdentifier);

    // Use explicit provider if specified, otherwise find best available
    const providerId =
      explicitProviderId || getBestProvider(modelKey, state.apiKeys, state.customProviders);

    if (!providerId) {
      throw new Error(
        `No available provider for model: ${modelKey}. Please configure API keys in settings.`
      );
    }

    const provider = state.providers.get(providerId);
    if (!provider) {
      // Check if this might be a custom provider that was deleted
      const isCustomProvider =
        providerId.startsWith('openai-compatible-') || providerId.startsWith('anthropic-');

      if (isCustomProvider) {
        throw new Error(
          `Custom provider "${providerId}" not found. It may have been deleted. ` +
            `Please select a different model in settings.`
        );
      }

      throw new Error(`Provider ${providerId} not initialized for model: ${modelKey}`);
    }

    // Resolve provider-specific model name
    const providerModelName = resolveProviderModelName(modelKey, providerId);
    return provider(providerModelName);
  },

  // Check if model is available (synchronous)
  isModelAvailable: (modelIdentifier: string) => {
    const state = get();
    return checkModelAvailable(modelIdentifier, state.apiKeys, state.customProviders);
  },

  // Get best provider for a model (synchronous)
  getBestProviderForModel: (modelKey: string) => {
    const state = get();
    return getBestProvider(modelKey, state.apiKeys, state.customProviders);
  },

  // Set API key and rebuild providers
  setApiKey: async (providerId: string, apiKey: string) => {
    // Persist to database
    await saveApiKeyToDb(providerId, apiKey);

    // Update state
    const state = get();
    const newApiKeys = { ...state.apiKeys, [providerId]: apiKey };

    // Rebuild providers and available models
    const providers = createProviders(
      newApiKeys,
      state.providerConfigs,
      state.baseUrls,
      state.useCodingPlanSettings
    );
    const availableModels = computeAvailableModels(
      newApiKeys,
      state.providerConfigs,
      state.customProviders,
      state.customModels
    );

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
    // Persist to database
    await saveBaseUrlToDb(providerId, baseUrl);

    // Update state
    const state = get();
    const newBaseUrls = new Map(state.baseUrls);
    if (baseUrl) {
      newBaseUrls.set(providerId, baseUrl);
    } else {
      newBaseUrls.delete(providerId);
    }

    // Rebuild providers
    const providers = createProviders(
      state.apiKeys,
      state.providerConfigs,
      newBaseUrls,
      state.useCodingPlanSettings
    );

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
    const { customProviderService } = await import('@/services/custom-provider-service');
    await customProviderService.addCustomProvider(config.id, config);

    // Reload and rebuild
    await get().refresh();
  },

  // Update custom provider
  updateCustomProvider: async (providerId: string, config: Partial<CustomProviderConfig>) => {
    const { customProviderService } = await import('@/services/custom-provider-service');
    await customProviderService.updateCustomProvider(providerId, config);

    // Reload and rebuild
    await get().refresh();
  },

  // Remove custom provider
  removeCustomProvider: async (providerId: string) => {
    const { customProviderService } = await import('@/services/custom-provider-service');
    await customProviderService.removeCustomProvider(providerId);

    // Reload and rebuild
    await get().refresh();
  },

  // Full refresh of all state
  refresh: async () => {
    logger.info('[ProviderStore] Refreshing all state...');

    try {
      // Reload all data
      const [apiKeys, baseUrls, useCodingPlanSettings, customProviders, customModels] =
        await Promise.all([
          loadApiKeys(),
          loadBaseUrls(),
          loadUseCodingPlanSettings(),
          loadCustomProviders(),
          loadCustomModels(),
        ]);

      // Rebuild everything
      const providerConfigs = buildProviderConfigs(customProviders);
      const providers = createProviders(apiKeys, providerConfigs, baseUrls, useCodingPlanSettings);
      const availableModels = computeAvailableModels(
        apiKeys,
        providerConfigs,
        customProviders,
        customModels
      );

      logger.info('[ProviderStore] Refresh complete', {
        providerCount: providers.size,
        availableModelCount: availableModels.length,
      });

      set({
        providers,
        providerConfigs,
        apiKeys,
        baseUrls,
        useCodingPlanSettings,
        customProviders,
        customModels,
        availableModels,
      });
    } catch (error) {
      logger.error('[ProviderStore] Refresh failed:', error);
    }
  },

  // Rebuild providers without reloading from database (for immediate state updates)
  rebuildProviders: () => {
    const state = get();

    const providers = createProviders(
      state.apiKeys,
      state.providerConfigs,
      state.baseUrls,
      state.useCodingPlanSettings
    );
    const availableModels = computeAvailableModels(
      state.apiKeys,
      state.providerConfigs,
      state.customProviders,
      state.customModels
    );

    logger.info('[ProviderStore] Providers rebuilt', {
      providerCount: providers.size,
      availableModelCount: availableModels.length,
    });

    set({ providers, availableModels });
  },
}));

// ===== Backward Compatibility Exports =====

/**
 * aiProviderService compatibility layer
 * @deprecated Use useProviderStore directly
 */
export const aiProviderService = {
  getProviderModel: (modelIdentifier: string) =>
    useProviderStore.getState().getProviderModel(modelIdentifier),

  getProviderModelAsync: async (modelIdentifier: string) => {
    // Ensure initialized before getting provider
    await useProviderStore.getState().initialize();
    return useProviderStore.getState().getProviderModel(modelIdentifier);
  },

  refreshProviders: () => useProviderStore.getState().refresh(),

  refreshCustomProviders: () => useProviderStore.getState().refresh(),

  getProvider: (providerId: string) => useProviderStore.getState().providers.get(providerId),
};

/**
 * modelService compatibility layer
 * @deprecated Use useProviderStore directly
 */
export const modelService = {
  initialize: () => useProviderStore.getState().initialize(),

  getAvailableModels: async () => {
    await useProviderStore.getState().initialize();
    return useProviderStore.getState().availableModels;
  },

  getAvailableModelsSync: () => useProviderStore.getState().availableModels,

  getBestProviderForModel: async (modelKey: string) => {
    await useProviderStore.getState().initialize();
    return useProviderStore.getState().getBestProviderForModel(modelKey);
  },

  getBestProviderForModelSync: (modelKey: string) =>
    useProviderStore.getState().getBestProviderForModel(modelKey),

  isModelAvailable: async (modelIdentifier: string) => {
    await useProviderStore.getState().initialize();
    return useProviderStore.getState().isModelAvailable(modelIdentifier);
  },

  isModelAvailableSync: (modelIdentifier: string) =>
    useProviderStore.getState().isModelAvailable(modelIdentifier),

  refreshModels: async () => {
    await useProviderStore.getState().refresh();
    return modelSyncService.manualRefresh();
  },

  // Methods that need agent/settings integration - import dynamically to avoid cycles
  getCurrentModel: async () => {
    const { settingsManager } = await import('@/stores/settings-store');
    const { agentRegistry } = await import('@/services/agents/agent-registry');
    const { modelTypeService } = await import('@/services/model-type-service');

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

    const modelType = (agent as { modelType?: string })?.modelType;
    if (!modelType) {
      logger.warn('Agent has no modelType defined');
      return '';
    }

    if (!isValidModelType(modelType)) {
      logger.warn(`Invalid modelType: ${modelType}`);
      return '';
    }
    return await modelTypeService.resolveModelType(modelType as ModelType);
  },

  setCurrentModel: async (modelIdentifier: string) => {
    const { settingsManager } = await import('@/stores/settings-store');
    const { agentRegistry } = await import('@/services/agents/agent-registry');
    const { MODEL_TYPE_SETTINGS_KEYS } = await import('@/types/model-types');

    const agentId = await settingsManager.getAgentId();
    let agent = await agentRegistry.getWithResolvedTools(agentId);

    if (!agent) {
      agent = await agentRegistry.getWithResolvedTools('planner');
    }

    if (!agent) {
      throw new Error('Unable to resolve agent for model selection');
    }

    const modelType = (agent as { modelType?: string })?.modelType;
    if (!modelType) {
      throw new Error('Agent has no modelType defined');
    }

    const settingsKey =
      MODEL_TYPE_SETTINGS_KEYS[modelType as keyof typeof MODEL_TYPE_SETTINGS_KEYS];
    if (!settingsKey) {
      throw new Error(`No settings key found for modelType: ${modelType}`);
    }

    await settingsManager.set(settingsKey, modelIdentifier);
    logger.info(`Model updated to ${modelIdentifier} for modelType ${modelType}`);
  },

  getAllProviders: () => PROVIDER_CONFIGS,

  getModelWithProvider: async (modelKey: string) => {
    const modelConfig = MODEL_CONFIGS[modelKey as keyof typeof MODEL_CONFIGS];
    if (!modelConfig) return null;

    const provider = useProviderStore.getState().getBestProviderForModel(modelKey);
    if (!provider) return null;

    return { model: modelConfig, provider };
  },
};
