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

  it('should normalize custom provider base URL without duplicating v1', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    const { customProviderService } = await import('@/providers/custom/custom-provider-service');

    vi.mocked(invoke).mockResolvedValue({
      status: 200,
      headers: {},
      body: JSON.stringify({ data: [] }),
    });

    const config: CustomProviderConfig = {
      id: 'custom-openai',
      name: 'Custom OpenAI',
      type: 'openai-compatible',
      baseUrl: 'https://doit.cc.cd/v1',
      apiKey: 'test-key',
      enabled: true,
    };

    await customProviderService.testProviderConnection(config);

    const fetchCall = vi
      .mocked(invoke)
      .mock.calls.find((call) => call[0] === 'proxy_fetch');
    expect(fetchCall).toBeTruthy();
    const request = fetchCall?.[1]?.request as { url?: string; allow_private_ip?: boolean };
    expect(request?.url).toBe('https://doit.cc.cd/v1/models');
    expect(request?.allow_private_ip).toBe(true);
  });

  it('should append v1 when missing for openai-compatible connection test', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    const { customProviderService } = await import('@/providers/custom/custom-provider-service');

    vi.mocked(invoke).mockResolvedValue({
      status: 200,
      headers: {},
      body: JSON.stringify({ data: [] }),
    });

    const config: CustomProviderConfig = {
      id: 'custom-openai',
      name: 'Custom OpenAI',
      type: 'openai-compatible',
      baseUrl: 'https://doit.cc.cd',
      apiKey: 'test-key',
      enabled: true,
    };

    await customProviderService.testProviderConnection(config);

    const fetchCall = vi
      .mocked(invoke)
      .mock.calls.find((call) => call[0] === 'proxy_fetch');
    expect(fetchCall).toBeTruthy();
    const request = fetchCall?.[1]?.request as { url?: string; allow_private_ip?: boolean };
    expect(request?.url).toBe('https://doit.cc.cd/v1/models');
    expect(request?.allow_private_ip).toBe(true);
  });

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

    const fetchCall = vi
      .mocked(invoke)
      .mock.calls.find((call) => call[0] === 'proxy_fetch' && call[1]?.request?.url?.includes('10.108.10.104'));
    expect(fetchCall).toBeTruthy();
    const request = fetchCall?.[1]?.request as { url?: string; allow_private_ip?: boolean };
    expect(request?.url).toBe('http://10.108.10.104:9090/v1/models');
    expect(request?.allow_private_ip).toBe(true);
  });

});

describe('CustomProviderService - base URL validation', () => {
  it('rejects base URLs that include endpoint paths', async () => {
    const { customProviderService } = await import('@/providers/custom/custom-provider-service');

    const validation = customProviderService.validateProviderConfig({
      name: 'Acme',
      type: 'openai-compatible',
      baseUrl: 'https://api.acme.com/v1/chat/completions',
      apiKey: 'key',
    });

    expect(validation.isValid).toBe(false);
    expect(validation.errors).toContain(
      'Base URL should not include endpoint paths (e.g., /v1/messages)'
    );
  });
});
