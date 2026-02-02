// src/providers/oauth/github-copilot-oauth-service.ts
// Core OAuth service for GitHub Copilot authentication (Rust-backed).
// Non-auth helpers (fetch, vision detection) remain; OAuth flow is delegated to Rust.

import { createGitHubCopilotOpenAICompatible } from '@opeoginni/github-copilot-openai-compatible';
import { logger } from '@/lib/logger';
import { llmClient } from '@/services/llm/llm-client';

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

// Copilot headers for API requests
export const COPILOT_HEADERS = {
  'User-Agent': 'GitHubCopilotChat/0.35.0',
  'Editor-Version': 'vscode/1.105.1',
  'Editor-Plugin-Version': 'copilot-chat/0.35.0',
  'Copilot-Integration-Id': 'vscode-chat',
};

// Response API alternate input types (from SST implementation)
export const RESPONSES_API_ALTERNATE_INPUT_TYPES = [
  'file_search_call',
  'computer_call',
  'computer_call_output',
  'web_search_call',
  'function_call',
  'function_call_output',
  'image_generation_call',
  'code_interpreter_call',
  'local_shell_call',
  'local_shell_call_output',
  'mcp_list_tools',
  'mcp_approval_request',
  'mcp_approval_response',
  'mcp_call',
  'reasoning',
];

export interface GitHubCopilotOAuthTokens {
  accessToken: string; // OAuth access token
  copilotToken: string; // Copilot API token
  expiresAt: number; // Unix timestamp in milliseconds
  enterpriseUrl?: string; // Enterprise URL (optional)
}

export interface OAuthFlowResult {
  userCode: string;
  verificationUri: string;
  deviceCode: string;
}

export interface TokenExchangeResult {
  type: 'success' | 'failed' | 'pending';
  tokens?: GitHubCopilotOAuthTokens;
  error?: string;
}

/**
 * Start Device Code OAuth flow - delegates to Rust.
 */
export async function startDeviceCodeFlow(enterpriseUrl?: string): Promise<OAuthFlowResult> {
  logger.info('[GitHubCopilotOAuth] Starting device code flow via Rust');
  const result = await llmClient.startGitHubCopilotOAuthDeviceCode({ enterpriseUrl });
  return {
    deviceCode: result.deviceCode,
    userCode: result.userCode,
    verificationUri: result.verificationUri,
  };
}

/**
 * Poll for access token - delegates to Rust.
 */
export async function pollForAccessToken(
  deviceCode: string,
  enterpriseUrl?: string
): Promise<TokenExchangeResult> {
  logger.info('[GitHubCopilotOAuth] Polling for access token via Rust');
  const result = await llmClient.pollGitHubCopilotOAuthDeviceCode({
    deviceCode,
    enterpriseUrl,
  });

  if (result.type === 'success' && result.tokens) {
    return {
      type: 'success',
      tokens: {
        accessToken: result.tokens.accessToken,
        copilotToken: result.tokens.copilotToken,
        expiresAt: result.tokens.expiresAt,
        enterpriseUrl: result.tokens.enterpriseUrl,
      },
    };
  }

  if (result.type === 'pending') {
    return { type: 'pending' };
  }

  return {
    type: 'failed',
    error: result.error || 'Token exchange failed',
  };
}

/**
 * Get Copilot API token using stored OAuth access token - delegates to Rust refresh.
 */
export async function getCopilotApiToken(
  _accessToken: string,
  _enterpriseUrl?: string
): Promise<
  { type: 'success'; tokens: GitHubCopilotOAuthTokens } | { type: 'failed'; error?: string }
> {
  try {
    logger.info('[GitHubCopilotOAuth] Getting Copilot API token via Rust');
    const tokens = await llmClient.refreshGitHubCopilotOAuthToken();
    return {
      type: 'success',
      tokens: {
        accessToken: tokens.accessToken,
        copilotToken: tokens.copilotToken,
        expiresAt: tokens.expiresAt,
        enterpriseUrl: tokens.enterpriseUrl,
      },
    };
  } catch (error) {
    logger.error('[GitHubCopilotOAuth] Failed to get Copilot token:', error);
    return {
      type: 'failed',
      error: error instanceof Error ? error.message : 'Failed to get Copilot token',
    };
  }
}

/**
 * Refresh Copilot token - delegates to Rust.
 */
export async function refreshAccessToken(): Promise<
  | { type: 'success'; accessToken: string; copilotToken: string; expiresAt: number }
  | { type: 'failed'; error?: string }
> {
  try {
    logger.info('[GitHubCopilotOAuth] Refreshing token via Rust');
    const tokens = await llmClient.refreshGitHubCopilotOAuthToken();
    return {
      type: 'success',
      accessToken: tokens.accessToken,
      copilotToken: tokens.copilotToken,
      expiresAt: tokens.expiresAt,
    };
  } catch (error) {
    logger.error('[GitHubCopilotOAuth] Token refresh error:', error);
    return {
      type: 'failed',
      error: error instanceof Error ? error.message : 'Token refresh failed',
    };
  }
}

/**
 * Check if Copilot token is expired or about to expire (within 1 minute)
 */
export function isCopilotTokenExpired(expiresAt: number): boolean {
  const bufferMs = 60 * 1000; // 1 minute buffer
  return Date.now() + bufferMs >= expiresAt;
}

/**
 * Determine if a request is an agent call based on request body
 */
