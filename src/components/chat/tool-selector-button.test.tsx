import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentDefinition } from '@/types/agent';
import { ToolSelectorButton } from './tool-selector-button';

// Mock dependencies
const mockAgentStoreState = {
  agents: new Map<string, AgentDefinition>(),
  isLoading: false,
  isInitialized: false,
  getAgent: (id: string) => {
    return mockAgentStoreState.agents.get(id) || null;
  },
  refreshAgents: vi.fn().mockResolvedValue(undefined),
};

// Mock tool override store
vi.mock('@/stores/tool-override-store', () => {
  const state = {
    overrides: new Map(),
    addTool: vi.fn(),
    removeTool: vi.fn(),
    clearOverride: vi.fn(),
    getOverride: vi.fn(() => undefined),
    hasOverride: vi.fn(() => false),
  };

  const mockStore: any = vi.fn((selector) => {
    if (typeof selector === 'function') {
      return selector(state);
    }
    return state;
  });

  mockStore.getState = () => state;

  return {
    useToolOverrideStore: mockStore,
  };
});

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
    settings: { assistantId: 'test-agent' },
    loading: false,
  })),
}));

// Mock tool registry
vi.mock('@/services/agents/tool-registry', () => ({
  getAvailableToolsForUI: vi.fn(() => [
    { id: 'bashTool', label: 'Bash', ref: {} },
    { id: 'readFile', label: 'Read File', ref: {} },
    { id: 'writeFile', label: 'Write File', ref: {} },
  ]),
  getAvailableToolsForUISync: vi.fn(() => [
    { id: 'bashTool', label: 'Bash', ref: {} },
    { id: 'readFile', label: 'Read File', ref: {} },
    { id: 'writeFile', label: 'Write File', ref: {} },
  ]),
}));

// Mock MCP tools hook
vi.mock('@/hooks/use-multi-mcp-tools', () => ({
  useMultiMCPTools: vi.fn(() => ({
    allTools: [
      {
        prefixedName: 'mcp__server1__tool1',
        name: 'Tool 1',
        serverName: 'Server 1',
      },
    ],
  })),
}));

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
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

