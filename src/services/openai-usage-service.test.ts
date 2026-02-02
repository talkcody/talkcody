// src/services/openai-usage-service.test.ts
import { describe, expect, it, vi } from 'vitest';
import { fetchOpenAIUsage } from './openai-usage-service';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('fetchOpenAIUsage', () => {
  it('should call Rust backend command instead of direct API', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    const mockData = {
      plan_type: 'plus',
      rate_limit: {
        primary_window: {
          used_percent: 50,
          reset_at: 1704067200,
        },
        secondary_window: {
          used_percent: 30,
          reset_at: 1704652800,
        },
      },
      credits: {
        has_credits: true,
        unlimited: false,
        balance: '100.00',
      },
    };

    vi.mocked(invoke).mockResolvedValue(mockData);

    const result = await fetchOpenAIUsage();

    expect(invoke).toHaveBeenCalledWith('llm_openai_oauth_usage');
    expect(result.five_hour.utilization_pct).toBe(50);
    expect(result.seven_day.utilization_pct).toBe(30);
    expect(result.rate_limit_tier).toBe('plus');
    expect(result.credits?.balance).toBe(100);
  });

  it('should handle missing optional fields', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    const mockData = {
      plan_type: 'free',
      rate_limit: {
        primary_window: {
          used_percent: 10,
        },
        secondary_window: null,
      },
    };

    vi.mocked(invoke).mockResolvedValue(mockData);

    const result = await fetchOpenAIUsage();

    expect(result.five_hour.utilization_pct).toBe(10);
    expect(result.seven_day.utilization_pct).toBe(0);
    expect(result.credits).toBeUndefined();
    expect(result.code_review_utilization).toBeUndefined();
  });

  it('should handle code review rate limit', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    const mockData = {
      plan_type: 'pro',
      rate_limit: {
        primary_window: { used_percent: 20 },
        secondary_window: { used_percent: 15 },
      },
      code_review_rate_limit: {
        primary_window: { used_percent: 25 },
      },
    };

    vi.mocked(invoke).mockResolvedValue(mockData);

    const result = await fetchOpenAIUsage();

    expect(result.code_review_utilization).toBe(25);
  });

  it('should throw when Rust command fails', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    vi.mocked(invoke).mockRejectedValue(new Error('OAuth not connected'));

    await expect(fetchOpenAIUsage()).rejects.toThrow('OAuth not connected');
  });
});
