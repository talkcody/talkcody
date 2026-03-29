// src/test/chat-service.runManualAgentLoop.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { hookService } from '../services/hooks/hook-service';
import { hookStateService } from '../services/hooks/hook-state-service';
import { messageService } from '../services/message-service';
import { completionHookPipeline } from '../services/agents/llm-completion-hooks';
import type { CompletionHook } from '../types/completion-hooks';
import { createLLMService, LLMService } from '../services/agents/llm-service';
import { stopHookService } from '../services/agents/stop-hook-service';
import type { AgentLoopOptions, UIMessage } from '../types/agent';
import { createLlmEventStream, createTextOnlyEvents } from './utils/llm-client-mock';

vi.mock('@/providers/stores/provider-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/providers/stores/provider-store')>();
  return {
    ...actual,
    useProviderStore: {
      getState: vi.fn(() => ({
        getProviderModel: vi.fn(() => ({
          provider: 'test-provider',
          config: { id: 'test-provider' },
        })),
        isModelAvailable: vi.fn(() => true),
        availableModels: [],
        apiKeys: {},
        providers: new Map(),
        customProviders: {},
      })),
    },
    modelService: {
      isModelAvailableSync: vi.fn().mockReturnValue(true),
      getBestProviderForModelSync: vi.fn().mockReturnValue('test-provider'),
    },
  };
});

vi.mock('../stores/settings-store', () => ({
  settingsManager: {
    getCurrentRootPath: vi.fn().mockReturnValue('/test/path'),
    getCurrentTaskId: vi.fn().mockReturnValue('test-task-id'),
    getSync: vi.fn().mockReturnValue(undefined),
    getBatchSync: vi.fn().mockReturnValue({}),
    getAutoApproveEditsGlobal: vi.fn(() => false),
    getAutoCodeReviewGlobal: vi.fn(() => false),
    setAutoApproveEditsGlobal: vi.fn(),
    setAutoCodeReviewGlobal: vi.fn(),
  },
  useSettingsStore: {
    getState: vi.fn(() => ({
      language: 'en',
      getReasoningEffort: vi.fn(() => 'medium'),
      getAutoApproveEditsGlobal: vi.fn(() => false),
      getAutoCodeReviewGlobal: vi.fn(() => false),
      setAutoApproveEditsGlobal: vi.fn(),
      setAutoCodeReviewGlobal: vi.fn(),
    })),
  },
}));

vi.mock('../services/workspace-root-service', () => ({
  getValidatedWorkspaceRoot: vi.fn().mockResolvedValue('/test/path'),
  getEffectiveWorkspaceRoot: vi.fn().mockResolvedValue('/test/path'),
}));

vi.mock('../services/ai/ai-pricing-service', () => ({
  aiPricingService: {
    calculateCost: vi.fn().mockResolvedValue(0.001),
  },
}));

vi.mock('../services/task-service', () => ({
  taskService: {
    updateTaskUsage: vi.fn().mockResolvedValue(undefined),
    updateTaskSettings: vi.fn().mockResolvedValue(undefined),
    getTaskSettings: vi.fn().mockResolvedValue(null),
    generateAndUpdateTitle: vi.fn().mockResolvedValue(undefined),
    createTask: vi.fn().mockResolvedValue('test-task-id'),
    loadTasks: vi.fn().mockResolvedValue(undefined),
    loadMessages: vi.fn().mockResolvedValue([]),
    selectTask: vi.fn().mockResolvedValue(undefined),
    deleteTask: vi.fn().mockResolvedValue(undefined),
    renameTask: vi.fn().mockResolvedValue(undefined),
    getTaskDetails: vi.fn().mockResolvedValue(null),
    loadTasksWithPagination: vi.fn().mockResolvedValue([]),
    loadTasksWithSearchPagination: vi.fn().mockResolvedValue([]),
    startNewTask: vi.fn().mockReturnValue(undefined),
  },
}));

