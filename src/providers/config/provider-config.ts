// src/providers/config/provider-config.ts
import type { ProviderRegistry } from '@/types';

export const PROVIDER_CONFIGS: ProviderRegistry = {
  talkcody: {
    id: 'talkcody',
    name: 'TalkCody Free',
    apiKeyName: 'TALKCODY_ENABLED', // Not a real API key, just a flag
    required: false,
    type: 'custom',
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    apiKeyName: 'OPENAI_API_KEY',
    required: false,
    type: 'openai',
    supportsOAuth: true, // Supports OpenAI ChatGPT Plus/Pro OAuth authentication
  },

  github_copilot: {
    id: 'github_copilot',
    name: 'GitHub Copilot',
    apiKeyName: 'GITHUB_COPILOT_TOKEN',
    baseUrl: 'https://api.githubcopilot.com',
    required: false,
    type: 'openai-compatible',
    supportsOAuth: true,
  },

  moonshot: {
    id: 'moonshot',
    name: 'Moonshot',
    apiKeyName: 'MOONSHOT_API_KEY',
    required: false,
    type: 'openai-compatible',
    supportsInternational: true,
    internationalBaseUrl: 'https://api.kimi.com/v1',
  },

  kimi_coding: {
    id: 'kimi_coding',
    name: 'Kimi Coding Plan',
    apiKeyName: 'KIMI_CODING_API_KEY',
    baseUrl: 'https://api.kimi.com/coding/v1',
    required: false,
    type: 'openai-compatible',
  },

  MiniMax: {
    id: 'MiniMax',
    name: 'MiniMax',
    apiKeyName: 'MINIMAX_API_KEY',
    required: false,
    type: 'openai-compatible',
    supportsCodingPlan: true,
    supportsInternational: true,
    internationalBaseUrl: 'https://api.minimaxi.chat/anthropic/v1',
  },

  zhipu: {
    id: 'zhipu',
    name: 'Zhipu AI',
    apiKeyName: 'ZHIPU_API_KEY',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4/',
    required: false,
    type: 'openai-compatible',
    supportsCodingPlan: true,
    codingPlanBaseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
  },

  openRouter: {
    id: 'openRouter',
    name: 'OpenRouter',
    apiKeyName: 'OPEN_ROUTER_API_KEY',
    required: false,
    type: 'custom',
  },

  aiGateway: {
    id: 'aiGateway',
    name: 'Vercel AI Gateway',
    apiKeyName: 'AI_GATEWAY_API_KEY',
    required: false,
    type: 'custom',
  },

  deepseek: {
    id: 'deepseek',
    name: 'Deepseek',
    apiKeyName: 'DEEPSEEK_API_KEY',
    baseUrl: 'https://api.deepseek.com',
    required: false,
    type: 'openai-compatible',
  },

  google: {
    id: 'google',
    name: 'Google AI',
    apiKeyName: 'GOOGLE_API_KEY',
    required: false,
    type: 'custom',
  },

  zai: {
    id: 'zai',
    name: 'Z.AI',
    apiKeyName: 'ZAI_API_KEY',
    baseUrl: 'https://api.z.ai/api/paas/v4/',
    required: false,
    type: 'openai-compatible',
    supportsCodingPlan: true,
    codingPlanBaseUrl: 'https://api.z.ai/api/coding/paas/v4',
  },

  ollama: {
    id: 'ollama',
    name: 'Ollama',
    apiKeyName: 'OLLAMA_ENABLED',
    baseUrl: 'http://127.0.0.1:11434',
    required: false,
    type: 'openai-compatible',
  },

  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    apiKeyName: 'ANTHROPIC_API_KEY',
    required: false,
    type: 'custom',
    supportsOAuth: true,
  },

  lmstudio: {
    id: 'lmstudio',
    name: 'LM Studio',
    apiKeyName: 'LMSTUDIO_ENABLED',
    baseUrl: 'http://127.0.0.1:1234',
    required: false,
    type: 'openai-compatible',
  },

  tavily: {
    id: 'tavily',
    name: 'Tavily Web Search',
    apiKeyName: 'TAVILY_API_KEY',
    baseUrl: 'https://api.tavily.com',
    required: false,
    type: 'custom',
  },

  serper: {
    id: 'serper',
    name: 'Serper Web Search',
    apiKeyName: 'SERPER_API_KEY',
    baseUrl: 'https://google.serper.dev',
    required: false,
    type: 'custom',
  },

  elevenlabs: {
    id: 'elevenlabs',
    name: 'Eleven Labs Text-to-Speech',
    apiKeyName: 'ELEVENLABS_API_KEY',
    baseUrl: 'https://api.elevenlabs.io',
    required: false,
    type: 'custom',
  },

  groq: {
    id: 'groq',
    name: 'Groq',
    apiKeyName: 'GROQ_API_KEY',
    baseUrl: 'https://api.groq.com/openai/v1',
    required: false,
    type: 'openai-compatible',
  },
} as const;

// Generate types from definitions
export type ProviderIds = keyof typeof PROVIDER_CONFIGS;
export const PROVIDER_IDS = Object.keys(PROVIDER_CONFIGS) as ProviderIds[];

// Providers that support Coding Plan feature
export const PROVIDERS_WITH_CODING_PLAN = Object.entries(PROVIDER_CONFIGS)
  .filter(([_, config]) => config.supportsCodingPlan)
  .map(([id]) => id);

// Providers that support International mode
export const PROVIDERS_WITH_INTERNATIONAL = Object.entries(PROVIDER_CONFIGS)
  .filter(([_, config]) => config.supportsInternational)
  .map(([id]) => id);
