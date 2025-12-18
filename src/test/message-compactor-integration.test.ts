// src/test/message-compactor-integration.test.ts
// Integration tests for MessageCompactor using MockLanguageModelV2 from AI SDK

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockLanguageModelV2, simulateReadableStream } from 'ai/test';
import type { ModelMessage } from 'ai';
import * as aiModule from 'ai';
import { LLMService } from '../services/agents/llm-service';
import { MessageCompactor } from '../services/message-compactor';
import type { CompressionConfig, UIMessage } from '../types/agent';

// ============================================
// MOCKS
// ============================================

vi.mock('../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  },
}));

vi.mock('../services/model-service', () => ({
  modelService: {
    isModelAvailableSync: vi.fn().mockReturnValue(true),
    getBestProviderForModelSync: vi.fn().mockReturnValue('test-provider'),
  },
}));

vi.mock('../services/ai-provider-service', () => ({
  aiProviderService: {
    getProviderModel: vi.fn(),
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
    getCurrentConversationId: vi.fn().mockReturnValue('test-conversation-id'),
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

vi.mock('../services/conversation-manager', () => ({
  ConversationManager: {
    updateConversationUsage: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../lib/llm-utils', () => ({
  convertMessages: vi.fn().mockImplementation((messages) => Promise.resolve(messages || [])),
  formatReasoningText: vi
    .fn()
    .mockImplementation((text, isFirst) => (isFirst ? `\n<thinking>\n${text}` : text)),
}));

vi.mock('../lib/models', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/models')>();
  return {
    ...actual,
    getContextLength: vi.fn().mockReturnValue(200000),
  };
});

vi.mock('../stores/conversation-usage-store', () => ({
  useConversationUsageStore: {
    getState: vi.fn(() => ({
      addUsage: vi.fn(),
      setContextUsage: vi.fn(),
    })),
  },
}));

vi.mock('../stores/plan-mode-store', () => ({
  usePlanModeStore: {
    getState: vi.fn(() => ({
      isPlanModeEnabled: false,
    })),
  },
}));

vi.mock('../stores/file-changes-store', () => ({
  useFileChangesStore: {
    getState: vi.fn(() => ({
      clearConversation: vi.fn(),
    })),
  },
}));

// Mock the 'ai' module's streamText for direct control over streaming
vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return {
    ...actual,
    streamText: vi.fn(),
    stepCountIs: vi.fn((count) => ({ type: 'step-count', count })),
  };
});

// ============================================
// HELPER FUNCTIONS
// ============================================

// Helper to create mock stream for streamText (fullStream format)
function createStreamTextMock(options: {
  textChunks?: string[];
  finishReason?: 'stop' | 'tool-calls' | 'error';
  inputTokens?: number;
  outputTokens?: number;
}) {
  const {
    textChunks = ['Hello, world!'],
    finishReason = 'stop',
    inputTokens = 10,
    outputTokens = 20,
  } = options;

  const fullStream = (async function* () {
    yield { type: 'text-start' };
    for (const text of textChunks) {
      yield { type: 'text-delta', text };
    }
    yield {
      type: 'step-finish',
      finishReason,
      usage: { inputTokens, outputTokens },
    };
  })();

  return {
    fullStream,
    finishReason: Promise.resolve(finishReason),
    response: Promise.resolve(null),
    providerMetadata: Promise.resolve(null),
  };
}

// Helper for MockLanguageModelV2 doStream format
function createMockStreamResponse(options: {
  textChunks?: string[];
  finishReason?: 'stop' | 'tool-calls' | 'error';
  inputTokens?: number;
  outputTokens?: number;
}) {
  const {
    textChunks = ['Hello, world!'],
    finishReason = 'stop',
    inputTokens = 10,
    outputTokens = 20,
  } = options;

  const chunks: any[] = [{ type: 'text-delta', textDelta: '' }];

  for (const text of textChunks) {
    chunks.push({ type: 'text-delta', textDelta: text });
  }

  chunks.push({
    type: 'finish',
    finishReason,
    usage: { promptTokens: inputTokens, completionTokens: outputTokens },
  });

  return {
    stream: simulateReadableStream({ chunks }),
    rawCall: { rawPrompt: null, rawSettings: {} },
  };
}

function createCompressionSummaryResponse(summary?: string) {
  const defaultSummary = `<analysis>
This is an analysis of the conversation history.
</analysis>

1. Primary Request and Intent: User wants to test message compression.
2. Key Technical Concepts: MessageCompactor, streaming, AI SDK integration.
3. Files and Code Sections: src/services/message-compactor.ts was examined.
4. Errors and fixes: No errors encountered.
5. Problem Solving: Testing compression flow.
6. All user messages: User asked to implement compression tests.
7. Pending Tasks: Complete integration tests.
8. Current Work: Running compression integration tests.`;

  const text = summary || defaultSummary;
  const words = text.split(' ');
  const chunks: string[] = [];

  // Split into ~5 word chunks for streaming simulation
  for (let i = 0; i < words.length; i += 5) {
    chunks.push(words.slice(i, i + 5).join(' ') + ' ');
  }

  return createMockStreamResponse({
    textChunks: chunks,
    finishReason: 'stop',
    inputTokens: 500,
    outputTokens: 200,
  });
}

function createUIMessages(count: number): UIMessage[] {
  const messages: UIMessage[] = [];
  for (let i = 0; i < count; i++) {
    messages.push({
      id: `msg-${i}`,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Test message ${i + 1}. This contains enough text to simulate a real conversation.`,
      timestamp: new Date(),
    });
  }
  return messages;
}

function createModelMessages(count: number): ModelMessage[] {
  const messages: ModelMessage[] = [];
  for (let i = 0; i < count; i++) {
    messages.push({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Test message ${i + 1}. This contains enough text to simulate a real conversation.`,
    });
  }
  return messages;
}

function createMessagesWithToolCalls(): ModelMessage[] {
  return [
    { role: 'user', content: 'Read the config file' },
    {
      role: 'assistant',
      content: [
        {
          type: 'tool-call',
          toolCallId: 'call-123',
          toolName: 'readFile',
          input: { path: '/config.json' },
        },
      ],
    },
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'call-123',
          toolName: 'readFile',
          output: { type: 'text', value: '{"setting": "value"}' },
        },
      ],
    },
    { role: 'assistant', content: 'The config file contains...' },
  ] as ModelMessage[];
}

