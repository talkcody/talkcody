import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies before importing the service
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  BaseDirectory: { AppData: 'appdata' },
  exists: vi.fn(),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/stores/settings-store', () => ({
  settingsManager: {
    getProviderApiKey: vi.fn(),
    getProviderBaseUrl: vi.fn(),
  },
}));

vi.mock('@/providers/provider_config', () => ({
  PROVIDER_CONFIGS: {
    anthropic: { name: 'Anthropic' },
    openai: { name: 'OpenAI' },
  },
}));

describe('CustomModelService - fetchProviderModels with custom base URL', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should use custom base URL when configured for anthropic', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    const { settingsManager } = await import('@/stores/settings-store');
    const { customModelService } = await import('./custom-model-service');

    // Setup mocks
    vi.mocked(settingsManager.getProviderApiKey).mockReturnValue('test-api-key');
    vi.mocked(settingsManager.getProviderBaseUrl).mockResolvedValue('https://custom-proxy.com/v1');
    vi.mocked(invoke).mockResolvedValue({
      status: 200,
      body: JSON.stringify({ data: [{ id: 'claude-3', name: 'Claude 3' }] }),
    });

    await customModelService.fetchProviderModels('anthropic');

    // Verify invoke was called with the custom URL
    expect(invoke).toHaveBeenCalledWith('proxy_fetch', {
      request: expect.objectContaining({
        url: 'https://custom-proxy.com/v1/models',
        method: 'GET',
      }),
    });
  });

  it('should use custom base URL when configured for openai', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    const { settingsManager } = await import('@/stores/settings-store');
    const { customModelService } = await import('./custom-model-service');

    vi.mocked(settingsManager.getProviderApiKey).mockReturnValue('test-api-key');
    vi.mocked(settingsManager.getProviderBaseUrl).mockResolvedValue('https://my-openai-proxy.com/v1/');
    vi.mocked(invoke).mockResolvedValue({
      status: 200,
      body: JSON.stringify({ data: [{ id: 'gpt-4', name: 'GPT-4' }] }),
    });

    await customModelService.fetchProviderModels('openai');

    // Verify trailing slashes are handled correctly
    expect(invoke).toHaveBeenCalledWith('proxy_fetch', {
      request: expect.objectContaining({
        url: 'https://my-openai-proxy.com/v1/models',
        method: 'GET',
      }),
    });
  });

  it('should use default endpoint when no custom base URL is configured', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    const { settingsManager } = await import('@/stores/settings-store');
    const { customModelService } = await import('./custom-model-service');

    vi.mocked(settingsManager.getProviderApiKey).mockReturnValue('test-api-key');
    vi.mocked(settingsManager.getProviderBaseUrl).mockResolvedValue(null);
    vi.mocked(invoke).mockResolvedValue({
      status: 200,
      body: JSON.stringify({ data: [{ id: 'claude-3', name: 'Claude 3' }] }),
    });

    await customModelService.fetchProviderModels('anthropic');

    // Verify default endpoint is used
    expect(invoke).toHaveBeenCalledWith('proxy_fetch', {
      request: expect.objectContaining({
        url: 'https://api.anthropic.com/v1/models',
        method: 'GET',
      }),
    });
  });

  it('should handle multiple trailing slashes in custom base URL', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    const { settingsManager } = await import('@/stores/settings-store');
    const { customModelService } = await import('./custom-model-service');

    vi.mocked(settingsManager.getProviderApiKey).mockReturnValue('test-api-key');
    vi.mocked(settingsManager.getProviderBaseUrl).mockResolvedValue('https://proxy.com/v1///');
    vi.mocked(invoke).mockResolvedValue({
      status: 200,
      body: JSON.stringify({ data: [] }),
    });

    await customModelService.fetchProviderModels('anthropic');

    expect(invoke).toHaveBeenCalledWith('proxy_fetch', {
      request: expect.objectContaining({
        url: 'https://proxy.com/v1/models',
      }),
    });
  });

  it('should include anthropic-specific headers with custom base URL', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    const { settingsManager } = await import('@/stores/settings-store');
    const { customModelService } = await import('./custom-model-service');

    vi.mocked(settingsManager.getProviderApiKey).mockReturnValue('my-api-key');
    vi.mocked(settingsManager.getProviderBaseUrl).mockResolvedValue('https://custom-anthropic.com/v1');
    vi.mocked(invoke).mockResolvedValue({
      status: 200,
      body: JSON.stringify({ data: [] }),
    });

    await customModelService.fetchProviderModels('anthropic');

    expect(invoke).toHaveBeenCalledWith('proxy_fetch', {
      request: expect.objectContaining({
        headers: expect.objectContaining({
          'x-api-key': 'my-api-key',
          'anthropic-version': '2023-06-01',
        }),
      }),
    });
  });
});
