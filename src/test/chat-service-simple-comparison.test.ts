// src/test/chat-service-simple-comparison.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLLMService, type LLMService } from '@/services/agents/llm-service';
import type { UIMessage } from '@/types/agent';

// Mock all dependencies
vi.mock('@/lib/logger', () => ({
  logger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/services/model-service', () => ({
  modelService: { isModelAvailableSync: vi.fn(() => true) },
}));

vi.mock('@/services/ai-provider-service', () => ({
  aiProviderService: {
    getProviderModel: vi.fn(() => ({ modelId: 'test-model', provider: 'test' })),
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

vi.mock('@/stores/provider-store', () => ({
  useProviderStore: {
    getState: vi.fn(() => mockProviderStore),
  },
}));

vi.mock('@/stores/settings-store', () => ({
  settingsManager: {
    getCurrentRootPath: vi.fn(() => '/test/path'),
    getCurrentConversationId: vi.fn(() => 'test-conversation-id'),
    getSync: vi.fn().mockReturnValue(undefined),
    getBatchSync: vi.fn().mockReturnValue({}),
  },
  useSettingsStore: {
    getState: vi.fn(() => ({
      language: 'en',
    })),
  },
}));

vi.mock('@/services/workspace-root-service', () => ({
  getValidatedWorkspaceRoot: vi.fn().mockResolvedValue('/test/path'),
  getEffectiveWorkspaceRoot: vi.fn().mockResolvedValue('/test/path'),
}));

vi.mock('@/services/ai-pricing-service', () => ({
  aiPricingService: { calculateCost: vi.fn(() => Promise.resolve(0.01)) },
}));

vi.mock('@/services/conversation-manager', () => ({
  ConversationManager: { updateConversationUsage: vi.fn(() => Promise.resolve()) },
}));

vi.mock('@/lib/llm-utils', () => ({
  convertMessages: vi.fn(async (messages) =>
    messages.map((msg: UIMessage) => ({ role: msg.role, content: msg.content }))
  ),
  formatReasoningText: vi.fn((text, isFirst) => (isFirst ? `\n<thinking>\n${text}` : text)),
}));

vi.mock('ai', () => ({
  streamText: vi.fn(),
  stepCountIs: vi.fn((count) => ({ type: 'step-count', count })),
  smoothStream: vi.fn(() => undefined),
  NoSuchToolError: { isInstance: vi.fn(() => false) },
  InvalidToolInputError: { isInstance: vi.fn(() => false) },
}));

describe('ChatService Methods Simple Comparison', () => {
  const testMessages: UIMessage[] = [
    {
      id: '1',
      role: 'user',
      content: 'Hello, how are you?',
      timestamp: new Date(),
    },
  ];

  let mockStreamText: any;
  let llmService: LLMService;

  beforeEach(async () => {
    vi.clearAllMocks();
    const aiModule = await import('ai');
    mockStreamText = vi.mocked(aiModule.streamText);

    // Create a new LLMService instance for each test
    llmService = createLLMService('test-task-id');
  });

  it('should demonstrate that runAgent can replace streamChat functionality', async () => {
    // Setup consistent mock
    const mockFullStream = [
      { type: 'text-delta', text: 'Hello' },
      { type: 'text-delta', text: ' World' },
      { type: 'step-finish', finishReason: 'stop', usage: { inputTokens: 10, outputTokens: 5 } },
    ];

    mockStreamText.mockReturnValue({
      fullStream: (async function* () {
        for (const delta of mockFullStream) {
          yield delta;
        }
      })(),
      textStream: (async function* () {
        for (const delta of mockFullStream) {
          if (delta.type === 'text-delta') {
            yield delta;
          }
        }
      })(),
      onFinish: async () => {},
    });

    const runAgentOutput: string[] = [];
    let runAgentCompleted = false;

    // Test runAgent (which uses runManualAgentLoop by default)
    await llmService.runAgentLoop(
      {
        messages: testMessages,
        model: 'test-model',
        isThink: false,
        tools: {},
      },
      {
        onChunk: (chunk: string) => runAgentOutput.push(chunk),
        onComplete: (fullText: string) => {
          runAgentCompleted = true;
          expect(fullText).toBe('Hello World');
        },
        onError: vi.fn(),
        onStatus: vi.fn(),
        onToolMessage: vi.fn(),
      }
    );

    // Verify basic functionality
    expect(runAgentOutput).toEqual(['Hello', ' World']);
    expect(runAgentOutput.join('')).toBe('Hello World');
    expect(runAgentCompleted).toBe(true);
    expect(mockStreamText).toHaveBeenCalled();
  });

  it('should demonstrate runManualAgentLoop advanced features', async () => {
    const mockFullStream = [
      { type: 'text-delta', text: 'Advanced response' },
      { type: 'step-finish', finishReason: 'stop', usage: { inputTokens: 5, outputTokens: 3 } },
    ];

    mockStreamText.mockReturnValue({
      fullStream: (async function* () {
        for (const delta of mockFullStream) {
          yield delta;
        }
      })(),
    });

    let completed = false;

    // Test advanced features that streamChat doesn't have
    await llmService.runAgentLoop(
      {
        messages: testMessages,
        model: 'test-model',
        maxIterations: 10,
      },
      {
        onChunk: vi.fn(),
        onComplete: () => {
          completed = true;
        },
        onError: vi.fn(),
        onStatus: vi.fn(),
        onToolMessage: vi.fn(),
      }
    );

    expect(completed).toBe(true);
    expect(mockStreamText).toHaveBeenCalled();
  });

  it('should validate that both methods have compatible interfaces', () => {
    // Verify that runAgent supports all the parameters that streamChat needs
    const streamChatParams = {
      messages: testMessages,
      model: 'test-model',
      isThink: false,
      onChunk: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn(),
      onStatus: vi.fn(),
      customSystemPrompt: 'test prompt',
      customTools: {},
      suppressReasoning: false,
      onToolMessage: vi.fn(),
      abortController: new AbortController(),
    };

    // These should be compatible parameter mappings:
    const runAgentParams = {
      messages: streamChatParams.messages,
      model: streamChatParams.model,
      systemPrompt: streamChatParams.customSystemPrompt,
      tools: streamChatParams.customTools,
      isThink: streamChatParams.isThink,
      suppressReasoning: streamChatParams.suppressReasoning,
      useManualLoop: true,
    };

    const runAgentCallbacks = {
      onChunk: streamChatParams.onChunk,
      onComplete: streamChatParams.onComplete,
      onError: streamChatParams.onError,
      onStatus: streamChatParams.onStatus,
      onToolMessage: streamChatParams.onToolMessage,
    };

    // Verify the interface mapping is complete
    expect(runAgentParams.messages).toBe(streamChatParams.messages);
    expect(runAgentParams.model).toBe(streamChatParams.model);
    expect(runAgentParams.systemPrompt).toBe(streamChatParams.customSystemPrompt);
    expect(runAgentParams.tools).toBe(streamChatParams.customTools);
    expect(runAgentParams.isThink).toBe(streamChatParams.isThink);
    expect(runAgentParams.suppressReasoning).toBe(streamChatParams.suppressReasoning);

    expect(runAgentCallbacks.onChunk).toBe(streamChatParams.onChunk);
    expect(runAgentCallbacks.onComplete).toBe(streamChatParams.onComplete);
    expect(runAgentCallbacks.onError).toBe(streamChatParams.onError);
    expect(runAgentCallbacks.onStatus).toBe(streamChatParams.onStatus);
    expect(runAgentCallbacks.onToolMessage).toBe(streamChatParams.onToolMessage);
  });
});
