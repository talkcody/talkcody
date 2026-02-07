// src/providers/oauth/github-copilot-oauth-service.ts
// Core OAuth service for GitHub Copilot authentication (Rust-backed).
// Non-auth helpers (fetch, vision detection) remain; OAuth flow is delegated to Rust.

import { logger } from '@/lib/logger';
import { llmClient } from '@/services/llm/llm-client';

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
  expiresIn: number;
  interval: number;
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
    expiresIn: result.expiresIn,
    interval: result.interval,
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
