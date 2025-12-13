import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useNestedToolsStore } from '@/stores/nested-tools-store';
import type { ToolMessageContent, UIMessage } from '@/types/agent';
import { CallAgentToolDoing } from './call-agent-tool-doing';

describe('CallAgentToolDoing Component', () => {
  beforeEach(() => {
    // Clear store before each test
    useNestedToolsStore.getState().clearAll();
  });

  const defaultProps = {
    agentId: 'test-agent',
    task: 'Execute complex task',
    toolCallId: 'parent-tool-call-123',
  };

  // Helper function to create tool-call messages in the correct format
  // Note: Tool messages from tool-executor.ts have role: 'tool', not 'assistant'
  const createToolCallMessage = (toolName: string, toolCallId: string, input: any): UIMessage => {
    const toolContent: ToolMessageContent = {
      type: 'tool-call',
      toolCallId,
      toolName,
      input,
    };

    return {
      id: `msg-${toolCallId}`,
      role: 'tool',
      content: [toolContent],
      timestamp: new Date(),
      toolCallId,
      toolName,
    };
  };

  it('should render basic agent information', () => {
    render(<CallAgentToolDoing {...defaultProps} />);

    expect(screen.getByText(/Agent: test-agent/i)).toBeInTheDocument();
    expect(screen.getByText(/Execute complex task/i)).toBeInTheDocument();
  });

  it('should render with empty nested tools initially', () => {
    render(<CallAgentToolDoing {...defaultProps} />);

    // Should render the component
    expect(screen.getByText(/Agent: test-agent/i)).toBeInTheDocument();

    // Should not show any nested tool items initially
    const nestedToolItems = screen.queryAllByTestId(/nested-tool-/i);
    expect(nestedToolItems).toHaveLength(0);
  });

  it('should re-render when nested tools are added to store', async () => {
    const { rerender } = render(<CallAgentToolDoing {...defaultProps} />);

    // Initially no nested tools
    expect(screen.queryAllByText(/bash/i)).toHaveLength(0);

    // Add a nested tool message to the store
    const nestedMessage = createToolCallMessage('bash', 'nested-tool-1', { command: 'ls -la' });

    await act(async () => {
      useNestedToolsStore.getState().addMessage('parent-tool-call-123', nestedMessage);
    });

    // Force a re-render to trigger the subscription
    rerender(<CallAgentToolDoing {...defaultProps} />);

    // Wait for the nested tool to appear
    await waitFor(() => {
      const bashElements = screen.queryAllByText(/bash/i);
      expect(bashElements.length).toBeGreaterThan(0);
    });
  });

  it('should handle multiple nested tools', async () => {
    const { rerender } = render(<CallAgentToolDoing {...defaultProps} />);

    // Add multiple nested tool messages
    const messages: UIMessage[] = [
      createToolCallMessage('bash', 'nested-tool-1', { command: 'ls -la' }),
      createToolCallMessage('read', 'nested-tool-2', { filePath: '/test/file.ts' }),
      createToolCallMessage('write', 'nested-tool-3', {
        filePath: '/test/output.ts',
        content: 'test',
      }),
    ];

    await act(async () => {
      for (const msg of messages) {
        useNestedToolsStore.getState().addMessage('parent-tool-call-123', msg);
      }
    });

    rerender(<CallAgentToolDoing {...defaultProps} />);

    // Collapsed summary only shows the current tool; expand to see full list
    fireEvent.click(screen.getByText(/Agent is using tools:/i));

    await waitFor(() => {
      expect(screen.queryAllByText(/bash/i).length).toBeGreaterThan(0);
      expect(screen.queryAllByText(/read/i).length).toBeGreaterThan(0);
      expect(screen.queryAllByText(/write/i).length).toBeGreaterThan(0);
    });
  });

  it('should handle missing toolCallId gracefully', () => {
    const propsWithoutToolCallId = {
      agentId: 'test-agent',
      task: 'Execute complex task',
    };

    // Should render without crashing
    render(<CallAgentToolDoing {...propsWithoutToolCallId} />);

    expect(screen.getByText(/Agent: test-agent/i)).toBeInTheDocument();
  });

  it('should not show nested tools from different parent toolCallId', async () => {
    render(<CallAgentToolDoing {...defaultProps} />);

    // Add nested tools for a DIFFERENT parent
    const nestedMessage = createToolCallMessage('bash', 'nested-tool-1', { command: 'ls -la' });

    useNestedToolsStore.getState().addMessage('different-parent-id', nestedMessage);

    // Should NOT show nested tools from different parent
    await waitFor(
      () => {
        const bashElements = screen.queryAllByText(/bash/i);
        // Should only find "bash" in potential system text, not as a tool
        expect(bashElements.length).toBe(0);
      },
      { timeout: 1000 }
    ).catch(() => {
      // Expected to timeout since the tool should NOT appear
      expect(screen.queryAllByText(/bash/i)).toHaveLength(0);
    });
  });

  it('should reactively update when new nested tools are added', async () => {
    const { rerender } = render(<CallAgentToolDoing {...defaultProps} />);

    // Add first nested tool
    const message1 = createToolCallMessage('bash', 'nested-tool-1', { command: 'echo test' });

    await act(async () => {
      useNestedToolsStore.getState().addMessage('parent-tool-call-123', message1);
    });
    rerender(<CallAgentToolDoing {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText(/bash/i)).toBeInTheDocument();
    });

    // Add second nested tool
    const message2 = createToolCallMessage('read', 'nested-tool-2', { filePath: '/test/file.ts' });

    await act(async () => {
      useNestedToolsStore.getState().addMessage('parent-tool-call-123', message2);
    });
    rerender(<CallAgentToolDoing {...defaultProps} />);

    // Collapsed summary only shows the current tool; expand to see full list
    fireEvent.click(screen.getByText(/Agent is using tools:/i));

    await waitFor(() => {
      expect(screen.queryAllByText(/bash/i).length).toBeGreaterThan(0);
      expect(screen.queryAllByText(/read/i).length).toBeGreaterThan(0);
    });
  });
});
