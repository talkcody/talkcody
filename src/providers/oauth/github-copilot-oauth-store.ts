// src/providers/oauth/github-copilot-oauth-store.ts
// Zustand store for GitHub Copilot OAuth state management (Rust-backed).

import { create } from 'zustand';
import { logger } from '@/lib/logger';
import { llmClient } from '@/services/llm/llm-client';
import {
  isCopilotTokenExpired,
  pollForAccessToken,
  startDeviceCodeFlow,
} from './github-copilot-oauth-service';

interface GitHubCopilotOAuthState {
  // Connection state
  isConnected: boolean;
  isLoading: boolean;
  isPolling: boolean;
  error: string | null;

  // Tokens (metadata only; actual tokens stored in Rust)
  expiresAt: number | null;
  enterpriseUrl: string | null;

  // OAuth flow state
  deviceCode: string | null;
  userCode: string | null;
  verificationUri: string | null;
  expiresAtMs: number | null;
  intervalMs: number | null;

  // Initialization
  isInitialized: boolean;
}

interface GitHubCopilotOAuthActions {
  // Initialize from Rust storage
  initialize: () => Promise<void>;

  // OAuth flow - Device Code Flow with polling
  startOAuth: (enterpriseUrl?: string) => Promise<{ userCode: string; verificationUri: string }>;
  pollForToken: () => Promise<void>;
  disconnect: () => Promise<void>;

  // Token management
  getValidCopilotToken: () => Promise<string | null>;
  refreshTokenIfNeeded: () => Promise<boolean>;
}

type GitHubCopilotOAuthStore = GitHubCopilotOAuthState & GitHubCopilotOAuthActions;

async function loadOAuthSnapshot() {
  try {
    return await llmClient.getOAuthStatus();
  } catch (error) {
    logger.warn('[GitHubCopilotOAuth] Failed to read OAuth status from Rust:', error);
    return null;
  }
}

