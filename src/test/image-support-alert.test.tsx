import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ImageSupportAlert } from '@/components/chat/image-support-alert';
import { useModelStore } from '@/stores/model-store';
import { toast } from 'sonner';

// Mock dependencies
vi.mock('@/stores/model-store', () => ({
  useModelStore: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    info: vi.fn(),
  },
}));

// Mock settings store for useLocale hook
vi.mock('@/stores/settings-store', () => {
  const mockStore: any = vi.fn((selector) => {
    const state = {
      language: 'en' as const,
      setLanguage: vi.fn(),
    };
    if (typeof selector === 'function') {
      return selector(state);
    }
    return state;
  });
  mockStore.getState = () => ({
    language: 'en' as const,
    setLanguage: vi.fn(),
  });
  return {
    useSettingsStore: mockStore,
  };
});

describe('ImageSupportAlert', () => {
  const mockAvailableModels = [
    {
      key: 'gpt-4-vision',
      name: 'GPT-4 Vision',
      provider: 'openai',
      providerName: 'OpenAI',
      imageInput: true,
      imageOutput: false,
      audioInput: false,
      priority: 1,
    },
    {
      key: 'claude-3-vision',
      name: 'Claude 3 Vision',
      provider: 'anthropic',
      providerName: 'Anthropic',
      imageInput: true,
      imageOutput: false,
      audioInput: false,
      priority: 2,
    },
    {
      key: 'gpt-4',
      name: 'GPT-4',
      provider: 'openai',
      providerName: 'OpenAI',
      imageInput: false,
      imageOutput: false,
      audioInput: false,
      priority: 3,
    },
  ];

  const mockOnOpenChange = vi.fn();
  const mockOnModelSelect = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    (useModelStore as any).mockReturnValue({
      availableModels: mockAvailableModels,
    });
  });

  it('should render alert dialog when open', () => {
    render(
      <ImageSupportAlert
        open={true}
        onOpenChange={mockOnOpenChange}
        onModelSelect={mockOnModelSelect}
      />
    );

    expect(screen.getByText('Image Input Not Supported')).toBeInTheDocument();
    expect(screen.getByText(/The current model doesn't support image input/)).toBeInTheDocument();
  });

  it('should display models that support images', async () => {
    render(
      <ImageSupportAlert
        open={true}
        onOpenChange={mockOnOpenChange}
        onModelSelect={mockOnModelSelect}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Models that support images:')).toBeInTheDocument();
    });

    expect(screen.getByText('GPT-4 Vision')).toBeInTheDocument();
    expect(screen.getByText('Claude 3 Vision')).toBeInTheDocument();
    expect(screen.getByText('OpenAI')).toBeInTheDocument();
    expect(screen.getByText('Anthropic')).toBeInTheDocument();
  });

  it('should handle model selection', async () => {
    render(
      <ImageSupportAlert
        open={true}
        onOpenChange={mockOnOpenChange}
        onModelSelect={mockOnModelSelect}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('GPT-4 Vision')).toBeInTheDocument();
    });

    const modelButton = screen.getByText('GPT-4 Vision').closest('button');
    fireEvent.click(modelButton!);

    await waitFor(() => {
      expect(mockOnModelSelect).toHaveBeenCalledWith('gpt-4-vision');
    });

    expect(mockOnOpenChange).toHaveBeenCalledWith(false);
    expect(toast.success).toHaveBeenCalledWith('Model switched');
  });

  it('should handle "Keep Current Model" button', async () => {
    render(
      <ImageSupportAlert
        open={true}
        onOpenChange={mockOnOpenChange}
        onModelSelect={mockOnModelSelect}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Keep Current Model')).toBeInTheDocument();
    });

    const keepButton = screen.getByText('Keep Current Model');
    fireEvent.click(keepButton);

    await waitFor(() => {
      expect(mockOnOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('should show message when no models support images', async () => {
    (useModelStore as any).mockReturnValue({
      availableModels: [
        {
          key: 'gpt-4',
          name: 'GPT-4',
          provider: 'openai',
          providerName: 'OpenAI',
          imageInput: false,
          imageOutput: false,
          audioInput: false,
          priority: 1,
        },
      ],
    });

    render(
      <ImageSupportAlert
        open={true}
        onOpenChange={mockOnOpenChange}
        onModelSelect={mockOnModelSelect}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/No models with image support are currently available/)).toBeInTheDocument();
    });

    expect(screen.getByText(/Please configure API keys for providers that offer image-capable models/)).toBeInTheDocument();
  });

  it('should not show model list when no models support images', () => {
    (useModelStore as any).mockReturnValue({
      availableModels: [
        {
          key: 'gpt-4',
          name: 'GPT-4',
          provider: 'openai',
          providerName: 'OpenAI',
          imageInput: false,
          imageOutput: false,
          audioInput: false,
          priority: 1,
        },
      ],
    });

    render(
      <ImageSupportAlert
        open={true}
        onOpenChange={mockOnOpenChange}
        onModelSelect={mockOnModelSelect}
      />
    );

    expect(screen.queryByText('Models that support images:')).not.toBeInTheDocument();
    expect(screen.queryByText('GPT-4 Vision')).not.toBeInTheDocument();
  });

  it('should change button text when no models support images', async () => {
    (useModelStore as any).mockReturnValue({
      availableModels: [
        {
          key: 'gpt-4',
          name: 'GPT-4',
          provider: 'openai',
          providerName: 'OpenAI',
          imageInput: false,
          imageOutput: false,
          audioInput: false,
          priority: 1,
        },
      ],
    });

    render(
      <ImageSupportAlert
        open={true}
        onOpenChange={mockOnOpenChange}
        onModelSelect={mockOnModelSelect}
      />
    );

    // Wait for the component to render
    await waitFor(() => {
      expect(screen.getByText('Image Input Not Supported')).toBeInTheDocument();
    });

    // The "Choose Model Manually" button should not be shown when there are no image-capable models
    expect(screen.queryByText('Choose Model Manually')).not.toBeInTheDocument();
  });

  it('should filter models correctly based on imageInput property', async () => {
    render(
      <ImageSupportAlert
        open={true}
        onOpenChange={mockOnOpenChange}
        onModelSelect={mockOnModelSelect}
      />
    );

    // Wait for models to be filtered and rendered
    await waitFor(() => {
      expect(screen.getByText('GPT-4 Vision')).toBeInTheDocument();
    });

    // Should only show models with imageInput: true
    expect(screen.getByText('Claude 3 Vision')).toBeInTheDocument();

    // Should not show models with imageInput: false
    expect(screen.queryByText('GPT-4')).not.toBeInTheDocument();
  });
});