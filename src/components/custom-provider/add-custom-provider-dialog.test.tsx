import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AddCustomProviderDialog } from './AddCustomProviderDialog';

const {
  mockAddCustomProvider,
  mockUpdateCustomProvider,
  mockRefreshProviders,
  mockValidateProviderConfig,
  mockGenerateProviderId,
  mockTestProviderConnection,
  mockAddCustomProviderService,
  mockAddCustomModels,
  mockSupportsModelsFetch,
  mockFetchProviderModels,
  mockRefreshModelConfigs,
  mockOnOpenChange,
  mockTranslation,
} = vi.hoisted(() => ({
  mockAddCustomProvider: vi.fn().mockResolvedValue(undefined),
  mockUpdateCustomProvider: vi.fn().mockResolvedValue(undefined),
  mockRefreshProviders: vi.fn().mockResolvedValue(undefined),
  mockValidateProviderConfig: vi.fn(() => ({
    isValid: true,
    errors: [],
    warnings: [],
  })),
  mockGenerateProviderId: vi.fn(() => 'openai-compatible-acme-123456'),
  mockTestProviderConnection: vi.fn(),
  mockAddCustomProviderService: vi.fn(),
  mockAddCustomModels: vi.fn().mockResolvedValue(undefined),
  mockSupportsModelsFetch: vi.fn(() => false),
  mockFetchProviderModels: vi.fn(),
  mockRefreshModelConfigs: vi.fn().mockResolvedValue(undefined),
  mockOnOpenChange: vi.fn(),
  mockTranslation: {
    Common: {
      add: 'Add',
      cancel: 'Cancel',
      update: 'Update',
    },
    CustomProviderDialog: {
      fixValidationErrors: 'Fix validation errors',
      connectionSuccessfulWithTime: (time: number) => `Success ${time}`,
      connectionSuccessful: 'Connection success',
      connectionFailed: (error: string) => `Connection failed: ${error}`,
      testFailed: (error: string) => `Test failed: ${error}`,
      providerUpdated: 'Provider updated',
      providerAdded: 'Provider added',
      saveFailed: (error: string) => `Save failed: ${error}`,
      addModelsTitle: (name: string) => `Add models for ${name}`,
      addTitle: 'Add provider',
      editTitle: 'Edit provider',
      description: 'Description',
      providerType: 'Provider type',
      selectProviderType: 'Select provider type',
      openaiCompatible: 'OpenAI Compatible',
      anthropic: 'Anthropic',
      openaiCompatibleDescription: 'OpenAI compatible description',
      anthropicDescription: 'Anthropic description',
      providerName: 'Provider name',
      providerNamePlaceholder: 'Provider name',
      baseUrl: 'Base URL',
      baseUrlPlaceholderAnthropic: 'https://api.anthropic.com',
      baseUrlPlaceholderOpenAI: 'https://api.openai.com',
      baseUrlHint: 'Base URL hint',
      apiKey: 'API key',
      apiKeyPlaceholder: 'API key',
      enabled: 'Enabled',
      testing: 'Testing',
      test: 'Test',
      saving: 'Saving',
      skip: 'Skip',
      availableModelsHint: (models: string, extra: number) => `Models ${models} ${extra}`,
    },
    Settings: {
      customModelsDialog: {
        description: 'Models description',
        fetchModels: 'Fetch models',
        noModelsFound: 'No models',
        fetchFailed: (error: string) => `Fetch failed: ${error}`,
        availableModels: (count: number) => `Available ${count}`,
        selectAll: 'Select all',
        clear: 'Clear',
        searchPlaceholder: 'Search',
        clearSearchAria: 'Clear search',
        noModelsMatch: (query: string) => `No models match ${query}`,
        modelsSelected: (count: number) => `${count} selected`,
        manualModelName: 'Manual model name',
        manualModelPlaceholder: 'Model id',
        noListingSupport: 'No listing support',
        enterManually: 'Enter manually',
        hideManualInput: 'Hide manual input',
        addModelManually: 'Add model manually',
        selectAtLeastOne: 'Select at least one',
        addedModels: (count: number) => `Added ${count}`,
        addFailed: 'Add failed',
        addModels: 'Add models',
        provider: 'Provider',
        selectProvider: 'Select provider',
      },
    },
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('@/hooks/use-locale', () => ({
  useTranslation: () => mockTranslation,
}));

vi.mock('@/providers/custom/custom-provider-service', () => ({
  customProviderService: {
    validateProviderConfig: mockValidateProviderConfig,
    generateProviderId: mockGenerateProviderId,
    testProviderConnection: mockTestProviderConnection,
    addCustomProvider: mockAddCustomProviderService,
  },
}));

vi.mock('@/providers/custom/custom-model-service', () => ({
  customModelService: {
    addCustomModels: mockAddCustomModels,
    supportsModelsFetch: mockSupportsModelsFetch,
    fetchProviderModels: mockFetchProviderModels,
  },
}));

vi.mock('@/providers/config/model-config', () => ({
  refreshModelConfigs: mockRefreshModelConfigs,
}));

vi.mock('@/providers/stores/provider-store', () => ({
  useProviderStore: {
    getState: vi.fn(() => ({
      addCustomProvider: mockAddCustomProvider,
      updateCustomProvider: mockUpdateCustomProvider,
      refresh: mockRefreshProviders,
    })),
  },
}));

describe('AddCustomProviderDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses provider store when adding a new provider', async () => {
    render(<AddCustomProviderDialog open={true} onOpenChange={mockOnOpenChange} />);

    fireEvent.change(screen.getByLabelText(/Provider name/i), {
      target: { value: 'Acme AI' },
    });
    fireEvent.change(screen.getByLabelText(/Base URL/i), {
      target: { value: 'https://api.acme.ai' },
    });
    fireEvent.change(screen.getByLabelText(/API key/i), {
      target: { value: 'acme-key' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      expect(mockAddCustomProvider).toHaveBeenCalledWith({
        id: 'openai-compatible-acme-123456',
        name: 'Acme AI',
        type: 'openai-compatible',
        baseUrl: 'https://api.acme.ai',
        apiKey: 'acme-key',
        enabled: true,
        description: '',
      });
    });

    expect(mockAddCustomProviderService).not.toHaveBeenCalled();
  });

  it('refreshes models after adding custom models', async () => {
    render(<AddCustomProviderDialog open={true} onOpenChange={mockOnOpenChange} />);

    fireEvent.change(screen.getByLabelText(/Provider name/i), {
      target: { value: 'Acme AI' },
    });
    fireEvent.change(screen.getByLabelText(/Base URL/i), {
      target: { value: 'https://api.acme.ai' },
    });
    fireEvent.change(screen.getByLabelText(/API key/i), {
      target: { value: 'acme-key' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await screen.findByText('Add models for Acme AI');

    fireEvent.change(screen.getByPlaceholderText('Model id'), {
      target: { value: 'acme-model' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Add models' }));

    await waitFor(() => {
      expect(mockAddCustomModels).toHaveBeenCalledWith({
        'acme-model': {
          name: 'acme-model',
          providers: ['openai-compatible-acme-123456'],
          pricing: { input: '0', output: '0' },
        },
      });
    });

    expect(mockRefreshModelConfigs).toHaveBeenCalled();
    expect(mockRefreshProviders).toHaveBeenCalled();
  });
});
