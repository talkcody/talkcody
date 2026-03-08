import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentDefinition } from '@/types/agent';
import { ModelType } from '@/types/model-types';
import { DynamicContextPanel } from './dynamic-context-panel';

vi.mock('@/services/prompt/preview', () => ({
  previewSystemPrompt: vi.fn().mockResolvedValue({
    finalSystemPrompt: 'Test prompt',
    unresolvedPlaceholders: [],
    resolvedContextSources: [
      {
        providerId: 'project_memory',
        providerLabel: 'Project Memory',
        token: 'project_memory',
        sourcePath: '/test/workspace/AGENTS.md',
        sectionKind: 'project_memory',
        charsInjected: 24,
      },
    ],
  }),
}));

vi.mock('@/services/workspace-root-service', () => ({
  getValidatedWorkspaceRoot: vi.fn().mockResolvedValue('/test/workspace'),
}));

describe('DynamicContextPanel', () => {
  const mockAgent: AgentDefinition = {
    id: 'test-agent',
    name: 'Test Agent',
    description: 'Test description',
    modelType: ModelType.MAIN,
    systemPrompt: 'Test system prompt',
    tools: {},
    dynamicPrompt: {
      enabled: false,
      providers: ['env'],
      variables: {},
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should not cause infinite re-renders when onChange is called', async () => {
    const mockOnChange = vi.fn();
    let renderCount = 0;

    const TestWrapper = () => {
      renderCount++;
      return <DynamicContextPanel agent={mockAgent} onChange={mockOnChange} />;
    };

    await act(async () => {
      render(<TestWrapper />);
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
    });

    expect(mockOnChange).toHaveBeenCalled();
    expect(renderCount).toBeLessThan(50);
  });

  it('should render Dynamic Context title', async () => {
    const mockOnChange = vi.fn();

    await act(async () => {
      render(<DynamicContextPanel agent={mockAgent} onChange={mockOnChange} />);
    });

    expect(screen.getByText('Dynamic Context')).toBeInTheDocument();
  });

  it('should render provider checkboxes for project memory and project instructions', async () => {
    const mockOnChange = vi.fn();

    await act(async () => {
      render(<DynamicContextPanel agent={mockAgent} onChange={mockOnChange} />);
    });

    expect(screen.getByText('Environment')).toBeInTheDocument();
    expect(screen.getByText('Project Memory')).toBeInTheDocument();
    expect(screen.getByText('Project Instructions')).toBeInTheDocument();
  });

  it('should call onChange with correct structure when mounted', async () => {
    const mockOnChange = vi.fn();

    await act(async () => {
      render(<DynamicContextPanel agent={mockAgent} onChange={mockOnChange} />);
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    expect(mockOnChange).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: false,
        providers: ['env'],
        variables: expect.any(Object),
        providerSettings: expect.objectContaining({
          agents_md: expect.any(Object),
        }),
      })
    );
  });

  it('should render resolved context sources from the preview result', async () => {
    const mockOnChange = vi.fn();

    await act(async () => {
      render(<DynamicContextPanel agent={mockAgent} onChange={mockOnChange} />);
    });

    await waitFor(() => {
      expect(screen.getByText('Resolved Context Sources')).toBeInTheDocument();
    });

    expect(screen.getAllByText('Project Memory').length).toBeGreaterThan(0);
    expect(screen.getByText('/test/workspace/AGENTS.md')).toBeInTheDocument();
  });

  it('should handle agent with no dynamicPrompt gracefully', async () => {
    const mockOnChange = vi.fn();
    const agentWithoutDynamic: AgentDefinition = {
      id: 'test-agent-2',
      name: 'Test Agent 2',
      modelType: ModelType.MAIN,
      systemPrompt: 'Test prompt',
      tools: {},
    };

    await act(async () => {
      render(<DynamicContextPanel agent={agentWithoutDynamic} onChange={mockOnChange} />);
    });

    expect(screen.getByText('Dynamic Context')).toBeInTheDocument();
  });
});
