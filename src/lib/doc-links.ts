/**
 * Centralized documentation links configuration
 * All external documentation URLs should be defined here for easy management
 */

import { settingsManager } from '@/stores/settings-store';

function getBaseUrl(): string {
  const language = settingsManager.getSync('language');
  return language === 'zh' ? 'https://www.talkcody.com/zh/docs' : 'https://www.talkcody.com/docs';
}

export function getDocLinks() {
  const BASE_URL = getBaseUrl();

  return {
    // Features
    features: {
      tools: `${BASE_URL}/features/tools`,
      skills: `${BASE_URL}/features/skills`,
      agents: `${BASE_URL}/features/ai-agents`,
      mcpServers: `${BASE_URL}/features/mcp-servers`,
      models: `${BASE_URL}/configuration/model-settings`,
      planMode: `${BASE_URL}/features/plan-mode`,
      worktree: `${BASE_URL}/features/worktree`,
    },

    // Configuration
    configuration: {
      apiKeys: `${BASE_URL}/configuration/api-keys`,
      modelSettings: `${BASE_URL}/configuration/model-settings`,
      generalSettings: `${BASE_URL}/configuration/general-settings`,
      editorSettings: `${BASE_URL}/configuration/editor-settings`,
      agentConfiguration: `${BASE_URL}/configuration/agent-configuration`,
      mcpConfiguration: `${BASE_URL}/configuration/mcp-configuration`,
    },

    // API Keys Provider Documentation
    apiKeysProviders: {
      aiGateway: `${BASE_URL}/configuration/api-keys#vercel-ai-gateway`,
      openRouter: `${BASE_URL}/configuration/api-keys#openrouter`,
      openai: `${BASE_URL}/configuration/api-keys#openai`,
      MiniMax: `${BASE_URL}/configuration/api-keys#minimax`,
      zhipu: `${BASE_URL}/configuration/api-keys#zhipu-ai`,
      anthropic: `${BASE_URL}/configuration/api-keys#anthropic`,
      google: `${BASE_URL}/configuration/api-keys#google-ai`,
      deepseek: `${BASE_URL}/configuration/api-keys#deepseek`,
      ollama: `${BASE_URL}/configuration/api-keys#ollama`,
      lmstudio: `${BASE_URL}/configuration/api-keys#lm-studio`,
      tavily: `${BASE_URL}/configuration/api-keys#tavily`,
      elevenlabs: `${BASE_URL}/configuration/api-keys#eleven-labs`,
      moonshot: `${BASE_URL}/configuration/api-keys#moonshot`,
      serper: `${BASE_URL}/configuration/api-keys#serper`,
    },

    // Introduction
    introduction: {
      quickStart: `${BASE_URL}/introduction/quick-start`,
      clientDownloads: `${BASE_URL}/introduction/client-downloads`,
      faq: `${BASE_URL}/introduction/faq`,
    },

    // Open Source
    openSource: {
      architecture: `${BASE_URL}/open-source/architecture`,
      developmentSetup: `${BASE_URL}/open-source/development-setup`,
    },
  } as const;
}

// Type helper for doc links
export type DocLinks = ReturnType<typeof getDocLinks>;
export type DocLinkPath = keyof DocLinks;
