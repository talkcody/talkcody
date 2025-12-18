import { logger } from '@/lib/logger';
import { MODEL_CONFIGS, type ModelKey, type ProviderType } from '@/lib/models';
import { PROVIDERS_WITH_CODING_PLAN, providerRegistry } from '@/providers';
import { modelService } from '@/services/model-service';
import { settingsManager } from '@/stores/settings-store';
import type { ApiKeySettings } from '@/types/api-keys';

export class AIProviderService {
  private providers: Map<string, any> = new Map();
  private apiKeys: ApiKeySettings | null = null;
  private baseUrls: Map<string, string> = new Map();
  private useCodingPlanSettings: Map<string, boolean> = new Map();
  private lastApiKeysUpdate = 0;
  private readonly API_KEYS_CACHE_TTL = 5000; // 5 seconds

  constructor() {
    // Initialize providers synchronously with cached API keys (if available)
    this.initializeProvidersSync();
    // Then initialize properly in the background
    this.initializeProviders();
  }

  private initializeProvidersSync(): void {
    try {
      // Try to get cached API keys synchronously only if settings are initialized
      this.apiKeys = settingsManager.getApiKeysSync();
      this.createProviders();
    } catch {
      // Settings not initialized yet - will be initialized async
      // This is expected on first load
    }
  }

  private async initializeProviders(): Promise<void> {
    try {
      await this.updateApiKeys();
      this.createProviders();
    } catch (error) {
      logger.warn('Failed to initialize providers:', error);
      // Continue without providers - they will be created when needed
    }
  }

  private async updateApiKeys(): Promise<void> {
    const now = Date.now();
    if (this.apiKeys && now - this.lastApiKeysUpdate < this.API_KEYS_CACHE_TTL) {
      return;
    }

    try {
      this.apiKeys = await settingsManager.getApiKeys();

      // Also load custom provider API keys
      const customApiKeys = await settingsManager.getCustomProviderApiKeys();
      this.apiKeys = { ...this.apiKeys, ...customApiKeys };

      this.lastApiKeysUpdate = now;

      // Load base URLs and useCodingPlan settings for all providers using batch queries
      this.baseUrls.clear();
      this.useCodingPlanSettings.clear();

      const allProviders = providerRegistry.getAllProviders();
      const providerIds = allProviders.map((p) => p.id);

      // Batch query all base URLs
      const baseUrlKeys = providerIds.map((id) => `base_url_${id}`);
      const baseUrlValues = await settingsManager.getBatch(baseUrlKeys);
      for (const providerId of providerIds) {
        const baseUrl = baseUrlValues[`base_url_${providerId}`];
        if (baseUrl) {
          this.baseUrls.set(providerId, baseUrl);
        }
      }

      // Batch query all useCodingPlan settings
      const codingPlanKeys = PROVIDERS_WITH_CODING_PLAN.map((id) => `use_coding_plan_${id}`);
      const codingPlanValues = await settingsManager.getBatch(codingPlanKeys);
      for (const providerId of PROVIDERS_WITH_CODING_PLAN) {
        const value = codingPlanValues[`use_coding_plan_${providerId}`];
        if (value !== undefined && value !== '') {
          this.useCodingPlanSettings.set(providerId, value === 'true');
        }
      }
    } catch (error) {
      logger.warn('Failed to get API keys from settings:', error);
      this.apiKeys = {};
    }
  }

  private createProviders(): void {
    if (!this.apiKeys) {
      logger.warn('Cannot create providers: API keys not loaded');
      return;
    }

    // Clear existing providers
    this.providers.clear();

    // Dynamically create providers based on registry
    for (const provider of providerRegistry.getAllProviders()) {
      const providerId = provider.id;
      let apiKey = this.apiKeys[providerId as keyof ApiKeySettings];

      // For custom providers, get API key from custom provider service
      if (provider.isCustom && provider.customConfig) {
        apiKey = provider.customConfig.apiKey;
      }

      // Skip if no API key (except for ollama/lmstudio which uses 'enabled')
      if (!apiKey) {
        logger.debug(`Skipping provider ${providerId}: no API key configured`);
        continue;
      }

      // For ollama/lmstudio, check if enabled
      if ((providerId === 'ollama' || providerId === 'lmstudio') && apiKey !== 'enabled') {
        continue;
      }

      // Create provider using the definition's factory function
      if (provider.createProvider) {
        // Use custom base URL if set, otherwise use the default from provider definition
        let customBaseUrl = this.baseUrls.get(providerId);

        // Special handling for providers with Coding Plan: determine base URL based on useCodingPlan setting
        if (!customBaseUrl) {
          const useCodingPlan = this.useCodingPlanSettings.get(providerId);
          if (useCodingPlan && provider.codingPlanBaseUrl) {
            customBaseUrl = provider.codingPlanBaseUrl;
          }
        }

        const baseUrl = customBaseUrl || provider.baseUrl;
        // logger.info(
        //   `Creating provider ${providerId} with base URL: ${baseUrl || 'default'} (custom: ${!!customBaseUrl})`
        // );
        try {
          const createdProvider = provider.createProvider(apiKey, baseUrl);
          this.providers.set(providerId, createdProvider);
        } catch (error) {
          logger.error(`Failed to create provider ${providerId}:`, error);
        }
      } else {
        logger.warn(`Provider ${providerId} has no createProvider function`);
      }
    }

    logger.info(`Created ${this.providers.size} providers`);
  }

