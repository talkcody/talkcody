import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LLMService } from '@/services/agents/llm-service';
import type { StreamEvent, StreamTextRequest } from '@/services/llm/types';
import type { ToolWithUI } from '@/types/tool';

let traceEnabled = false;

const createEventStream = (events: StreamEvent[]) =>
  (async function* stream() {
    for (const event of events) {
      yield event;
    }
  })();

const createStubTool = (
  name: string,
  execute: ReturnType<typeof vi.fn> = vi.fn(async (input) => ({ success: true, input })),
  inputSchema: Record<string, unknown> = {
    type: 'object',
    properties: {},
    additionalProperties: false,
  }
): ToolWithUI => ({
  name,
  description: `Test tool ${name}`,
  inputSchema,
  execute,
  renderToolDoing: () => null,
  renderToolResult: () => null,
  canConcurrent: false,
});

vi.mock('@/services/llm/llm-client', () => ({
  llmClient: {
    streamText: vi.fn(),
    generateImage: vi.fn(),
  },
}));

vi.mock('@/providers/models/model-type-service', () => ({
  modelTypeService: {
    resolveModelType: vi.fn(async () => 'gemini-3-pro-image@aiGateway'),
    resolveModelTypeSync: vi.fn(() => 'gemini-3-pro-image@aiGateway'),
  },
}));