export const useGitHubCopilotOAuthStore = create<GitHubCopilotOAuthStore>((set, get) => ({
  // Initial state
  isConnected: false,
  isLoading: false,
  isPolling: false,
  error: null,
  expiresAt: null,
  enterpriseUrl: null,
  deviceCode: null,
  userCode: null,
  verificationUri: null,
  expiresAtMs: null,
  intervalMs: null,
  isInitialized: false,

  // Initialize from Rust storage
  initialize: async () => {
    const { isInitialized, isLoading } = get();
    if (isInitialized || isLoading) return;

    set({ isLoading: true, error: null });

    try {
      logger.info('[GitHubCopilotOAuth] Initializing store');

      const snapshot = await loadOAuthSnapshot();
      const isConnected = snapshot?.githubCopilot?.isConnected || false;

      // Load token metadata from Rust
      let expiresAt: number | null = null;
      let enterpriseUrl: string | null = null;
      try {
        const tokens = await llmClient.getGitHubCopilotOAuthTokens();
        expiresAt = tokens.expiresAt ?? null;
        enterpriseUrl = tokens.enterpriseUrl ?? null;
      } catch (e) {
        logger.warn('[GitHubCopilotOAuth] Failed to load token metadata:', e);
      }

      logger.info('[GitHubCopilotOAuth] Initialized', { isConnected });

      set({
        isConnected,
        expiresAt,
        enterpriseUrl,
        isLoading: false,
        isInitialized: true,
      });
    } catch (error) {
      logger.error('[GitHubCopilotOAuth] Initialization error:', error);
      set({
        error: error instanceof Error ? error.message : 'Failed to initialize',
        isLoading: false,
        isInitialized: true,
      });
    }
  },

  // Start OAuth flow - Device Code Flow
  startOAuth: async (enterpriseUrl?: string) => {
    set({ isLoading: true, error: null, isPolling: false });

    try {
      const result = await startDeviceCodeFlow(enterpriseUrl);
      const nowMs = Date.now();
      const expiresAtMs = nowMs + Math.max(0, result.expiresIn * 1000);

      set({
        deviceCode: result.deviceCode,
        userCode: result.userCode,
        verificationUri: result.verificationUri,
        enterpriseUrl: enterpriseUrl || null,
        expiresAtMs,
        intervalMs: Math.max(1, result.interval) * 1000,
        isLoading: false,
        isPolling: true,
      });

      logger.info('[GitHubCopilotOAuth] OAuth flow started');

      return {
        userCode: result.userCode,
        verificationUri: result.verificationUri,
      };
    } catch (error) {
      logger.error('[GitHubCopilotOAuth] Failed to start OAuth:', error);
      set({
        error: error instanceof Error ? error.message : 'Failed to start OAuth',
        isLoading: false,
        isPolling: false,
      });
      throw error;
    }
  },

  // Poll for token using Device Code Flow
  pollForToken: async () => {
    const { deviceCode, enterpriseUrl, expiresAtMs, intervalMs } = get();

    if (!deviceCode) {
      throw new Error('No device code found. Please start OAuth flow first.');
    }

    set({ isPolling: true, error: null });

    const pollIntervalMs = intervalMs ?? 5000;
    const deadlineMs = expiresAtMs ?? Date.now() + 10 * 60 * 1000;

    try {
      while (Date.now() < deadlineMs) {
        const result = await pollForAccessToken(deviceCode, enterpriseUrl || undefined);

        if (result.type === 'success' && result.tokens) {
          logger.info('[GitHubCopilotOAuth] OAuth completed successfully');

          set({
            isConnected: true,
            expiresAt: result.tokens.expiresAt,
            enterpriseUrl: result.tokens.enterpriseUrl || null,
            deviceCode: null,
            userCode: null,
            verificationUri: null,
            expiresAtMs: null,
            intervalMs: null,
            isLoading: false,
            isPolling: false,
          });
          return;
        }

        if (result.type !== 'pending') {
          throw new Error(result.error || 'Token exchange failed');
        }

        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }

      throw new Error('Device code expired. Please start OAuth flow again.');
    } catch (error) {
      logger.error('[GitHubCopilotOAuth] Failed to poll for token:', error);
      set({
        error: error instanceof Error ? error.message : 'Failed to complete OAuth',
        isLoading: false,
        isPolling: false,
      });
      throw error;
    }
  },

  // Disconnect and clear tokens via Rust
  disconnect: async () => {
    set({ isLoading: true, error: null });

    try {
      await llmClient.disconnectGitHubCopilotOAuth();

      logger.info('[GitHubCopilotOAuth] Disconnected');

      set({
        expiresAt: null,
        enterpriseUrl: null,
        isConnected: false,
        deviceCode: null,
        userCode: null,
        verificationUri: null,
        expiresAtMs: null,
        intervalMs: null,
        isLoading: false,
        isPolling: false,
      });
    } catch (error) {
      logger.error('[GitHubCopilotOAuth] Failed to disconnect:', error);
      set({
        error: error instanceof Error ? error.message : 'Failed to disconnect',
        isLoading: false,
      });
      throw error;
    }
  },

  // Get a valid Copilot token (refresh if needed) via Rust
  getValidCopilotToken: async () => {
    const state = get();

    if (!state.isConnected) {
      logger.warn('[GitHubCopilotOAuth] Not connected');
      return null;
    }

    // Check if token is expired
    if (state.expiresAt && isCopilotTokenExpired(state.expiresAt)) {
      logger.info('[GitHubCopilotOAuth] Token expired, refreshing...');
      const success = await get().refreshTokenIfNeeded();
      if (!success) {
        logger.error('[GitHubCopilotOAuth] Token refresh failed');
        return null;
      }
    }

    try {
      const tokens = await llmClient.getGitHubCopilotOAuthTokens();
      return tokens.copilotToken ?? null;
    } catch (error) {
      logger.error('[GitHubCopilotOAuth] Failed to get token:', error);
      return null;
    }
  },

  // Refresh token if needed via Rust
  refreshTokenIfNeeded: async () => {
    const { expiresAt } = get();

    // Only refresh if expired
    if (expiresAt && !isCopilotTokenExpired(expiresAt)) {
      return true;
    }

    try {
      const tokens = await llmClient.refreshGitHubCopilotOAuthToken();

      logger.info('[GitHubCopilotOAuth] Token refreshed successfully');

      set({
        expiresAt: tokens.expiresAt,
        enterpriseUrl: tokens.enterpriseUrl || null,
      });

      return true;
    } catch (error) {
      logger.error('[GitHubCopilotOAuth] Token refresh error:', error);
      return false;
    }
  },
}));

// Selector for connection status
export const selectIsGitHubCopilotOAuthConnected = (state: GitHubCopilotOAuthStore) =>
  state.isConnected;

// Export async helper for checking OAuth status
export async function isGitHubCopilotOAuthConnected(): Promise<boolean> {
  const store = useGitHubCopilotOAuthStore.getState();
  if (!store.isInitialized) {
    await store.initialize();
  }
  return useGitHubCopilotOAuthStore.getState().isConnected;
}

// Export async helper for getting valid Copilot token
export async function getGitHubCopilotOAuthToken(): Promise<string | null> {
  const store = useGitHubCopilotOAuthStore.getState();
  if (!store.isInitialized) {
    await store.initialize();
  }
  return store.getValidCopilotToken();
}

// Export async helper for getting tokens
export async function getGitHubCopilotOAuthTokens(): Promise<{
  accessToken: string | null;
  copilotToken: string | null;
  enterpriseUrl: string | null;
} | null> {
  const store = useGitHubCopilotOAuthStore.getState();
  if (!store.isInitialized) {
    await store.initialize();
  }
  const state = useGitHubCopilotOAuthStore.getState();
  if (!state.isConnected) {
    return null;
  }
  try {
    const tokens = await llmClient.getGitHubCopilotOAuthTokens();
    return {
      accessToken: tokens.accessToken ?? null,
      copilotToken: tokens.copilotToken ?? null,
      enterpriseUrl: tokens.enterpriseUrl ?? null,
    };
  } catch (error) {
    logger.error('[GitHubCopilotOAuth] Failed to get tokens:', error);
    return null;
  }
}
