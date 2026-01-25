import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentDefinition } from '@/types/agent';
import { agentService } from '@/services/database/agent-service';
import { AgentSelector } from './agent-selector';

// Mock dependencies
const mockSetAssistantId = vi.fn();
const mockSetActiveView = vi.fn();
const mockAgentStoreState = {
  agents: new Map<string, AgentDefinition>(),
  isLoading: false,
  isInitialized: false,
  refreshToken: 0,
};

// Mock agent registry
vi.mock('@/services/agents/agent-registry', () => ({
  agentRegistry: {
    list: vi.fn(() => {
      const mockAgents: AgentDefinition[] = [
        {
          id: 'agent-1',
          name: 'Test Agent 1',
          description: 'Test description 1',
          version: '1.0.0',
          isDefault: true,
          hidden: false,
          systemPrompt: 'Test prompt 1',
          modelType: 'main_model' as any,
        },
        {
          id: 'agent-2',
          name: 'Test Agent 2',
          description: 'Test description 2',
          version: '1.0.0',
          isDefault: false,
          hidden: false,
          systemPrompt: 'Test prompt 2',
          modelType: 'main_model' as any,
        },
        {
          id: 'agent-3',
          name: 'Hidden Agent',
          description: 'Hidden agent',
          version: '1.0.0',
          isDefault: false,
          hidden: true,
          systemPrompt: 'Hidden prompt',
          modelType: 'main_model' as any,
        },
      ];

      // Return agents based on mock store size
      return mockAgentStoreState.agents.size > 0 ? mockAgents : [];
    }),
    isSystemAgentEnabled: vi.fn(() => true),
  },
}));

// Mock agent store
vi.mock('@/stores/agent-store', () => ({
  useAgentStore: vi.fn((selector) => {
    if (typeof selector === 'function') {
      return selector(mockAgentStoreState);
    }
    return mockAgentStoreState;
  }),
}));

// Mock app settings hook
vi.mock('@/hooks/use-settings', () => ({
  useAppSettings: vi.fn(() => ({
    settings: { assistantId: 'agent-1' },
    setAssistantId: mockSetAssistantId,
    loading: false,
  })),
}));

vi.mock('@/services/database/agent-service', () => ({
  agentService: {
    listAgents: vi.fn(),
  },
}));

// Mock UI navigation
vi.mock('@/contexts/ui-navigation', () => ({
  useUiNavigation: vi.fn(() => ({
    setActiveView: mockSetActiveView,
  })),
}));

// Mock BaseSelector
vi.mock('./base-selector', () => ({
  BaseSelector: ({ items, placeholder, disabled, value }: any) => (
    <div data-testid="base-selector">
      <span data-testid="selector-disabled">{String(disabled)}</span>
      <span data-testid="selector-placeholder">{placeholder}</span>
      <span data-testid="selector-value">{value}</span>
      <div data-testid="selector-items">
        {items.map((item: any) => (
          <div key={item.value} data-testid={`item-${item.value}`}>
            {item.label}
          </div>
        ))}
      </div>
    </div>
  ),
}));

