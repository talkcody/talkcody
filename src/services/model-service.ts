// src/services/model-service.ts
import { logger } from '@/lib/logger';
import { getProvidersForModel, MODEL_CONFIGS } from '@/lib/models';
import { PROVIDER_CONFIGS, providerRegistry } from '@/providers';
import { settingsManager } from '@/stores/settings-store';
import type { AgentDefinition } from '@/types/agent';
import type { ApiKeySettings, AvailableModel } from '@/types/api-keys';
import { MODEL_TYPE_SETTINGS_KEYS } from '@/types/model-types';
import { agentRegistry } from './agents/agent-registry';
import { customModelService } from './custom-model-service';
import { customProviderService } from './custom-provider-service';
import { modelSyncService } from './model-sync-service';
import { modelTypeService } from './model-type-service';

export class ModelService {
  private syncInitialized = false;

  /**
   * Initialize model sync service (called once on app startup)
   */
  async initialize(): Promise<void> {
    if (!this.syncInitialized) {
      await modelSyncService.initialize();
      this.syncInitialized = true;
    }
  }

  /**
   * Get all available models based on configured API keys
   */
  async getAvailableModels(): Promise<AvailableModel[]> {
    // Ensure sync service is initialized
    await this.initialize();

    const apiKeys = await this.getApiKeys();
    const availableModels: AvailableModel[] = [];

    // Iterate through all built-in models
    for (const [modelKey, modelConfig] of Object.entries(MODEL_CONFIGS)) {
      if (!modelConfig) continue;

      // Find all available providers for this model (not just the best one)
      const providers = getProvidersForModel(modelKey);
      // logger.info(`Found ${providers.length} providers for model ${modelKey}`);
      const availableProviders = this.getAllAvailableProviders(providers, apiKeys);
      // logger.info(`Found ${availableProviders.length} available providers for model ${modelKey}`);

      // Create a model entry for each available provider
      for (const provider of availableProviders) {
        availableModels.push({
          key: modelKey,
          name: modelConfig.name,
          provider: provider.id,
          providerName: provider.name,
          imageInput: modelConfig.imageInput ?? false,
          imageOutput: modelConfig.imageOutput ?? false,
          audioInput: modelConfig.audioInput ?? false,
        });
      }
    }

    // Add custom models
    try {
      const customModelsConfig = await customModelService.getCustomModels();
      const enabledCustomProviders = await customProviderService.getEnabledCustomProviders();
      const customProviderIds = new Set(enabledCustomProviders.map((p) => p.id));

      for (const [modelKey, modelConfig] of Object.entries(customModelsConfig.models)) {
        // Custom models have explicit providers, check if provider is available
        for (const providerId of modelConfig.providers) {
          // Check if it's a built-in provider with API key, or an enabled custom provider
          const isBuiltInWithKey = this.hasApiKeyForProvider(providerId, apiKeys);
          const isCustomProviderEnabled = customProviderIds.has(providerId);

          if (isBuiltInWithKey || isCustomProviderEnabled) {
            // Get provider name from built-in config or custom provider
            let providerName = providerId;
            const builtInConfig = PROVIDER_CONFIGS[providerId as keyof typeof PROVIDER_CONFIGS];
            if (builtInConfig) {
              providerName = builtInConfig.name;
            } else {
              const customProvider = enabledCustomProviders.find((p) => p.id === providerId);
              if (customProvider) {
                providerName = customProvider.name;
              }
            }

            availableModels.push({
              key: modelKey,
              name: modelConfig.name,
              provider: providerId,
              providerName,
              imageInput: modelConfig.imageInput ?? false,
              imageOutput: modelConfig.imageOutput ?? false,
              audioInput: modelConfig.audioInput ?? false,
            });
          }
        }
      }
    } catch (error) {
      logger.warn('Failed to load custom models:', error);
    }

    // Sort by name
    return availableModels.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Get available models synchronously (for performance-critical scenarios)
   */
  getAvailableModelsSync(): AvailableModel[] {
    let apiKeys: ApiKeySettings;
    try {
      apiKeys = settingsManager.getApiKeysSync();
    } catch {
      // Fallback to empty keys if settings not initialized
      apiKeys = {};
    }

    const availableModels: AvailableModel[] = [];

    // Iterate through all models
    for (const [modelKey, modelConfig] of Object.entries(MODEL_CONFIGS)) {
      if (!modelConfig) continue;

      // Find all available providers for this model (not just the best one)
      const providers = getProvidersForModel(modelKey);
      const availableProviders = this.getAllAvailableProviders(providers, apiKeys);

      // Create a model entry for each available provider
      for (const provider of availableProviders) {
        availableModels.push({
          key: modelKey,
          name: modelConfig.name,
          provider: provider.id,
          providerName: provider.name,
          imageInput: modelConfig.imageInput ?? false,
          imageOutput: modelConfig.imageOutput ?? false,
          audioInput: modelConfig.audioInput ?? false,
        });
      }
    }

    return availableModels.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Get the best provider for a specific model
   */
  async getBestProviderForModel(modelKey: string): Promise<string | null> {
    const apiKeys = await this.getApiKeys();
    const providers = getProvidersForModel(modelKey);
    const bestProvider = this.getBestAvailableProvider(providers, apiKeys);
    return bestProvider?.id || null;
  }

  /**
   * Get the best provider for a specific model synchronously
   */
  getBestProviderForModelSync(modelKey: string): string | null {
    let apiKeys: ApiKeySettings;
    try {
      apiKeys = settingsManager.getApiKeysSync();
    } catch {
      apiKeys = {};
    }

    const providers = getProvidersForModel(modelKey);
    const bestProvider = this.getBestAvailableProvider(providers, apiKeys);
    return bestProvider?.id || null;
  }

  /**
   * Parse model identifier into modelKey and provider
   * Supports both formats:
   * - "modelKey@provider" (new format with explicit provider)
   * - "modelKey" (legacy format)
   */
  private parseModelIdentifier(modelIdentifier: string): {
    modelKey: string;
    providerId: string | null;
  } {
    const parts = modelIdentifier.split('@');
    if (parts.length === 2 && parts[0] && parts[1]) {
      return { modelKey: parts[0], providerId: parts[1] };
    }
    return { modelKey: modelIdentifier, providerId: null };
  }

  /**
   * Check if a model is available (has at least one provider with API key)
   */
  async isModelAvailable(modelIdentifier: string): Promise<boolean> {
    const { modelKey, providerId } = this.parseModelIdentifier(modelIdentifier);

    logger.debug(
      `isModelAvailable: modelIdentifier=${modelIdentifier}, modelKey=${modelKey}, providerId=${providerId}`
    );

    if (providerId) {
      // Check specific provider - could be built-in or custom provider
      const apiKeys = await this.getApiKeys();
      const hasBuiltInKey = this.hasApiKeyForProvider(providerId, apiKeys);
      logger.debug(`isModelAvailable: hasBuiltInKey=${hasBuiltInKey}`);
      if (hasBuiltInKey) {
        return true;
      }

      // Check if it's an enabled custom provider
      const enabledCustomProviders = await customProviderService.getEnabledCustomProviders();
      const isCustomProviderEnabled = enabledCustomProviders.some((p) => p.id === providerId);
      logger.debug(
        `isModelAvailable: enabledCustomProviders=${enabledCustomProviders.map((p) => p.id).join(',')}, isCustomProviderEnabled=${isCustomProviderEnabled}`
      );
      if (isCustomProviderEnabled) {
        return true;
      }

      return false;
    }

    // Check if any provider is available
    const provider = await this.getBestProviderForModel(modelKey);
    return provider !== null;
  }

  /**
   * Check if a model is available synchronously
   */
  isModelAvailableSync(modelIdentifier: string): boolean {
    const { modelKey, providerId } = this.parseModelIdentifier(modelIdentifier);

    if (providerId) {
      // Check specific provider - could be built-in or custom provider
      let apiKeys: ApiKeySettings;
      try {
        apiKeys = settingsManager.getApiKeysSync();
      } catch {
        apiKeys = {};
      }
      const hasBuiltInKey = this.hasApiKeyForProvider(providerId, apiKeys);
      if (hasBuiltInKey) {
        return true;
      }

      // Check if it's an enabled custom provider (from cache)
      const enabledCustomProviders = customProviderService.getEnabledCustomProvidersSync();
      const isCustomProviderEnabled = enabledCustomProviders.some((p) => p.id === providerId);
      if (isCustomProviderEnabled) {
        return true;
      }

      return false;
    }

    // Check if any provider is available
    const provider = this.getBestProviderForModelSync(modelKey);
    return provider !== null;
  }

  /**
   * Get model configuration including the best provider
   */
  async getModelWithProvider(modelKey: string): Promise<{ model: any; provider: string } | null> {
    const modelConfig = MODEL_CONFIGS[modelKey as keyof typeof MODEL_CONFIGS];
    if (!modelConfig) return null;

    const provider = await this.getBestProviderForModel(modelKey);
    if (!provider) return null;

    return { model: modelConfig, provider };
  }

  /**
   * Find all available providers from a list based on API key availability
   */
  private getAllAvailableProviders(providers: any[], apiKeys: ApiKeySettings): any[] {
    const availableProviders = providers.filter((provider) => {
      const hasKey = this.hasApiKeyForProvider(provider.id, apiKeys);
      // logger.info(`[getAllAvailableProviders] Provider ${provider.id} hasKey: ${hasKey}`);
      return hasKey;
    });
    return availableProviders;
  }

  /**
   * Find the best available provider from a list based on API key availability
   */
  private getBestAvailableProvider(providers: any[], apiKeys: ApiKeySettings): any | null {
    for (const provider of providers) {
      if (this.hasApiKeyForProvider(provider.id, apiKeys)) {
        return provider;
      }
    }

    return null;
  }

  /**
   * Check if API key is configured for a provider
   */
  private hasApiKeyForProvider(providerId: string, apiKeys: ApiKeySettings): boolean {
    return providerRegistry.hasApiKey(providerId, apiKeys);
  }

  /**
   * Get API keys with simple caching
   */
  private async getApiKeys(): Promise<ApiKeySettings> {
    return await settingsManager.getApiKeys();
  }

  /**
   * Get the current model for the active agent
   * @returns Model identifier in format "modelKey@provider" or empty string if not configured
   */
  async getCurrentModel(): Promise<string> {
    // Use override agent if provided (for commands), otherwise use user's selected agent
    const agentId = await settingsManager.getAgentId();

    // Get agent with MCP tools resolved
    let agent = await agentRegistry.getWithResolvedTools(agentId);
    if (!agent) {
      logger.warn(`Agent with ID "${agentId}" not found, falling back to default 'planner' agent`);
      agent = await agentRegistry.getWithResolvedTools('planner');
    }

    // If still no agent found, return empty string
    if (!agent) {
      logger.error('Unable to resolve any agent, including fallback planner agent');
      return '';
    }

    // Get modelType from agent
    const modelType = (agent as AgentDefinition)?.modelType;
    if (!modelType) {
      logger.warn('Agent has no modelType defined');
      return '';
    }

    // Use modelTypeService to resolve the model with proper fallback to defaults
    // This ensures new users get the default model even if no model is configured
    return await modelTypeService.resolveModelType(modelType);
  }

  /**
   * Set the current model for the active agent
   * @param modelIdentifier Model identifier in format "modelKey@provider"
   */
  async setCurrentModel(modelIdentifier: string): Promise<void> {
    // Use override agent if provided (for commands), otherwise use user's selected agent
    const agentId = await settingsManager.getAgentId();

    // Get agent with MCP tools resolved
    let agent = await agentRegistry.getWithResolvedTools(agentId);
    if (!agent) {
      logger.warn(`Agent with ID "${agentId}" not found, falling back to default 'planner' agent`);
      agent = await agentRegistry.getWithResolvedTools('planner');
    }

    // If still no agent found, throw error
    if (!agent) {
      logger.error('Unable to resolve any agent, including fallback planner agent');
      throw new Error('Unable to resolve agent for model selection');
    }

    // Get modelType from agent
    const modelType = (agent as AgentDefinition)?.modelType;
    if (!modelType) {
      logger.warn('Agent has no modelType defined');
      throw new Error('Agent has no modelType defined');
    }

    // Get settings key for this model type
    const settingsKey = MODEL_TYPE_SETTINGS_KEYS[modelType];
    if (!settingsKey) {
      logger.warn(`No settings key found for modelType: ${modelType}`);
      throw new Error(`No settings key found for modelType: ${modelType}`);
    }

    // Set model value in settings (format: "modelKey@provider")
    await settingsManager.set(settingsKey, modelIdentifier);
    logger.info(`Model updated to ${modelIdentifier} for modelType ${modelType}`);
  }

  /**
   * Get all configured providers
   */
  getAllProviders() {
    return PROVIDER_CONFIGS;
  }
}

export const modelService = new ModelService();
