import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UIMessage } from '@/types/agent';

const {
  getWithResolvedToolsMock,
  runAgentLoopMock,
  previewSystemPromptMock,
  getEffectiveWorkspaceRootMock,
  getChangesMock,
  getAutoCheckFinishGlobalMock,
  getTaskMock,
  isModelAvailableSyncMock,
} = vi.hoisted(() => ({
  getWithResolvedToolsMock: vi.fn(),
  runAgentLoopMock: vi.fn(),
  previewSystemPromptMock: vi.fn(),
  getEffectiveWorkspaceRootMock: vi.fn(),
  getChangesMock: vi.fn(),
  getAutoCheckFinishGlobalMock: vi.fn(),
  getTaskMock: vi.fn(),
  isModelAvailableSyncMock: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/providers/stores/provider-store', () => ({
  modelService: {
    isModelAvailableSync: isModelAvailableSyncMock,
  },
}));

vi.mock('@/services/agents/agent-registry', () => ({
  agentRegistry: {
    getWithResolvedTools: getWithResolvedToolsMock,
  },
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

vi.mock('@/stores/file-changes-store', () => ({
  useFileChangesStore: {
    getState: () => ({
      getChanges: getChangesMock,
    }),
  },
}));

vi.mock('@/stores/settings-store', () => ({
  useSettingsStore: {
    getState: () => ({
      getAutoCheckFinishGlobal: getAutoCheckFinishGlobalMock,
    }),
  },
}));

vi.mock('@/stores/task-store', () => ({
  useTaskStore: {
    getState: () => ({
      getTask: getTaskMock,
    }),
  },
}));

import {
  checkFinishService,
  lastCheckFinishTimestamp,
  parseCheckFinishResult,
} from './check-finish-service';

describe('parseCheckFinishResult', () => {
  it('treats COMPLETE output with empty sections as complete', () => {
    const result = parseCheckFinishResult(`## Task Completion Check
- Status: COMPLETE
- Confidence: HIGH

## Missing Items
None

## Suggested TODO List
None`);

    expect(result.isComplete).toBe(true);
    expect(result.hasActionableItems).toBe(false);
  });

  it('treats section headings alone as non-actionable', () => {
    const result = parseCheckFinishResult(`## Task Completion Check
- Status: COMPLETE
- Confidence: MEDIUM

## Missing Items

## Suggested TODO List`);

    expect(result.isComplete).toBe(true);
    expect(result.hasActionableItems).toBe(false);
  });

  it('detects actionable incomplete results', () => {
    const result = parseCheckFinishResult(`## Task Completion Check
- Status: INCOMPLETE
- Confidence: HIGH

## Missing Items
Need to add validation for empty inputs.

## Suggested TODO List
- [ ] Add input validation
- [ ] Add tests`);

    expect(result.isComplete).toBe(false);
    expect(result.hasActionableItems).toBe(true);
  });
});

describe('CheckFinishService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastCheckFinishTimestamp.clear();

    getAutoCheckFinishGlobalMock.mockReturnValue(true);
    getChangesMock.mockReturnValue([{ filePath: 'src/example.ts', timestamp: 10 }]);
    getTaskMock.mockReturnValue({ title: 'Finish the feature' });
    isModelAvailableSyncMock.mockReturnValue(true);
    getEffectiveWorkspaceRootMock.mockResolvedValue('/repo');
    previewSystemPromptMock.mockResolvedValue({ finalSystemPrompt: 'dynamic system prompt' });
    runAgentLoopMock.mockImplementation(
      async (
        _options: unknown,
        callbacks: { onComplete?: (finalText?: string) => void; onChunk?: (chunk: string) => void }
      ) => {
        callbacks.onChunk?.('partial');
        callbacks.onComplete?.(`## Task Completion Check
- Status: COMPLETE
- Confidence: HIGH

## Missing Items
None

## Suggested TODO List
None`);
      }
    );
  });

  it('uses the resolved agent tools and dynamic system prompt when running the check', async () => {
    const agentTools = {
      readFile: {
        name: 'readFile',
      },
    };

    getWithResolvedToolsMock.mockResolvedValue({
      id: 'coding',
      model: 'test-model',
      systemPrompt: 'base system prompt',
      dynamicPrompt: { enabled: true },
      tools: agentTools,
    });

    const result = await checkFinishService.run('task-1', 'Please complete the task');

    expect(result).toBeNull();
    expect(previewSystemPromptMock).toHaveBeenCalledWith({
      agent: expect.objectContaining({ id: 'coding' }),
      workspaceRoot: '/repo',
      taskId: 'task-1',
    });
    expect(runAgentLoopMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'test-model',
        systemPrompt: 'dynamic system prompt',
        tools: agentTools,
        agentId: 'coding',
        isSubagent: true,
      }),
      expect.any(Object)
    );
  });

  it('returns a continuation message when the check finds actionable items', async () => {
    getWithResolvedToolsMock.mockResolvedValue({
      id: 'coding',
      model: 'test-model',
      systemPrompt: 'base system prompt',
      tools: {},
    });
    runAgentLoopMock.mockImplementation(
      async (
        _options: unknown,
        callbacks: { onComplete?: (finalText?: string) => void; onChunk?: (chunk: string) => void }
      ) => {
        callbacks.onComplete?.(`## Task Completion Check
- Status: INCOMPLETE
- Confidence: HIGH

## Missing Items
Need tests.

## Suggested TODO List
- [ ] Add regression tests`);
      }
    );

    const result = await checkFinishService.run('task-1');

    expect(result).toContain('Task Completion Check');
    expect(result).toContain('Please continue working on the above items to complete the task.');
  });

  it('skips rerunning when no new file changes are present', async () => {
    getWithResolvedToolsMock.mockResolvedValue({
      id: 'coding',
      model: 'test-model',
      systemPrompt: 'base system prompt',
      tools: {},
    });
    lastCheckFinishTimestamp.set('task-1', 10);

    const result = await checkFinishService.run('task-1');

    expect(result).toBeNull();
    expect(runAgentLoopMock).not.toHaveBeenCalled();
  });
});
