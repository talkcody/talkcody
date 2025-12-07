import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { toast } from 'sonner';

// Mock toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock locale
vi.mock('@/hooks/use-locale', () => ({
  useLocale: () => ({
    t: {
      Settings: {
        apiKeys: {
          title: 'API Keys',
          description: 'Configure API keys',
          tooltipTitle: 'API Keys',
          tooltipDescription: 'Configure your API keys',
          test: 'Test',
          testing: 'Testing...',
          testConnection: 'Test',
          customBaseUrl: 'Custom Base URL',
          baseUrlPlaceholder: () => 'Enter base URL',
          testSuccess: (name: string) => `${name} connection successful`,
          testFailed: (name: string) => `${name} connection failed`,
          useCodingPlan: 'Use Coding Plan',
          configured: 'Configured',
          viewDocumentation: 'View Documentation',
          enterKey: () => 'Enter API key',
          codingPlanEnabled: () => 'Coding plan enabled',
          codingPlanDisabled: () => 'Coding plan disabled',
          codingPlanUpdateFailed: () => 'Failed to update',
        },
      },
    },
    locale: 'en',
  }),
}));

// Mock doc links
vi.mock('@/lib/doc-links', () => ({
  getDocLinks: () => ({
    configuration: { apiKeys: 'https://docs.example.com/api-keys' },
    apiKeysProviders: {
      anthropic: 'https://docs.example.com/anthropic',
      openai: 'https://docs.example.com/openai',
    },
  }),
}));

// Mock logger
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock tauri fetch
vi.mock('@/lib/tauri-fetch', () => ({
  simpleFetch: vi.fn(),
}));

// Mock providers
vi.mock('@/providers', () => ({
  PROVIDER_CONFIGS: {
    anthropic: {
      id: 'anthropic',
      name: 'Anthropic',
      baseUrl: 'https://api.anthropic.com',
    },
    openai: {
      id: 'openai',
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com',
    },
  },
}));

// Mock ai-provider-service
vi.mock('@/services/ai-provider-service', () => ({
  aiProviderService: {
    refreshProviders: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock custom-model-service
vi.mock('@/services/custom-model-service', () => ({
  customModelService: {
    supportsModelsFetch: vi.fn().mockReturnValue(true),
    fetchProviderModels: vi.fn(),
    getModelsEndpoint: vi.fn().mockReturnValue('https://api.anthropic.com/v1/models'),
  },
  isLocalProvider: vi.fn().mockReturnValue(false),
}));

// Mock settings-store
vi.mock('@/stores/settings-store', () => ({
  settingsManager: {
    getApiKeys: vi.fn().mockResolvedValue({ anthropic: 'test-key' }),
    getProviderBaseUrl: vi.fn().mockResolvedValue(null),
    getProviderUseCodingPlan: vi.fn().mockResolvedValue(false),
    setProviderApiKey: vi.fn().mockResolvedValue(undefined),
  },
}));

// Import after mocks
import { ApiKeysSettings } from './api-keys-settings';
import { customModelService } from '@/services/custom-model-service';
import { settingsManager } from '@/stores/settings-store';

describe('ApiKeysSettings - Connection Test Error Messages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should show URL in error message when connection test fails with default endpoint', async () => {
    vi.mocked(settingsManager.getProviderBaseUrl).mockResolvedValue(null);
    vi.mocked(customModelService.fetchProviderModels).mockRejectedValue(new Error('Connection refused'));

    render(<ApiKeysSettings />);

    // Wait for component to load API keys
    await waitFor(() => {
      expect(settingsManager.getApiKeys).toHaveBeenCalled();
    });

    // Find and click the Test button for anthropic
    const testButtons = await screen.findAllByRole('button', { name: /test/i });
    const anthropicTestButton = testButtons.find((btn) => btn.textContent?.toLowerCase().includes('test'));

    if (anthropicTestButton) {
      fireEvent.click(anthropicTestButton);

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          expect.stringContaining('https://api.anthropic.com/v1/models')
        );
      });
    }
  });

  it('should show custom URL in error message when connection test fails with custom base URL', async () => {
    const customUrl = 'https://my-custom-proxy.com/v1';
    vi.mocked(settingsManager.getProviderBaseUrl).mockResolvedValue(customUrl);
    vi.mocked(customModelService.fetchProviderModels).mockRejectedValue(new Error('Connection refused'));

    render(<ApiKeysSettings />);

    await waitFor(() => {
      expect(settingsManager.getApiKeys).toHaveBeenCalled();
    });

    const testButtons = await screen.findAllByRole('button', { name: /test/i });
    const anthropicTestButton = testButtons.find((btn) => btn.textContent?.toLowerCase().includes('test'));

    if (anthropicTestButton) {
      fireEvent.click(anthropicTestButton);

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          expect.stringContaining('https://my-custom-proxy.com/v1/models')
        );
      });
    }
  });

  it('should show provider name in error message', async () => {
    vi.mocked(settingsManager.getProviderBaseUrl).mockResolvedValue(null);
    vi.mocked(customModelService.fetchProviderModels).mockRejectedValue(new Error('API error'));

    render(<ApiKeysSettings />);

    await waitFor(() => {
      expect(settingsManager.getApiKeys).toHaveBeenCalled();
    });

    const testButtons = await screen.findAllByRole('button', { name: /test/i });
    const anthropicTestButton = testButtons.find((btn) => btn.textContent?.toLowerCase().includes('test'));

    if (anthropicTestButton) {
      fireEvent.click(anthropicTestButton);

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Anthropic'));
      });
    }
  });

  it('should show success message when connection test succeeds', async () => {
    vi.mocked(settingsManager.getProviderBaseUrl).mockResolvedValue(null);
    vi.mocked(customModelService.fetchProviderModels).mockResolvedValue([
      { id: 'claude-3', name: 'Claude 3' },
    ]);

    render(<ApiKeysSettings />);

    await waitFor(() => {
      expect(settingsManager.getApiKeys).toHaveBeenCalled();
    });

    const testButtons = await screen.findAllByRole('button', { name: /test/i });
    const anthropicTestButton = testButtons.find((btn) => btn.textContent?.toLowerCase().includes('test'));

    if (anthropicTestButton) {
      fireEvent.click(anthropicTestButton);

      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('Anthropic'));
      });
    }
  });
});
