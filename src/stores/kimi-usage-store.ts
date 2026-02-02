// src/stores/kimi-usage-store.ts
// Zustand store for managing Kimi Coding Plan usage data

import { create } from 'zustand';
import { logger } from '@/lib/logger';
import type { KimiUsageData } from '@/services/kimi-usage-service';
import { fetchKimiUsage } from '@/services/kimi-usage-service';

interface KimiUsageStore {
  // State
  usageData: KimiUsageData | null;
  isLoading: boolean;
  error: string | null;
  lastFetchTime: number | null;

  // Actions
  initialize: () => Promise<void>;
  refresh: () => Promise<void>;
  reset: () => void;
}

export const useKimiUsageStore = create<KimiUsageStore>((set, get) => ({
  // Initial State
  usageData: null,
  isLoading: false,
  error: null,
  lastFetchTime: null,

  // Initialize - fetch usage data on first load
  initialize: async () => {
    const { lastFetchTime } = get();

    // Skip if already fetched recently (within 5 minutes)
    if (lastFetchTime && Date.now() - lastFetchTime < 5 * 60 * 1000) {
      logger.info('[KimiUsageStore] Skipping fetch - recently fetched');
      return;
    }

    set({ isLoading: true, error: null });

    try {
      const data = await fetchKimiUsage();
      set({
        usageData: data,
        isLoading: false,
        error: null,
        lastFetchTime: Date.now(),
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[KimiUsageStore] Failed to initialize:', error);
      set({
        isLoading: false,
        error: errorMessage,
      });
    }
  },

  // Refresh - manually refresh usage data
  refresh: async () => {
    set({ isLoading: true, error: null });

    try {
      const data = await fetchKimiUsage();
      set({
        usageData: data,
        isLoading: false,
        error: null,
        lastFetchTime: Date.now(),
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[KimiUsageStore] Failed to refresh:', error);
      set({
        isLoading: false,
        error: errorMessage,
      });
    }
  },

  // Reset - clear all data
  reset: () => {
    set({
      usageData: null,
      isLoading: false,
      error: null,
      lastFetchTime: null,
    });
  },
}));
