// src/services/kimi-usage-service.test.ts
// Tests for Kimi usage service

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseCurlCommand,
  fetchKimiUsage,
  testKimiToken,
  getTimeUntilReset,
  getUsageLevel,
  getRemainingPercentage,
} from './kimi-usage-service';
import { settingsManager } from '@/stores/settings-store';

// Mock dependencies
vi.mock('@/stores/settings-store', () => ({
  settingsManager: {
    getKimiCookie: vi.fn(),
  },
}));

vi.mock('@/lib/tauri-fetch', () => ({
  simpleFetch: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

import { simpleFetch } from '@/lib/tauri-fetch';

describe('Kimi Usage Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('parseCurlCommand', () => {
    it('should parse raw token string', () => {
      const token = 'eyJhbGciOiJIUzUxMiIsInR5cCI6IkpXVCJ9.test';
      const result = parseCurlCommand(token);
      expect(result.token).toBe(token);
    });

    it('should parse full cURL command with Bearer token', () => {
      const curl = `curl 'https://www.kimi.com/apiv2/kimi.gateway.billing.v1.BillingService/GetUsages' \
        -H 'authorization: Bearer eyJhbGciOiJIUzUxMiIsInR5cCI6IkpXVCJ9.test' \
        -H 'content-type: application/json' \
        --data-raw '{"scope":["FEATURE_CODING"]}'`;
      const result = parseCurlCommand(curl);
      expect(result.token).toBe('eyJhbGciOiJIUzUxMiIsInR5cCI6IkpXVCJ9.test');
    });

    it('should parse cURL with double quotes', () => {
      const curl = `curl "https://www.kimi.com/apiv2/kimi.gateway.billing.v1.BillingService/GetUsages" \
        -H "Authorization: Bearer test.token.123"`;
      const result = parseCurlCommand(curl);
      expect(result.token).toBe('test.token.123');
    });

    it('should handle empty input', () => {
      const result = parseCurlCommand('');
      expect(result.token).toBe('');
    });

    it('should handle curl command without Authorization header', () => {
      const curl = `curl 'https://www.kimi.com/apiv2/kimi.gateway.billing.v1.BillingService/GetUsages'`;
      const result = parseCurlCommand(curl);
      expect(result.token).toBe('');
    });
  });

  describe('fetchKimiUsage', () => {
    it('should throw error when token not configured', async () => {
      vi.mocked(settingsManager.getKimiCookie).mockReturnValue('');
      await expect(fetchKimiUsage()).rejects.toThrow('token not configured');
    });

    it('should throw error when token format is invalid', async () => {
      vi.mocked(settingsManager.getKimiCookie).mockReturnValue('curl invalid-url');
      await expect(fetchKimiUsage()).rejects.toThrow('Invalid token format');
    });

    it('should fetch and parse usage data correctly', async () => {
      const mockResponse = {
        usages: [
          {
            scope: 'FEATURE_CODING',
            detail: {
              limit: '100',
              used: '9',
              remaining: '91',
              resetTime: '2026-02-07T05:59:17.796014Z',
            },
            limits: [
              {
                window: {
                  duration: 300,
                  timeUnit: 'TIME_UNIT_MINUTE',
                },
                detail: {
                  limit: '100',
                  used: '1',
                  remaining: '99',
                  resetTime: '2026-02-02T02:59:17.796014Z',
                },
              },
            ],
          },
        ],
      };

      vi.mocked(settingsManager.getKimiCookie).mockReturnValue('test-token');
      vi.mocked(simpleFetch).mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await fetchKimiUsage();

      expect(result.weekly.total).toBe(100);
      expect(result.weekly.used).toBe(9);
      expect(result.weekly.remaining).toBe(91);
      expect(result.weekly.utilization_pct).toBe(9);
      expect(result.weekly.reset_at).toBe('2026-02-07T05:59:17.796014Z');

      expect(result.five_hour.total).toBe(100);
      expect(result.five_hour.used).toBe(1);
      expect(result.five_hour.remaining).toBe(99);
      expect(result.five_hour.utilization_pct).toBe(1);
      expect(result.five_hour.reset_at).toBe('2026-02-02T02:59:17.796014Z');
    });

    it('should map API 401/403 to SESSION_EXPIRED for UI recovery', async () => {
      vi.mocked(settingsManager.getKimiCookie).mockReturnValue('test-token');
      vi.mocked(simpleFetch).mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      } as Response);

      await expect(fetchKimiUsage()).rejects.toThrow('SESSION_EXPIRED');
    });

    it('should handle empty limits array', async () => {
      const mockResponse = {
        usages: [
          {
            scope: 'FEATURE_CODING',
            detail: {
              limit: '100',
              used: '50',
              remaining: '50',
              resetTime: '2026-02-07T05:59:17.796014Z',
            },
            limits: [],
          },
        ],
      };

      vi.mocked(settingsManager.getKimiCookie).mockReturnValue('test-token');
      vi.mocked(simpleFetch).mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await fetchKimiUsage();

      expect(result.weekly.total).toBe(100);
      expect(result.five_hour.total).toBe(0);
    });

    it('should handle missing FEATURE_CODING scope', async () => {
      const mockResponse = {
        usages: [
          {
            scope: 'OTHER_SCOPE',
            detail: {
              limit: '100',
              used: '10',
              remaining: '90',
            },
          },
        ],
      };

      vi.mocked(settingsManager.getKimiCookie).mockReturnValue('test-token');
      vi.mocked(simpleFetch).mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await expect(fetchKimiUsage()).rejects.toThrow('No FEATURE_CODING usage data found');
    });
  });

  describe('testKimiToken', () => {
    it('should throw error for invalid token format', async () => {
      await expect(testKimiToken('curl -H "Other: header"')).rejects.toThrow('Invalid token format');
    });

    it('should parse token from cURL command', async () => {
      const mockResponse = {
        usages: [
          {
            scope: 'FEATURE_CODING',
            detail: {
              limit: '100',
              used: '9',
              remaining: '91',
            },
          },
        ],
      };

      vi.mocked(simpleFetch).mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const curl = `curl 'https://www.kimi.com/apiv2/kimi.gateway.billing.v1.BillingService/GetUsages' \
        -H 'authorization: Bearer valid.token.here'`;

      const result = await testKimiToken(curl);
      expect(result).toBe(true);
    });

    it('should throw error for invalid token', async () => {
      vi.mocked(simpleFetch).mockResolvedValue({
        ok: false,
        status: 401,
      } as Response);

      await expect(testKimiToken('invalid-token')).rejects.toThrow('Invalid or expired token');
    });

    it('should throw error for API error', async () => {
      vi.mocked(simpleFetch).mockResolvedValue({
        ok: false,
        status: 500,
      } as Response);

      await expect(testKimiToken('valid-token')).rejects.toThrow('API error: 500');
    });
  });

  describe('getTimeUntilReset', () => {
    it('should return days and hours for distant reset', () => {
      const future = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000); // 2d 3h
      const result = getTimeUntilReset(future.toISOString());
      expect(result).toMatch(/2d 3h/);
    });

    it('should return hours and minutes for near reset', () => {
      const future = new Date(Date.now() + 2 * 60 * 60 * 1000 + 30 * 60 * 1000); // 2h 30m
      const result = getTimeUntilReset(future.toISOString());
      expect(result).toMatch(/2h 30m/);
    });

    it('should return minutes for very near reset', () => {
      const future = new Date(Date.now() + 45 * 60 * 1000); // 45m
      const result = getTimeUntilReset(future.toISOString());
      expect(result).toMatch(/45m/);
    });

    it('should return "Resetting soon" for past reset time', () => {
      const past = new Date(Date.now() - 60 * 1000); // 1 minute ago
      const result = getTimeUntilReset(past.toISOString());
      expect(result).toBe('Resetting soon...');
    });
  });

  describe('getUsageLevel', () => {
    it('should return low for < 50%', () => {
      expect(getUsageLevel(0)).toBe('low');
      expect(getUsageLevel(25)).toBe('low');
      expect(getUsageLevel(49.9)).toBe('low');
    });

    it('should return medium for 50-74%', () => {
      expect(getUsageLevel(50)).toBe('medium');
      expect(getUsageLevel(74.9)).toBe('medium');
    });

    it('should return high for 75-89%', () => {
      expect(getUsageLevel(75)).toBe('high');
      expect(getUsageLevel(89.9)).toBe('high');
    });

    it('should return critical for >= 90%', () => {
      expect(getUsageLevel(90)).toBe('critical');
      expect(getUsageLevel(100)).toBe('critical');
    });
  });

  describe('getRemainingPercentage', () => {
    it('should calculate remaining percentage correctly', () => {
      expect(getRemainingPercentage(0)).toBe(100);
      expect(getRemainingPercentage(50)).toBe(50);
      expect(getRemainingPercentage(100)).toBe(0);
    });

    it('should not return negative values', () => {
      expect(getRemainingPercentage(150)).toBe(0);
    });
  });
});
