// src/providers/oauth/github-copilot-oauth-service.ts
// Core OAuth service for GitHub Copilot authentication
// Uses @opeoginni/github-copilot-openai-compatible for OpenAI-compatible API
// Reference: https://github.com/sst/opencode-copilot-auth/blob/main/index.mjs

import { createGitHubCopilotOpenAICompatible } from '@opeoginni/github-copilot-openai-compatible';
import { logger } from '@/lib/logger';
import { simpleFetch } from '@/lib/tauri-fetch';

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

// OAuth constants from SST opencode-copilot-auth
const CLIENT_ID = 'Iv1.b507a08c87ecfe98';
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
// Device code and copilot API URL are constructed dynamically based on domain
const _DEVICE_CODE_URL = 'https://github.com/login/device/code';
const _COPILOT_API_KEY_URL = 'https://api.github.com/copilot_internal/v2/token';

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

export interface DeviceCodeResult {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export interface TokenExchangeResult {
  type: 'success' | 'failed' | 'pending';
  tokens?: GitHubCopilotOAuthTokens;
  error?: string;
}

export interface OAuthFlowResult {
  userCode: string;
  verificationUri: string;
  deviceCode: string;
}

/**
 * Normalize domain URL by removing protocol and trailing slash
 */
function normalizeDomain(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

/**
 * Get Copilot API URLs based on domain
 */
function getCopilotUrls(domain: string) {
  return {
    DEVICE_CODE_URL: `https://${domain}/login/device/code`,
    ACCESS_TOKEN_URL: `https://${domain}/login/oauth/access_token`,
    COPILOT_API_KEY_URL: `https://api.${domain}/copilot_internal/v2/token`,
  };
}

/**
 * Start Device Code OAuth flow - returns device code and user code for display
 */
export async function startDeviceCodeFlow(enterpriseUrl?: string): Promise<OAuthFlowResult> {
  const domain = enterpriseUrl ? normalizeDomain(enterpriseUrl) : 'github.com';
  const urls = getCopilotUrls(domain);

  try {
    logger.info('[GitHubCopilotOAuth] Starting device code flow, domain:', domain);

    const response = await simpleFetch(urls.DEVICE_CODE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...COPILOT_HEADERS,
      },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        scope: 'read:user',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('[GitHubCopilotOAuth] Device code request failed:', response.status, errorText);
      throw new Error(`Device code request failed: ${response.status}`);
    }

    const data = await response.json();

    logger.info('[GitHubCopilotOAuth] Device code flow started successfully');

    return {
      deviceCode: data.device_code,
      userCode: data.user_code,
      verificationUri: data.verification_uri,
    };
  } catch (error) {
    logger.error('[GitHubCopilotOAuth] Failed to start device code flow:', error);
    throw new Error(
      `Failed to start OAuth flow: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Poll for access token after user completes authorization
 */
export async function pollForAccessToken(
  deviceCode: string,
  enterpriseUrl?: string,
  onProgress?: (status: 'pending' | 'authorized' | 'success' | 'failed', message?: string) => void
): Promise<TokenExchangeResult> {
  const domain = enterpriseUrl ? normalizeDomain(enterpriseUrl) : 'github.com';
  const urls = getCopilotUrls(domain);
  const intervalMs = 5 * 1000; // 5 second polling interval

  // Start with the device code polling interval if provided
  const maxAttempts = 600; // Maximum polling time (about 30 minutes)
  let attempts = 0;

  logger.info('[GitHubCopilotOAuth] Starting to poll for access token');

  while (attempts < maxAttempts) {
    try {
      const response = await simpleFetch(urls.ACCESS_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': COPILOT_HEADERS['User-Agent'],
        },
        body: JSON.stringify({
          client_id: CLIENT_ID,
          device_code: deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('[GitHubCopilotOAuth] Token request failed:', response.status, errorText);
        return {
          type: 'failed',
          error: `Token request failed: ${response.status}`,
        };
      }

      const data = await response.json();

      if (data.access_token) {
        logger.info('[GitHubCopilotOAuth] Access token received');

        // Now get the Copilot API token
        const copilotResult = await getCopilotApiToken(data.access_token, enterpriseUrl);

        if (copilotResult.type === 'success' && copilotResult.tokens) {
          return {
            type: 'success',
            tokens: copilotResult.tokens,
          };
        }
        // Handle failed case with type guard
        const failedResult = copilotResult as { type: 'failed'; error?: string };
        return {
          type: 'failed',
          error: failedResult.error || 'Failed to get Copilot token',
        };
      }

      if (data.error === 'authorization_pending') {
        onProgress?.('pending', 'Waiting for authorization...');
        logger.debug('[GitHubCopilotOAuth] Authorization pending, polling...');
      } else if (data.error === 'authorization_declined') {
        onProgress?.('failed', 'Authorization declined');
        return {
          type: 'failed',
          error: 'Authorization declined by user',
        };
      } else if (data.error === 'expired_token') {
        onProgress?.('failed', 'Device code expired');
        return {
          type: 'failed',
          error: 'Device code expired. Please restart the OAuth flow.',
        };
      } else if (data.error === 'slow_down') {
        // Rate limiting - increase polling interval
        logger.info('[GitHubCopilotOAuth] Rate limited, increasing polling interval');
      } else if (data.error) {
        onProgress?.('failed', `Error: ${data.error}`);
        return {
          type: 'failed',
          error: `OAuth error: ${data.error}`,
        };
      }

      attempts++;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    } catch (error) {
      logger.error('[GitHubCopilotOAuth] Token polling error:', error);
      return {
        type: 'failed',
        error: `Token polling failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  onProgress?.('failed', 'Polling timeout');
  return {
    type: 'failed',
    error: 'Polling timeout. Please restart the OAuth flow.',
  };
}

/**
 * Get Copilot API token using OAuth access token
 */
export async function getCopilotApiToken(
  accessToken: string,
  enterpriseUrl?: string
): Promise<
  { type: 'success'; tokens: GitHubCopilotOAuthTokens } | { type: 'failed'; error?: string }
> {
  const domain = enterpriseUrl ? normalizeDomain(enterpriseUrl) : 'github.com';
  const copilotApiUrl = `https://api.${domain}/copilot_internal/v2/token`;

  try {
    logger.info('[GitHubCopilotOAuth] Getting Copilot API token');

    const response = await simpleFetch(copilotApiUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
        ...COPILOT_HEADERS,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(
        '[GitHubCopilotOAuth] Copilot token request failed:',
        response.status,
        errorText
      );
      return {
        type: 'failed',
        error: `Copilot token request failed: ${response.status}`,
      };
    }

    const data = await response.json();

    if (!data.token) {
      logger.error('[GitHubCopilotOAuth] No token in response:', data);
      return {
        type: 'failed',
        error: 'Invalid Copilot token response',
      };
    }

    logger.info('[GitHubCopilotOAuth] Copilot API token received successfully');

    return {
      type: 'success',
      tokens: {
        accessToken,
        copilotToken: data.token,
        expiresAt: data.expires_at * 1000, // Convert to milliseconds
        enterpriseUrl,
      },
    };
  } catch (error) {
    logger.error('[GitHubCopilotOAuth] Failed to get Copilot token:', error);
    return {
      type: 'failed',
      error: `Failed to get Copilot token: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Refresh OAuth access token
 */
export async function refreshAccessToken(
  refreshToken: string
): Promise<{ type: 'success'; accessToken: string } | { type: 'failed'; error?: string }> {
  try {
    logger.info('[GitHubCopilotOAuth] Refreshing access token');

    const response = await simpleFetch(ACCESS_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': COPILOT_HEADERS['User-Agent'],
      },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: CLIENT_ID,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('[GitHubCopilotOAuth] Token refresh failed:', response.status, errorText);
      return {
        type: 'failed',
        error: `Token refresh failed: ${response.status}`,
      };
    }

    const data = await response.json();

    if (!data.access_token) {
      return {
        type: 'failed',
        error: 'Invalid token refresh response',
      };
    }

    logger.info('[GitHubCopilotOAuth] Access token refreshed successfully');

    return {
      type: 'success',
      accessToken: data.access_token,
    };
  } catch (error) {
    logger.error('[GitHubCopilotOAuth] Token refresh error:', error);
    return {
      type: 'failed',
      error: `Token refresh failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Check if Copilot token is expired or about to expire
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
 * Get the base URL for Copilot API
 */
export function getCopilotBaseUrl(enterpriseUrl?: string): string {
  if (enterpriseUrl) {
    return `https://copilot-api.${normalizeDomain(enterpriseUrl)}`;
  }
  return 'https://api.githubcopilot.com';
}

/**
 * Get client ID (for display purposes)
 */
export function getClientId(): string {
  return CLIENT_ID;
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