vi.mock('@/services/hooks/hook-service', () => ({
  hookService: {
    runStop: vi.fn().mockResolvedValue({ blocked: false, continue: true, additionalContext: [] }),
    runSessionStart: vi
      .fn()
      .mockResolvedValue({ blocked: false, continue: true, additionalContext: [] }),
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

vi.mock('@/lib/llm-utils', () => ({
  convertMessages: vi.fn().mockImplementation((messages) => Promise.resolve(messages || [])),
  formatReasoningText: vi
    .fn()
    .mockImplementation((text, isFirst) => (isFirst ? `\n<thinking>\n${text}` : text)),
}));

vi.mock('@/providers/stores/provider-store', () => ({
  useProviderStore: {
    getState: () => ({
      isModelAvailable: () => true,
      getProviderModel: vi.fn(),
      availableModels: [],
      apiKeys: {},
      providers: new Map(),
      customProviders: {},
    }),
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

vi.mock('@/services/database-service', () => ({
  databaseService: {
    insertApiUsageEvent: vi.fn().mockResolvedValue(undefined),
    startSpan: vi.fn().mockResolvedValue(undefined),
    endSpan: vi.fn().mockResolvedValue(undefined),
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

vi.mock('@/stores/settings-store', () => ({
  useSettingsStore: {
    getState: () => ({
      language: 'en',
      getTraceEnabled: () => traceEnabled,
      getReasoningEffort: () => 'medium',
    }),
  },
}));

vi.mock('@/services/workspace-root-service', () => ({
  getEffectiveWorkspaceRoot: vi.fn().mockResolvedValue('/tmp'),
}));

describe('LLMService image generation tool orchestration', () => {
  beforeEach(() => {
    traceEnabled = false;
    vi.clearAllMocks();
  });

  it('routes image generation through streamText with tool info and tracing', async () => {
    traceEnabled = true;

    const { llmClient } = await import('@/services/llm/llm-client');
    const streamTextMock = vi.mocked(llmClient.streamText);
    const requests: StreamTextRequest[] = [];

    streamTextMock.mockImplementation(async (request) => {
      requests.push(request);

      if (requests.length === 1) {
        return {
          requestId: 'req-1',
          events: createEventStream([
            { type: 'text-start' },
            {
              type: 'tool-call',
              toolCallId: 'call-1',
              toolName: 'imageGeneration',
              input: { prompt: 'sunset' },
            },
            { type: 'done', finish_reason: 'tool-calls' },
          ]),
        };
      }

      return {
        requestId: 'req-2',
        events: createEventStream([
          { type: 'text-start' },
          { type: 'text-delta', text: 'Done' },
          { type: 'done', finish_reason: 'stop' },
        ]),
      };
    });

    const attachments = [
      {
        id: 'attach-1',
        type: 'image' as const,
        filename: 'generated-1.png',
        filePath: '/tmp/generated-1.png',
        mimeType: 'image/png',
        size: 123,
      },
    ];
    const imageExecute = vi.fn(async (input) => ({ success: true, input, attachments }));
    const imageTool = createStubTool('imageGeneration', imageExecute, {
      type: 'object',
      properties: {
        prompt: { type: 'string' },
      },
      required: ['prompt'],
      additionalProperties: false,
    });
    const askTool = createStubTool('askUserQuestions');

    const service = new LLMService('task-1');
    const toolMessages: Array<{ content: unknown; attachments?: unknown }> = [];

    await service.runAgentLoop(
      {
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            content: 'Generate a sunset image',
            timestamp: new Date(),
          },
        ],
        model: 'gemini-3-pro-image@aiGateway',
        tools: {
          askUserQuestions: askTool,
          imageGeneration: imageTool,
        },
      },
      {
        onChunk: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
        onStatus: vi.fn(),
        onToolMessage: (message) => toolMessages.push(message),
      }
    );

    expect(streamTextMock).toHaveBeenCalledTimes(2);
    expect(requests[0]?.tools?.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['askUserQuestions', 'imageGeneration'])
    );
    expect(requests[0]?.traceContext?.traceId).toBe('task-1');
    expect(requests[0]?.traceContext?.spanName).toContain('Step1-llm');

    const toolCallMessage = toolMessages.find(
      (message) =>
        Array.isArray(message.content) &&
        message.content.some(
          (part) =>
            part.type === 'tool-call' && part.toolName === 'imageGeneration'
        )
    );
    const toolResultMessage = toolMessages.find(
      (message) =>
        Array.isArray(message.content) &&
        message.content.some(
          (part) =>
            part.type === 'tool-result' && part.toolName === 'imageGeneration'
        )
    );

    expect(toolCallMessage).toBeTruthy();
    expect(toolResultMessage).toBeTruthy();
    expect((toolResultMessage as { attachments?: unknown }).attachments).toEqual(attachments);
    expect(imageExecute).toHaveBeenCalledTimes(1);
    expect(imageExecute.mock.calls[0]?.[0]).toMatchObject({ prompt: 'sunset' });
    expect(imageExecute.mock.calls[0]?.[1]).toMatchObject({ taskId: 'task-1' });
  });
});

describe('LLMService stream retry behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((handler: TimerHandler) => {
      if (typeof handler === 'function') {
        handler();
      }
      return 0 as ReturnType<typeof setTimeout>;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const buildCallbacks = () => ({
    onChunk: vi.fn(),
    onComplete: vi.fn(),
    onError: vi.fn(),
    onStatus: vi.fn(),
  });

  it('retries server failures up to 3 times and succeeds on the 4th attempt', async () => {
    const { llmClient } = await import('@/services/llm/llm-client');
    const streamTextMock = vi.mocked(llmClient.streamText);

    let attempts = 0;
    streamTextMock.mockImplementation(async () => {
      attempts++;
      if (attempts <= 3) {
        throw new Error('HTTP 520: error code: 520');
      }

      return {
        requestId: `retry-success-${attempts}`,
        events: createEventStream([
          { type: 'text-start' },
          { type: 'text-delta', text: 'retry recovered' },
          { type: 'done', finish_reason: 'stop' },
        ]),
      };
    });

    const callbacks = buildCallbacks();
    const service = new LLMService('task-retry-success');

    await service.runAgentLoop(
      {
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            content: 'hello',
            timestamp: new Date(),
          },
        ],
        model: 'gemini-3-pro-image@aiGateway',
        tools: {},
      },
      callbacks
    );

    expect(streamTextMock).toHaveBeenCalledTimes(4);
    expect(callbacks.onComplete).toHaveBeenCalledWith('retry recovered');
    expect(callbacks.onError).not.toHaveBeenCalled();
  });

  it('fails with clear reason after retries are exhausted', async () => {
    const { llmClient } = await import('@/services/llm/llm-client');
    const streamTextMock = vi.mocked(llmClient.streamText);

    streamTextMock.mockRejectedValue(
      new Error('HTTP 503: upstream connect error or disconnect/reset before headers')
    );

    const callbacks = buildCallbacks();
    const service = new LLMService('task-retry-exhausted');

    await expect(
      service.runAgentLoop(
        {
          messages: [
            {
              id: 'msg-1',
              role: 'user',
              content: 'hello',
              timestamp: new Date(),
            },
          ],
          model: 'gemini-3-pro-image@aiGateway',
          tools: {},
        },
        callbacks
      )
    ).rejects.toThrow(/after 3 retries/i);

    expect(streamTextMock).toHaveBeenCalledTimes(4);
    expect(callbacks.onError).toHaveBeenCalledTimes(1);
    expect(callbacks.onError.mock.calls[0]?.[0]?.message).toContain('after 3 retries');
  });

  it('does not retry non-retryable 4xx failures', async () => {
    const { llmClient } = await import('@/services/llm/llm-client');
    const streamTextMock = vi.mocked(llmClient.streamText);

    streamTextMock.mockRejectedValue(new Error('HTTP error 401: invalid api key'));

    const callbacks = buildCallbacks();
    const service = new LLMService('task-no-retry-4xx');

    await expect(
      service.runAgentLoop(
        {
          messages: [
            {
              id: 'msg-1',
              role: 'user',
              content: 'hello',
              timestamp: new Date(),
            },
          ],
          model: 'gemini-3-pro-image@aiGateway',
          tools: {},
        },
        callbacks
      )
    ).rejects.toThrow(/401/);

    expect(streamTextMock).toHaveBeenCalledTimes(1);
  });
});
