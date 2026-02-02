// src/services/openai-usage-service.ts
// Service for fetching OpenAI ChatGPT subscription usage data via OAuth API

import { invoke } from '@tauri-apps/api/core';
import { logger } from '@/lib/logger';
import {
  getRemainingPercentage,
  getTimeUntilReset,
  getUsageLevel,
  getWeeklyResetDisplay,
} from '@/lib/usage-utils';

const OPENAI_USAGE_COMMAND = 'llm_openai_oauth_usage';

/**
 * API response structure for rate limit window
 */
interface OpenAIApiRateLimitWindow {
  used_percent?: number; // 0-100
  limit_window_seconds?: number; // Window duration in seconds
  reset_after_seconds?: number; // Seconds until reset
  reset_at?: number; // Unix timestamp (seconds)
}

/**
 * API response structure for rate limit
 */
interface OpenAIApiRateLimit {
  allowed?: boolean;
  limit_reached?: boolean;
  primary_window?: OpenAIApiRateLimitWindow;
  secondary_window?: OpenAIApiRateLimitWindow | null;
}

/**
 * API response structure for credits
 */
interface OpenAIApiCredits {
  has_credits?: boolean;
  unlimited?: boolean;
  balance?: string; // String number
  approx_local_messages?: [number, number];
  approx_cloud_messages?: [number, number];
}

/**
 * API response from ChatGPT usage endpoint
 */
interface OpenAIApiResponse {
  plan_type?: string; // e.g., "plus", "pro", "team", "free"
  rate_limit?: OpenAIApiRateLimit;
  code_review_rate_limit?: OpenAIApiRateLimit;
  credits?: OpenAIApiCredits;
}

/**
 * Usage window data structure (internal)
 */
export interface OpenAIUsageWindow {
  utilization_pct: number; // 0-100
  reset_at?: string; // ISO 8601 timestamp
}

/**
 * Credits information (internal)
 */
export interface OpenAICredits {
  balance: number;
  has_credits: boolean;
  unlimited: boolean;
}

/**
 * Complete OpenAI ChatGPT usage data (internal)
 */
export interface OpenAIUsageData {
  five_hour: OpenAIUsageWindow;
  seven_day: OpenAIUsageWindow;
  credits?: OpenAICredits;
  rate_limit_tier?: string;
  code_review_utilization?: number;
}

/**
 * Fetch OpenAI ChatGPT usage data from OAuth API
 *
 * @returns OpenAI usage data including session, weekly limits, and credits
 * @throws Error if not authenticated or API call fails
 */
export async function fetchOpenAIUsage(): Promise<OpenAIUsageData> {
  try {
    logger.info('[OpenAIUsage] Fetching usage data');

    const apiData = await invoke<OpenAIApiResponse>(OPENAI_USAGE_COMMAND);

    // Log full response for debugging
    logger.info('[OpenAIUsage] Raw API response:', JSON.stringify(apiData, null, 2));

    // Transform API response to internal format
    const transformWindow = (window?: OpenAIApiRateLimitWindow | null): OpenAIUsageWindow => {
      if (!window) {
        return { utilization_pct: 0 };
      }

      // Convert Unix timestamp (seconds) to ISO 8601 string
      const resetAt = window.reset_at ? new Date(window.reset_at * 1000).toISOString() : undefined;

      return {
        utilization_pct: window.used_percent ?? 0,
        reset_at: resetAt,
      };
    };

    const data: OpenAIUsageData = {
      five_hour: transformWindow(apiData.rate_limit?.primary_window ?? null),
      seven_day: transformWindow(apiData.rate_limit?.secondary_window ?? null),
      rate_limit_tier: apiData.plan_type,
    };

    // Transform credits if present
    if (apiData.credits) {
      data.credits = {
        balance: Number.parseFloat(apiData.credits.balance ?? '0') || 0,
        has_credits: apiData.credits.has_credits ?? false,
        unlimited: apiData.credits.unlimited ?? false,
      };
    }

    // Add code review utilization if present
    if (apiData.code_review_rate_limit?.primary_window) {
      data.code_review_utilization =
        apiData.code_review_rate_limit.primary_window.used_percent ?? 0;
    }

    logger.info('[OpenAIUsage] Usage data fetched successfully', {
      fiveHour: data.five_hour?.utilization_pct,
      sevenDay: data.seven_day?.utilization_pct,
      credits: data.credits,
      planType: data.rate_limit_tier,
    });

    return data;
  } catch (error) {
    logger.error('[OpenAIUsage] Failed to fetch usage:', error);
    throw error;
  }
}

// Re-export utility functions for backward compatibility
export { getTimeUntilReset, getWeeklyResetDisplay, getUsageLevel, getRemainingPercentage };
