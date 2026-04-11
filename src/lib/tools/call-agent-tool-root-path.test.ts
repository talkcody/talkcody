import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  runAgentLoopMock,
  previewSystemPromptMock,
  getEffectiveWorkspaceRootMock,
  isModelAvailableSyncMock,
  getWithResolvedToolsMock,
} = vi.hoisted(() => ({
  runAgentLoopMock: vi.fn(),
  previewSystemPromptMock: vi.fn(),
  getEffectiveWorkspaceRootMock: vi.fn(),
  isModelAvailableSyncMock: vi.fn(() => true),
  getWithResolvedToolsMock: vi.fn(),
}));

vi.mock('@/services/agents/llm-service', () => ({
  createLLMService: vi.fn(() => ({
    runAgentLoop: runAgentLoopMock,
  })),
}));

vi.mock('@/services/prompt/preview', () => ({
  previewSystemPrompt: previewSystemPromptMock,
}));

vi.mock('@/services/workspace-root-service', () => ({
  getEffectiveWorkspaceRoot: getEffectiveWorkspaceRootMock,
}));

vi.mock('@/services/agents/agent-registry', () => ({
  agentRegistry: {
    getWithResolvedTools: getWithResolvedToolsMock,
  },
}));

vi.mock('@/providers/stores/provider-store', () => ({
  modelService: {
    isModelAvailableSync: isModelAvailableSyncMock,
  },
}));

vi.mock('@/stores/nested-tools-store', () => ({
  useNestedToolsStore: {
    getState: () => ({
      addMessage: vi.fn(),
      clearAll: vi.fn(),
    }),
  },
}));

import { callAgent } from './call-agent-tool';

describe('callAgent rootPath inheritance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEffectiveWorkspaceRootMock.mockResolvedValue('/fallback/root');
    previewSystemPromptMock.mockResolvedValue({ finalSystemPrompt: 'dynamic prompt' });
    runAgentLoopMock.mockResolvedValue(undefined);
    getWithResolvedToolsMock.mockResolvedValue({
      id: 'explore',
      model: 'test-model',
      tools: {},
      dynamicPrompt: { enabled: true },
      systemPrompt: 'static prompt',
    });
  });

  it('passes context.rootPath into nested agent loop and dynamic prompt', async () => {
    const result = await callAgent.execute(
      {
        agentId: 'explore',
        task: 'Inspect files',
        context: 'Focus on src',
      },
      {
        taskId: 'task-1',
        toolId: 'tool-1',
        rootPath: '/worktrees/task-1',
      }
    );

    expect(previewSystemPromptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceRoot: '/worktrees/task-1',
        taskId: 'task-1',
      })
    );
    expect(getEffectiveWorkspaceRootMock).not.toHaveBeenCalled();
    expect(runAgentLoopMock).toHaveBeenCalledWith(
      expect.objectContaining({
        rootPath: '/worktrees/task-1',
        subagentId: expect.any(String),
      }),
      expect.any(Object),
      undefined
    );
    expect(result.success).toBe(true);
  });

  it('reuses the parent tool call id as subagentId for nested agent loops', async () => {
    await callAgent.execute(
      {
        agentId: 'explore',
        task: 'Inspect files',
        context: 'Focus on src',
        _toolCallId: 'call_subagent_123',
      },
      {
        taskId: 'task-1',
        toolId: 'tool-1',
        rootPath: '/worktrees/task-1',
      }
    );

    expect(runAgentLoopMock).toHaveBeenCalledWith(
      expect.objectContaining({
        subagentId: 'call_subagent_123',
      }),
      expect.any(Object),
      undefined
    );
  });
});