vi.mock('../services/context/context-compactor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/context/context-compactor')>();
  const MockContextCompactor = vi.fn(function (this: typeof actual.ContextCompactor) {
    Object.setPrototypeOf(this, actual.ContextCompactor.prototype);
    const instance = new actual.ContextCompactor();
    Object.assign(this, instance);
    this.compactMessages = vi.fn(async (options) => {
      const preservedMessages = options.messages.slice(-1);
      return {
        compressedSummary: 'Summary',
        sections: [{ title: 'Summary', content: 'Summary' }],
        preservedMessages,
        originalMessageCount: options.messages.length,
        compressedMessageCount: preservedMessages.length + 2,
        compressionRatio: 0.5,
      };
    });
  });
  return {
    ...actual,
    ContextCompactor: MockContextCompactor,
  };
});

vi.mock('@/stores/task-store', () => ({
  useTaskStore: {
    getState: vi.fn(() => ({
      getMessages: vi.fn(() => []),
      getTask: vi.fn(() => undefined),
      updateTask: vi.fn(),
      updateTaskUsage: vi.fn(),
    })),
  },
}));

vi.mock('../services/hooks/hook-service', () => ({
  hookService: {
    runStop: vi.fn().mockResolvedValue({
      blocked: false,
      continue: true,
      additionalContext: [],
    }),
    applyHookSummary: vi.fn(),
    runSessionStart: vi.fn().mockResolvedValue({
      blocked: false,
      continue: true,
      additionalContext: [],
    }),
    runPreToolUse: vi.fn().mockResolvedValue({
      blocked: false,
      continue: true,
      additionalContext: [],
    }),
    runPostToolUse: vi.fn().mockResolvedValue({
      blocked: false,
      continue: true,
      additionalContext: [],
    }),
  },
}));

vi.mock('@/services/hooks/hook-state-service', () => ({
  hookStateService: {
    consumeAdditionalContext: vi.fn(() => []),
    setStopHookActive: vi.fn(),
  },
}));

vi.mock('../services/message-service', () => ({
  messageService: {
    addUserMessage: vi.fn(),
  },
}));

vi.mock('../lib/llm-utils', () => ({
  convertMessages: vi.fn().mockImplementation((messages) => Promise.resolve(messages || [])),
  formatReasoningText: vi
    .fn()
    .mockImplementation((text, isFirst) => (isFirst ? `\n<thinking>\n${text}` : text)),
}));

vi.mock('@/services/llm/llm-client', () => ({
  llmClient: {
    streamText: vi.fn(),
    generateImage: vi.fn(),
  },
}));

