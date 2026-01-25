// src/stores/api-usage-store.ts
// Zustand store for API usage data management

import { create } from 'zustand';
import { logger } from '@/lib/logger';
import { fetchApiUsageRange } from '@/services/api-usage-service';
import type { ApiUsageRange, ApiUsageRangeResult, ApiUsageTokenView } from '@/types/api-usage';

interface ApiUsageState {
  range: ApiUsageRange;
  tokenView: ApiUsageTokenView;
  data: ApiUsageRangeResult | null;
  isLoading: boolean;
  error: string | null;
  lastFetchedAt: number | null;
  autoRefreshEnabled: boolean;
}

interface ApiUsageActions {
  initialize: () => Promise<void>;
  fetchUsage: () => Promise<void>;
  refresh: () => Promise<void>;
  setRange: (range: ApiUsageRange) => Promise<void>;
  setTokenView: (view: ApiUsageTokenView) => void;
  setAutoRefresh: (enabled: boolean) => void;
  clear: () => void;
}

type ApiUsageStore = ApiUsageState & ApiUsageActions;

const CACHE_DURATION_MS = 60 * 1000;
const AUTO_REFRESH_INTERVAL_MS = 60 * 1000;

let refreshInterval: ReturnType<typeof setInterval> | null = null;

export const useApiUsageStore = create<ApiUsageStore>((set, get) => ({
  range: 'week',
  tokenView: 'total',
  data: null,
  isLoading: false,
  error: null,
  lastFetchedAt: null,
  autoRefreshEnabled: false,

  initialize: async () => {
    const { data } = get();
    if (data) return;
    await get().fetchUsage();
  },

  fetchUsage: async () => {
    const { isLoading, range, lastFetchedAt } = get();
    if (isLoading) return;

    if (lastFetchedAt && Date.now() - lastFetchedAt < CACHE_DURATION_MS) {
      return;
    }

    set({ isLoading: true, error: null });

    try {
      const data = await fetchApiUsageRange(range);
      set({ data, isLoading: false, lastFetchedAt: Date.now() });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch API usage';
      logger.error('[ApiUsageStore] Failed to fetch usage:', error);
      set({ isLoading: false, error: message });
    }
  },

  refresh: async () => {
    set({ lastFetchedAt: null });
    await get().fetchUsage();
  },

  setRange: async (range) => {
    set({ range, lastFetchedAt: null });
    await get().fetchUsage();
  },

  setTokenView: (view) => {
    set({ tokenView: view });
  },

  setAutoRefresh: (enabled) => {
    set({ autoRefreshEnabled: enabled });

    if (refreshInterval) {
      clearInterval(refreshInterval);
      refreshInterval = null;
    }

    if (enabled) {
      refreshInterval = setInterval(() => {
        const store = get();
        if (store.autoRefreshEnabled) {
          store.fetchUsage();
        }
      }, AUTO_REFRESH_INTERVAL_MS);
    }
  },

  clear: () => {
    set({ data: null, error: null, lastFetchedAt: null });
  },
}));