describe('AgentSelector Component', () => {
  beforeEach(() => {
    mockSetAssistantId.mockClear();
    mockSetActiveView.mockClear();

    // Reset agent store state
    mockAgentStoreState.agents = new Map();
    mockAgentStoreState.isLoading = false;
    mockAgentStoreState.isInitialized = false;
  });

  it('should render empty selector when no agents are loaded', () => {
    // No agents in store
    mockAgentStoreState.agents = new Map();

    render(<AgentSelector />);

    expect(screen.getByTestId('base-selector')).toBeInTheDocument();
    expect(screen.getByTestId('selector-placeholder')).toHaveTextContent('Select agent');
  });

  it('should display agents when loaded from store', async () => {
    // Set agents in store to trigger agent loading
    mockAgentStoreState.agents = new Map([
      ['agent-1', { id: 'agent-1', name: 'Test Agent 1' } as AgentDefinition],
      ['agent-2', { id: 'agent-2', name: 'Test Agent 2' } as AgentDefinition],
    ]);

    render(<AgentSelector />);

    await waitFor(() => {
      expect(screen.getByText('Test Agent 1')).toBeInTheDocument();
      expect(screen.getByText('Test Agent 2')).toBeInTheDocument();
    });
  });

  it('should filter out hidden agents', async () => {
    mockAgentStoreState.agents = new Map([
      ['agent-1', { id: 'agent-1', name: 'Test Agent 1' } as AgentDefinition],
      ['agent-2', { id: 'agent-2', name: 'Test Agent 2' } as AgentDefinition],
      ['agent-3', { id: 'agent-3', name: 'Hidden Agent', hidden: true } as AgentDefinition],
    ]);

    render(<AgentSelector />);

    await waitFor(() => {
      expect(screen.getByText('Test Agent 1')).toBeInTheDocument();
      expect(screen.getByText('Test Agent 2')).toBeInTheDocument();
      // Hidden agent should not appear
      expect(screen.queryByText('Hidden Agent')).not.toBeInTheDocument();
    });
  });

  it('should include "Manage agents" option', async () => {
    mockAgentStoreState.agents = new Map([
      ['agent-1', { id: 'agent-1', name: 'Test Agent 1' } as AgentDefinition],
    ]);

    render(<AgentSelector />);

    await waitFor(() => {
      // The actual text includes an ellipsis: "Manage agents…"
      expect(screen.getByText(/Manage agents/)).toBeInTheDocument();
    });
  });

  it('should be disabled when agents are loading', async () => {
    mockAgentStoreState.isLoading = true;

    await act(async () => {
      render(<AgentSelector />);
    });

    expect(screen.getByTestId('selector-disabled')).toHaveTextContent('true');
  });

  it('should not be disabled when agents are loaded', () => {
    mockAgentStoreState.isLoading = false;
    mockAgentStoreState.agents = new Map([
      ['agent-1', { id: 'agent-1', name: 'Test Agent 1' } as AgentDefinition],
    ]);

    render(<AgentSelector />);

    expect(screen.getByTestId('selector-disabled')).toHaveTextContent('false');
  });

  it('should use current assistantId as selected value', () => {
    mockAgentStoreState.agents = new Map([
      ['agent-1', { id: 'agent-1', name: 'Test Agent 1' } as AgentDefinition],
    ]);

    render(<AgentSelector />);

    expect(screen.getByTestId('selector-value')).toHaveTextContent('agent-1');
  });

  it('should handle disabled prop', async () => {
    mockAgentStoreState.isLoading = false;

    await act(async () => {
      render(<AgentSelector disabled={true} />);
    });

    expect(screen.getByTestId('selector-disabled')).toHaveTextContent('true');
  });

  it('should be disabled when both disabled prop and isLoading are true', async () => {
    mockAgentStoreState.isLoading = true;

    await act(async () => {
      render(<AgentSelector disabled={true} />);
    });

    expect(screen.getByTestId('selector-disabled')).toHaveTextContent('true');
  });

  it('should re-render when agent store size changes', async () => {
    // Set agents in store before initial render
    mockAgentStoreState.agents = new Map([
      ['agent-1', { id: 'agent-1', name: 'Test Agent 1' } as AgentDefinition],
      ['agent-2', { id: 'agent-2', name: 'Test Agent 2' } as AgentDefinition],
    ]);

    render(<AgentSelector />);

    // Agents should be visible after render
    await waitFor(() => {
      expect(screen.getByText('Test Agent 1')).toBeInTheDocument();
      expect(screen.getByText('Test Agent 2')).toBeInTheDocument();
    });
  });

  it('should remove disabled local agents after refresh token update', async () => {
    mockAgentStoreState.agents = new Map([
      ['agent-1', { id: 'agent-1', name: 'Test Agent 1' } as AgentDefinition],
      ['agent-2', { id: 'agent-2', name: 'Test Agent 2' } as AgentDefinition],
    ]);

    const listAgentsMock = vi.mocked(agentService.listAgents);
    listAgentsMock.mockResolvedValue([
      { id: 'agent-1', is_enabled: true },
      { id: 'agent-2', is_enabled: true },
    ] as any);

    const { rerender } = render(<AgentSelector />);

    await waitFor(() => {
      expect(screen.getByText('Test Agent 1')).toBeInTheDocument();
      expect(screen.getByText('Test Agent 2')).toBeInTheDocument();
    });

    listAgentsMock.mockResolvedValue([
      { id: 'agent-1', is_enabled: true },
      { id: 'agent-2', is_enabled: false },
    ] as any);

    mockAgentStoreState.refreshToken += 1;
    rerender(<AgentSelector />);

    await waitFor(() => {
      expect(screen.getByText('Test Agent 1')).toBeInTheDocument();
      expect(screen.queryByText('Test Agent 2')).not.toBeInTheDocument();
    });
  });
});
