import { describe, expect, it, vi } from 'vitest';
import type { CustomProviderConfig } from '@/types/custom-provider';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  BaseDirectory: { AppData: 'appdata' },
  exists: vi.fn(),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
}));

// Note: Logger is already mocked globally in setup.ts

describe('CustomProviderService - private IP support', () => {
  it('should allow private IP requests for connection test', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    const { customProviderService } = await import('@/providers/custom/custom-provider-service');

    vi.mocked(invoke).mockResolvedValue({
      status: 200,
      headers: {},
      body: JSON.stringify({ data: [] }),
    });

    const config: CustomProviderConfig = {
      id: 'custom-private',
      name: 'Private Provider',
      type: 'openai-compatible',
      baseUrl: 'http://10.108.10.104:9090/v1',
      apiKey: 'test-key',
      enabled: true,
      description: 'Private IP provider',
    };

    await customProviderService.testProviderConnection(config);

    expect(invoke).toHaveBeenCalledWith('proxy_fetch', {
      request: expect.objectContaining({
        url: 'http://10.108.10.104:9090/v1/models',
        allow_private_ip: true,
      }),
    });
  });
});
