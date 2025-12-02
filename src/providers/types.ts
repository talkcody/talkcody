// src/providers/types.ts

export type ProviderType = 'openai' | 'openai-compatible' | 'custom';

export interface ProviderDefinition {
  id: string;
  name: string;
  priority: number;
  apiKeyName: string;
  baseUrl?: string;
  required?: boolean;
  type: ProviderType;
  createProvider?: (apiKey: string, baseUrl?: string) => any;
}

export interface ProviderRegistry {
  [key: string]: ProviderDefinition;
}
