import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  startExecution: vi.fn(),
  getRunningTaskIds: vi.fn(() => []),
  createTask: vi.fn(),
  addUserMessage: vi.fn(),
  getCurrentModel: vi.fn(),
  getAgent: vi.fn(),
  previewSystemPrompt: vi.fn(),
  getTaskDetails: vi.fn(),
  updateTaskSettings: vi.fn(),
  settingsGetAgentId: vi.fn(() => 'planner'),
  settingsGetPlanModeEnabled: vi.fn(() => false),
  settingsGetRalphLoopEnabled: vi.fn(() => false),
  settingsGetWorktreeModeEnabled: vi.fn(() => false),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/services/execution-service', () => ({
  executionService: {
    startExecution: mocks.startExecution,
    getRunningTaskIds: mocks.getRunningTaskIds,
  },
}));

vi.mock('@/services/task-service', () => ({
  taskService: {
    createTask: mocks.createTask,
    getTaskDetails: mocks.getTaskDetails,
    updateTaskSettings: mocks.updateTaskSettings,
  },
}));

vi.mock('@/services/message-service', () => ({
  messageService: {
    addUserMessage: mocks.addUserMessage,
  },
}));

vi.mock('@/providers/stores/provider-store', () => ({
  modelService: {
    getCurrentModel: mocks.getCurrentModel,
  },
}));

vi.mock('@/services/agents/agent-registry', () => ({
  agentRegistry: {
    getWithResolvedTools: mocks.getAgent,
  },
}));

vi.mock('@/services/prompt/preview', () => ({
  previewSystemPrompt: mocks.previewSystemPrompt,
}));

vi.mock('@/services/workspace-root-service', () => ({
  getEffectiveWorkspaceRoot: vi.fn().mockResolvedValue('/repo'),
}));

vi.mock('@/stores/settings-store', () => ({
  useSettingsStore: {
    getState: () => ({
      language: 'en',
      getAgentId: mocks.settingsGetAgentId,
      getPlanModeEnabled: mocks.settingsGetPlanModeEnabled,
      getRalphLoopEnabled: mocks.settingsGetRalphLoopEnabled,
      getWorktreeModeEnabled: mocks.settingsGetWorktreeModeEnabled,
    }),
  },
}));

import { useTaskQueueStore } from '@/stores/task-queue-store';
import { taskQueueService } from './task-queue-service';

describe('task-queue-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTaskQueueStore.setState({ queuesByProjectId: new Map() });
    mocks.getCurrentModel.mockResolvedValue('test-model');
    mocks.settingsGetAgentId.mockReturnValue('planner');
    mocks.settingsGetPlanModeEnabled.mockReturnValue(false);
    mocks.settingsGetRalphLoopEnabled.mockReturnValue(false);
    mocks.settingsGetWorktreeModeEnabled.mockReturnValue(false);
    mocks.getAgent.mockResolvedValue({
      id: 'planner',
      systemPrompt: 'system prompt',
      dynamicPrompt: { enabled: false },
      tools: {},
    });
    mocks.createTask.mockResolvedValue('task-queued');
    mocks.startExecution.mockResolvedValue(undefined);
    mocks.getTaskDetails.mockImplementation(async (taskId: string) => ({
      id: taskId,
      project_id: taskId === 'task-other' ? 'project-b' : 'project-a',
    }));
  });

  it('does not start queued draft while another task in the same project is still running', async () => {
    useTaskQueueStore.getState().enqueueDraft({
      projectId: 'project-a',
      sourceTaskId: 'task-1',
      prompt: 'queued prompt',
    });
    mocks.getRunningTaskIds.mockReturnValue(['task-other']);
    mocks.getTaskDetails.mockResolvedValue({ id: 'task-other', project_id: 'project-a' });

    const result = await taskQueueService.tryStartNextQueuedItem('project-a');

    expect(result).toBeNull();
    expect(mocks.createTask).not.toHaveBeenCalled();
  });

  it('ignores running tasks from other projects when advancing the queue', async () => {
    const draft = useTaskQueueStore.getState().enqueueDraft({
      projectId: 'project-a',
      sourceTaskId: 'task-1',
      prompt: 'queued prompt',
    });
    mocks.getRunningTaskIds.mockReturnValue(['task-other']);
    mocks.getTaskDetails.mockResolvedValue({ id: 'task-other', project_id: 'project-b' });

    const result = await taskQueueService.tryStartNextQueuedItem('project-a');

    expect(result).toBe('task-queued');
    expect(mocks.createTask).toHaveBeenCalledWith('queued prompt', {
      projectId: 'project-a',
    });
    expect(useTaskQueueStore.getState().getQueue('project-a')).toHaveLength(0);
    expect(draft.status).toBe('queued');
  });

  it('materializes and dequeues queued draft immediately after start scheduling', async () => {
    const draft = useTaskQueueStore.getState().enqueueDraft({
      projectId: 'project-a',
      sourceTaskId: 'task-1',
      prompt: 'queued prompt',
      planModeEnabled: true,
      ralphLoopEnabled: true,
      worktreeEnabled: true,
    });

    let resolveStartExecution: (() => void) | undefined;
    mocks.startExecution.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveStartExecution = resolve;
        })
    );

    const result = await taskQueueService.materializeDraft(draft);

    expect(result).toBe('task-queued');
    expect(mocks.updateTaskSettings).toHaveBeenCalledWith('task-queued', {
      planModeEnabled: true,
      ralphLoopEnabled: true,
      worktreeEnabled: true,
    });
    expect(useTaskQueueStore.getState().getQueue('project-a')).toHaveLength(0);
    expect(mocks.startExecution).toHaveBeenCalled();

    resolveStartExecution?.();
    await Promise.resolve();
  });

  it('continues with the next queued draft when startup fails after dequeue', async () => {
    useTaskQueueStore.getState().enqueueDraft({
      projectId: 'project-a',
      sourceTaskId: 'task-1',
      prompt: 'first prompt',
    });
    useTaskQueueStore.getState().enqueueDraft({
      projectId: 'project-a',
      sourceTaskId: 'task-queued',
      prompt: 'second prompt',
    });

    mocks.startExecution.mockRejectedValueOnce(new Error('start failed')).mockResolvedValueOnce(undefined);

    const firstHead = useTaskQueueStore.getState().getHead('project-a');
    expect(firstHead).not.toBeNull();
    await taskQueueService.materializeDraft(firstHead!);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mocks.createTask).toHaveBeenCalledTimes(2);
    expect(mocks.createTask).toHaveBeenNthCalledWith(1, 'first prompt', {
      projectId: 'project-a',
    });
    expect(mocks.createTask).toHaveBeenNthCalledWith(2, 'second prompt', {
      projectId: 'project-a',
    });
    expect(useTaskQueueStore.getState().getQueue('project-a')).toHaveLength(0);
  });

  it('enqueues multiple prompts and marks them as command-origin queue items', async () => {
    const drafts = await taskQueueService.enqueuePrompts({
      projectId: 'project-a',
      sourceTaskId: 'task-1',
      prompts: ['first task', 'second task'],
      origin: 'command',
    });

    expect(drafts).toHaveLength(2);
    expect(drafts[0]?.origin).toBe('command');
    expect(drafts[1]?.origin).toBe('command');
    expect(useTaskQueueStore.getState().getQueue('project-a')).toHaveLength(1);
    expect(useTaskQueueStore.getState().getHead('project-a')?.sourceTaskId).toBe('task-queued');
    expect(mocks.createTask).toHaveBeenCalledWith('first task', {
      projectId: 'project-a',
    });
  });
});
