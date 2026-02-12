// src/types/provider.ts

import type { CustomProviderConfig } from './custom-provider';

export type ProviderType =
  | 'openai'
  | 'openai-compatible'
  | 'custom'
  | 'custom-openai'
  | 'custom-anthropic';

export interface ProviderDefinition {
  id: string;
  name: string;
  apiKeyName: string;
  baseUrl?: string;
  required?: boolean;
  type: ProviderType;
  // biome-ignore lint/suspicious/noExplicitAny: Provider return types vary by implementation
  createProvider?: (apiKey: string, baseUrl?: string, useInternational?: boolean) => any;
  isCustom?: boolean;
  customConfig?: CustomProviderConfig;
  /** Whether this provider supports Coding Plan feature */
  supportsCodingPlan?: boolean;
  /** Custom base URL to use when Coding Plan is enabled */
  codingPlanBaseUrl?: string;
  /** Whether this provider supports OAuth authentication (e.g., Claude Pro/Max) */
  supportsOAuth?: boolean;
  /** Whether this provider supports International/International mode toggle */
  supportsInternational?: boolean;
  /** International base URL to use when International mode is enabled */
  internationalBaseUrl?: string;
  /** Separate API key name for Coding Plan (if different from regular API key) */
  codingPlanApiKeyName?: string;
}

export interface ProviderRegistry {
  [key: string]: ProviderDefinition;
}

// Extended provider definition that includes custom providers
export interface ExtendedProviderDefinition extends ProviderDefinition {
  isCustom?: boolean;
  customConfig?: CustomProviderConfig;
}

// Provider creation context for custom providers
export interface ProviderCreationContext {
  apiKey: string;
  baseUrl?: string;
  customConfig?: CustomProviderConfig;
}