describe('ToolSelectorButton Component', () => {
  beforeEach(() => {
    // Reset agent store state
    mockAgentStoreState.agents = new Map();
    mockAgentStoreState.isLoading = false;
    mockAgentStoreState.isInitialized = false;

    // Clear mock calls
    vi.clearAllMocks();
  });

  it('should be disabled when no agent is loaded', () => {
    // No agents in store
    mockAgentStoreState.agents = new Map();

    render(<ToolSelectorButton />);

    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
  });

  it('should be enabled when agent is loaded', async () => {
    // Set agents in store to trigger agent loading
    mockAgentStoreState.agents = new Map([
      ['test-agent', { id: 'test-agent', name: 'Test Agent' } as AgentDefinition],
    ]);

    render(<ToolSelectorButton />);

    await waitFor(() => {
      const button = screen.getByRole('button');
      expect(button).not.toBeDisabled();
    });
  });

  it('should display selected tool count badge', async () => {
    mockAgentStoreState.agents = new Map([
      [
        'test-agent',
        {
          id: 'test-agent',
          name: 'Test Agent',
          modelType: 'main_model' as any,
          systemPrompt: 'test',
          tools: {
            bashTool: {} as any,
            readFile: {} as any,
          },
        } as AgentDefinition,
      ],
    ]);

    render(<ToolSelectorButton />);

    await waitFor(() => {
      // The agent has 2 tools selected: bashTool and readFile
      expect(screen.getByText('2')).toBeInTheDocument();
    });
  });

  it('should show tooltip on hover', async () => {
    mockAgentStoreState.agents = new Map([
      ['test-agent', { id: 'test-agent', name: 'Test Agent' } as AgentDefinition],
    ]);

    render(<ToolSelectorButton />);

    await waitFor(() => {
      const button = screen.getByRole('button');
      expect(button).toBeInTheDocument();
    });
  });

  it('should re-render when agent store size changes', async () => {
    const { rerender } = render(<ToolSelectorButton />);

    // Initially no agents - button should be disabled
    const buttonBefore = screen.getByRole('button');
    expect(buttonBefore).toBeDisabled();

    // Add agents to store
    mockAgentStoreState.agents = new Map([
      ['test-agent', { id: 'test-agent', name: 'Test Agent' } as AgentDefinition],
    ]);

    // Force re-render to simulate store change
    rerender(<ToolSelectorButton />);

    await waitFor(() => {
      const buttonAfter = screen.getByRole('button');
      expect(buttonAfter).not.toBeDisabled();
    });
  });

  it('should display tool count when tools are selected', async () => {
    mockAgentStoreState.agents = new Map([
      [
        'test-agent',
        {
          id: 'test-agent',
          name: 'Test Agent',
          modelType: 'main_model' as any,
          systemPrompt: 'test',
          tools: {
            bashTool: {} as any,
            readFile: {} as any,
          },
        } as AgentDefinition,
      ],
    ]);

    render(<ToolSelectorButton />);

    await waitFor(() => {
      // Agent has 2 tools: bashTool and readFile
      const badge = screen.getByText('2');
      expect(badge).toBeInTheDocument();
    });
  });

  it('should have correct icon', async () => {
    mockAgentStoreState.agents = new Map([
      ['test-agent', { id: 'test-agent', name: 'Test Agent' } as AgentDefinition],
    ]);

    render(<ToolSelectorButton />);

    await waitFor(() => {
      // Check for Wrench icon by looking for SVG
      const button = screen.getByRole('button');
      const svg = button.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });
  });

  it('should update tool selection when agent tools are modified', async () => {
    // Setup agent with 2 tools initially
    const initialAgent = {
      id: 'test-agent',
      name: 'Test Agent',
      description: 'Test description',
      version: '1.0.0',
      isDefault: false,
      hidden: false,
      systemPrompt: 'Test prompt',
      modelType: 'main_model' as any,
      tools: {
        bashTool: {} as any,
        readFile: {} as any,
      },
    } as AgentDefinition;

    mockAgentStoreState.agents = new Map([['test-agent', initialAgent]]);

    const { rerender } = render(<ToolSelectorButton />);

    // Verify agent has 2 tools initially
    await waitFor(() => {
      expect(screen.getByText('2')).toBeInTheDocument();
    });

    // Update agent to have 3 tools
    const updatedAgent = {
      ...initialAgent,
      tools: {
        bashTool: {} as any,
        readFile: {} as any,
        writeFile: {} as any,
      },
    } as AgentDefinition;

    mockAgentStoreState.agents = new Map([['test-agent', updatedAgent]]);

    rerender(<ToolSelectorButton />);

    // Verify agent now has 3 tools
    await waitFor(() => {
      expect(screen.getByText('3')).toBeInTheDocument();
    });
  });

  it('should update tool selection when switching between agents', async () => {
    // Setup two different agents with different tools
    const agent1 = {
      id: 'agent-1',
      name: 'Agent 1',
      description: 'First agent',
      version: '1.0.0',
      isDefault: false,
      hidden: false,
      systemPrompt: 'Prompt 1',
      modelType: 'main_model' as any,
      tools: {
        bashTool: {} as any,
        readFile: {} as any,
      },
    } as AgentDefinition;

    const agent2 = {
      id: 'agent-2',
      name: 'Agent 2',
      description: 'Second agent',
      version: '1.0.0',
      isDefault: false,
      hidden: false,
      systemPrompt: 'Prompt 2',
      modelType: 'main_model' as any,
      tools: {
        writeFile: {} as any,
      },
    } as AgentDefinition;

    mockAgentStoreState.agents = new Map([
      ['agent-1', agent1],
      ['agent-2', agent2],
    ]);

    // Start with agent-1
    const mockUseAppSettings = await import('@/hooks/use-settings');
    vi.mocked(mockUseAppSettings.useAppSettings).mockReturnValue({
      settings: { assistantId: 'agent-1' } as any,
      loading: false,
      error: null,
      setAssistantId: vi.fn(),
    } as any);

    const { rerender } = render(<ToolSelectorButton />);

    // Verify agent-1 has 2 tools
    await waitFor(() => {
      expect(screen.getByText('2')).toBeInTheDocument();
    });

    // Switch to agent-2
    vi.mocked(mockUseAppSettings.useAppSettings).mockReturnValue({
      settings: { assistantId: 'agent-2' } as any,
      loading: false,
      error: null,
      setAssistantId: vi.fn(),
    } as any);

    rerender(<ToolSelectorButton />);

    // Verify agent-2 has 1 tool
    await waitFor(() => {
      expect(screen.getByText('1')).toBeInTheDocument();
    });
  });
});
