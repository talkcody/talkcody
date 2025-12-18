// src/test/chat-service.runManualAgentLoop.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { LLMService } from '../services/agents/llm-service';
import type { AgentLoopOptions, UIMessage } from '../types/agent';

// Mock additional dependencies
vi.mock('../services/model-service', () => ({
  modelService: {
    isModelAvailableSync: vi.fn().mockReturnValue(true),
    getBestProviderForModelSync: vi.fn().mockReturnValue('test-provider'),
  },
}));

vi.mock('../services/ai-provider-service', () => ({
  aiProviderService: {
    getProviderModel: vi.fn().mockReturnValue({
      provider: {
        apiKey: 'test-key',
        baseUrl: 'https://test.example.com',
      },
      model: {
        key: 'test-model',
        name: 'Test Model',
      },
    }),
  },
}));

// Mock provider store
const mockProviderStore = {
  getProviderModel: vi.fn(() => ({
    languageModel: {
      provider: 'test',
      modelId: 'test-model',
    },
    modelConfig: {
      name: 'Test Model',
      context_length: 128000,
    },
    providerId: 'test-provider',
    modelKey: 'test-model',
  })),
  isModelAvailable: vi.fn(() => true),
  availableModels: [],
  apiKeys: {},
  providers: new Map(),
  customProviders: {},
};

vi.mock('../stores/provider-store', () => ({
  useProviderStore: {
    getState: vi.fn(() => mockProviderStore),
  },
}));

vi.mock('../stores/settings-store', () => ({
  settingsManager: {
    getCurrentRootPath: vi.fn().mockReturnValue('/test/path'),
    getCurrentTaskId: vi.fn().mockReturnValue('test-task-id'),
    getSync: vi.fn().mockReturnValue(undefined),
    getBatchSync: vi.fn().mockReturnValue({}),
  },
  useSettingsStore: {
    getState: vi.fn(() => ({
      language: 'en',
    })),
  },
}));

vi.mock('../services/workspace-root-service', () => ({
  getValidatedWorkspaceRoot: vi.fn().mockResolvedValue('/test/path'),
  getEffectiveWorkspaceRoot: vi.fn().mockResolvedValue('/test/path'),
}));

vi.mock('../services/ai-pricing-service', () => ({
  aiPricingService: {
    calculateCost: vi.fn().mockResolvedValue(0.001),
  },
}));

