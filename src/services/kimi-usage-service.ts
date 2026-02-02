// src/services/kimi-usage-service.ts
// Service for fetching Kimi Coding Plan usage data via manual token configuration

import { logger } from '@/lib/logger';
import { simpleFetch } from '@/lib/tauri-fetch';
import { settingsManager } from '@/stores/settings-store';

/**
 * Kimi Coding Plan Usage API endpoint
 */
const KIMI_USAGE_API_URL =
  'https://www.kimi.com/apiv2/kimi.gateway.billing.v1.BillingService/GetUsages';

/**
 * Parsed credentials from cURL or manual input
 */
interface KimiCredentials {
  token: string;
}

/**
 * API response from Kimi usage endpoint
 */
interface KimiApiResponse {
  usages?: Array<{
    scope?: string;
    detail?: {
      limit?: string;
      used?: string;
      remaining?: string;
      resetTime?: string;
    };
    limits?: Array<{
      window?: {
        duration?: number;
        timeUnit?: string;
      };
      detail?: {
        limit?: string;
        used?: string;
        remaining?: string;
        resetTime?: string;
      };
    }>;
  }>;
}

/**
 * Usage window data structure (internal)
 */
export interface KimiUsageWindow {
  utilization_pct: number; // 0-100
  used: number;
  total: number;
  remaining: number;
  reset_at?: string; // ISO 8601 timestamp
}

/**
 * Complete Kimi Coding Plan usage data (internal)
 */
export interface KimiUsageData {
  weekly: KimiUsageWindow;
  five_hour: KimiUsageWindow;
  last_validated_at: string; // When the token was last successfully validated
}

/**
 * Parse cURL command to extract credentials
 *
 * Supports two formats:
 * 1. Full cURL command (from "Copy as cURL")
 * 2. Raw Bearer token string
 *
 * @param curlString cURL command or token string
 * @returns Parsed credentials
 */
export function parseCurlCommand(curlString: string): KimiCredentials {
  const credentials: KimiCredentials = {
    token: '',
  };

  const trimmed = curlString.trim();

  // If it's a simple token string (not a cURL command)
  if (!trimmed.startsWith('curl')) {
    credentials.token = trimmed;
    return credentials;
  }

  // Extract Authorization header from cURL command
  const authMatch =
    trimmed.match(/-H\s+'[Aa]uthorization:\s*Bearer\s+([^']+)'/) ||
    trimmed.match(/-H\s+"[Aa]uthorization:\s*Bearer\s+([^"]+)"/);

  if (authMatch?.[1]) {
    credentials.token = authMatch[1];
  }

  return credentials;
}

/**
 * Fetch Kimi Coding Plan usage data from API
 *
 * @returns Kimi usage data
 * @throws Error if token not configured or API call fails
 */
