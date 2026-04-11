import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentLoopCallbacks, AgentLoopOptions } from '@/types/agent';

const { executeWithSmartConcurrencyMock, getEffectiveWorkspaceRootMock, streamTextMock } =
  vi.hoisted(() => ({
    executeWithSmartConcurrencyMock: vi.fn(),
    getEffectiveWorkspaceRootMock: vi.fn(),
    streamTextMock: vi.fn(),
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
  convertMessages: vi.fn().mockImplementation(async (messages) => messages),
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

describe('LLMService execution root propagation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEffectiveWorkspaceRootMock.mockResolvedValue('/main/repo');
    executeWithSmartConcurrencyMock.mockResolvedValue([]);
    streamTextMock.mockResolvedValue({
      requestId: 'req-1',
      events: (async function* () {
        yield { type: 'text-start' };
        yield {
          type: 'tool-call',
          toolCallId: 'call-1',
          toolName: 'readFile',
          input: { file_path: 'src/index.ts' },
        };
        yield { type: 'done', finish_reason: 'tool-calls' };
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

  const options: AgentLoopOptions = {
    messages: [
      {
        id: 'msg-1',
        role: 'user',
        content: 'inspect the repo',
        timestamp: new Date(),
      },
    ],
    model: 'test-model',
    tools: {
      readFile: {
        name: 'readFile',
        description: 'Read file',
        inputSchema: {} as any,
        execute: vi.fn(),
        renderToolDoing: () => null,
        renderToolResult: () => null,
        canConcurrent: true,
      },
    },
  };

    it('passes explicit execution rootPath into tool executor', async () => {
      const service = new LLMService('task-1');

      await service.runAgentLoop(
        {
          ...options,
          rootPath: '/worktrees/task-1',
          subagentId: 'subagent-1',
        },
        callbacks
      );

      expect(executeWithSmartConcurrencyMock).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          taskId: 'task-1',
          rootPath: '/worktrees/task-1',
          subagentId: 'subagent-1',
        }),
        expect.any(Function),
        expect.any(Function)
      );
      expect(getEffectiveWorkspaceRootMock).not.toHaveBeenCalled();
    });

  it('falls back to resolved workspace root when execution rootPath is not provided', async () => {
    const service = new LLMService('task-1');

    await service.runAgentLoop(options, callbacks);

    expect(getEffectiveWorkspaceRootMock).toHaveBeenCalledWith('task-1');
    expect(executeWithSmartConcurrencyMock).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        taskId: 'task-1',
        rootPath: '/main/repo',
      }),
      expect.any(Function),
      expect.any(Function)
    );
  });
});