  /**
   * Resolve the provider-specific model name
   */
  private resolveProviderModelName(modelKey: string, providerId: string): string {
    const config = MODEL_CONFIGS[modelKey as ModelKey];

    // Use provider-specific mapping if available, otherwise use the original model key
    return config?.providerMappings?.[providerId as ProviderType] || modelKey;
  }

  /**
   * Parse model identifier into modelKey and provider
   * Supports both formats:
   * - "modelKey@provider" (new format with explicit provider)
   * - "modelKey" (legacy format, will auto-select best provider)
   */
  private parseModelIdentifier(modelIdentifier: string): {
    modelKey: string;
    providerId: string | null;
  } {
    const parts = modelIdentifier.split('@');
    if (parts.length === 2) {
      return { modelKey: parts[0] ?? '', providerId: parts[1] ?? null };
    }
    return { modelKey: modelIdentifier, providerId: null };
  }

  getProviderModel(modelIdentifier: string) {
    // Parse the model identifier
    const { modelKey, providerId: explicitProviderId } = this.parseModelIdentifier(modelIdentifier);

    // Use explicit provider if specified, otherwise find best available
    const providerId = explicitProviderId || modelService.getBestProviderForModelSync(modelKey);
    if (!providerId) {
      throw new Error(
        `No available provider for model: ${modelKey}. Please configure API keys in settings.`
      );
    }

    const provider = this.providers.get(providerId);
    if (!provider) {
      logger.warn(
        `Provider ${providerId} not found, attempting to recreate. Current providers: ${Array.from(this.providers.keys()).join(', ')}`
      );
      // Try to get API keys synchronously before creating providers
      try {
        this.apiKeys = settingsManager.getApiKeysSync();
        logger.info('Reloaded API keys synchronously before recreating providers');
      } catch (error) {
        logger.error('Failed to reload API keys synchronously:', error);
      }
      // Try to create providers if not found
      this.createProviders();
      const retryProvider = this.providers.get(providerId);
      if (!retryProvider) {
        logger.error(
          `Failed to initialize provider ${providerId} for model ${modelKey}. Available providers after retry: ${Array.from(this.providers.keys()).join(', ')}`
        );
        throw new Error(`Provider ${providerId} not initialized for model: ${modelKey}`);
      }

      // Resolve provider-specific model name
      const providerModelName = this.resolveProviderModelName(modelKey, providerId);
      return retryProvider(providerModelName);
    }

    // Resolve provider-specific model name
    const providerModelName = this.resolveProviderModelName(modelKey, providerId);
    return provider(providerModelName);
  }

  // Async version for initialization scenarios
  async getProviderModelAsync(modelIdentifier: string) {
    await this.updateApiKeys();
    this.createProviders();

    // Parse the model identifier
    const { modelKey, providerId: explicitProviderId } = this.parseModelIdentifier(modelIdentifier);

    // Use explicit provider if specified, otherwise find best available
    const providerId = explicitProviderId || (await modelService.getBestProviderForModel(modelKey));
    if (!providerId) {
      throw new Error(
        `No available provider for model: ${modelKey}. Please configure API keys in settings.`
      );
    }

    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new Error(`Provider ${providerId} not initialized for model: ${modelKey}`);
    }

    // Resolve provider-specific model name
    const providerModelName = this.resolveProviderModelName(modelKey, providerId);
    return provider(providerModelName);
  }

  // Force refresh of API keys and providers
  async refreshProviders(): Promise<void> {
    this.apiKeys = null;
    this.lastApiKeysUpdate = 0;
    await this.updateApiKeys();
    this.createProviders();
  }

  // Refresh custom providers
  async refreshCustomProviders(): Promise<void> {
    await providerRegistry.refreshCustomProviders();
    await this.refreshProviders();
  }

  // Get a specific provider by ID
  getProvider(providerId: string) {
    return this.providers.get(providerId);
  }
}

export const aiProviderService = new AIProviderService();
