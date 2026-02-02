// src/stores/openai-usage-store.ts
// Zustand store for OpenAI ChatGPT usage data management

import { create } from 'zustand';
import { logger } from '@/lib/logger';
import { isOpenAIOAuthConnected } from '@/providers/oauth/openai-oauth-store';
import type { OpenAIUsageData } from '@/services/openai-usage-service';
import { fetchOpenAIUsage } from '@/services/openai-usage-service';

interface OpenAIUsageState {
  // Usage data
  usageData: OpenAIUsageData | null;

  // Loading state
  isLoading: boolean;

  // Error state
  error: string | null;

  // Last fetch timestamp
  lastFetchedAt: number | null;

  // Auto-refresh enabled
  autoRefreshEnabled: boolean;

  // Initialization state
  isInitialized: boolean;

  // Last known OAuth connection status
  lastAuthConnected: boolean | null;
}

interface OpenAIUsageActions {
  // Fetch usage data
  fetchUsage: () => Promise<void>;

  // Refresh usage data
  refresh: () => Promise<void>;

  // Clear usage data
  clear: () => void;

  // Enable/disable auto-refresh
  setAutoRefresh: (enabled: boolean) => void;

  // Initialize store
  initialize: () => Promise<void>;
}

type OpenAIUsageStore = OpenAIUsageState & OpenAIUsageActions;

// Cache duration: 2 minutes
const CACHE_DURATION_MS = 2 * 60 * 1000;

// Auto-refresh interval: 5 minutes
const AUTO_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

let refreshInterval: ReturnType<typeof setInterval> | null = null;

export const useOpenAIUsageStore = create<OpenAIUsageStore>((set, get) => ({
  // Initial state
  usageData: null,
  isLoading: false,
  error: null,
  lastFetchedAt: null,
  autoRefreshEnabled: false,
  isInitialized: false,
  lastAuthConnected: null,

  // Initialize store
  initialize: async () => {
    const { isInitialized } = get();
    if (isInitialized) return;

    logger.info('[OpenAIUsageStore] Initializing');
    set({ isInitialized: true });

    // Initial fetch
    await get().fetchUsage();
  },

  // Fetch usage data
  fetchUsage: async () => {
    const { isLoading, lastFetchedAt, lastAuthConnected } = get();

    // Avoid concurrent fetches
    if (isLoading) {
      logger.debug('[OpenAIUsageStore] Already fetching, skipping');
      return;
    }

    const isConnected = await isOpenAIOAuthConnected();

    // Clear cached data when OAuth disconnects so UI prompts reconnection
    if (!isConnected) {
      if (lastAuthConnected !== false) {
        logger.info('[OpenAIUsageStore] OAuth disconnected, clearing usage data');
        set({
          usageData: null,
          lastFetchedAt: null,
          error: null,
          lastAuthConnected: false,
        });
      }
      return;
    }

    // If connection state changed from disconnected to connected, force refresh
    const shouldForceRefresh = lastAuthConnected === false;

    // Check cache freshness
    if (!shouldForceRefresh && lastFetchedAt && Date.now() - lastFetchedAt < CACHE_DURATION_MS) {
      logger.debug('[OpenAIUsageStore] Using cached data');
      return;
    }

    set({ isLoading: true, error: null, lastAuthConnected: true });

    try {
      logger.info('[OpenAIUsageStore] Fetching usage data');
      const usageData = await fetchOpenAIUsage();

      // Log received data structure
      logger.info('[OpenAIUsageStore] Received usage data:', JSON.stringify(usageData, null, 2));

      // Validate data structure
      if (!usageData || !usageData.five_hour || !usageData.seven_day) {
        logger.error('[OpenAIUsageStore] Invalid data structure:', {
          hasUsageData: !!usageData,
          hasFiveHour: !!usageData?.five_hour,
          hasSevenDay: !!usageData?.seven_day,
          dataKeys: usageData ? Object.keys(usageData) : [],
        });
        throw new Error('Invalid usage data structure received from API');
      }

      set({
        usageData,
        lastFetchedAt: Date.now(),
        isLoading: false,
        error: null,
      });

      logger.info('[OpenAIUsageStore] Usage data updated successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[OpenAIUsageStore] Failed to fetch usage:', error);

      set({
        error: errorMessage,
        isLoading: false,
      });
    }
  },

  // Refresh usage data (bypasses cache)
  refresh: async () => {
    logger.info('[OpenAIUsageStore] Forcing refresh');

    // Clear cache timestamp to force fresh fetch
    set({ lastFetchedAt: null });

    await get().fetchUsage();
  },

  // Clear usage data
  clear: () => {
    logger.info('[OpenAIUsageStore] Clearing usage data');

    set({
      usageData: null,
      lastFetchedAt: null,
      error: null,
      lastAuthConnected: null,
    });
  },

  // Enable/disable auto-refresh
  setAutoRefresh: (enabled: boolean) => {
    logger.info('[OpenAIUsageStore] Auto-refresh:', enabled);

    set({ autoRefreshEnabled: enabled });

    // Clear existing interval
    if (refreshInterval) {
      clearInterval(refreshInterval);
      refreshInterval = null;
    }

    // Start new interval if enabled
    if (enabled) {
      refreshInterval = setInterval(() => {
        const store = get();
        if (store.autoRefreshEnabled) {
          logger.debug('[OpenAIUsageStore] Auto-refresh triggered');
          store.fetchUsage();
        }
      }, AUTO_REFRESH_INTERVAL_MS);
    }
  },
}));

// Selector for usage data
export const selectOpenAIUsageData = (state: OpenAIUsageStore) => state.usageData;

// Selector for loading state
export const selectOpenAIUsageLoading = (state: OpenAIUsageStore) => state.isLoading;

// Selector for error state
export const selectOpenAIUsageError = (state: OpenAIUsageStore) => state.error;

// Helper function to get usage data
export async function getOpenAIUsageData(): Promise<OpenAIUsageData | null> {
  const store = useOpenAIUsageStore.getState();

  if (!store.isInitialized) {
    await store.initialize();
  }

  return store.usageData;
}
