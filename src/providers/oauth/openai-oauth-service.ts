// src/providers/oauth/openai-oauth-service.ts
// Core OAuth service for OpenAI ChatGPT Plus/Pro authentication (Rust-backed).

import { logger } from '@/lib/logger';
import { llmClient } from '@/services/llm/llm-client';

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const OAUTH_REDIRECT_URI = 'http://localhost:1455/auth/callback';

export interface OpenAIOAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp in milliseconds
  accountId?: string; // ChatGPT account ID extracted from JWT
}

export interface OAuthFlowResult {
  url: string;
  verifier: string;
  state: string;
}

export interface TokenExchangeResult {
  type: 'success' | 'failed';
  tokens?: OpenAIOAuthTokens;
  error?: string;
}

export interface ParsedAuthInput {
  code?: string;
  state?: string;
}

export interface JWTPayload {
  exp?: number;
  iat?: number;
  sub?: string;
  'https://api.openai.com/auth'?: {
    user_id?: string;
  };
}

/**
 * Start OAuth flow - generates authorization URL via Rust.
 */
export async function startOAuthFlow(): Promise<OAuthFlowResult> {
  logger.info('[OpenAIOAuth] Starting OAuth flow via Rust');
  return llmClient.startOpenAIOAuth();
}

/**
 * Parse authorization code and state from user input
 * Supports multiple formats:
 * - Full URL: http://localhost:1455/auth/callback?code=xxx&state=yyy
 * - Code#State: xxx#yyy
 * - Query string: code=xxx&state=yyy
 * - Just code: xxx
 */
export function parseAuthorizationInput(input: string): ParsedAuthInput {
  const value = (input || '').trim();
  if (!value) return {};

  // Try to parse as URL
  try {
    const url = new URL(value);
    return {
      code: url.searchParams.get('code') ?? undefined,
      state: url.searchParams.get('state') ?? undefined,
    };
  } catch {
    // Not a URL, continue with other formats
  }

  // Try code#state format
  if (value.includes('#')) {
    const [code, state] = value.split('#', 2);
    return { code, state };
  }

  // Try query string format
  if (value.includes('code=')) {
    const params = new URLSearchParams(value);
    return {
      code: params.get('code') ?? undefined,
      state: params.get('state') ?? undefined,
    };
  }

  // Assume it's just the code
  return { code: value };
}

/**
 * Exchange authorization code for tokens via Rust.
 */
export async function exchangeCode(
  code: string,
  verifier: string,
  expectedState?: string
): Promise<TokenExchangeResult> {
  try {
    const parsed = parseAuthorizationInput(code);
    const authCode = parsed.code || code;
    const state = expectedState ?? parsed.state;

    logger.info('[OpenAIOAuth] Exchanging code via Rust');
    const tokens = await llmClient.completeOpenAIOAuth({
      code: authCode,
      verifier,
      expectedState: state,
    });
    return { type: 'success', tokens };
  } catch (error) {
    logger.error('[OpenAIOAuth] Token exchange error:', error);
    return {
      type: 'failed',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Refresh an expired access token via Rust.
 */
export async function refreshAccessToken(refreshToken: string): Promise<TokenExchangeResult> {
  try {
    logger.info('[OpenAIOAuth] Refreshing access token via Rust');
    const tokens = await llmClient.refreshOpenAIOAuth({ refreshToken });
    return { type: 'success', tokens };
  } catch (error) {
    logger.error('[OpenAIOAuth] Token refresh error:', error);
    return {
      type: 'failed',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Check if token is expired or about to expire (within 1 minute)
 */
export function isTokenExpired(expiresAt: number): boolean {
  const bufferMs = 60 * 1000; // 1 minute buffer
  return Date.now() + bufferMs >= expiresAt;
}

export function getRedirectUri(): string {
  return OAUTH_REDIRECT_URI;
}

export function getClientId(): string {
  return CLIENT_ID;
}