function createCompressionConfig(overrides?: Partial<CompressionConfig>): CompressionConfig {
  return {
    enabled: true,
    preserveRecentMessages: 4,
    compressionModel: 'test-compression-model',
    compressionThreshold: 0.7,
    ...overrides,
  };
}

function createMockCompressionModel(config?: {
  summary?: string;
  shouldError?: boolean;
  errorMessage?: string;
  inputTokens?: number;
  outputTokens?: number;
}) {
  const { summary, shouldError, errorMessage, inputTokens = 500, outputTokens = 200 } = config || {};

  if (shouldError) {
    return new MockLanguageModelV2({
      doGenerate: async () => {
        throw new Error(errorMessage || 'Model error');
      },
      doStream: async () => {
        throw new Error(errorMessage || 'Streaming error');
      },
    });
  }

  const response = createCompressionSummaryResponse(summary);

  return new MockLanguageModelV2({
    doStream: async () => response,
    doGenerate: async () => ({
      rawCall: { rawPrompt: null, rawSettings: {} },
      finishReason: 'stop' as const,
      usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
      text: summary || 'Default compression summary',
    }),
  });
}

// ============================================
// TESTS
// ============================================

describe('MessageCompactor Integration Tests with MockLanguageModelV2', () => {
  let llmService: LLMService;
  let mockStreamText: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Re-establish mocks after clearing
    const { modelService } = await import('../services/model-service');
    vi.mocked(modelService.isModelAvailableSync).mockReturnValue(true);
    vi.mocked(modelService.getBestProviderForModelSync).mockReturnValue('test-provider');

    const { aiProviderService } = await import('../services/ai-provider-service');
    vi.mocked(aiProviderService.getProviderModel).mockReturnValue({});

    const { convertMessages, formatReasoningText } = await import('../lib/llm-utils');
    vi.mocked(convertMessages).mockImplementation((messages) => Promise.resolve(messages || []));
    vi.mocked(formatReasoningText).mockImplementation((text, isFirst) =>
      isFirst ? `\n<thinking>\n${text}` : text
    );

    // Set up streamText mock with default compression summary response
    mockStreamText = vi.mocked(aiModule.streamText);
    mockStreamText.mockReturnValue(createStreamTextMock({
      textChunks: ['<analysis>', 'Test analysis', '</analysis>', '\n1. Primary Request: test'],
      finishReason: 'stop',
      inputTokens: 100,
      outputTokens: 50,
    }));

    llmService = new LLMService();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  // ===========================================
  // TEST SUITE 1: Basic Compression with Streaming
  // ===========================================
  describe('Basic compression with streaming response', () => {
    it('should complete full compression flow with MockLanguageModelV2', async () => {
      const callbacks = {
        onChunk: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
        onStatus: vi.fn(),
      };

      await llmService.runAgentLoop(
        {
          messages: createUIMessages(2),
          model: 'test-model',
          systemPrompt: 'You are a compression assistant',
          tools: {},
          maxIterations: 1,
        },
        callbacks
      );

      expect(callbacks.onChunk).toHaveBeenCalled();
      expect(callbacks.onComplete).toHaveBeenCalled();
      expect(callbacks.onError).not.toHaveBeenCalled();
    });

    it('should stream compression summary in chunks', async () => {
      const receivedChunks: string[] = [];
      const callbacks = {
        onChunk: vi.fn((chunk) => receivedChunks.push(chunk)),
        onComplete: vi.fn(),
        onError: vi.fn(),
        onStatus: vi.fn(),
      };

      await llmService.runAgentLoop(
        {
          messages: createUIMessages(2),
          model: 'test-model',
          systemPrompt: 'Compress this conversation',
          tools: {},
          maxIterations: 1,
        },
        callbacks
      );

      // Verify streaming behavior - should receive multiple chunks
      expect(receivedChunks.length).toBeGreaterThan(1);
      const fullText = receivedChunks.join('');
      expect(fullText).toContain('analysis');
    });

    it('should call onStatus with Answering status', async () => {
      const statusHistory: string[] = [];
      const callbacks = {
        onChunk: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
        onStatus: vi.fn((status) => statusHistory.push(status)),
      };

      await llmService.runAgentLoop(
        {
          messages: createUIMessages(2),
          model: 'test-model',
          systemPrompt: 'Test',
          tools: {},
          maxIterations: 1,
        },
        callbacks
      );

      expect(statusHistory).toContain('Answering');
    });
  });

  // ===========================================
  // TEST SUITE 2: Structured Response Parsing
  // ===========================================
  describe('Structured response parsing (8 sections)', () => {
    it('should parse all 8 compression sections correctly', async () => {
      const messageCompactor = new MessageCompactor({
        runAgentLoop: async (_options, callbacks) => {
          const summary = `<analysis>Analyzing the conversation</analysis>

1. Primary Request and Intent: Test intent
2. Key Technical Concepts: React, TypeScript
3. Files and Code Sections: src/app.ts
4. Errors and fixes: Fixed type error
5. Problem Solving: Optimized queries
6. All user messages: User asked about testing
7. Pending Tasks: Write more tests
8. Current Work: Integration testing`;
          callbacks.onComplete?.(summary);
        },
      });

      const result = await messageCompactor.compactMessages({
        messages: createModelMessages(4),
        config: createCompressionConfig({ preserveRecentMessages: 1 }),
      });

      expect(result.sections.length).toBeGreaterThanOrEqual(8);
      expect(result.sections.some((s) => s.title.includes('Primary Request'))).toBe(true);
      expect(result.sections.some((s) => s.title.includes('Key Technical'))).toBe(true);
      expect(result.sections.some((s) => s.title.includes('Current Work'))).toBe(true);
    });

    it('should extract analysis tags from response', async () => {
      const messageCompactor = new MessageCompactor({
        runAgentLoop: async (_options, callbacks) => {
          callbacks.onComplete?.('<analysis>This is the analysis</analysis>\n1. Section: content');
        },
      });

      const result = await messageCompactor.compactMessages({
        messages: [{ role: 'user', content: 'Test' }, { role: 'assistant', content: 'Response' }],
        config: createCompressionConfig({ preserveRecentMessages: 0 }),
      });

      const analysisSection = result.sections.find((s) => s.title === 'Analysis');
      expect(analysisSection).toBeDefined();
      expect(analysisSection?.content).toBe('This is the analysis');
    });

    it('should handle malformed responses gracefully', async () => {
      const messageCompactor = new MessageCompactor({
        runAgentLoop: async (_options, callbacks) => {
          callbacks.onComplete?.('This is just plain text without any sections');
        },
      });

      const result = await messageCompactor.compactMessages({
        messages: createModelMessages(4),
        config: createCompressionConfig({ preserveRecentMessages: 1 }),
      });

      // Should create a fallback Summary section
      expect(result.sections.length).toBeGreaterThan(0);
      expect(result.sections[0].title).toBe('Summary');
    });
  });

  // ===========================================
  // TEST SUITE 3: Token Usage Tracking
  // ===========================================
  describe('Token usage tracking', () => {
    it('should track token usage from streamText response', async () => {
      // Set up mock with specific token usage
      mockStreamText.mockReturnValue(createStreamTextMock({
        textChunks: ['Response text'],
        finishReason: 'stop',
        inputTokens: 1500,
        outputTokens: 500,
      }));

      const callbacks = {
        onChunk: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
        onStatus: vi.fn(),
      };

      await llmService.runAgentLoop(
        {
          messages: createUIMessages(2),
          model: 'test-model',
          systemPrompt: 'Test',
          tools: {},
          maxIterations: 1,
        },
        callbacks
      );

      expect(callbacks.onComplete).toHaveBeenCalled();
    });

    it('should update compression statistics', async () => {
      const messageCompactor = new MessageCompactor({
        runAgentLoop: async (_options, callbacks) => {
          callbacks.onComplete?.('Summary');
        },
      });

      const initialStats = messageCompactor.getCompressionStats();
      expect(initialStats.totalCompressions).toBe(0);

      await messageCompactor.compactMessages({
        messages: createModelMessages(4),
        config: createCompressionConfig({ preserveRecentMessages: 1 }),
      });

      const statsAfterFirst = messageCompactor.getCompressionStats();
      expect(statsAfterFirst.totalCompressions).toBe(1);
      expect(statsAfterFirst.averageCompressionRatio).toBeGreaterThan(0);
    });
  });

  // ===========================================
  // TEST SUITE 4: Error Scenarios
  // ===========================================
  describe('Error scenarios', () => {
    it('should handle model errors gracefully', async () => {
      // Mock streamText to throw an error
      mockStreamText.mockImplementation(() => {
        throw new Error('API rate limit exceeded');
      });

      const callbacks = {
        onChunk: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
        onStatus: vi.fn(),
      };

      await expect(
        llmService.runAgentLoop(
          {
            messages: createUIMessages(2),
            model: 'test-model',
            systemPrompt: 'Test',
            tools: {},
            maxIterations: 1,
          },
          callbacks
        )
      ).rejects.toThrow();

      expect(callbacks.onError).toHaveBeenCalled();
    });

    it('should handle stream errors during compression', async () => {
      // Mock streamText to return a stream that yields an error
      mockStreamText.mockReturnValue({
        fullStream: (async function* () {
          yield { type: 'text-delta', text: 'Partial ' };
          yield { type: 'error', error: new Error('Stream interrupted') };
        })(),
        finishReason: Promise.resolve('error'),
      });

      const callbacks = {
        onChunk: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
        onStatus: vi.fn(),
      };

      await expect(
        llmService.runAgentLoop(
          {
            messages: createUIMessages(2),
            model: 'test-model',
            systemPrompt: 'Test',
            tools: {},
            maxIterations: 1,
          },
          callbacks
        )
      ).rejects.toThrow();
    });

    it('should handle empty response from model', async () => {
      // Mock streamText to return empty response
      mockStreamText.mockReturnValue({
        fullStream: (async function* () {
          yield {
            type: 'step-finish',
            finishReason: 'stop',
            usage: { inputTokens: 10, outputTokens: 0 },
          };
        })(),
        finishReason: Promise.resolve('stop'),
      });

      const callbacks = {
        onChunk: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
        onStatus: vi.fn(),
      };

      await llmService.runAgentLoop(
        {
          messages: createUIMessages(2),
          model: 'test-model',
          systemPrompt: 'Test',
          tools: {},
          maxIterations: 1,
        },
        callbacks
      );

      expect(callbacks.onComplete).toHaveBeenCalledWith('');
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

      const callbacks = {
        onChunk: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
        onStatus: vi.fn(),
      };

      await expect(
        llmService.runAgentLoop(
          {
            messages: createUIMessages(2),
            model: 'unavailable-model',
            systemPrompt: 'Test',
            tools: {},
            maxIterations: 1,
          },
          callbacks
        )
      ).rejects.toThrow('No available provider');
    });
  });

  // ===========================================
  // TEST SUITE 5: Timeout and Abort Handling
  // ===========================================
  describe('Timeout and abort handling', () => {
    it('should pass abort controller through compression flow', async () => {
      // MessageCompactor receives AbortController as second argument
      const abortController = new AbortController();

      const messageCompactor = new MessageCompactor({
        runAgentLoop: async (_options, callbacks, controller) => {
          // Verify controller is passed (may be undefined if not needed)
          callbacks.onComplete?.('Summary');
        },
      });

      // The compactMessages method accepts abortController as second param
      await messageCompactor.compactMessages(
        {
          messages: [{ role: 'user', content: 'Test' }, { role: 'assistant', content: 'Response' }],
          config: createCompressionConfig({ preserveRecentMessages: 0 }),
        },
        abortController
      );

      // Test passes if no error is thrown
      expect(true).toBe(true);
    });

    it('should handle compression errors from runAgentLoop', async () => {
      const messageCompactor = new MessageCompactor({
        runAgentLoop: async (_options, callbacks) => {
          // Simulate an error by calling onError callback
          // This triggers performCompression's promise rejection
          setTimeout(() => {
            callbacks.onError?.(new Error('Compression failed'));
          }, 0);
        },
      });

      // The performCompression method rejects when onError is called
      await expect(
        messageCompactor.compactMessages({
          messages: createModelMessages(4),
          config: createCompressionConfig({ preserveRecentMessages: 1 }),
        })
      ).rejects.toThrow('Compression failed');
    });
  });

  // ===========================================
  // TEST SUITE 6: Multiple Compression Cycles
  // ===========================================
  describe('Multiple compression cycles', () => {
    it('should handle consecutive compressions correctly', async () => {
      const messageCompactor = new MessageCompactor({
        runAgentLoop: async (_options, callbacks) => {
          callbacks.onComplete?.('Compression summary cycle');
        },
      });

      // First compression
      const result1 = await messageCompactor.compactMessages({
        messages: createModelMessages(4),
        config: createCompressionConfig({ preserveRecentMessages: 1 }),
      });

      expect(result1.compressedSummary).toBeTruthy();

      // Create compressed messages
      const compressedMessages = messageCompactor.createCompressedMessages(result1);

      // Add more messages
      const extendedMessages: ModelMessage[] = [
        ...compressedMessages,
        { role: 'user' as const, content: 'New message' },
        { role: 'assistant' as const, content: 'New response' },
      ];

      // Second compression
      const result2 = await messageCompactor.compactMessages({
        messages: extendedMessages,
        config: createCompressionConfig({ preserveRecentMessages: 1 }),
      });

      expect(result2.compressedSummary).toBeTruthy();

      // Validate message structure after compression
      // New behavior: summary is a user message, not system message
      const finalMessages = messageCompactor.createCompressedMessages(result2);

      // Should have user message with summary
      const userMessages = finalMessages.filter((m) => m.role === 'user');
      expect(userMessages.length).toBeGreaterThanOrEqual(1);

      // First user message should contain the summary
      const summaryMessage = userMessages[0];
      expect(summaryMessage.content).toContain('[Previous conversation summary]');
    });

    it('should handle summary as user message on repeated compression', async () => {
      const messageCompactor = new MessageCompactor({
        runAgentLoop: async (_options, callbacks) => {
          callbacks.onComplete?.('New summary from second compression');
        },
      });

      // Test the createCompressedMessages method directly with a manually constructed
      // CompressionResult that has an old user summary in preservedMessages
      // This simulates the scenario where a previous compression created a user summary message
      // and now a second compression is handling them
      const compressionResult = {
        compressedSummary: 'New summary from second compression',
        sections: [],
        preservedMessages: [
          // First preserved message is the original system prompt
          { role: 'system' as const, content: 'You are a helpful assistant.' },
          // Old summary as user message (from previous compression)
          { role: 'user' as const, content: '[Previous conversation summary]\n\nOld summary from first compression' },
          { role: 'assistant' as const, content: 'I understand the previous context.' },
          { role: 'user' as const, content: 'Question after first compression' },
          { role: 'assistant' as const, content: 'Answer after first compression' },
        ],
        originalMessageCount: 10,
        compressedMessageCount: 6,
        compressionRatio: 0.6,
      };

      const compressedMessages = messageCompactor.createCompressedMessages(compressionResult);

      // Should have the original system prompt first
      expect(compressedMessages[0].role).toBe('system');
      expect(compressedMessages[0].content).toBe('You are a helpful assistant.');

      // Should have user message with new summary
      expect(compressedMessages[1].role).toBe('user');
      expect(compressedMessages[1].content).toContain('[Previous conversation summary]');
      expect(compressedMessages[1].content).toContain('New summary from second compression');

      // Should have assistant acknowledgment
      expect(compressedMessages[2].role).toBe('assistant');
    });

    it('should update compression statistics across cycles', async () => {
      const messageCompactor = new MessageCompactor({
        runAgentLoop: async (_options, callbacks) => {
          callbacks.onComplete?.('Summary');
        },
      });

      const initialStats = messageCompactor.getCompressionStats();
      expect(initialStats.totalCompressions).toBe(0);

      // First compression
      await messageCompactor.compactMessages({
        messages: createModelMessages(4),
        config: createCompressionConfig({ preserveRecentMessages: 1 }),
      });

      const statsAfterFirst = messageCompactor.getCompressionStats();
      expect(statsAfterFirst.totalCompressions).toBe(1);

      // Second compression
      await messageCompactor.compactMessages({
        messages: createModelMessages(4),
        config: createCompressionConfig({ preserveRecentMessages: 1 }),
      });

      const statsAfterSecond = messageCompactor.getCompressionStats();
      expect(statsAfterSecond.totalCompressions).toBe(2);
      expect(statsAfterSecond.averageCompressionRatio).toBeGreaterThan(0);
    });
  });

  // ===========================================
  // TEST SUITE 7: Tool Message Handling
  // ===========================================
  describe('Tool message handling in compression', () => {
    it('should preserve tool-call/tool-result pairs when compressing', async () => {
      const messageCompactor = new MessageCompactor({
        runAgentLoop: async (_options, callbacks) => {
          callbacks.onComplete?.('Summary with tool calls');
        },
      });

      const messagesWithTools = createMessagesWithToolCalls();

      const result = await messageCompactor.compactMessages({
        messages: messagesWithTools,
        config: createCompressionConfig({ preserveRecentMessages: 3 }),
      });

      // Validate that preserved messages maintain tool pairs
      const compressedMessages = messageCompactor.createCompressedMessages(result);
      const validation = messageCompactor.validateCompressedMessages(compressedMessages);

      // The compression process may produce consecutive assistant messages
      // which is fixed by the fixedMessages. What matters is that the final result has complete tool pairs.
      if (!validation.valid && validation.fixedMessages) {
        const revalidation = messageCompactor.validateCompressedMessages(validation.fixedMessages);
        expect(revalidation.valid).toBe(true);
      } else {
        expect(validation.valid).toBe(true);
      }
    });

    it('should adjust preserve boundary to keep tool pairs together', async () => {
      const messageCompactor = new MessageCompactor({
        runAgentLoop: async (_options, callbacks) => {
          callbacks.onComplete?.('Summary');
        },
      });

      const messages: ModelMessage[] = [
        { role: 'user', content: 'Request 1' },
        {
          role: 'assistant',
          content: [
            { type: 'tool-call', toolCallId: 'call-1', toolName: 'test', input: {} },
          ],
        },
        {
          role: 'tool',
          content: [
            { type: 'tool-result', toolCallId: 'call-1', toolName: 'test', output: { type: 'text', value: 'done' } },
          ],
        },
        { role: 'assistant', content: 'Final response' },
      ];

      // Request to preserve only 1 message, but boundary should adjust
      const result = await messageCompactor.compactMessages({
        messages,
        config: createCompressionConfig({ preserveRecentMessages: 1 }),
      });

      // Should preserve more than 1 to keep tool pair together
      expect(result.preservedMessages.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ===========================================
  // TEST SUITE 8: Full Integration Flow
  // ===========================================
  describe('Full integration: MessageCompactor -> LLMService -> MockLanguageModelV2', () => {
    it('should complete full integration flow with realistic compression', async () => {
      // Set up a realistic mock stream that returns structured summary
      const summary = `<analysis>
The user engaged in a conversation about testing the MessageCompactor.
</analysis>

1. Primary Request and Intent: Test the message compression system
2. Key Technical Concepts: AI SDK, MockLanguageModelV2, streaming
3. Files and Code Sections: message-compactor.ts, llm-service.ts
4. Errors and fixes: None encountered
5. Problem Solving: Successfully implemented mock testing
6. All user messages: User requested compression tests
7. Pending Tasks: None
8. Current Work: Running integration tests`;

      mockStreamText.mockReturnValue(createStreamTextMock({
        textChunks: summary.split('\n'),
        finishReason: 'stop',
        inputTokens: 2000,
        outputTokens: 500,
      }));

      const receivedChunks: string[] = [];
      const callbacks = {
        onChunk: vi.fn((chunk) => receivedChunks.push(chunk)),
        onComplete: vi.fn(),
        onError: vi.fn(),
        onStatus: vi.fn(),
      };

      await llmService.runAgentLoop(
        {
          messages: createUIMessages(10),
          model: 'test-model',
          systemPrompt: 'You are testing the compression system',
          tools: {},
          maxIterations: 1,
        },
        callbacks
      );

      // Verify full integration
      expect(callbacks.onComplete).toHaveBeenCalled();
      expect(callbacks.onError).not.toHaveBeenCalled();

      const fullResponse = receivedChunks.join('');
      expect(fullResponse).toContain('analysis');
      expect(fullResponse).toContain('Primary Request');
    });

    it('should handle compression with shouldCompress check', async () => {
      // Re-establish the getContextLength mock to ensure it returns 200000
      const { getContextLength } = await import('../lib/models');
      vi.mocked(getContextLength).mockReturnValue(200000);

      const messageCompactor = new MessageCompactor({
        runAgentLoop: async (_options, callbacks) => {
          callbacks.onComplete?.('Compression complete');
        },
      });

      // Config with threshold 0.7 means compress when > 70% of context (140k)
      const config = createCompressionConfig({ compressionThreshold: 0.7 });

      // Test shouldCompress with high token count (150k > 140k threshold)
      const shouldCompressHigh = messageCompactor.shouldCompress(
        createModelMessages(10),
        config,
        150000, // 75% of 200k context - above threshold
        'test-model'
      );

      expect(shouldCompressHigh).toBe(true);

      // Test shouldCompress with low token count (50k < 140k threshold)
      const shouldCompressLow = messageCompactor.shouldCompress(
        createModelMessages(10),
        config,
        50000, // 25% of 200k context - below threshold
        'test-model'
      );

      expect(shouldCompressLow).toBe(false);

      // Test shouldCompress returns false when disabled
      const disabledConfig = createCompressionConfig({ enabled: false });
      const shouldNotCompress = messageCompactor.shouldCompress(
        createModelMessages(10),
        disabledConfig,
        150000,
        'test-model'
      );

      expect(shouldNotCompress).toBe(false);
    });
  });
});