vi.mock('@/services/database-service', () => ({
  databaseService: {
    startSpan: vi.fn().mockResolvedValue(undefined),
    endSpan: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('ChatService.runManualAgentLoop', () => {
  let chatService: LLMService;
  let mockCallbacks: {
    onChunk: ReturnType<typeof vi.fn>;
    onComplete: ReturnType<typeof vi.fn>;
    onError: ReturnType<typeof vi.fn>;
    onStatus: ReturnType<typeof vi.fn>;
  };
  let mockStreamText: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    completionHookPipeline.clear();
    completionHookPipeline.register(stopHookService);

    // Re-establish mock implementations after clearing
    // Import the mocked module to access mock functions
    const { modelService } = await import('@/providers/stores/provider-store');
    vi.mocked(modelService.isModelAvailableSync).mockReturnValue(true);
    vi.mocked(modelService.getBestProviderForModelSync).mockReturnValue('test-provider');

    const { useProviderStore } = await import('@/providers/stores/provider-store');
    vi.mocked(useProviderStore.getState).mockReturnValue({
      getProviderModel: vi.fn().mockReturnValue({
        provider: 'test-provider',
        config: { id: 'test-provider' },
      }),
      isModelAvailable: vi.fn(() => true),
      availableModels: [],
      apiKeys: {},
      providers: new Map(),
      customProviders: {},
    });

    const { convertMessages, formatReasoningText } = await import('../lib/llm-utils');
    vi.mocked(convertMessages).mockImplementation((messages) => Promise.resolve(messages || []));
    vi.mocked(formatReasoningText).mockImplementation((text, isFirst) =>
      isFirst ? `\n<thinking>\n${text}` : text
    );

    vi.mocked(hookService.runStop).mockResolvedValue({
      blocked: false,
      continue: true,
      additionalContext: [],
    });
    vi.mocked(hookService.runSessionStart).mockResolvedValue({
      blocked: false,
      continue: true,
      additionalContext: [],
    });
    vi.mocked(hookService.runPreToolUse).mockResolvedValue({
      blocked: false,
      continue: true,
      additionalContext: [],
    });
    vi.mocked(hookService.runPostToolUse).mockResolvedValue({
      blocked: false,
      continue: true,
      additionalContext: [],
    });

    const llmModule = await import('@/services/llm/llm-client');
    mockStreamText = vi.mocked(llmModule.llmClient.streamText);

    chatService = new LLMService('test-task-id');
    mockCallbacks = {
      onChunk: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn(),
      onStatus: vi.fn(),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const createMockMessages = (): UIMessage[] => [
    {
      id: 'msg-1',
      role: 'user',
      content: 'Hello, please help me',
      timestamp: new Date(),
    },
  ];

  const createBasicOptions = (overrides?: Partial<AgentLoopOptions>): AgentLoopOptions => ({
    messages: createMockMessages(),
    model: 'test-model',
    systemPrompt: 'You are a helpful assistant',
    tools: {},
    isThink: false,
    suppressReasoning: false,
    maxIterations: 5,
    ...overrides,
  });

  describe('Basic functionality', () => {
    it('should complete successfully with text response', async () => {
      mockStreamText.mockReturnValue(
        createLlmEventStream(createTextOnlyEvents(['Hello!', ' How can I help?']))
      );

      const options = createBasicOptions();

      await chatService.runAgentLoop(options, mockCallbacks);

      expect(mockCallbacks.onChunk).toHaveBeenCalledWith('Hello!');
      expect(mockCallbacks.onChunk).toHaveBeenCalledWith(' How can I help?');
      expect(mockCallbacks.onComplete).toHaveBeenCalledWith('Hello! How can I help?');
      expect(mockCallbacks.onStatus).toHaveBeenCalledWith('Answering');
    });

    it('should handle reasoning output when isThink is true', async () => {
      mockStreamText.mockReturnValue(
        createLlmEventStream([
          { type: 'reasoning-delta', id: 'default', text: 'Let me think about this...' },
          { type: 'text-start' },
          { type: 'text-delta', text: 'Based on my reasoning, here is the answer.' },
          { type: 'done', finish_reason: 'stop' },
        ])
      );

      const options = createBasicOptions({ isThink: true });

      await chatService.runAgentLoop(options, mockCallbacks);

      expect(mockCallbacks.onChunk).toHaveBeenCalledWith(
        '\n<thinking>\nLet me think about this...'
      );
      expect(mockCallbacks.onChunk).toHaveBeenCalledWith(
        'Based on my reasoning, here is the answer.'
      );
      expect(mockCallbacks.onStatus).toHaveBeenCalledWith('Thinking');
    });

    it('should suppress reasoning when suppressReasoning is true', async () => {
      mockStreamText.mockReturnValue(
        createLlmEventStream([
          { type: 'reasoning-delta', id: 'default', text: 'This should be suppressed' },
          { type: 'text-delta', text: 'Visible text' },
          { type: 'done', finish_reason: 'stop' },
        ])
      );

      const options = createBasicOptions({ suppressReasoning: true });

      await chatService.runAgentLoop(options, mockCallbacks);

      expect(mockCallbacks.onChunk).not.toHaveBeenCalledWith('This should be suppressed');
      expect(mockCallbacks.onChunk).toHaveBeenCalledWith('Visible text');
    });

    it('should respect maxIterations limit', async () => {
      // Mock stream that would normally continue indefinitely
      mockStreamText.mockReturnValue(
        createLlmEventStream([
          {
            type: 'tool-call',
            toolName: 'nonExistentTool',
            toolCallId: 'call-1',
            input: {},
          },
          { type: 'done', finish_reason: 'tool-calls' },
        ])
      );

      const options = createBasicOptions({
        maxIterations: 2,
        tools: {},
      });

      await chatService.runAgentLoop(options, mockCallbacks);

      // Should have called streamText at most maxIterations times
      expect(mockStreamText).toHaveBeenCalledTimes(2);
    });
  });

  describe('Completion hook continuation', () => {
    it('should continue with append mode and keep auto review input in next iteration', async () => {
      const appendHook: CompletionHook = {
        name: 'append-hook',
        priority: 20,
        shouldRun: () => true,
        run: vi
          .fn()
          .mockResolvedValueOnce({
            action: 'continue',
            continuationMode: 'append',
            nextMessages: [
              {
                id: 'append-msg-1',
                role: 'user',
                content: 'Please fix auto review issues',
                timestamp: new Date(),
              },
            ],
          })
          .mockResolvedValueOnce({ action: 'stop' }),
      };

      completionHookPipeline.register(appendHook);

      const { useTaskStore } = await import('@/stores/task-store');
      const getMessagesMock = vi.fn().mockReturnValue([
        {
          id: 'store-msg-1',
          role: 'user',
          content: 'initial request',
          timestamp: new Date(),
        },
        {
          id: 'store-msg-2',
          role: 'assistant',
          content: 'auto review found issues',
          timestamp: new Date(),
        },
        {
          id: 'store-msg-3',
          role: 'user',
          content: 'Please fix auto review issues',
          timestamp: new Date(),
        },
      ]);
      vi.mocked(useTaskStore.getState).mockReturnValue({
        getMessages: getMessagesMock,
        getTask: vi.fn(() => undefined),
        updateTask: vi.fn(),
        updateTaskUsage: vi.fn(),
      });

      mockStreamText
        .mockReturnValueOnce(
          createLlmEventStream([
            { type: 'text-delta', text: 'first iteration output' },
            { type: 'done', finish_reason: 'stop' },
          ])
        )
        .mockReturnValueOnce(
          createLlmEventStream([
            { type: 'text-delta', text: 'second iteration handles review' },
            { type: 'done', finish_reason: 'stop' },
          ])
        );

      const options = createBasicOptions({ maxIterations: 5 });
      await chatService.runAgentLoop(options, mockCallbacks);

      expect(mockStreamText).toHaveBeenCalledTimes(2);
      expect(getMessagesMock).toHaveBeenCalled();
      expect(mockCallbacks.onComplete).toHaveBeenCalledWith('second iteration handles review');

      const secondCallPayload = mockStreamText.mock.calls[1]?.[0] as {
        messages?: Array<{ role?: string; content?: unknown }>;
      };
      const secondCallMessages = secondCallPayload.messages || [];
      expect(
        secondCallMessages.some(
          (msg) => msg.role === 'user' && msg.content === 'Please fix auto review issues'
        )
      ).toBe(true);
    });

    it('should continue with replace mode using nextMessages only', async () => {
      const replaceHook: CompletionHook = {
        name: 'replace-hook',
        priority: 20,
        shouldRun: () => true,
        run: vi
          .fn()
          .mockResolvedValueOnce({
            action: 'continue',
            continuationMode: 'replace',
            nextMessages: [
              {
                id: 'replace-msg-1',
                role: 'user',
                content: 'fresh context message',
                timestamp: new Date(),
              },
            ],
          })
          .mockResolvedValueOnce({ action: 'stop' }),
      };

      completionHookPipeline.register(replaceHook);

      mockStreamText
        .mockReturnValueOnce(
          createLlmEventStream([
            { type: 'text-delta', text: 'replace first' },
            { type: 'done', finish_reason: 'stop' },
          ])
        )
        .mockReturnValueOnce(
          createLlmEventStream([
            { type: 'text-delta', text: 'replace second' },
            { type: 'done', finish_reason: 'stop' },
          ])
        );

      const options = createBasicOptions({ maxIterations: 5 });
      await chatService.runAgentLoop(options, mockCallbacks);

      expect(mockStreamText).toHaveBeenCalledTimes(2);

      const secondCallPayload = mockStreamText.mock.calls[1]?.[0] as {
        messages?: Array<{ role?: string; content?: unknown }>;
      };
      const secondCallMessages = secondCallPayload.messages || [];

      expect(
        secondCallMessages.some(
          (msg) => msg.role === 'user' && msg.content === 'fresh context message'
        )
      ).toBe(true);
      expect(
        secondCallMessages.some(
          (msg) => msg.role === 'user' && msg.content === 'Hello, please help me'
        )
      ).toBe(false);
    });
  });

  describe('Tool execution', () => {
    it('should execute tools successfully', async () => {
      const mockTool = {
        inputSchema: z.object({}),
        execute: vi.fn().mockResolvedValue({
          success: true,
          content: 'Tool result',
        }),
      };


      mockStreamText
        .mockReturnValueOnce(
          createLlmEventStream([
            {
              type: 'tool-call',
              toolName: 'testTool',
              toolCallId: 'call-1',
              input: { input: 'test' },
            },
            { type: 'done', finish_reason: 'tool-calls' },
          ])
        )
        .mockReturnValueOnce(
          createLlmEventStream([
            { type: 'text-delta', text: 'Tool executed successfully!' },
            { type: 'done', finish_reason: 'stop' },
          ])
        );

      const options = createBasicOptions({
        tools: { testTool: mockTool },
      });

      await chatService.runAgentLoop(options, mockCallbacks);

      expect(mockTool.execute).toHaveBeenCalledWith({ input: 'test' });
    });

    it('should handle tool not found error', async () => {
      mockStreamText
        .mockReturnValueOnce(
          createLlmEventStream([
            {
              type: 'tool-call',
              toolName: 'nonExistentTool',
              toolCallId: 'call-1',
              input: {},
            },
            { type: 'done', finish_reason: 'tool-calls' },
          ])
        )
        .mockReturnValueOnce(
          createLlmEventStream([
            { type: 'text-delta', text: 'I apologize, let me try a different approach.' },
            { type: 'done', finish_reason: 'stop' },
          ])
        );

      const options = createBasicOptions({
        tools: { validTool: { inputSchema: z.object({}), execute: vi.fn() } },
      });

      await chatService.runAgentLoop(options, mockCallbacks);
    });

    it('should handle tool execution errors', async () => {
      const mockTool = {
        inputSchema: z.object({}),
        execute: vi.fn().mockRejectedValue(new Error('Tool execution failed')),
      };

      mockStreamText
        .mockReturnValueOnce(
          createLlmEventStream([
            {
              type: 'tool-call',
              toolName: 'failingTool',
              toolCallId: 'call-1',
              input: {},
            },
            { type: 'done', finish_reason: 'tool-calls' },
          ])
        )
        .mockReturnValueOnce(
          createLlmEventStream([
            { type: 'text-delta', text: 'Let me handle this error.' },
            { type: 'done', finish_reason: 'stop' },
          ])
        );

      const options = createBasicOptions({
        tools: { failingTool: mockTool },
      });

      await chatService.runAgentLoop(options, mockCallbacks);
    });
  });

  describe('Error handling', () => {
    it('should reject with AbortError when aborted before stop hook', async () => {
      const abortController = new AbortController();
      mockStreamText.mockReturnValue(
        createLlmEventStream([{ type: 'done', finish_reason: 'stop' }])
      );

      vi.mocked(hookService.runStop).mockResolvedValue({
        blocked: false,
        continue: true,
        additionalContext: [],
      });

      const options = createBasicOptions();

      const runPromise = chatService.runAgentLoop(options, mockCallbacks, abortController);
      abortController.abort();

      await expect(runPromise).rejects.toThrow('Aborted');

      expect(mockCallbacks.onError).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'AbortError' })
      );
      expect(hookService.runStop).not.toHaveBeenCalled();
    });

    it('should reject with AbortError when aborted before loop iteration', async () => {
      const abortController = new AbortController();
      abortController.abort();

      const options = createBasicOptions();

      await expect(
        chatService.runAgentLoop(options, mockCallbacks, abortController)
      ).rejects.toThrow('Aborted');

      expect(mockCallbacks.onError).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'AbortError' })
      );
    });

    it('should auto-compact on context length exceeded and retry', async () => {
      const overflowError = {
        type: 'error',
        sequence_number: 2,
        error: {
          type: 'invalid_request_error',
          code: 'context_length_exceeded',
          message: 'Your input exceeds the context window of this model.',
          param: 'input',
        },
      };

      const mockFirstStream = [{ type: 'error', error: overflowError }];

      mockStreamText
        .mockReturnValueOnce({
          events: (async function* () {
            for (const delta of mockFirstStream) {
              if (delta.type === 'error' && typeof delta.error === 'object') {
                const payload = delta.error as { error?: { code?: string } };
                if (payload.error?.code) {
                  yield { type: 'error', message: payload.error.code };
                  continue;
                }
              }
              yield delta as { type: string; message?: string };
            }
          })(),
        })
        .mockReturnValueOnce(
          createLlmEventStream([
            { type: 'text-delta', text: 'Recovered after compaction.' },
            { type: 'done', finish_reason: 'stop' },
          ])
        );

      const options = createBasicOptions();

      await chatService.runAgentLoop(options, mockCallbacks);

      expect(mockCallbacks.onChunk).toHaveBeenCalledWith('Recovered after compaction.');
      expect(mockCallbacks.onError).not.toHaveBeenCalled();

      const { ContextCompactor } = await import('../services/context/context-compactor');
      const compactorInstance = vi.mocked(ContextCompactor).mock.instances[0];
      expect(compactorInstance.compactMessages).toHaveBeenCalledTimes(1);
    });

    it('should surface friendly error if auto-compaction fails', async () => {
      const overflowError = {
        type: 'error',
        sequence_number: 2,
        error: {
          type: 'invalid_request_error',
          code: 'context_length_exceeded',
          message: 'Your input exceeds the context window of this model.',
          param: 'input',
        },
      };

      const mockFirstStream = [{ type: 'error', error: overflowError }];

      mockStreamText.mockReturnValue({
        events: (async function* () {
          for (const delta of mockFirstStream) {
            if (delta.type === 'error' && typeof delta.error === 'object') {
              const payload = delta.error as { error?: { code?: string } };
              if (payload.error?.code) {
                yield { type: 'error', message: payload.error.code };
                continue;
              }
            }
            yield delta as { type: string; message?: string };
          }
        })(),
      });

      const { ContextCompactor } = await import('../services/context/context-compactor');
      const compactorInstance = vi.mocked(ContextCompactor).mock.instances[0];
      vi.mocked(compactorInstance.compactMessages).mockResolvedValueOnce({
        compressedSummary: '',
        sections: [],
        preservedMessages: [],
        originalMessageCount: 1,
        compressedMessageCount: 1,
        compressionRatio: 1,
      });

      const options = createBasicOptions();

      await expect(chatService.runAgentLoop(options, mockCallbacks)).rejects.toThrow(
        'Automatic compaction failed; please run /compact or reduce context.'
      );

      expect(mockCallbacks.onError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining(
            'Automatic compaction failed; please run /compact or reduce context.'
          ),
        })
      );
    });

    it('should handle NoSuchToolError gracefully', async () => {
      mockStreamText
        .mockReturnValueOnce(
          createLlmEventStream([
            { type: 'error', message: 'tool_not_found' },
          ])
        )
        .mockReturnValueOnce(
          createLlmEventStream([
            { type: 'text-delta', text: 'Using available tools instead.' },
            { type: 'done', finish_reason: 'stop' },
          ])
        );

      const options = createBasicOptions({
        tools: { validTool: { inputSchema: z.object({}), execute: vi.fn() } },
      });

      await chatService.runAgentLoop(options, mockCallbacks);

      expect(mockCallbacks.onChunk).toHaveBeenCalledWith('Using available tools instead.');
      expect(mockCallbacks.onComplete).toHaveBeenCalled();
    });

    it('should handle InvalidToolInputError gracefully', async () => {
      const mockError = new Error('Invalid input parameters');

      const mockFirstStream = [{ type: 'error', error: mockError }];

      const mockSecondStream = [
        { type: 'text-delta', text: 'Let me correct the parameters.' },
        {
          type: 'step-finish',
          finishReason: 'stop',
          usage: { inputTokens: 15, outputTokens: 8 },
        },
      ];

      mockStreamText
        .mockReturnValueOnce(
          createLlmEventStream([
            { type: 'error', message: 'invalid_tool_input' },
          ])
        )
        .mockReturnValueOnce(
          createLlmEventStream([
            { type: 'text-delta', text: 'Let me correct the parameters.' },
            { type: 'done', finish_reason: 'stop' },
          ])
        );

      const options = createBasicOptions();

      await chatService.runAgentLoop(options, mockCallbacks);

      expect(mockCallbacks.onChunk).toHaveBeenCalledWith('Let me correct the parameters.');
    });

    it('should handle tool call validation failed error gracefully', async () => {
      const mockError = new Error(
        "tool call validation failed: attempted to call tool 'readFile' which was not in request.tools"
      );

      const mockFirstStream = [{ type: 'error', error: mockError }];

      const mockSecondStream = [
        { type: 'text-delta', text: 'I will use the available tools.' },
        {
          type: 'step-finish',
          finishReason: 'stop',
          usage: { inputTokens: 15, outputTokens: 8 },
        },
      ];

      mockStreamText
        .mockReturnValueOnce(
          createLlmEventStream([
            { type: 'error', message: 'tool_call_validation_failed' },
          ])
        )
        .mockReturnValueOnce(
          createLlmEventStream([
            { type: 'text-delta', text: 'I will use the available tools.' },
            { type: 'done', finish_reason: 'stop' },
          ])
        );

      const options = createBasicOptions({
        tools: { validTool: { inputSchema: z.object({}), execute: vi.fn() } },
      });

      await chatService.runAgentLoop(options, mockCallbacks);

      expect(mockCallbacks.onChunk).toHaveBeenCalledWith('I will use the available tools.');
      expect(mockCallbacks.onComplete).toHaveBeenCalled();
    });

    it('should handle consecutive tool errors with guidance', async () => {
      const mockError1 = new Error('tool call validation failed: tool1 not in request.tools');
      const mockError2 = new Error('tool call validation failed: tool2 not in request.tools');
      const mockError3 = new Error('tool call validation failed: tool3 not in request.tools');

      const mockStream1 = [{ type: 'error', error: mockError1 }];

      const mockStream2 = [{ type: 'error', error: mockError2 }];

      const mockStream3 = [{ type: 'error', error: mockError3 }];

      const mockStream4 = [
        {
          type: 'text-delta',
          text: 'I understand now and will proceed correctly.',
        },
        {
          type: 'step-finish',
          finishReason: 'stop',
          usage: { inputTokens: 20, outputTokens: 12 },
        },
      ];

      mockStreamText
        .mockReturnValueOnce(
          createLlmEventStream([{ type: 'error', message: 'tool_call_validation_failed' }])
        )
        .mockReturnValueOnce(
          createLlmEventStream([{ type: 'error', message: 'tool_call_validation_failed' }])
        )
        .mockReturnValueOnce(
          createLlmEventStream([{ type: 'error', message: 'tool_call_validation_failed' }])
        )
        .mockReturnValueOnce(
          createLlmEventStream([
            { type: 'text-delta', text: 'I understand now and will proceed correctly.' },
            { type: 'done', finish_reason: 'stop' },
          ])
        );

      const options = createBasicOptions({
        tools: { validTool: { inputSchema: z.object({}), execute: vi.fn() } },
      });

      await chatService.runAgentLoop(options, mockCallbacks);

      expect(mockCallbacks.onChunk).toHaveBeenCalledWith(
        'I understand now and will proceed correctly.'
      );
    });

    it('should terminate on unknown errors', async () => {
      const mockError = new Error('Unknown stream error');

      const mockFullStream = [{ type: 'error', error: mockError }];

      mockStreamText.mockReturnValue(
        createLlmEventStream([{ type: 'error', message: 'Unknown stream error' }])
      );

      const options = createBasicOptions();

      await expect(chatService.runAgentLoop(options, mockCallbacks)).rejects.toThrow(
        'Unexpected error in agent loop (Error): Unknown stream error'
      );

      expect(mockCallbacks.onError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Unexpected error in agent loop (Error): Unknown stream error',
        })
      );
    });

    it('should call onError callback exactly once for stream errors after retries are exhausted', async () => {
      mockStreamText.mockImplementation(() =>
        createLlmEventStream([{ type: 'error', message: 'TimeoutError', name: 'TimeoutError' }])
      );

      const options = createBasicOptions();

      await expect(chatService.runAgentLoop(options, mockCallbacks)).rejects.toThrow(
        /after 3 retries/i
      );

      // Verify onError is called exactly once (not duplicated)
      expect(mockCallbacks.onError).toHaveBeenCalledTimes(1);
      expect(mockCallbacks.onError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('after 3 retries'),
        })
      );
    });

    it('should handle model unavailable error', async () => {
      // Make provider store throw error for unavailable model
      const { useProviderStore } = await import('@/providers/stores/provider-store');
      vi.mocked(useProviderStore.getState).mockReturnValueOnce({
        getProviderModel: vi.fn(() => ({
          provider: 'test-provider',
          config: { id: 'test-provider' },
        })),
        isModelAvailable: vi.fn(() => false),
        availableModels: [],
        apiKeys: {},
        providers: new Map(),
        customProviders: {},
      });

      const options = createBasicOptions({ model: 'unavailable-model' });

      await expect(chatService.runAgentLoop(options, mockCallbacks)).rejects.toThrow(
        'No available provider for model: unavailable-model'
      );
    });
  });

  describe('Edge cases', () => {
    it('should surface stop hook reason in loop messages', async () => {
      mockStreamText.mockReturnValue(
        createLlmEventStream([{ type: 'done', finish_reason: 'stop' }])
      );

      vi.mocked(hookService.runStop).mockImplementation(async () => {
        await Promise.resolve();
        return {
          blocked: true,
          blockReason: 'Stop hook blocked',
          continue: false,
          additionalContext: [],
        };
      });

      const options = createBasicOptions({
        tools: {},
      });

      const localService = new LLMService('test-task-id');

      await localService.runAgentLoop(options, mockCallbacks);

      expect(messageService.addUserMessage).toHaveBeenCalledWith(
        'test-task-id',
        'Stop hook blocked'
      );
      expect(hookStateService.setStopHookActive).toHaveBeenCalledWith(true);
    });

    it('should handle empty tool set', async () => {
      mockStreamText.mockReturnValue(
        createLlmEventStream([
          { type: 'text-delta', text: 'No tools available, responding directly.' },
          { type: 'done', finish_reason: 'stop' },
        ])
      );

      const options = createBasicOptions({
        tools: {},
      });

      await chatService.runAgentLoop(options, mockCallbacks);

      expect(mockCallbacks.onComplete).toHaveBeenCalledWith(
        'No tools available, responding directly.'
      );
    });

    it('should handle empty response content', async () => {
      mockStreamText.mockReturnValue(
        createLlmEventStream([{ type: 'done', finish_reason: 'stop' }])
      );

      const options = createBasicOptions();

      await chatService.runAgentLoop(options, mockCallbacks);

      expect(mockCallbacks.onComplete).toHaveBeenCalledWith('');
    });

    it('should handle pricing service error gracefully', async () => {
      const { aiPricingService } = await import('../services/ai/ai-pricing-service');
      vi.mocked(aiPricingService.calculateCost).mockRejectedValue(new Error('Pricing error'));

      mockStreamText.mockReturnValue(
        createLlmEventStream([
          { type: 'text-delta', text: 'Test response' },
          { type: 'done', finish_reason: 'stop' },
        ])
      );

      const options = createBasicOptions();

      // Should not throw despite pricing error
      await expect(chatService.runAgentLoop(options, mockCallbacks)).resolves.not.toThrow();

      expect(mockCallbacks.onComplete).toHaveBeenCalledWith('Test response');
    });

    it('should handle task usage update error gracefully', async () => {
      const { taskService } = await import('../services/task-service');
      vi.mocked(taskService.updateTaskUsage).mockRejectedValue(
        new Error('Database error')
      );

      mockStreamText.mockReturnValue(
        createLlmEventStream([
          { type: 'text-delta', text: 'Test response' },
          { type: 'done', finish_reason: 'stop' },
        ])
      );

      const options = createBasicOptions();

      // Should not throw despite database error
      await expect(chatService.runAgentLoop(options, mockCallbacks)).resolves.not.toThrow();

      expect(mockCallbacks.onComplete).toHaveBeenCalledWith('Test response');
    });
  });
});
