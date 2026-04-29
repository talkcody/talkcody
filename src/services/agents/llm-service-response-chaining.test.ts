import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentLoopCallbacks } from '@/types/agent';
import type { Message as ModelMessage, StreamTextRequest } from '@/services/llm/types';

const oauthState = {
  openaiIsConnected: false,
};

const {
  executeWithSmartConcurrencyMock,
  getEffectiveWorkspaceRootMock,
  streamTextMock,
  closeResponsesSessionMock,
  convertMessagesMock,
} = vi.hoisted(() => ({
  executeWithSmartConcurrencyMock: vi.fn(),
  getEffectiveWorkspaceRootMock: vi.fn(),
  streamTextMock: vi.fn(),
  closeResponsesSessionMock: vi.fn().mockResolvedValue(undefined),
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
    closeResponsesSession: closeResponsesSessionMock,
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
      oauthConfig: oauthState,
    }),
  },
}));

vi.mock('@/lib/utils', async () => {
  const actual = await vi.importActual<typeof import('@/lib/utils')>('@/lib/utils');
  return {
    ...actual,
    generateId: vi.fn(() => 'transport-session-test'),
  };
});

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

describe('LLMService response chaining integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    oauthState.openaiIsConnected = false;
    getEffectiveWorkspaceRootMock.mockResolvedValue('/main/repo');
    executeWithSmartConcurrencyMock.mockResolvedValue([
      {
        toolCall: {
          toolCallId: 'call-1',
          toolName: 'readFile',
          input: { file_path: 'src/index.ts' },
        },
        result: { ok: true },
      },
    ]);
  });

  const callbacks: AgentLoopCallbacks = {
    onChunk: vi.fn(),
    onComplete: vi.fn(),
    onError: vi.fn(),
    onStatus: vi.fn(),
    onToolMessage: vi.fn(),
    onAssistantMessageStart: vi.fn(),
  };

  it('keeps non-OpenAI providers stateless during the loop', async () => {
    const convertedMessages: ModelMessage[] = [{ role: 'user', content: 'continue' }];
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
        model: 'claude-sonnet@anthropic',
        tools: {},
      },
      callbacks
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]?.conversationMode).toBe('stateless');
    expect(requests[0]?.inputMode).toBe('full-history');
    expect(requests[0]?.previousResponseId).toBeNull();
  });

  it('does not advance the chain when follow-up metadata comes from a different provider', async () => {
    oauthState.openaiIsConnected = true;
    const convertedMessages: ModelMessage[] = [{ role: 'user', content: 'continue' }];
    convertMessagesMock.mockResolvedValue(convertedMessages);
    executeWithSmartConcurrencyMock.mockImplementation(async (toolCalls) =>
      toolCalls.map((toolCall) => ({ toolCall, result: { ok: true } }))
    );

    const requests: StreamTextRequest[] = [];
    let turn = 0;
    streamTextMock.mockImplementation(async (request) => {
      requests.push(request);
      turn += 1;

      if (turn === 1) {
        return {
          requestId: 'req-1',
          events: (async function* () {
            yield { type: 'text-start' };
            yield {
              type: 'tool-call',
              toolCallId: 'call-1',
              toolName: 'readFile',
              input: { file_path: 'src/index.ts' },
            };
            yield {
              type: 'response-metadata',
              responseId: 'resp-1',
              provider: 'openai-subscription',
              transport: 'websocket',
              continuationAccepted: true,
              transportSessionId: 'session-1',
            };
            yield { type: 'done', finish_reason: 'tool-calls' };
          })(),
        };
      }

      if (turn === 2) {
        return {
          requestId: 'req-2',
          events: (async function* () {
            yield { type: 'text-start' };
            yield {
              type: 'tool-call',
              toolCallId: 'call-2',
              toolName: 'readFile',
              input: { file_path: 'src/next.ts' },
            };
            yield {
              type: 'response-metadata',
              responseId: 'resp-api-2',
              provider: 'openai-api',
              transport: 'http-sse',
              continuationAccepted: true,
              transportSessionId: 'session-api',
            };
            yield { type: 'done', finish_reason: 'tool-calls' };
          })(),
        };
      }

      return {
        requestId: 'req-3',
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
        model: 'gpt-5.4@openai',
        tools: {
          readFile: {
            name: 'readFile',
            description: 'Read file',
            inputSchema: { type: 'object', properties: {}, additionalProperties: false } as never,
            execute: vi.fn(),
            renderToolDoing: () => null,
            renderToolResult: () => null,
            canConcurrent: true,
          },
        },
      },
      callbacks
    );

    expect(requests).toHaveLength(3);
    expect(requests[1]?.conversationMode).toBe('responses-chained');
    expect(requests[1]?.inputMode).toBe('incremental');
    expect(requests[1]?.previousResponseId).toBe('resp-1');
    expect(requests[1]?.transportSessionId).toBe('session-1');

    expect(requests[2]?.conversationMode).toBe('stateless');
    expect(requests[2]?.inputMode).toBe('full-history');
    expect(requests[2]?.previousResponseId).toBeNull();
    expect(requests[2]?.transportSessionId).toBeNull();
    expect(requests[2]?.messages).toEqual([
      {
        role: 'user',
        content: 'continue',
      },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'readFile',
            input: { file_path: 'src/index.ts' },
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
            output: {
              type: 'text',
              value: '{\n  "ok": true\n}',
            },
          },
        ],
      },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call-2',
            toolName: 'readFile',
            input: { file_path: 'src/next.ts' },
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-2',
            toolName: 'readFile',
            output: {
              type: 'text',
              value: '{\n  "ok": true\n}',
            },
          },
        ],
      },
    ]);
  });

  it('retries a websocket timeout turn with a fresh websocket full-history baseline', async () => {
    oauthState.openaiIsConnected = true;
    const convertedMessages: ModelMessage[] = [{ role: 'user', content: 'continue' }];
    convertMessagesMock.mockResolvedValue(convertedMessages);
    executeWithSmartConcurrencyMock.mockImplementation(async (toolCalls) =>
      toolCalls.map((toolCall) => ({ toolCall, result: { ok: true } }))
    );

    const requests: StreamTextRequest[] = [];
    let turn = 0;
    streamTextMock.mockImplementation(async (request) => {
      requests.push(request);
      turn += 1;

      if (turn === 1) {
        return {
          requestId: 'req-1',
          events: (async function* () {
            yield { type: 'text-start' };
            yield {
              type: 'tool-call',
              toolCallId: 'call-1',
              toolName: 'readFile',
              input: { file_path: 'src/index.ts' },
            };
            yield {
              type: 'response-metadata',
              responseId: 'resp-1',
              provider: 'openai-subscription',
              transport: 'websocket',
              continuationAccepted: true,
              transportSessionId: 'session-1',
            };
            yield { type: 'done', finish_reason: 'tool-calls' };
          })(),
        };
      }

      if (turn === 2) {
        return {
          requestId: 'req-2',
          events: (async function* () {
            yield {
              type: 'transport-fallback',
              reason: 'keepalive ping timeout',
              from: 'responses-chained',
              to: 'fresh-websocket-baseline',
            };
            yield {
              type: 'error',
              message: 'keepalive ping timeout',
            };
          })(),
        };
      }

      return {
        requestId: 'req-3',
        events: (async function* () {
          yield { type: 'text-start' };
          yield { type: 'text-delta', text: 'done' };
          yield {
            type: 'response-metadata',
            responseId: 'resp-3',
            provider: 'openai-subscription',
            transport: 'websocket',
            continuationAccepted: true,
            transportSessionId: 'session-2',
          };
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
        model: 'gpt-5.4@openai',
        tools: {
          readFile: {
            name: 'readFile',
            description: 'Read file',
            inputSchema: { type: 'object', properties: {}, additionalProperties: false } as never,
            execute: vi.fn(),
            renderToolDoing: () => null,
            renderToolResult: () => null,
            canConcurrent: true,
          },
        },
      },
      callbacks
    );

    expect(requests).toHaveLength(3);
    expect(requests[1]?.conversationMode).toBe('responses-chained');
    expect(requests[1]?.inputMode).toBe('incremental');
    expect(requests[2]?.conversationMode).toBe('responses-chained');
    expect(requests[2]?.inputMode).toBe('full-history');
    expect(requests[2]?.previousResponseId).toBeNull();
    expect(requests[2]?.transportSessionId).toBe('session-1');
    expect(closeResponsesSessionMock).toHaveBeenCalledWith('session-1');
  });

  it('retries a previous_response_not_found turn with a fresh websocket full-history baseline', async () => {
    oauthState.openaiIsConnected = true;
    const convertedMessages: ModelMessage[] = [{ role: 'user', content: 'continue' }];
    convertMessagesMock.mockResolvedValue(convertedMessages);
    executeWithSmartConcurrencyMock.mockImplementation(async (toolCalls) =>
      toolCalls.map((toolCall) => ({ toolCall, result: { ok: true } }))
    );

    const requests: StreamTextRequest[] = [];
    let turn = 0;
    streamTextMock.mockImplementation(async (request) => {
      requests.push(request);
      turn += 1;

      if (turn === 1) {
        return {
          requestId: 'req-1',
          events: (async function* () {
            yield { type: 'text-start' };
            yield {
              type: 'tool-call',
              toolCallId: 'call-1',
              toolName: 'readFile',
              input: { file_path: 'src/index.ts' },
            };
            yield {
              type: 'response-metadata',
              responseId: 'resp-1',
              provider: 'openai-subscription',
              transport: 'websocket',
              continuationAccepted: true,
              transportSessionId: 'session-1',
            };
            yield { type: 'done', finish_reason: 'tool-calls' };
          })(),
        };
      }

      if (turn === 2) {
        return {
          requestId: 'req-2',
          events: (async function* () {
            yield {
              type: 'transport-fallback',
              reason: 'previous_response_not_found',
              from: 'responses-chained',
              to: 'fresh-websocket-baseline',
            };
            yield {
              type: 'error',
              message: "Previous response with id 'resp-1' not found.",
            };
          })(),
        };
      }

      return {
        requestId: 'req-3',
        events: (async function* () {
          yield { type: 'text-start' };
          yield { type: 'text-delta', text: 'done' };
          yield {
            type: 'response-metadata',
            responseId: 'resp-3',
            provider: 'openai-subscription',
            transport: 'websocket',
            continuationAccepted: true,
            transportSessionId: 'session-2',
          };
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
        model: 'gpt-5.4@openai',
        tools: {
          readFile: {
            name: 'readFile',
            description: 'Read file',
            inputSchema: { type: 'object', properties: {}, additionalProperties: false } as never,
            execute: vi.fn(),
            renderToolDoing: () => null,
            renderToolResult: () => null,
            canConcurrent: true,
          },
        },
      },
      callbacks
    );

    expect(requests).toHaveLength(3);
    expect(requests[1]?.conversationMode).toBe('responses-chained');
    expect(requests[1]?.inputMode).toBe('incremental');
    expect(requests[1]?.previousResponseId).toBe('resp-1');
    expect(requests[2]?.conversationMode).toBe('responses-chained');
    expect(requests[2]?.inputMode).toBe('full-history');
    expect(requests[2]?.previousResponseId).toBeNull();
    expect(requests[2]?.transportSessionId).toBe('session-1');
    expect(closeResponsesSessionMock).toHaveBeenCalledWith('session-1');
  });

  it('retries a fallback-only fresh websocket baseline signal without requiring an error event', async () => {
    oauthState.openaiIsConnected = true;
    const convertedMessages: ModelMessage[] = [{ role: 'user', content: 'continue' }];
    convertMessagesMock.mockResolvedValue(convertedMessages);
    executeWithSmartConcurrencyMock.mockImplementation(async (toolCalls) =>
      toolCalls.map((toolCall) => ({ toolCall, result: { ok: true } }))
    );

    const requests: StreamTextRequest[] = [];
    let turn = 0;
    streamTextMock.mockImplementation(async (request) => {
      requests.push(request);
      turn += 1;

      if (turn === 1) {
        return {
          requestId: 'req-1',
          events: (async function* () {
            yield { type: 'text-start' };
            yield {
              type: 'tool-call',
              toolCallId: 'call-1',
              toolName: 'readFile',
              input: { file_path: 'src/index.ts' },
            };
            yield {
              type: 'response-metadata',
              responseId: 'resp-1',
              provider: 'openai-subscription',
              transport: 'websocket',
              continuationAccepted: true,
              transportSessionId: 'session-1',
            };
            yield { type: 'done', finish_reason: 'tool-calls' };
          })(),
        };
      }

      if (turn === 2) {
        return {
          requestId: 'req-2',
          events: (async function* () {
            yield {
              type: 'transport-fallback',
              reason: 'keepalive ping timeout',
              from: 'responses-chained',
              to: 'fresh-websocket-baseline',
            };
            yield { type: 'done', finish_reason: 'stop' };
          })(),
        };
      }

      return {
        requestId: 'req-3',
        events: (async function* () {
          yield { type: 'text-start' };
          yield { type: 'text-delta', text: 'done' };
          yield {
            type: 'response-metadata',
            responseId: 'resp-3',
            provider: 'openai-subscription',
            transport: 'websocket',
            continuationAccepted: true,
            transportSessionId: 'session-2',
          };
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
        model: 'gpt-5.4@openai',
        tools: {
          readFile: {
            name: 'readFile',
            description: 'Read file',
            inputSchema: { type: 'object', properties: {}, additionalProperties: false } as never,
            execute: vi.fn(),
            renderToolDoing: () => null,
            renderToolResult: () => null,
            canConcurrent: true,
          },
        },
      },
      callbacks
    );

    expect(requests).toHaveLength(3);
    expect(requests[2]?.conversationMode).toBe('responses-chained');
    expect(requests[2]?.inputMode).toBe('full-history');
    expect(requests[2]?.previousResponseId).toBeNull();
    expect(requests[2]?.transportSessionId).toBe('session-1');
    expect(closeResponsesSessionMock).toHaveBeenCalledWith('session-1');
  });

  it('retries a websocket reset after visible output has already started', async () => {
    oauthState.openaiIsConnected = true;
    const convertedMessages: ModelMessage[] = [{ role: 'user', content: 'continue' }];
    convertMessagesMock.mockResolvedValue(convertedMessages);
    executeWithSmartConcurrencyMock.mockImplementation(async (toolCalls) =>
      toolCalls.map((toolCall) => ({ toolCall, result: { ok: true } }))
    );

    const requests: StreamTextRequest[] = [];
    let turn = 0;
    streamTextMock.mockImplementation(async (request) => {
      requests.push(request);
      turn += 1;

      if (turn === 1) {
        return {
          requestId: 'req-1',
          events: (async function* () {
            yield { type: 'text-start' };
            yield {
              type: 'tool-call',
              toolCallId: 'call-1',
              toolName: 'readFile',
              input: { file_path: 'src/index.ts' },
            };
            yield {
              type: 'response-metadata',
              responseId: 'resp-1',
              provider: 'openai-subscription',
              transport: 'websocket',
              continuationAccepted: true,
              transportSessionId: 'session-1',
            };
            yield { type: 'done', finish_reason: 'tool-calls' };
          })(),
        };
      }

      if (turn === 2) {
        return {
          requestId: 'req-2',
          events: (async function* () {
            yield { type: 'text-start' };
            yield { type: 'text-delta', text: 'partial output' };
            yield {
              type: 'transport-fallback',
              reason: 'connection reset without closing handshake',
              from: 'responses-chained',
              to: 'fresh-websocket-baseline',
            };
            yield {
              type: 'error',
              message: 'connection reset without closing handshake',
            };
          })(),
        };
      }

      return {
        requestId: 'req-3',
        events: (async function* () {
          yield { type: 'text-start' };
          yield { type: 'text-delta', text: 'done' };
          yield {
            type: 'response-metadata',
            responseId: 'resp-3',
            provider: 'openai-subscription',
            transport: 'websocket',
            continuationAccepted: true,
            transportSessionId: 'session-2',
          };
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
        model: 'gpt-5.4@openai',
        tools: {
          readFile: {
            name: 'readFile',
            description: 'Read file',
            inputSchema: { type: 'object', properties: {}, additionalProperties: false } as never,
            execute: vi.fn(),
            renderToolDoing: () => null,
            renderToolResult: () => null,
            canConcurrent: true,
          },
        },
      },
      callbacks
    );

    expect(requests).toHaveLength(3);
    expect(requests[1]?.conversationMode).toBe('responses-chained');
    expect(requests[1]?.inputMode).toBe('incremental');
    expect(requests[1]?.previousResponseId).toBe('resp-1');
    expect(requests[2]?.conversationMode).toBe('responses-chained');
    expect(requests[2]?.inputMode).toBe('full-history');
    expect(requests[2]?.previousResponseId).toBeNull();
    expect(requests[2]?.transportSessionId).toBe('session-1');
    expect(closeResponsesSessionMock).toHaveBeenCalledWith('session-1');
  });
});
