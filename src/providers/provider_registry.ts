// src/providers/registry.ts
import { logger } from '@/lib/logger';
import { isLocalProvider } from '@/services/custom-model-service';
import { PROVIDER_CONFIGS } from './provider_config';
import type { ProviderDefinition } from './types';

export class ProviderRegistry {
  private static instance: ProviderRegistry;
  private providers: Map<string, ProviderDefinition> = new Map();

  private constructor() {
    // Initialize with default providers
    this.loadDefaultProviders();
  }

  static getInstance(): ProviderRegistry {
    if (!ProviderRegistry.instance) {
      ProviderRegistry.instance = new ProviderRegistry();
    }
    return ProviderRegistry.instance;
  }

  private loadDefaultProviders(): void {
    for (const [id, definition] of Object.entries(PROVIDER_CONFIGS)) {
      this.providers.set(id, definition);
    }
  }

  registerProvider(definition: ProviderDefinition): void {
    this.providers.set(definition.id, definition);
  }

  getProvider(id: string): ProviderDefinition | undefined {
    return this.providers.get(id);
  }

  getAllProviders(): ProviderDefinition[] {
    return Array.from(this.providers.values());
  }

  getProviderIds(): string[] {
    return Array.from(this.providers.keys());
  }

  hasProvider(id: string): boolean {
    return this.providers.has(id);
  }

  // Generate API key settings interface
  generateApiKeySettings(): Record<string, string> {
    const settings: Record<string, string> = {};
    for (const provider of this.getAllProviders()) {
      // Convert from PROVIDER_API_KEY format to camelCase
      const key = provider.id;
      settings[key] = '';
    }
    return settings;
  }

  // Generate provider type union
  generateProviderTypeUnion(): string {
    const ids = this.getProviderIds();
    return ids.map((id) => `'${id}'`).join(' | ');
  }

  // Check if API key is configured for provider
  hasApiKey(providerId: string, apiKeys: Record<string, any>): boolean {
    const provider = this.getProvider(providerId);
    if (!provider) {
      logger.warn('[hasApiKey] Provider not found', { providerId });
      return false;
    }

    // Local providers (Ollama, LM Studio) use 'enabled' instead of API key
    if (isLocalProvider(providerId)) {
      const result = apiKeys[providerId] === 'enabled';
      return result;
    }

    const apiKey = apiKeys[providerId];
    const hasKey = !!(apiKey && typeof apiKey === 'string' && apiKey.trim());

    // logger.info('[hasApiKey] API key check for provider', {
    //   provider: providerId,
    //   hasKey,
    //   keyType: typeof apiKey,
    //   keyLength: apiKey?.length || 0,
    //   allApiKeyKeys: Object.keys(apiKeys),
    //   apiKeyValue: apiKey ? `${apiKey.substring(0, 10)}...` : 'undefined',
    // });

    return hasKey;
  }
}

// Export singleton instance
export const providerRegistry = ProviderRegistry.getInstance();
