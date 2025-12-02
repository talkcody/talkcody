import { BaseDirectory, exists, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { logger } from '@/lib/logger';
import { createTauriFetch } from '@/lib/tauri-fetch';
import { PROVIDER_CONFIGS, type ProviderIds } from '@/providers/provider_config';
import { settingsManager } from '@/stores/settings-store';
import type { ModelConfig, ModelsConfiguration } from '@/types/models';

const CUSTOM_MODELS_FILENAME = 'custom-models.json';

/**
 * Local AI providers that don't require API keys
 */
export const LOCAL_PROVIDERS = ['ollama', 'lmstudio'] as const;
export type LocalProvider = (typeof LOCAL_PROVIDERS)[number];

export function isLocalProvider(providerId: string): boolean {
  return LOCAL_PROVIDERS.includes(providerId as LocalProvider);
}

/**
 * Provider endpoints for fetching available models
 */
const PROVIDER_MODELS_ENDPOINTS: Record<string, string | null> = {
  openai: 'https://api.openai.com/v1/models',
  ollama: 'http://127.0.0.1:11434/v1/models',
  lmstudio: 'http://127.0.0.1:1234/v1/models',
  openRouter: 'https://openrouter.ai/api/v1/models',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4/models',
  MiniMax: 'https://api.minimaxi.com/v1/models',
  // Providers that don't support /v1/models endpoint
  anthropic: null,
  google: null,
  aiGateway: null,
  tavily: null,
  elevenlabs: null,
};

interface FetchedModel {
  id: string;
  name?: string;
  owned_by?: string;
}

interface ModelsListResponse {
  data: FetchedModel[];
}

/**
 * Service for managing custom models
 */
class CustomModelService {
  private memoryCache: ModelsConfiguration | null = null;

  /**
   * Get custom models configuration
   */
  async getCustomModels(): Promise<ModelsConfiguration> {
    if (this.memoryCache) {
      return this.memoryCache;
    }

    try {
      const fileExists = await exists(CUSTOM_MODELS_FILENAME, {
        baseDir: BaseDirectory.AppData,
      });

      if (!fileExists) {
        // Return empty config if file doesn't exist
        const emptyConfig: ModelsConfiguration = {
          version: 'custom',
          models: {},
        };
        return emptyConfig;
      }

      const content = await readTextFile(CUSTOM_MODELS_FILENAME, {
        baseDir: BaseDirectory.AppData,
      });
      const config = JSON.parse(content) as ModelsConfiguration;
      this.memoryCache = config;
      return config;
    } catch (error) {
      logger.warn('Failed to load custom models:', error);
      return { version: 'custom', models: {} };
    }
  }

  /**
   * Save custom models configuration
   */
  private async saveCustomModels(config: ModelsConfiguration): Promise<void> {
    try {
      const content = JSON.stringify(config, null, 2);
      await writeTextFile(CUSTOM_MODELS_FILENAME, content, {
        baseDir: BaseDirectory.AppData,
      });
      this.memoryCache = config;
      logger.info('Custom models saved successfully');
    } catch (error) {
      logger.error('Failed to save custom models:', error);
      throw error;
    }
  }

  /**
   * Add a custom model
   */
  async addCustomModel(modelId: string, modelConfig: ModelConfig): Promise<void> {
    const config = await this.getCustomModels();
    config.models[modelId] = modelConfig;
    await this.saveCustomModels(config);

    // Dispatch event to notify UI
    window.dispatchEvent(new CustomEvent('customModelsUpdated'));
  }

  /**
   * Add multiple custom models at once
   */
  async addCustomModels(models: Record<string, ModelConfig>): Promise<void> {
    const config = await this.getCustomModels();
    config.models = { ...config.models, ...models };
    await this.saveCustomModels(config);

    // Dispatch event to notify UI
    window.dispatchEvent(new CustomEvent('customModelsUpdated'));
  }

  /**
   * Remove a custom model
   */
  async removeCustomModel(modelId: string): Promise<void> {
    const config = await this.getCustomModels();
    delete config.models[modelId];
    await this.saveCustomModels(config);

    // Dispatch event to notify UI
    window.dispatchEvent(new CustomEvent('customModelsUpdated'));
  }

  /**
   * Check if a model is a custom model
   */
  async isCustomModel(modelId: string): Promise<boolean> {
    const config = await this.getCustomModels();
    return modelId in config.models;
  }

  /**
   * Clear memory cache
   */
  clearCache(): void {
    this.memoryCache = null;
  }

  /**
   * Check if provider supports fetching models list
   */
  supportsModelsFetch(providerId: string): boolean {
    return PROVIDER_MODELS_ENDPOINTS[providerId] !== null;
  }

  /**
   * Get the models endpoint for a provider
   */
  getModelsEndpoint(providerId: string): string | null {
    return PROVIDER_MODELS_ENDPOINTS[providerId] ?? null;
  }

  /**
   * Fetch available models from a provider
   */
  async fetchProviderModels(providerId: string): Promise<FetchedModel[]> {
    const endpoint = this.getModelsEndpoint(providerId);
    if (!endpoint) {
      throw new Error(`Provider ${providerId} does not support models listing`);
    }

    // Get API key for the provider
    const apiKey = settingsManager.getProviderApiKey(providerId);

    // For local providers (ollama, lmstudio), API key is optional
    if (!apiKey && !isLocalProvider(providerId)) {
      throw new Error(`No API key configured for provider ${providerId}`);
    }

    try {
      const tauriFetch = createTauriFetch();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      // Add authorization header if API key exists
      if (apiKey && !isLocalProvider(providerId)) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      // Special headers for OpenRouter
      if (providerId === 'openRouter') {
        headers['HTTP-Referer'] = 'https://talkcody.com';
        headers['X-Title'] = 'TalkCody';
      }

      const response = await tauriFetch(endpoint, {
        method: 'GET',
        headers,
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as ModelsListResponse;

      // Normalize the response
      const models = data.data || [];
      return models.map((m) => ({
        id: m.id,
        name: m.name || m.id,
        owned_by: m.owned_by,
      }));
    } catch (error) {
      logger.error(`Failed to fetch models from ${providerId}:`, error);
      throw error;
    }
  }

  /**
   * Get list of providers that support models fetching and have API keys configured
   */
  getAvailableProvidersForFetch(): Array<{ id: string; name: string }> {
    const providers: Array<{ id: string; name: string }> = [];

    for (const [providerId, endpoint] of Object.entries(PROVIDER_MODELS_ENDPOINTS)) {
      if (endpoint === null) continue;

      const providerConfig = PROVIDER_CONFIGS[providerId as ProviderIds];
      if (!providerConfig) continue;

      // Check if API key is configured (or local provider is enabled)
      const apiKey = settingsManager.getProviderApiKey(providerId);

      // Local providers need to be enabled, remote providers need API key
      const isAvailable = isLocalProvider(providerId) ? apiKey === 'enabled' : !!apiKey;

      if (isAvailable) {
        providers.push({
          id: providerId,
          name: providerConfig.name,
        });
      }
    }

    return providers;
  }
}

// Export singleton instance
export const customModelService = new CustomModelService();
export default customModelService;
