// src/providers/definitions.ts
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGateway } from '@ai-sdk/gateway';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { createTauriFetch } from '@/lib/tauri-fetch';
import type { ProviderDefinition, ProviderRegistry } from './types';

export const PROVIDER_CONFIGS: ProviderRegistry = {
  aiGateway: {
    id: 'aiGateway',
    name: 'Vercel AI Gateway',
    priority: 0,
    apiKeyName: 'AI_GATEWAY_API_KEY',
    required: false,
    type: 'custom',
    createProvider: (apiKey: string) =>
      createGateway({
        headers: {
          'http-referer': 'https://talkcody.com',
          'x-title': 'TalkCody',
        },
        apiKey,
        fetch: createTauriFetch() as typeof fetch,
      }),
  },

  openRouter: {
    id: 'openRouter',
    name: 'OpenRouter',
    priority: 1,
    apiKeyName: 'OPEN_ROUTER_API_KEY',
    required: false,
    type: 'custom',
    createProvider: (apiKey: string) =>
      createOpenRouter({
        apiKey,
        headers: {
          'HTTP-Referer': 'https://talkcody.com',
          'X-Title': 'TalkCody',
        },
        extraBody: {
          reasoning: {
            enabled: true,
          },
        },
        fetch: createTauriFetch() as typeof fetch,
      }),
  },

  openai: {
    id: 'openai',
    name: 'OpenAI',
    priority: 2,
    apiKeyName: 'OPENAI_API_KEY',
    required: false,
    type: 'openai',
    createProvider: (apiKey: string, baseUrl?: string) => {
      if (baseUrl) {
        return createOpenAICompatible({
          apiKey,
          name: 'openai',
          baseURL: baseUrl,
          fetch: createTauriFetch() as typeof fetch,
        });
      }
      return createOpenAI({
        apiKey,
        fetch: createTauriFetch() as typeof fetch,
      });
    },
  },

  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    priority: 2,
    apiKeyName: 'ANTHROPIC_API_KEY',
    required: false,
    type: 'custom',
    createProvider: (apiKey: string, baseUrl?: string) =>
      createAnthropic({
        apiKey,
        ...(baseUrl && { baseURL: baseUrl }),
        // Use Tauri fetch to bypass webview CORS restrictions
        // This works for both official Anthropic API and third-party compatible APIs
        fetch: createTauriFetch() as typeof fetch,
      }),
  },

  deepseek: {
    id: 'deepseek',
    name: 'Deepseek',
    priority: 2,
    apiKeyName: 'DEEPSEEK_API_KEY',
    baseUrl: 'https://api.deepseek.com',
    required: false,
    type: 'openai-compatible',
    createProvider: (apiKey: string, baseUrl?: string) =>
      createOpenAICompatible({
        apiKey,
        name: 'deepseek',
        baseURL: baseUrl || 'https://api.deepseek.com/v1/',
        fetch: createTauriFetch() as typeof fetch,
      }),
  },

  zhipu: {
    id: 'zhipu',
    name: 'Zhipu AI',
    priority: 2,
    apiKeyName: 'ZHIPU_API_KEY',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4/',
    required: false,
    type: 'openai-compatible',
    createProvider: (apiKey: string, baseUrl?: string) =>
      createOpenAICompatible({
        apiKey,
        name: 'zhipu',
        baseURL: baseUrl || 'https://open.bigmodel.cn/api/paas/v4/',
        fetch: createTauriFetch() as typeof fetch,
      }),
  },

  MiniMax: {
    id: 'MiniMax',
    name: 'MiniMax',
    priority: 2,
    apiKeyName: 'MINIMAX_API_KEY',
    required: false,
    type: 'openai-compatible',
    createProvider: (apiKey: string) =>
      // createAnthropic({
      //   apiKey,
      //   baseURL: 'https://api.minimaxi.com/anthropic/v1',
      //   fetch: createTauriFetch() as typeof fetch,
      // }),
      createOpenAICompatible({
        apiKey,
        name: 'MINIMAX',
        baseURL: 'https://api.minimaxi.com/v1',
        fetch: createTauriFetch() as typeof fetch,
      }),
  },

  google: {
    id: 'google',
    name: 'Google AI',
    priority: 2,
    apiKeyName: 'GOOGLE_API_KEY',
    required: false,
    type: 'custom',
    createProvider: (apiKey: string) =>
      createGoogleGenerativeAI({
        apiKey,
        fetch: createTauriFetch() as typeof fetch,
      }),
  },

  ollama: {
    id: 'ollama',
    name: 'Ollama',
    priority: 1,
    apiKeyName: 'OLLAMA_ENABLED',
    baseUrl: 'http://127.0.0.1:11434',
    required: false,
    type: 'openai-compatible',
    createProvider: () =>
      createOpenAICompatible({
        name: 'ollama',
        baseURL: 'http://127.0.0.1:11434/v1',
        apiKey: 'ollama', // Ollama doesn't require a real API key
        fetch: createTauriFetch() as typeof fetch,
      }),
  },

  lmstudio: {
    id: 'lmstudio',
    name: 'LM Studio',
    priority: 1,
    apiKeyName: 'LMSTUDIO_ENABLED',
    baseUrl: 'http://127.0.0.1:1234',
    required: false,
    type: 'openai-compatible',
    createProvider: (_apiKey: string, baseUrl?: string) =>
      createOpenAICompatible({
        name: 'lmstudio',
        baseURL: baseUrl ? `${baseUrl}/v1` : 'http://127.0.0.1:1234/v1',
        apiKey: 'lm-studio', // LM Studio doesn't require a real API key
        fetch: createTauriFetch() as typeof fetch,
      }),
  },

  tavily: {
    id: 'tavily',
    name: 'Tavily Web Search',
    priority: 3,
    apiKeyName: 'TAVILY_API_KEY',
    baseUrl: 'https://api.tavily.com',
    required: false,
    type: 'custom',
    createProvider: () => null, // Tavily is not an AI provider, just a search API
  },
  elevenlabs: {
    id: 'elevenlabs',
    name: 'Eleven Labs Text-to-Speech',
    priority: 3,
    apiKeyName: 'ELEVENLABS_API_KEY',
    baseUrl: 'https://api.elevenlabs.io',
    required: false,
    type: 'custom',
    createProvider: () => null,
  },
} as const;

// Generate types from definitions
export type ProviderIds = keyof typeof PROVIDER_CONFIGS;
export const PROVIDER_IDS = Object.keys(PROVIDER_CONFIGS) as ProviderIds[];

// Helper functions
export function getProviderDefinition(id: string): ProviderDefinition | undefined {
  return PROVIDER_CONFIGS[id as ProviderIds];
}

export function getAllProviderDefinitions(): ProviderDefinition[] {
  return Object.values(PROVIDER_CONFIGS);
}

export function getProviderApiKeyName(id: string): string | undefined {
  return getProviderDefinition(id)?.apiKeyName;
}
