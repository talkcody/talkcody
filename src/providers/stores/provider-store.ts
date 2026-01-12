// src/stores/provider-store.ts
// Unified state management for providers and models

import { create } from 'zustand';
import { logger } from '@/lib/logger';
import { ensureModelsInitialized } from '@/providers/config/model-config';
import { PROVIDER_CONFIGS, PROVIDERS_WITH_CODING_PLAN } from '@/providers/config/provider-config';
import {
  buildProviderConfigs,
  isModelAvailable as checkModelAvailable,
  computeAvailableModels,
  createProviders,
  getBestProvider,
  type OAuthConfig,
  type ProviderFactory,
  parseModelIdentifier,
  resolveProviderModelName,
} from '@/providers/core/provider-utils';
import { modelSyncService } from '@/providers/models/model-sync-service';
import { remoteAgentsSyncService } from '@/providers/remote-agents/remote-agents-sync-service';
import { remoteSkillsSyncService } from '@/providers/remote-skills/remote-skills-sync-service';
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

  // Synchronous getters (main API for LLM service)
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
    // Load Claude OAuth
    const { getClaudeOAuthAccessToken } = await import('@/providers/oauth/claude-oauth-store');
    const anthropicAccessToken = await getClaudeOAuthAccessToken();

    // Load OpenAI OAuth - use helper function like Claude OAuth
    const { getOpenAIOAuthAccessToken } = await import('@/providers/oauth/openai-oauth-store');
    const openaiAccessToken = await getOpenAIOAuthAccessToken();

    // Get additional OpenAI OAuth state (accountId) if connected
    const { useOpenAIOAuthStore } = await import('@/providers/oauth/openai-oauth-store');
    const openaiStoreState = useOpenAIOAuthStore.getState();
    const openaiAccountId = openaiStoreState.accountId;

    // Load Qwen Code OAuth
    const { getQwenCodeOAuthAccessToken } = await import('@/providers/oauth/qwen-code-oauth-store');
    const qwenAccessToken = await getQwenCodeOAuthAccessToken();

    // Load GitHub Copilot OAuth
    const { getGitHubCopilotOAuthTokens } = await import(
      '@/providers/oauth/github-copilot-oauth-store'
    );
    const githubCopilotTokens = await getGitHubCopilotOAuthTokens();

    return {
      anthropicAccessToken,
      openaiAccessToken,
      openaiAccountId,
      qwenAccessToken,
      githubCopilotAccessToken: githubCopilotTokens?.accessToken || null,
      githubCopilotCopilotToken: githubCopilotTokens?.copilotToken || null,
      githubCopilotEnterpriseUrl: githubCopilotTokens?.enterpriseUrl || null,
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
  customProviders: [],
  customModels: {},
  oauthConfig: {},
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
      const [apiKeys, baseUrls, useCodingPlanSettings, customProviders, customModels, oauthConfig] =
        await Promise.all([
          loadApiKeys(),
          loadBaseUrls(),
          loadUseCodingPlanSettings(),
          loadCustomProviders(),
          loadCustomModels(),
          loadOAuthConfig(),
        ]);

      logger.info('[ProviderStore] Data loaded', {
        apiKeyCount: Object.keys(apiKeys).filter((k) => apiKeys[k]).length,
        baseUrlCount: baseUrls.size,
        customProviderCount: customProviders.length,
        customModelCount: Object.keys(customModels).length,
        hasOAuth: !!oauthConfig.anthropicAccessToken,
      });

      // Build provider configs (built-in + custom)
      const providerConfigs = buildProviderConfigs(customProviders);

      // Create provider instances (with OAuth support)
      const providers = createProviders(
        apiKeys,
        providerConfigs,
        baseUrls,
        useCodingPlanSettings,
        oauthConfig
      );

      // Compute available models (with OAuth support)
      const availableModels = computeAvailableModels(
        apiKeys,
        providerConfigs,
        customProviders,
        customModels,
        oauthConfig
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

  // Get provider model instance (synchronous - main API for LLM service)
  getProviderModel: (modelIdentifier: string) => {
    const state = get();
    const { modelKey, providerId: explicitProviderId } = parseModelIdentifier(modelIdentifier);

    // Use explicit provider if specified, otherwise find best available
    const providerId =
      explicitProviderId ||
      getBestProvider(modelKey, state.apiKeys, state.customProviders, state.oauthConfig);

    if (!providerId) {
      throw new Error(
        `No available provider for model: ${modelKey}. Please configure API keys in settings.`
      );
    }

    const provider = state.providers.get(providerId);
    if (!provider) {
      throw new Error(`Provider ${providerId} not initialized for model: ${modelKey}`);
    }

    // For OpenAI OAuth, we need to ensure the token is valid when making API calls
    // This is handled by the provider's custom fetch function
    const providerModelName = resolveProviderModelName(modelKey, providerId);
    return provider(providerModelName);
  },

  // Check if model is available (synchronous)
  isModelAvailable: (modelIdentifier: string) => {
    const state = get();
    return checkModelAvailable(
      modelIdentifier,
      state.apiKeys,
      state.customProviders,
      state.oauthConfig
    );
  },

  // Get best provider for a model (synchronous)
  getBestProviderForModel: (modelKey: string) => {
    const state = get();
    return getBestProvider(modelKey, state.apiKeys, state.customProviders, state.oauthConfig);
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
      state.useCodingPlanSettings,
      state.oauthConfig
    );
    const availableModels = computeAvailableModels(
      newApiKeys,
      state.providerConfigs,
      state.customProviders,
      state.customModels,
      state.oauthConfig
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
      state.useCodingPlanSettings,
      state.oauthConfig
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
    const { customProviderService } = await import('@/providers/custom/custom-provider-service');
    await customProviderService.addCustomProvider(config.id, config);

    // Reload and rebuild
    await get().refresh();
  },

  // Update custom provider
  updateCustomProvider: async (providerId: string, config: Partial<CustomProviderConfig>) => {
    const { customProviderService } = await import('@/providers/custom/custom-provider-service');
    await customProviderService.updateCustomProvider(providerId, config);

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
      // Reload all data (including OAuth)
      const [apiKeys, baseUrls, useCodingPlanSettings, customProviders, customModels, oauthConfig] =
        await Promise.all([
          loadApiKeys(),
          loadBaseUrls(),
          loadUseCodingPlanSettings(),
          loadCustomProviders(),
          loadCustomModels(),
          loadOAuthConfig(),
        ]);

      // Rebuild everything
      const providerConfigs = buildProviderConfigs(customProviders);
      const providers = createProviders(
        apiKeys,
        providerConfigs,
        baseUrls,
        useCodingPlanSettings,
        oauthConfig
      );
      const availableModels = computeAvailableModels(
        apiKeys,
        providerConfigs,
        customProviders,
        customModels,
        oauthConfig
      );

      logger.info('[ProviderStore] Refresh complete', {
        providerCount: providers.size,
        availableModelCount: availableModels.length,
        hasOAuth: !!oauthConfig.anthropicAccessToken,
      });

      set({
        providers,
        providerConfigs,
        apiKeys,
        baseUrls,
        useCodingPlanSettings,
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

    const providers = createProviders(
      state.apiKeys,
      state.providerConfigs,
      state.baseUrls,
      state.useCodingPlanSettings,
      state.oauthConfig
    );
    const availableModels = computeAvailableModels(
      state.apiKeys,
      state.providerConfigs,
      state.customProviders,
      state.customModels,
      state.oauthConfig
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
};
