import type { ToolSet } from 'ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { AgentLoopState } from '@/types/agent';
import { ToolExecutor } from './tool-executor';

// Mock dependencies
vi.mock('@/lib/logger', () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  },
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  },
}));

describe('tool-executor - callAgent toolCallId passing', () => {
  let mockCallAgentExecute: any;
  let mockTools: ToolSet;
  let mockOnToolMessage: any;
  let toolExecutor: ToolExecutor;
  let mockLoopState: AgentLoopState;

  beforeEach(() => {
    // Create a mock execute function that captures the arguments
    mockCallAgentExecute = vi.fn().mockResolvedValue({
      success: true,
      task_result: 'Task completed',
    });

    // Setup mock tools registry
    mockTools = {
      callAgent: {
        description: 'Call a sub-agent',
        inputSchema: z.object({}),
        execute: mockCallAgentExecute,
      },
    };

    mockOnToolMessage = vi.fn();

    // Create mock loop state
    mockLoopState = {
      messages: [],
      currentIteration: 0,
      isComplete: false,
    };

    // Create ToolExecutor instance
    toolExecutor = new ToolExecutor();
  });

  it('should pass _toolCallId to callAgent tool', async () => {
    const toolCall = {
      toolCallId: 'call_test_123456',
      toolName: 'callAgent',
      input: {
        agentId: 'test-agent',
        task: 'test task',
        context: 'test context',
      },
    };

    await toolExecutor.executeToolCall(toolCall, {
      tools: mockTools,
      loopState: mockLoopState,
      model: 'test-model',
      onToolMessage: mockOnToolMessage,
    });

    // Verify that callAgent's execute was called
    expect(mockCallAgentExecute).toHaveBeenCalledTimes(1);

    // Get the arguments passed to execute
    const executeArgs = mockCallAgentExecute.mock.calls[0][0];

    // Verify _toolCallId was passed correctly
    expect(executeArgs._toolCallId).toBe('call_test_123456');

    // Verify other input parameters are still there
    expect(executeArgs.agentId).toBe('test-agent');
    expect(executeArgs.task).toBe('test task');
    expect(executeArgs.context).toBe('test context');
  });

  it('should pass _abortController to callAgent tool when provided', async () => {
    const abortController = new AbortController();

    const toolCall = {
      toolCallId: 'call_test_abortable',
      toolName: 'callAgent',
      input: {
        agentId: 'test-agent',
        task: 'test task',
      },
    };

    await toolExecutor.executeToolCall(toolCall, {
      tools: mockTools,
      loopState: mockLoopState,
      model: 'test-model',
      onToolMessage: mockOnToolMessage,
      abortController,
    });

    expect(mockCallAgentExecute).toHaveBeenCalledTimes(1);

    const executeArgs = mockCallAgentExecute.mock.calls[0][0];

    // Verify both _toolCallId and _abortController are passed
    expect(executeArgs._toolCallId).toBe('call_test_abortable');
    expect(executeArgs._abortController).toBe(abortController);
  });

  it('should pass _toolCallId even when abortController is not provided', async () => {
    const toolCall = {
      toolCallId: 'call_test_no_abort',
      toolName: 'callAgent',
      input: {
        agentId: 'test-agent',
        task: 'test task',
      },
    };

    await toolExecutor.executeToolCall(toolCall, {
      tools: mockTools,
      loopState: mockLoopState,
      model: 'test-model',
      onToolMessage: mockOnToolMessage,
      // No abortController provided
    });

    expect(mockCallAgentExecute).toHaveBeenCalledTimes(1);

    const executeArgs = mockCallAgentExecute.mock.calls[0][0];

    // Verify _toolCallId is passed even without abortController
    expect(executeArgs._toolCallId).toBe('call_test_no_abort');
    expect(executeArgs._abortController).toBeUndefined();
  });

  it('should not add _toolCallId to other tools', async () => {
    const mockBashExecute = vi.fn().mockResolvedValue('command output');

    const bashTools: ToolSet = {
      bash: {
        description: 'Execute bash command',
        inputSchema: z.object({}),
        execute: mockBashExecute,
      },
    };

    const toolCall = {
      toolCallId: 'call_bash_123',
      toolName: 'bash',
      input: {
        command: 'ls -la',
      },
    };

    await toolExecutor.executeToolCall(toolCall, {
      tools: bashTools,
      loopState: mockLoopState,
      model: 'test-model',
      onToolMessage: mockOnToolMessage,
    });

    expect(mockBashExecute).toHaveBeenCalledTimes(1);

    const executeArgs = mockBashExecute.mock.calls[0][0];

    // Verify _toolCallId is NOT added to bash tool
    expect(executeArgs._toolCallId).toBeUndefined();
    expect(executeArgs.command).toBe('ls -la');
  });

  it('should send tool-call message with correct toolCallId before execution', async () => {
    const toolCall = {
      toolCallId: 'call_message_test',
      toolName: 'callAgent',
      input: {
        agentId: 'test-agent',
        task: 'test task',
      },
    };

    await toolExecutor.executeToolCall(toolCall, {
      tools: mockTools,
      loopState: mockLoopState,
      model: 'test-model',
      onToolMessage: mockOnToolMessage,
    });

    // Verify onToolMessage was called twice (tool-call and tool-result)
    expect(mockOnToolMessage).toHaveBeenCalledTimes(2);

    // Check the first call is the tool-call message
    const toolCallMessage = mockOnToolMessage.mock.calls[0][0];
    expect(toolCallMessage.role).toBe('tool');
    expect(toolCallMessage.toolCallId).toBe('call_message_test');
    expect(toolCallMessage.toolName).toBe('callAgent');

    // Verify the message content includes tool-call type
    const toolCallContent = toolCallMessage.content.find((c: any) => c.type === 'tool-call');
    expect(toolCallContent).toBeDefined();
    expect(toolCallContent.toolCallId).toBe('call_message_test');
  });

  it('should parse stringified arrays in tool input fields', async () => {
    const mockCodeSearchExecute = vi.fn().mockResolvedValue({
      success: true,
      result: 'Search completed',
    });

    const codeSearchTools: ToolSet = {
      codeSearch: {
        description: 'Search code files',
        inputSchema: z.object({}),
        execute: mockCodeSearchExecute,
      },
    };

    const toolCall = {
      toolCallId: 'call_codesearch_123',
      toolName: 'codeSearch',
      input: {
        pattern: 'fragment.*pipeline.*driver',
        path: '/Users/test/starrocks',
        file_types: '["cpp", "h"]', // Stringified array
      },
    };

    await toolExecutor.executeToolCall(toolCall, {
      tools: codeSearchTools,
      loopState: mockLoopState,
      model: 'test-model',
      onToolMessage: mockOnToolMessage,
    });

    expect(mockCodeSearchExecute).toHaveBeenCalledTimes(1);

    const executeArgs = mockCodeSearchExecute.mock.calls[0][0];

    // Verify file_types was parsed from string to array
    expect(Array.isArray(executeArgs.file_types)).toBe(true);
    expect(executeArgs.file_types).toEqual(['cpp', 'h']);
    expect(executeArgs.pattern).toBe('fragment.*pipeline.*driver');
    expect(executeArgs.path).toBe('/Users/test/starrocks');
  });

  it('should parse stringified objects in tool input fields', async () => {
    const mockToolExecute = vi.fn().mockResolvedValue({ success: true });

    const testTools: ToolSet = {
      testTool: {
        description: 'Test tool',
        inputSchema: z.object({}),
        execute: mockToolExecute,
      },
    };

    const toolCall = {
      toolCallId: 'call_test_obj',
      toolName: 'testTool',
      input: {
        name: 'test',
        config: '{"key": "value", "nested": {"foo": "bar"}}', // Stringified object
      },
    };

    await toolExecutor.executeToolCall(toolCall, {
      tools: testTools,
      loopState: mockLoopState,
      model: 'test-model',
      onToolMessage: mockOnToolMessage,
    });

    expect(mockToolExecute).toHaveBeenCalledTimes(1);

    const executeArgs = mockToolExecute.mock.calls[0][0];

    // Verify config was parsed from string to object
    expect(typeof executeArgs.config).toBe('object');
    expect(executeArgs.config).toEqual({ key: 'value', nested: { foo: 'bar' } });
    expect(executeArgs.name).toBe('test');
  });

  it('should keep regular strings unchanged', async () => {
    const mockToolExecute = vi.fn().mockResolvedValue({ success: true });

    const testTools: ToolSet = {
      testTool: {
        description: 'Test tool',
        inputSchema: z.object({}),
        execute: mockToolExecute,
      },
    };

    const toolCall = {
      toolCallId: 'call_test_str',
      toolName: 'testTool',
      input: {
        message: 'This is a regular string',
        path: '/some/path/file.txt',
      },
    };

    await toolExecutor.executeToolCall(toolCall, {
      tools: testTools,
      loopState: mockLoopState,
      model: 'test-model',
      onToolMessage: mockOnToolMessage,
    });

    expect(mockToolExecute).toHaveBeenCalledTimes(1);

    const executeArgs = mockToolExecute.mock.calls[0][0];

    // Verify strings are kept unchanged
    expect(executeArgs.message).toBe('This is a regular string');
    expect(executeArgs.path).toBe('/some/path/file.txt');
  });

  it('should handle invalid JSON strings gracefully', async () => {
    const mockToolExecute = vi.fn().mockResolvedValue({ success: true });

    const testTools: ToolSet = {
      testTool: {
        description: 'Test tool',
        inputSchema: z.object({}),
        execute: mockToolExecute,
      },
    };

    const toolCall = {
      toolCallId: 'call_test_invalid',
      toolName: 'testTool',
      input: {
        data: '[invalid json', // Invalid JSON that looks like array
      },
    };

    await toolExecutor.executeToolCall(toolCall, {
      tools: testTools,
      loopState: mockLoopState,
      model: 'test-model',
      onToolMessage: mockOnToolMessage,
    });

    expect(mockToolExecute).toHaveBeenCalledTimes(1);

    const executeArgs = mockToolExecute.mock.calls[0][0];

    // Verify invalid JSON is kept as string
    expect(executeArgs.data).toBe('[invalid json');
  });
});

