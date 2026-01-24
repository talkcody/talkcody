// src/services/custom-provider-service.ts
import { invoke } from '@tauri-apps/api/core';
import { BaseDirectory, exists, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { logger } from '@/lib/logger';
import type { ProxyRequest, ProxyResponse } from '@/lib/tauri-fetch';
import type {
  CustomProviderConfig,
  CustomProvidersConfiguration,
  CustomProviderTestResult,
  CustomProviderValidation,
} from '@/types/custom-provider';

const CUSTOM_PROVIDERS_FILENAME = 'custom-providers.json';

/**
 * Service for managing custom providers
 */
class CustomProviderService {
  private memoryCache: CustomProvidersConfiguration | null = null;

  /**
   * Get custom providers configuration
   */
  async getCustomProviders(): Promise<CustomProvidersConfiguration> {
    if (this.memoryCache) {
      return this.memoryCache;
    }

    try {
      const fileExists = await exists(CUSTOM_PROVIDERS_FILENAME, {
        baseDir: BaseDirectory.AppData,
      });

      if (!fileExists) {
        // Return empty config if file doesn't exist
        const emptyConfig: CustomProvidersConfiguration = {
          version: new Date().toISOString(),
          providers: {},
        };
        return emptyConfig;
      }

      const content = await readTextFile(CUSTOM_PROVIDERS_FILENAME, {
        baseDir: BaseDirectory.AppData,
      });
      const config = JSON.parse(content) as CustomProvidersConfiguration;
      this.memoryCache = config;
      return config;
    } catch (error) {
      logger.warn('Failed to load custom providers:', error);
      return { version: new Date().toISOString(), providers: {} };
    }
  }

  /**
   * Save custom providers configuration
   */
  private async saveCustomProviders(config: CustomProvidersConfiguration): Promise<void> {
    try {
      const content = JSON.stringify(config, null, 2);
      await writeTextFile(CUSTOM_PROVIDERS_FILENAME, content, {
        baseDir: BaseDirectory.AppData,
      });
      this.memoryCache = config;
      logger.info('Custom providers saved successfully');
    } catch (error) {
      logger.error('Failed to save custom providers:', error);
      throw error;
    }
  }

  /**
   * Add a custom provider
   */
  async addCustomProvider(providerId: string, providerConfig: CustomProviderConfig): Promise<void> {
    const config = await this.getCustomProviders();
    config.providers[providerId] = providerConfig;
    config.version = new Date().toISOString();
    await this.saveCustomProviders(config);

    // Dispatch event to notify UI
    window.dispatchEvent(new CustomEvent('customProvidersUpdated'));
  }

  /**
   * Update a custom provider
   */
  async updateCustomProvider(
    providerId: string,
    providerConfig: Partial<CustomProviderConfig>
  ): Promise<void> {
    const config = await this.getCustomProviders();
    if (!config.providers[providerId]) {
      throw new Error(`Custom provider ${providerId} not found`);
    }

    config.providers[providerId] = { ...config.providers[providerId], ...providerConfig };
    config.version = new Date().toISOString();
    await this.saveCustomProviders(config);

    // Dispatch event to notify UI
    window.dispatchEvent(new CustomEvent('customProvidersUpdated'));
  }

  /**
   * Remove a custom provider
   */
  async removeCustomProvider(providerId: string): Promise<void> {
    const config = await this.getCustomProviders();
    delete config.providers[providerId];
    config.version = new Date().toISOString();
    await this.saveCustomProviders(config);

    // Dispatch event to notify UI
    window.dispatchEvent(new CustomEvent('customProvidersUpdated'));
  }

  /**
   * Get a specific custom provider
   */
  async getCustomProvider(providerId: string): Promise<CustomProviderConfig | null> {
    const config = await this.getCustomProviders();
    return config.providers[providerId] || null;
  }

  /**
   * Check if a provider is a custom provider
   */
  async isCustomProvider(providerId: string): Promise<boolean> {
    const config = await this.getCustomProviders();
    return providerId in config.providers;
  }

  /**
   * Get all enabled custom providers
   */
  async getEnabledCustomProviders(): Promise<CustomProviderConfig[]> {
    const config = await this.getCustomProviders();
    return Object.values(config.providers).filter((provider) => provider.enabled);
  }

  /**
   * Get all enabled custom providers synchronously (from cache only)
   * Returns empty array if cache is not populated
   */
  getEnabledCustomProvidersSync(): CustomProviderConfig[] {
    if (!this.memoryCache) {
      return [];
    }
    return Object.values(this.memoryCache.providers).filter((provider) => provider.enabled);
  }

  /**
   * Clear memory cache
   */
  clearCache(): void {
    this.memoryCache = null;
  }

  /**
   * Validate custom provider configuration
   * Note: ID is auto-generated from name, so it's not required in validation
   */
  validateProviderConfig(
    config: Partial<CustomProviderConfig>,
    existingProviderId?: string
  ): CustomProviderValidation {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Built-in provider IDs that cannot be used
    const builtInProviderIds = [
      'aiGateway',
      'openRouter',
      'openai',
      'anthropic',
      'google',
      'zhipu',
      'deepseek',
      'ollama',
      'lmstudio',
    ];

    // Required fields (ID is auto-generated from name, so not required here)
    if (!config.name?.trim()) {
      errors.push('Provider name is required');
    } else if (!existingProviderId) {
      // Only check for conflicts when adding new provider (not editing)
      const generatedId = this.generateProviderId(config.type || 'openai-compatible', config.name);
      if (builtInProviderIds.includes(generatedId)) {
        errors.push(
          `Provider name "${config.name}" conflicts with a built-in provider. Please choose a different name.`
        );
      }
    }
    if (!config.type) {
      errors.push('Provider type is required');
    }
    if (!config.baseUrl?.trim()) {
      errors.push('Base URL is required');
    }
    if (!config.apiKey?.trim()) {
      errors.push('API key is required');
    }

    // Validate URL format
    if (config.baseUrl) {
      try {
        new URL(config.baseUrl);
      } catch {
        errors.push('Invalid base URL format');
      }
    }

    // Validate provider type
    if (config.type && !['openai-compatible', 'anthropic'].includes(config.type)) {
      errors.push('Invalid provider type. Must be "openai-compatible" or "anthropic"');
    }

    // Warnings
    if (config.baseUrl?.includes('localhost') || config.baseUrl?.includes('127.0.0.1')) {
      warnings.push('Using localhost URL - ensure the service is running');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Test connectivity to a custom provider
   */
  async testProviderConnection(config: CustomProviderConfig): Promise<CustomProviderTestResult> {
    const startTime = Date.now();

    try {
      let testUrl: string;
      let method: 'GET' | 'POST' = 'GET';
      let body: string | undefined;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      };

      // Set up provider-specific authentication and test endpoint
      if (config.type === 'anthropic') {
        headers['x-api-key'] = config.apiKey;
        headers['anthropic-version'] = '2023-06-01';
        headers['Authorization'] = `Bearer ${config.apiKey}`;
        // Anthropic /v1/messages requires POST with a minimal request body
        testUrl = `${config.baseUrl.replace(/\/+$/, '')}/v1/messages`;
        method = 'POST';
        body = JSON.stringify({
          model: 'claude-3-haiku-20240307',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'Hi' }],
        });
      } else {
        // openai-compatible - /v1/models supports GET
        headers.Authorization = `Bearer ${config.apiKey}`;
        testUrl = `${config.baseUrl.replace(/\/+$/, '')}/models`;
      }

      const proxyRequest: ProxyRequest = {
        url: testUrl,
        method,
        headers,
        body,
        allow_private_ip: true,
      };

      const response = await invoke<ProxyResponse>('proxy_fetch', { request: proxyRequest });
      const responseTime = Date.now() - startTime;

      if (response.status >= 400) {
        // Try to extract error message from response body
        let errorMessage = `HTTP ${response.status}: Request failed`;
        if (response.body) {
          try {
            const errorData = JSON.parse(response.body);
            if (errorData.error?.message) {
              errorMessage = `HTTP ${response.status}: ${errorData.error.message}`;
            }
          } catch {
            // Ignore parsing errors
          }
        }
        return {
          success: false,
          error: errorMessage,
          responseTime,
        };
      }

      // Try to extract models list for openai-compatible providers
      let models: string[] | undefined;
      if (config.type === 'openai-compatible' && response.body) {
        try {
          const data = JSON.parse(response.body);
          if (Array.isArray(data.data)) {
            models = data.data.map((model: { id: string }) => model.id).filter(Boolean);
          }
        } catch {
          // Ignore parsing errors
        }
      }

      return {
        success: true,
        responseTime,
        models,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        responseTime: Date.now() - startTime,
      };
    }
  }

  /**
   * Generate unique provider ID
   */
  generateProviderId(type: 'openai-compatible' | 'anthropic', name: string): string {
    const baseId = `${type}-${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
    const timestamp = Date.now().toString().slice(-6);
    return `${baseId}-${timestamp}`;
  }
}

// Export singleton instance
export const customProviderService = new CustomProviderService();
export default customProviderService;