export async function fetchKimiUsage(): Promise<KimiUsageData> {
  try {
    // Get stored credentials from settings
    const curlString = settingsManager.getKimiCookie();

    if (!curlString) {
      throw new Error('Kimi token not configured. Please add your token in settings.');
    }

    logger.info('[KimiUsage] Parsing credentials');

    // Parse credentials from stored cURL/token string
    const credentials = parseCurlCommand(curlString);

    if (!credentials.token) {
      throw new Error('Invalid token format. Please check your token configuration.');
    }

    logger.info('[KimiUsage] Fetching usage data');

    // Call Kimi Usage API
    const response = await simpleFetch(KIMI_USAGE_API_URL, {
      method: 'POST',
      headers: {
        Accept: '*/*',
        'Accept-Language': 'en',
        Authorization: `Bearer ${credentials.token}`,
        'Content-Type': 'application/json',
        Origin: 'https://www.kimi.com',
        Referer: 'https://www.kimi.com/code/console',
      },
      body: JSON.stringify({ scope: ['FEATURE_CODING'] }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('[KimiUsage] API error:', response.status, errorText);

      // Check for common error codes
      if (response.status === 401 || response.status === 403) {
        throw new Error(
          'SESSION_EXPIRED: Your Kimi session has expired. Please update your token in settings.'
        );
      }

      throw new Error(`Kimi Usage API error: ${response.status} - ${errorText}`);
    }

    const apiData = (await response.json()) as KimiApiResponse;

    // Log full response for debugging
    logger.info('[KimiUsage] Raw API response:', JSON.stringify(apiData, null, 2));

    if (!apiData.usages || apiData.usages.length === 0) {
      throw new Error('No usage data found in API response');
    }

    // Find FEATURE_CODING usage
    const codingUsage = apiData.usages.find((u) => u.scope === 'FEATURE_CODING');
    if (!codingUsage) {
      throw new Error('No FEATURE_CODING usage data found in API response');
    }

    // Parse weekly usage from detail
    const weeklyDetail = codingUsage.detail;
    if (!weeklyDetail) {
      throw new Error('No weekly usage detail found in API response');
    }

    const weeklyTotal = Number.parseInt(weeklyDetail.limit || '0', 10);
    const weeklyUsed = Number.parseInt(weeklyDetail.used || '0', 10);
    const weeklyRemaining = Number.parseInt(weeklyDetail.remaining || '0', 10);
    const weeklyUtilizationPct = weeklyTotal > 0 ? (weeklyUsed / weeklyTotal) * 100 : 0;

    // Parse 5-hour usage from limits array (find window with duration=300 minutes)
    let fiveHourWindow: KimiUsageWindow = {
      utilization_pct: 0,
      used: 0,
      total: 0,
      remaining: 0,
    };

    if (codingUsage.limits && codingUsage.limits.length > 0) {
      // Find the 5-hour window (300 minutes)
      const fiveHourLimit = codingUsage.limits.find(
        (l) => l.window?.duration === 300 && l.window?.timeUnit === 'TIME_UNIT_MINUTE'
      );

      if (fiveHourLimit?.detail) {
        const detail = fiveHourLimit.detail;
        const total = Number.parseInt(detail.limit || '0', 10);
        const used = Number.parseInt(detail.used || '0', 10);
        const remaining = Number.parseInt(detail.remaining || '0', 10);

        fiveHourWindow = {
          utilization_pct: total > 0 ? (used / total) * 100 : 0,
          used,
          total,
          remaining,
          reset_at: detail.resetTime,
        };
      }
    }

    const data: KimiUsageData = {
      weekly: {
        utilization_pct: weeklyUtilizationPct,
        used: weeklyUsed,
        total: weeklyTotal,
        remaining: weeklyRemaining,
        reset_at: weeklyDetail.resetTime,
      },
      five_hour: fiveHourWindow,
      last_validated_at: new Date().toISOString(),
    };

    logger.info('[KimiUsage] Usage data fetched successfully', {
      weeklyUtilizationPct: data.weekly.utilization_pct,
      weeklyUsed,
      weeklyTotal,
      fiveHourUtilizationPct: data.five_hour.utilization_pct,
      fiveHourUsed: data.five_hour.used,
      fiveHourTotal: data.five_hour.total,
    });

    return data;
  } catch (error) {
    logger.error('[KimiUsage] Failed to fetch usage:', error);
    throw error;
  }
}

/**
 * Test token validity by making a test API call
 *
 * @param curlString cURL command or token string to test
 * @returns true if valid, throws error if invalid
 */
export async function testKimiToken(curlString: string): Promise<boolean> {
  try {
    const credentials = parseCurlCommand(curlString);

    if (!credentials.token) {
      throw new Error('Invalid token format');
    }

    // Make test API call
    const response = await simpleFetch(KIMI_USAGE_API_URL, {
      method: 'POST',
      headers: {
        Accept: '*/*',
        'Accept-Language': 'en',
        Authorization: `Bearer ${credentials.token}`,
        'Content-Type': 'application/json',
        Origin: 'https://www.kimi.com',
        Referer: 'https://www.kimi.com/code/console',
      },
      body: JSON.stringify({ scope: ['FEATURE_CODING'] }),
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error('Invalid or expired token');
      }
      throw new Error(`API error: ${response.status}`);
    }

    const apiData = (await response.json()) as KimiApiResponse;

    // Log response for debugging
    logger.info('[KimiUsage] Test API response:', JSON.stringify(apiData, null, 2));

    if (!apiData.usages || apiData.usages.length === 0) {
      throw new Error('No usage data found in API response');
    }

    logger.info('[KimiUsage] Token test successful');
    return true;
  } catch (error) {
    logger.error('[KimiUsage] Token test failed:', error);
    throw error;
  }
}

/**
 * Calculate time remaining until reset
 *
 * @param resetAt ISO 8601 timestamp
 * @returns Human-readable time remaining string
 */
export function getTimeUntilReset(resetAt: string): string {
  const resetTime = new Date(resetAt).getTime();
  const now = Date.now();
  const diffMs = resetTime - now;

  if (diffMs <= 0) {
    return 'Resetting soon...';
  }

  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

/**
 * Get usage level indicator
 *
 * @param utilizationPct Usage percentage (0-100)
 * @returns 'low' | 'medium' | 'high' | 'critical'
 */
export function getUsageLevel(utilizationPct: number): 'low' | 'medium' | 'high' | 'critical' {
  if (utilizationPct < 50) return 'low';
  if (utilizationPct < 75) return 'medium';
  if (utilizationPct < 90) return 'high';
  return 'critical';
}

/**
 * Get remaining percentage
 *
 * @param utilizationPct Usage percentage (0-100)
 * @returns Remaining percentage (0-100)
 */
export function getRemainingPercentage(utilizationPct: number): number {
  return Math.max(0, 100 - utilizationPct);
}