describe('tool-executor - taskId context passing for worktree', () => {
  let toolExecutor: ToolExecutor;
  let mockLoopState: AgentLoopState;
  let mockOnToolMessage: any;

  beforeEach(() => {
    toolExecutor = new ToolExecutor();
    mockOnToolMessage = vi.fn();
    mockLoopState = {
      messages: [],
      currentIteration: 0,
      isComplete: false,
    };
  });

  describe('isToolWithUI type guard', () => {
    it('should return true for tools with renderToolDoing and renderToolResult', () => {
      const toolWithUI = {
        name: 'testTool',
        execute: vi.fn(),
        renderToolDoing: () => null,
        renderToolResult: () => null,
      };
      // Access private method via any cast for testing
      expect((toolExecutor as any).isToolWithUI(toolWithUI)).toBe(true);
    });

    it('should return false for plain tools without UI methods', () => {
      const plainTool = {
        name: 'testTool',
        execute: vi.fn(),
      };
      expect((toolExecutor as any).isToolWithUI(plainTool)).toBe(false);
    });

    it('should return false for null', () => {
      expect((toolExecutor as any).isToolWithUI(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect((toolExecutor as any).isToolWithUI(undefined)).toBe(false);
    });

    it('should return false for non-object types', () => {
      expect((toolExecutor as any).isToolWithUI('string')).toBe(false);
      expect((toolExecutor as any).isToolWithUI(123)).toBe(false);
      expect((toolExecutor as any).isToolWithUI(true)).toBe(false);
    });

    it('should return false for tools with only renderToolDoing', () => {
      const partialTool = {
        name: 'testTool',
        execute: vi.fn(),
        renderToolDoing: () => null,
      };
      expect((toolExecutor as any).isToolWithUI(partialTool)).toBe(false);
    });

    it('should return false for tools with only renderToolResult', () => {
      const partialTool = {
        name: 'testTool',
        execute: vi.fn(),
        renderToolResult: () => null,
      };
      expect((toolExecutor as any).isToolWithUI(partialTool)).toBe(false);
    });
  });

  describe('executeTool helper', () => {
    it('should pass context to ToolWithUI tools', async () => {
      const mockExecute = vi.fn().mockResolvedValue('result');
      const toolWithUI = {
        name: 'testTool',
        execute: mockExecute,
        renderToolDoing: () => null,
        renderToolResult: () => null,
      };
      const context = { taskId: 'task-123' };

      await (toolExecutor as any).executeTool(toolWithUI, { path: '/test' }, context);

      expect(mockExecute).toHaveBeenCalledWith({ path: '/test' }, context);
    });

    it('should NOT pass context to plain tools', async () => {
      const mockExecute = vi.fn().mockResolvedValue('result');
      const plainTool = {
        name: 'testTool',
        execute: mockExecute,
      };
      const context = { taskId: 'task-123' };

      await (toolExecutor as any).executeTool(plainTool, { path: '/test' }, context);

      // Plain tools should only receive the args, not the context
      expect(mockExecute).toHaveBeenCalledWith({ path: '/test' });
    });
  });

  describe('taskId propagation to tools', () => {
    it('should pass taskId from options to ToolWithUI execute context', async () => {
      const mockExecute = vi.fn().mockResolvedValue({ success: true });
      const toolWithUI = {
        name: 'testTool',
        description: 'Test tool',
        inputSchema: z.object({ path: z.string() }),
        execute: mockExecute,
        renderToolDoing: () => null,
        renderToolResult: () => null,
      };

      const toolCall = {
        toolCallId: 'call_test_taskId',
        toolName: 'testTool',
        input: { path: '/test/path' },
      };

      await toolExecutor.executeToolCall(toolCall, {
        tools: { testTool: toolWithUI },
        loopState: mockLoopState,
        model: 'test-model',
        onToolMessage: mockOnToolMessage,
        taskId: 'task-456',
      });

      expect(mockExecute).toHaveBeenCalledTimes(1);
      // Verify context with taskId was passed as second argument
      expect(mockExecute).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/test/path' }),
        expect.objectContaining({ taskId: 'task-456' })
      );
    });

    it('should pass undefined taskId when not provided in options', async () => {
      const mockExecute = vi.fn().mockResolvedValue({ success: true });
      const toolWithUI = {
        name: 'testTool',
        description: 'Test tool',
        inputSchema: z.object({ path: z.string() }),
        execute: mockExecute,
        renderToolDoing: () => null,
        renderToolResult: () => null,
      };

      const toolCall = {
        toolCallId: 'call_test_no_taskId',
        toolName: 'testTool',
        input: { path: '/test/path' },
      };

      await toolExecutor.executeToolCall(toolCall, {
        tools: { testTool: toolWithUI },
        loopState: mockLoopState,
        model: 'test-model',
        onToolMessage: mockOnToolMessage,
        // no taskId provided
      });

      expect(mockExecute).toHaveBeenCalledTimes(1);
      // Verify context with undefined taskId was passed
      expect(mockExecute).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/test/path' }),
        expect.objectContaining({ taskId: undefined })
      );
    });

    it('should NOT pass context to non-ToolWithUI tools even when taskId is provided', async () => {
      const mockExecute = vi.fn().mockResolvedValue({ success: true });
      const plainTool: ToolSet = {
        plainTool: {
          description: 'Plain tool without UI',
          inputSchema: z.object({ command: z.string() }),
          execute: mockExecute,
        },
      };

      const toolCall = {
        toolCallId: 'call_plain_tool',
        toolName: 'plainTool',
        input: { command: 'ls -la' },
      };

      await toolExecutor.executeToolCall(toolCall, {
        tools: plainTool,
        loopState: mockLoopState,
        model: 'test-model',
        onToolMessage: mockOnToolMessage,
        taskId: 'task-789',
      });

      expect(mockExecute).toHaveBeenCalledTimes(1);
      // Plain tools should receive args without context
      const callArgs = mockExecute.mock.calls[0];
      expect(callArgs.length).toBe(1); // Only args, no context
      expect(callArgs[0]).toEqual(expect.objectContaining({ command: 'ls -la' }));
    });

    it('should pass different taskIds to different tool calls', async () => {
      const mockExecute = vi.fn().mockResolvedValue({ success: true });
      const toolWithUI = {
        name: 'readFile',
        description: 'Read file tool',
        inputSchema: z.object({ path: z.string() }),
        execute: mockExecute,
        renderToolDoing: () => null,
        renderToolResult: () => null,
      };

      // First call with task-A
      await toolExecutor.executeToolCall(
        { toolCallId: 'call_1', toolName: 'readFile', input: { path: '/file1.txt' } },
        {
          tools: { readFile: toolWithUI },
          loopState: mockLoopState,
          model: 'test-model',
          onToolMessage: mockOnToolMessage,
          taskId: 'task-A',
        }
      );

      // Second call with task-B
      await toolExecutor.executeToolCall(
        { toolCallId: 'call_2', toolName: 'readFile', input: { path: '/file2.txt' } },
        {
          tools: { readFile: toolWithUI },
          loopState: mockLoopState,
          model: 'test-model',
          onToolMessage: mockOnToolMessage,
          taskId: 'task-B',
        }
      );

      expect(mockExecute).toHaveBeenCalledTimes(2);

      // Verify first call received task-A
      expect(mockExecute.mock.calls[0][1]).toEqual({ taskId: 'task-A' });

      // Verify second call received task-B
      expect(mockExecute.mock.calls[1][1]).toEqual({ taskId: 'task-B' });
    });
  });
});