export function isAgentCall(body: unknown): boolean {
  if (!body || typeof body !== 'object') {
    return false;
  }

  const obj = body as Record<string, unknown>;

  // Check for messages with tool/assistant roles
  if (Array.isArray(obj.messages)) {
    if (
      obj.messages.some(
        (msg) =>
          msg &&
          typeof msg === 'object' &&
          'role' in msg &&
          ['tool', 'assistant'].includes((msg as { role: string }).role)
      )
    ) {
      return true;
    }
  }

  // Check for input with alternate types
  if (Array.isArray(obj.input)) {
    const lastInput = obj.input[obj.input.length - 1];
    if (lastInput && typeof lastInput === 'object') {
      const isAssistant = (lastInput as { role?: string }).role === 'assistant';
      const hasAgentType =
        'type' in lastInput &&
        RESPONSES_API_ALTERNATE_INPUT_TYPES.includes((lastInput as { type: string }).type);
      if (isAssistant || hasAgentType) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Determine if a request is a vision request
 */
export function isVisionRequest(body: unknown): boolean {
  if (!body || typeof body !== 'object') {
    return false;
  }

  const obj = body as Record<string, unknown>;

  // Check for image_url in messages
  if (Array.isArray(obj.messages)) {
    for (const message of obj.messages) {
      if (message && typeof message === 'object' && 'content' in message) {
        const content = (message as { content: unknown }).content;
        if (Array.isArray(content)) {
          if (
            content.some(
              (part) =>
                part &&
                typeof part === 'object' &&
                'type' in part &&
                (part as { type: string }).type === 'image_url'
            )
          ) {
            return true;
          }
        }
      }
    }
  }

  // Check for input_image in alternate API
  if (Array.isArray(obj.input)) {
    const lastInput = obj.input[obj.input.length - 1];
    if (lastInput && typeof lastInput === 'object' && 'content' in lastInput) {
      const content = (lastInput as { content: unknown }).content;
      if (Array.isArray(content)) {
        if (
          content.some(
            (part) =>
              part &&
              typeof part === 'object' &&
              'type' in part &&
              (part as { type: string }).type === 'input_image'
          )
        ) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Normalize domain URL by removing protocol and trailing slash
 */
function normalizeDomain(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

/**
 * Get the base URL for Copilot API
 */
export function getCopilotBaseUrl(enterpriseUrl?: string): string {
  if (enterpriseUrl) {
    return `https://copilot-api.${normalizeDomain(enterpriseUrl)}`;
  }
  return 'https://api.githubcopilot.com';
}

/**
 * Create a custom fetch function that handles token refresh
 * This is used by the github-copilot-openai-compatible provider
 */
export function createGitHubCopilotFetch(enterpriseUrl?: string): FetchFn {
  // Return a fetch function that dynamically gets the token
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // Dynamic import to avoid circular dependencies
    const { getGitHubCopilotOAuthToken } = await import('./github-copilot-oauth-store');
    const copilotToken = await getGitHubCopilotOAuthToken();

    if (!copilotToken) {
      throw new Error('GitHub Copilot token not available. Please reconnect in settings.');
    }

    // Use Tauri streamFetch for CORS bypass
    const { streamFetch } = await import('@/lib/tauri-fetch');

    // Build URL
    let url = typeof input === 'string' ? input : input.toString();
    const baseUrl = getCopilotBaseUrl(enterpriseUrl);

    // Replace placeholder URL with actual base URL
    url = url.replace('https://api.githubcopilot.com', baseUrl);

    // Create headers with the copilot token
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${copilotToken}`);

    // Add required Copilot headers
    headers.set('User-Agent', COPILOT_HEADERS['User-Agent']);
    headers.set('Editor-Version', COPILOT_HEADERS['Editor-Version']);
    headers.set('Editor-Plugin-Version', COPILOT_HEADERS['Editor-Plugin-Version']);
    headers.set('Copilot-Integration-Id', COPILOT_HEADERS['Copilot-Integration-Id']);

    // Check if this is a vision request and add the required header
    if (init?.body) {
      try {
        const bodyStr = typeof init.body === 'string' ? init.body : String(init.body);
        const bodyObj = JSON.parse(bodyStr);
        if (isVisionRequest(bodyObj)) {
          headers.set('Copilot-Vision-Request', 'true');
        }
      } catch (error) {
        // If body parsing fails, continue without vision header
        logger.warn('[GitHubCopilotFetch] Failed to parse request body:', error);
      }
    }
    return streamFetch(url, { ...init, headers });
  };
}

/**
 * Create a GitHub Copilot provider that uses OAuth authentication
 * Uses @opeoginni/github-copilot-openai-compatible for OpenAI-compatible API
 * with automatic endpoint switching for Codex models
 */
export function createGitHubCopilotOAuthProvider(_copilotToken: string, enterpriseUrl?: string) {
  const baseUrl = getCopilotBaseUrl(enterpriseUrl);

  // Create a dynamic fetch function that handles token refresh
  const fetchFn = createGitHubCopilotFetch(enterpriseUrl);

  return createGitHubCopilotOpenAICompatible({
    baseURL: baseUrl,
    name: 'githubcopilot',
    headers: {
      'Copilot-Integration-Id': 'vscode-chat',
      'User-Agent': COPILOT_HEADERS['User-Agent'],
      'Editor-Version': COPILOT_HEADERS['Editor-Version'],
      'Editor-Plugin-Version': COPILOT_HEADERS['Editor-Plugin-Version'],
    },
    fetch: fetchFn as unknown as typeof fetch,
  });
}
