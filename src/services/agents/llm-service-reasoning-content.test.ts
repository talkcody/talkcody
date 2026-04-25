import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentLoopCallbacks } from '@/types/agent';
import type { Message as ModelMessage, StreamTextRequest } from '@/services/llm/types';

const {
  executeWithSmartConcurrencyMock,
  getEffectiveWorkspaceRootMock,
  streamTextMock,
  convertMessagesMock,
} = vi.hoisted(() => ({
  executeWithSmartConcurrencyMock: vi.fn(),
  getEffectiveWorkspaceRootMock: vi.fn(),
  streamTextMock: vi.fn(),
  convertMessagesMock: vi.fn(),
}));

vi.mock('@/services/agents/tool-executor', () => ({
  ToolExecutor: class {
    executeWithSmartConcurrency = executeWithSmartConcurrencyMock;
  },
}));

vi.mock('@/services/workspace-root-service', () => ({
  getEffectiveWorkspaceRoot: getEffectiveWorkspaceRootMock,
}));

vi.mock('@/services/llm/llm-client', () => ({
  llmClient: {
    streamText: streamTextMock,
  },
}));

vi.mock('@/lib/llm-utils', () => ({
  convertMessages: convertMessagesMock,
  formatReasoningText: vi.fn((text: string) => text),
}));

vi.mock('@/providers/stores/provider-store', () => ({
  useProviderStore: {
    getState: () => ({
      isModelAvailable: () => true,
      getProviderModel: vi.fn(),
      availableModels: [],
    }),
  },
}));

vi.mock('@/stores/settings-store', () => ({
  useSettingsStore: {
    getState: () => ({
      language: 'en',
      getTraceEnabled: () => false,
      getReasoningEffort: () => 'medium',
    }),
  },
  settingsManager: {
    get: vi.fn(),
    getSync: vi.fn(() => ''),
    getBatch: vi.fn(),
    getBatchSync: vi.fn(),
    getCurrentRootPath: vi.fn(() => '/main/repo'),
    getAutoApproveEditsGlobal: vi.fn(() => false),
    getAutoApprovePlanGlobal: vi.fn(() => false),
  },
}));

vi.mock('@/stores/task-store', () => ({
  useTaskStore: {
    getState: () => ({
      updateTask: vi.fn(),
      updateTaskUsage: vi.fn(),
      getMessages: vi.fn(() => []),
      clearRunningTaskUsage: vi.fn(),
    }),
  },
}));

vi.mock('@/services/hooks/hook-service', () => ({
  hookService: {
    runSessionStart: vi.fn().mockResolvedValue({ blocked: false, continue: true, additionalContext: [] }),
    runPreToolUse: vi.fn().mockResolvedValue({ blocked: false, continue: true, additionalContext: [] }),
    runPostToolUse: vi.fn().mockResolvedValue({ blocked: false, continue: true, additionalContext: [] }),
    applyHookSummary: vi.fn(),
  },
}));

vi.mock('@/services/hooks/hook-state-service', () => ({
  hookStateService: {
    consumeAdditionalContext: vi.fn(() => []),
  },
}));

vi.mock('@/services/database-service', () => ({
  databaseService: {
    startSpan: vi.fn().mockResolvedValue(undefined),
    endSpan: vi.fn().mockResolvedValue(undefined),
    insertApiUsageEvent: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/services/ai/ai-pricing-service', () => ({
  aiPricingService: {
    calculateCost: vi.fn().mockResolvedValue(0),
  },
}));

vi.mock('@/providers/config/model-config', () => ({
  getContextLength: vi.fn(() => 8192),
}));

import { LLMService } from './llm-service';

describe('LLMService reasoning_content normalization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEffectiveWorkspaceRootMock.mockResolvedValue('/main/repo');
    executeWithSmartConcurrencyMock.mockResolvedValue([]);
    streamTextMock.mockResolvedValue({
      requestId: 'req-1',
      events: (async function* () {
        yield { type: 'text-start' };
        yield { type: 'text-delta', text: 'done' };
        yield { type: 'done', finish_reason: 'stop' };
      })(),
    });
  });

  const callbacks: AgentLoopCallbacks = {
    onChunk: vi.fn(),
    onComplete: vi.fn(),
    onError: vi.fn(),
    onStatus: vi.fn(),
    onToolMessage: vi.fn(),
    onAssistantMessageStart: vi.fn(),
  };

  it('injects placeholder reasoning_content into historical DeepSeek assistant tool-call messages before streamText request', async () => {
    const convertedMessages: ModelMessage[] = [
      {
        role: 'user',
        content: [{ type: 'text', text: 'please read file' }],
      },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'readFile',
            input: { file_path: '/tmp/a.txt' },
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'readFile',
            output: { type: 'text', value: 'content' },
          },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'text', text: 'next' }],
      },
    ];

    convertMessagesMock.mockResolvedValue(convertedMessages);

    const requests: StreamTextRequest[] = [];
    streamTextMock.mockImplementation(async (request) => {
      requests.push(request);
      return {
        requestId: 'req-1',
        events: (async function* () {
          yield { type: 'text-start' };
          yield { type: 'text-delta', text: 'done' };
          yield { type: 'done', finish_reason: 'stop' };
        })(),
      };
    });

    const service = new LLMService('task-1');
    await service.runAgentLoop(
      {
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            content: 'continue',
            timestamp: new Date(),
          },
        ],
        model: 'deepseek-v4-pro@deepseek',
        tools: {},
      },
      callbacks
    );

    expect(requests).toHaveLength(1);
    const assistant = requests[0]?.messages.find((msg) => msg.role === 'assistant') as
      | { providerOptions?: { openaiCompatible?: { reasoning_content?: string } } }
      | undefined;

    expect(assistant?.providerOptions?.openaiCompatible?.reasoning_content).toBe(' ');
  });

  it('injects reasoning_content into historical assistant tool-call messages before streamText request', async () => {
    const convertedMessages: ModelMessage[] = [
      {
        role: 'user',
        content: [{ type: 'text', text: 'please read file' }],
      },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'readFile',
            input: { file_path: '/tmp/a.txt' },
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'readFile',
            output: { type: 'text', value: 'content' },
          },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'text', text: 'next' }],
      },
    ];

    convertMessagesMock.mockResolvedValue(convertedMessages);

    const requests: StreamTextRequest[] = [];
    streamTextMock.mockImplementation(async (request) => {
      requests.push(request);
      return {
        requestId: 'req-1',
        events: (async function* () {
          yield { type: 'text-start' };
          yield { type: 'text-delta', text: 'done' };
          yield { type: 'done', finish_reason: 'stop' };
        })(),
      };
    });

    const service = new LLMService('task-1');
    await service.runAgentLoop(
      {
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            content: 'continue',
            timestamp: new Date(),
          },
        ],
        model: 'kimi-k2.6@kimi_coding',
        tools: {},
      },
      callbacks
    );

    expect(requests).toHaveLength(1);
    const assistant = requests[0]?.messages.find((msg) => msg.role === 'assistant') as
      | { providerOptions?: { openaiCompatible?: { reasoning_content?: string } } }
      | undefined;

    expect(assistant?.providerOptions?.openaiCompatible?.reasoning_content).toBe(' ');
  });
});