vi.mock('../services/task-manager', () => ({
  TaskManager: {
    updateTaskUsage: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../lib/llm-utils', () => ({
  convertMessages: vi.fn().mockImplementation((messages) => Promise.resolve(messages || [])),
  formatReasoningText: vi
    .fn()
    .mockImplementation((text, isFirst) => (isFirst ? `\n<thinking>\n${text}` : text)),
}));

vi.mock('ai', () => ({
  streamText: vi.fn(),
  stepCountIs: vi.fn((count) => ({ type: 'step-count', count })),
  smoothStream: vi.fn(() => undefined),
  NoSuchToolError: {
    isInstance: vi.fn().mockReturnValue(false),
  },
  InvalidToolInputError: {
    isInstance: vi.fn().mockReturnValue(false),
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

    // Re-establish mocks after clearing
    const { modelService } = await import('../services/model-service');
    vi.mocked(modelService.isModelAvailableSync).mockReturnValue(true);
    vi.mocked(modelService.getBestProviderForModelSync).mockReturnValue('test-provider');

    const { aiProviderService } = await import('../services/ai-provider-service');
    vi.mocked(aiProviderService.getProviderModel).mockReturnValue({
      provider: {
        apiKey: 'test-key',
        baseUrl: 'https://test.example.com',
      },
      model: {
        key: 'test-model',
        name: 'Test Model',
      },
    });

    const { convertMessages, formatReasoningText } = await import('../lib/llm-utils');
    vi.mocked(convertMessages).mockImplementation((messages) => Promise.resolve(messages || []));
    vi.mocked(formatReasoningText).mockImplementation((text, isFirst) =>
      isFirst ? `\n<thinking>\n${text}` : text
    );

    const aiModule = await import('ai');
    mockStreamText = vi.mocked(aiModule.streamText);

    chatService = new LLMService();
    mockCallbacks = {
      onChunk: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn(),
      onStatus: vi.fn(),
    };
  });

  afterEach(() => {
    vi.resetAllMocks();
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
      // Mock successful text stream
      const mockFullStream = [
        { type: 'text-start' },
        { type: 'text-delta', text: 'Hello!' },
        { type: 'text-delta', text: ' How can I help?' },
        {
          type: 'step-finish',
          finishReason: 'stop',
          usage: { inputTokens: 10, outputTokens: 5 },
        },
      ];

      mockStreamText.mockReturnValue({
        fullStream: (async function* () {
          for (const delta of mockFullStream) {
            yield delta;
          }
        })(),
        finishReason: Promise.resolve('stop'),
      });

      const options = createBasicOptions();

      await chatService.runAgentLoop(options, mockCallbacks);

      expect(mockCallbacks.onChunk).toHaveBeenCalledWith('Hello!');
      expect(mockCallbacks.onChunk).toHaveBeenCalledWith(' How can I help?');
      expect(mockCallbacks.onComplete).toHaveBeenCalledWith('Hello! How can I help?');
      expect(mockCallbacks.onStatus).toHaveBeenCalledWith('Answering');
    });

    it('should handle reasoning output when isThink is true', async () => {
      const mockFullStream = [
        { type: 'reasoning-delta', text: 'Let me think about this...' },
        { type: 'text-start' },
        {
          type: 'text-delta',
          text: 'Based on my reasoning, here is the answer.',
        },
        {
          type: 'step-finish',
          finishReason: 'stop',
          usage: { inputTokens: 15, outputTokens: 8, reasoningTokens: 12 },
        },
      ];

      mockStreamText.mockReturnValue({
        fullStream: (async function* () {
          for (const delta of mockFullStream) {
            yield delta;
          }
        })(),
        finishReason: Promise.resolve('stop'),
      });

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
      const mockFullStream = [
        { type: 'reasoning-delta', text: 'This should be suppressed' },
        { type: 'text-delta', text: 'Visible text' },
        {
          type: 'step-finish',
          finishReason: 'stop',
          usage: { inputTokens: 10, outputTokens: 5 },
        },
      ];

      mockStreamText.mockReturnValue({
        fullStream: (async function* () {
          for (const delta of mockFullStream) {
            yield delta;
          }
        })(),
        finishReason: Promise.resolve('stop'),
      });

      const options = createBasicOptions({ suppressReasoning: true });

      await chatService.runAgentLoop(options, mockCallbacks);

      expect(mockCallbacks.onChunk).not.toHaveBeenCalledWith('This should be suppressed');
      expect(mockCallbacks.onChunk).toHaveBeenCalledWith('Visible text');
    });

    it('should respect maxIterations limit', async () => {
      // Mock stream that would normally continue indefinitely
      const mockFullStream = [
        {
          type: 'tool-call',
          toolName: 'nonExistentTool',
          toolCallId: 'call-1',
          args: {},
        },
      ];

      mockStreamText.mockReturnValue({
        fullStream: (async function* () {
          for (const delta of mockFullStream) {
            yield delta;
          }
        })(),
        finishReason: Promise.resolve('tool-calls'),
      });

      const options = createBasicOptions({
        maxIterations: 2,
        tools: {},
      });

      await chatService.runAgentLoop(options, mockCallbacks);

      // Should have called streamText at most maxIterations times
      expect(mockStreamText).toHaveBeenCalledTimes(2);
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

      const mockFullStream = [
        {
          type: 'tool-call',
          toolName: 'testTool',
          toolCallId: 'call-1',
          input: { input: 'test' },
        },
      ];

      // Second iteration after tool execution
      const mockSecondStream = [
        { type: 'text-delta', text: 'Tool executed successfully!' },
        {
          type: 'step-finish',
          finishReason: 'stop',
          usage: { inputTokens: 15, outputTokens: 8 },
        },
      ];

      mockStreamText
        .mockReturnValueOnce({
          fullStream: (async function* () {
            for (const delta of mockFullStream) {
              yield delta;
            }
          })(),
          finishReason: Promise.resolve('tool-calls'),
        })
        .mockReturnValueOnce({
          fullStream: (async function* () {
            for (const delta of mockSecondStream) {
              yield delta;
            }
          })(),
          finishReason: Promise.resolve('stop'),
        });

      const options = createBasicOptions({
        tools: { testTool: mockTool },
      });

      await chatService.runAgentLoop(options, mockCallbacks);

      expect(mockTool.execute).toHaveBeenCalledWith({ input: 'test' });
    });

    it('should handle tool not found error', async () => {
      const mockFullStream = [
        {
          type: 'tool-call',
          toolName: 'nonExistentTool',
          toolCallId: 'call-1',
          args: {},
        },
      ];

      // Second iteration should continue after tool error
      const mockSecondStream = [
        {
          type: 'text-delta',
          text: 'I apologize, let me try a different approach.',
        },
        {
          type: 'step-finish',
          finishReason: 'stop',
          usage: { inputTokens: 15, outputTokens: 10 },
        },
      ];

      mockStreamText
        .mockReturnValueOnce({
          fullStream: (async function* () {
            for (const delta of mockFullStream) {
              yield delta;
            }
          })(),
          finishReason: Promise.resolve('tool-calls'),
        })
        .mockReturnValueOnce({
          fullStream: (async function* () {
            for (const delta of mockSecondStream) {
              yield delta;
            }
          })(),
          finishReason: Promise.resolve('stop'),
        });

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

      const mockFullStream = [
        {
          type: 'tool-call',
          toolName: 'failingTool',
          toolCallId: 'call-1',
          args: {},
        },
      ];

      const mockSecondStream = [
        { type: 'text-delta', text: 'Let me handle this error.' },
        {
          type: 'step-finish',
          finishReason: 'stop',
          usage: { inputTokens: 15, outputTokens: 8 },
        },
      ];

      mockStreamText
        .mockReturnValueOnce({
          fullStream: (async function* () {
            for (const delta of mockFullStream) {
              yield delta;
            }
          })(),
          finishReason: Promise.resolve('tool-calls'),
        })
        .mockReturnValueOnce({
          fullStream: (async function* () {
            for (const delta of mockSecondStream) {
              yield delta;
            }
          })(),
          finishReason: Promise.resolve('stop'),
        });

      const options = createBasicOptions({
        tools: { failingTool: mockTool },
      });

      await chatService.runAgentLoop(options, mockCallbacks);
    });
  });

  describe('Error handling', () => {
    it('should handle NoSuchToolError gracefully', async () => {
      const { NoSuchToolError } = await import('ai');
      const mockError = new Error('Tool not found');
      vi.mocked(NoSuchToolError.isInstance).mockReturnValue(true);

      // First stream with error
      const mockFirstStream = [{ type: 'error', error: mockError }];

      // Second stream with recovery response
      const mockSecondStream = [
        { type: 'text-delta', text: 'Using available tools instead.' },
        {
          type: 'step-finish',
          finishReason: 'stop',
          usage: { inputTokens: 15, outputTokens: 8 },
        },
      ];

      mockStreamText
        .mockReturnValueOnce({
          fullStream: (async function* () {
            for (const delta of mockFirstStream) {
              yield delta;
            }
          })(),
          finishReason: Promise.resolve('error'),
        })
        .mockReturnValueOnce({
          fullStream: (async function* () {
            for (const delta of mockSecondStream) {
              yield delta;
            }
          })(),
          finishReason: Promise.resolve('stop'),
        });

      const options = createBasicOptions({
        tools: { validTool: { inputSchema: z.object({}), execute: vi.fn() } },
      });

      await chatService.runAgentLoop(options, mockCallbacks);

      expect(mockCallbacks.onChunk).toHaveBeenCalledWith('Using available tools instead.');
      expect(mockCallbacks.onComplete).toHaveBeenCalled();
    });

    it('should handle InvalidToolInputError gracefully', async () => {
      const { InvalidToolInputError } = await import('ai');
      const mockError = new Error('Invalid input parameters');
      vi.mocked(InvalidToolInputError.isInstance).mockReturnValue(true);

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
        .mockReturnValueOnce({
          fullStream: (async function* () {
            for (const delta of mockFirstStream) {
              yield delta;
            }
          })(),
          finishReason: Promise.resolve('error'),
        })
        .mockReturnValueOnce({
          fullStream: (async function* () {
            for (const delta of mockSecondStream) {
              yield delta;
            }
          })(),
          finishReason: Promise.resolve('stop'),
        });

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
        .mockReturnValueOnce({
          fullStream: (async function* () {
            for (const delta of mockFirstStream) {
              yield delta;
            }
          })(),
          finishReason: Promise.resolve('error'),
        })
        .mockReturnValueOnce({
          fullStream: (async function* () {
            for (const delta of mockSecondStream) {
              yield delta;
            }
          })(),
          finishReason: Promise.resolve('stop'),
        });

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
        .mockReturnValueOnce({
          fullStream: (async function* () {
            for (const delta of mockStream1) {
              yield delta;
            }
          })(),
          finishReason: Promise.resolve('error'),
        })
        .mockReturnValueOnce({
          fullStream: (async function* () {
            for (const delta of mockStream2) {
              yield delta;
            }
          })(),
          finishReason: Promise.resolve('error'),
        })
        .mockReturnValueOnce({
          fullStream: (async function* () {
            for (const delta of mockStream3) {
              yield delta;
            }
          })(),
          finishReason: Promise.resolve('error'),
        })
        .mockReturnValueOnce({
          fullStream: (async function* () {
            for (const delta of mockStream4) {
              yield delta;
            }
          })(),
          finishReason: Promise.resolve('stop'),
        });

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

      mockStreamText.mockReturnValue({
        fullStream: (async function* () {
          for (const delta of mockFullStream) {
            yield delta;
          }
        })(),
        finishReason: Promise.resolve('error'),
      });

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

    it('should call onError callback exactly once for stream errors', async () => {
      const mockError = new Error('TimeoutError');
      Object.defineProperty(mockError, 'name', { value: 'TimeoutError' });

      const mockFullStream = [{ type: 'error', error: mockError }];

      mockStreamText.mockReturnValue({
        fullStream: (async function* () {
          for (const delta of mockFullStream) {
            yield delta;
          }
        })(),
        finishReason: Promise.resolve('error'),
      });

      const options = createBasicOptions();

      await expect(chatService.runAgentLoop(options, mockCallbacks)).rejects.toThrow();

      // Verify onError is called exactly once (not duplicated)
      expect(mockCallbacks.onError).toHaveBeenCalledTimes(1);
      expect(mockCallbacks.onError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Unexpected error in agent loop (TimeoutError)'),
        })
      );
    });

    it('should handle model unavailable error', async () => {
      // Make provider store throw error for unavailable model
      const { useProviderStore } = await import('../stores/provider-store');
      vi.mocked(useProviderStore.getState).mockReturnValueOnce({
        ...mockProviderStore,
        getProviderModel: vi.fn(() => {
          throw new Error('No available provider for model: unavailable-model');
        }),
      });

      const options = createBasicOptions({ model: 'unavailable-model' });

      await expect(chatService.runAgentLoop(options, mockCallbacks)).rejects.toThrow(
        'No available provider for model: unavailable-model'
      );
    });
  });

  describe('Edge cases', () => {
    it('should handle empty tool set', async () => {
      const mockFullStream = [
        {
          type: 'text-delta',
          text: 'No tools available, responding directly.',
        },
        {
          type: 'step-finish',
          finishReason: 'stop',
          usage: { inputTokens: 10, outputTokens: 8 },
        },
      ];

      mockStreamText.mockReturnValue({
        fullStream: (async function* () {
          for (const delta of mockFullStream) {
            yield delta;
          }
        })(),
        finishReason: Promise.resolve('stop'),
      });

      const options = createBasicOptions({
        tools: {},
      });

      await chatService.runAgentLoop(options, mockCallbacks);

      expect(mockCallbacks.onComplete).toHaveBeenCalledWith(
        'No tools available, responding directly.'
      );
    });

    it('should handle empty response content', async () => {
      const mockFullStream = [
        {
          type: 'step-finish',
          finishReason: 'stop',
          usage: { inputTokens: 10, outputTokens: 0 },
        },
      ];

      mockStreamText.mockReturnValue({
        fullStream: (async function* () {
          for (const delta of mockFullStream) {
            yield delta;
          }
        })(),
        finishReason: Promise.resolve('stop'),
      });

      const options = createBasicOptions();

      await chatService.runAgentLoop(options, mockCallbacks);

      expect(mockCallbacks.onComplete).toHaveBeenCalledWith('');
    });

    it('should handle pricing service error gracefully', async () => {
      const { aiPricingService } = await import('../services/ai-pricing-service');
      vi.mocked(aiPricingService.calculateCost).mockRejectedValue(new Error('Pricing error'));

      const mockFullStream = [
        { type: 'text-delta', text: 'Test response' },
        {
          type: 'step-finish',
          finishReason: 'stop',
          usage: { inputTokens: 10, outputTokens: 5 },
        },
      ];

      mockStreamText.mockReturnValue({
        fullStream: (async function* () {
          for (const delta of mockFullStream) {
            yield delta;
          }
        })(),
        finishReason: Promise.resolve('stop'),
      });

      const options = createBasicOptions();

      // Should not throw despite pricing error
      await expect(chatService.runAgentLoop(options, mockCallbacks)).resolves.not.toThrow();

      expect(mockCallbacks.onComplete).toHaveBeenCalledWith('Test response');
    });

    it('should handle task usage update error gracefully', async () => {
      const { TaskManager } = await import('../services/task-manager');
      vi.mocked(TaskManager.updateTaskUsage).mockRejectedValue(
        new Error('Database error')
      );

      const mockFullStream = [
        { type: 'text-delta', text: 'Test response' },
        {
          type: 'step-finish',
          finishReason: 'stop',
          usage: { inputTokens: 10, outputTokens: 5 },
        },
      ];

      mockStreamText.mockReturnValue({
        fullStream: (async function* () {
          for (const delta of mockFullStream) {
            yield delta;
          }
        })(),
        finishReason: Promise.resolve('stop'),
      });

      const options = createBasicOptions();

      // Should not throw despite database error
      await expect(chatService.runAgentLoop(options, mockCallbacks)).resolves.not.toThrow();

      expect(mockCallbacks.onComplete).toHaveBeenCalledWith('Test response');
    });
  });
});
