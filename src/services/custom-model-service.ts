import { invoke } from '@tauri-apps/api/core';
import { BaseDirectory, exists, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { logger } from '@/lib/logger';
import type { ProxyRequest, ProxyResponse } from '@/lib/tauri-fetch';
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
  MiniMax: null, // MiniMax doesn't support /v1/models endpoint
  deepseek: 'https://api.deepseek.com/v1/models',
  anthropic: 'https://api.anthropic.com/v1/models',
  google: 'https://generativelanguage.googleapis.com/v1beta/models', // API key as query param
  aiGateway: 'https://ai-gateway.vercel.sh/v1/models',
  // Non-AI providers, no need to test
  tavily: null,
  elevenlabs: null,
};

// Raw model from API response (fields may be optional)
interface RawModel {
  id?: string;
  name?: string;
  owned_by?: string;
}

// Normalized model returned by the service
export interface FetchedModel {
  id: string;
  name: string;
  owned_by?: string;
}

interface ModelsListResponse {
  data?: RawModel[];
  models?: RawModel[]; // Google format
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
    let endpoint = this.getModelsEndpoint(providerId);
    if (!endpoint) {
      throw new Error(`Provider ${providerId} does not support models listing`);
    }

    // Check if user has set a custom base URL (for providers like Anthropic, OpenAI)
    const customBaseUrl = await settingsManager.getProviderBaseUrl(providerId);
    if (customBaseUrl) {
      // Use custom base URL to construct models endpoint
      // Remove trailing slashes and append /models
      endpoint = customBaseUrl.replace(/\/+$/, '') + '/models';
      logger.info(`Using custom base URL for ${providerId}: ${endpoint}`);
    }

    // Get API key for the provider
    const apiKey = settingsManager.getProviderApiKey(providerId);

    // For local providers (ollama, lmstudio), API key is optional
    if (!apiKey && !isLocalProvider(providerId)) {
      throw new Error(`No API key configured for provider ${providerId}`);
    }

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      };

      // Provider-specific authentication (apiKey is guaranteed to exist for non-local providers)
      if (providerId === 'anthropic' && apiKey) {
        // Anthropic uses x-api-key header
        headers['x-api-key'] = apiKey;
        headers['anthropic-version'] = '2023-06-01';
      } else if (providerId === 'google' && apiKey) {
        // Google uses API key as query parameter
        endpoint = `${endpoint}?key=${apiKey}`;
      } else if (providerId === 'openRouter' && apiKey) {
        // OpenRouter uses Bearer + custom headers
        headers['Authorization'] = `Bearer ${apiKey}`;
        headers['HTTP-Referer'] = 'https://talkcody.com';
        headers['X-Title'] = 'TalkCody';
      } else if (apiKey && !isLocalProvider(providerId)) {
        // Default: Bearer token
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      // Use non-streaming proxy_fetch for simple GET requests
      // This avoids the race condition in stream_fetch where data may arrive before listener is ready
      const proxyRequest: ProxyRequest = {
        url: endpoint,
        method: 'GET',
        headers,
      };

      const response = await invoke<ProxyResponse>('proxy_fetch', { request: proxyRequest });

      if (response.status >= 400) {
        throw new Error(`Failed to fetch models: ${response.status}`);
      }

      const data = JSON.parse(response.body) as ModelsListResponse;
      logger.info(`Raw models data from ${providerId}:`, data);

      // Normalize the response - handle different response formats
      let rawModels: RawModel[] = [];
      if (Array.isArray(data.data)) {
        // Standard OpenAI-compatible format
        rawModels = data.data;
      } else if (Array.isArray(data.models)) {
        // Google format: { "models": [...] }
        rawModels = data.models;
      } else if (Array.isArray(data)) {
        // Direct array format
        rawModels = data as unknown as RawModel[];
      }
      logger.info(`Fetched ${rawModels.length} models from ${providerId}`);

      // Transform and filter models
      const models: FetchedModel[] = [];
      for (const m of rawModels) {
        // Google uses "name" field like "models/gemini-2.5-flash", extract model id
        const id = m.id || (m.name?.startsWith('models/') ? m.name.slice(7) : m.name);
        if (id) {
          models.push({
            id,
            name: m.name || id,
            owned_by: m.owned_by,
          });
        }
      }
      return models;
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
