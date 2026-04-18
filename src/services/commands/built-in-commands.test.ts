import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandType, type CommandContext } from '@/types/command';

const fsMocks = vi.hoisted(() => ({
  exists: vi.fn(),
  readTextFile: vi.fn(),
}));

const queueMocks = vi.hoisted(() => ({
  enqueuePrompts: vi.fn(),
}));

const taskServiceMocks = vi.hoisted(() => ({
  getTaskDetails: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: fsMocks.exists,
  readTextFile: fsMocks.readTextFile,
}));

vi.mock('@/services/context/manual-context-compaction', () => ({
  compactTaskContext: vi.fn(),
}));

vi.mock('@/services/task-queue-service', () => ({
  taskQueueService: {
    enqueuePrompts: queueMocks.enqueuePrompts,
  },
}));

vi.mock('@/services/task-service', () => ({
  taskService: {
    getTaskDetails: taskServiceMocks.getTaskDetails,
  },
}));

vi.mock('@/services/repository-utils', () => ({
  normalizeFilePath: vi.fn(async (_root: string, filePath: string) => `/repo/${filePath}`),
}));

vi.mock('@/services/workspace-root-service', () => ({
  getValidatedWorkspaceRoot: vi.fn(async () => '/repo'),
}));

vi.mock('@/stores/settings-store', () => ({
  useSettingsStore: {
    getState: () => ({
      getProject: () => 'project-a',
    }),
  },
}));

import { getBuiltInCommands } from './built-in-commands';

describe('getBuiltInCommands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsMocks.exists.mockResolvedValue(true);
    fsMocks.readTextFile.mockResolvedValue('- [ ] First task\n- [x] Done task\n- Second task');
    queueMocks.enqueuePrompts.mockResolvedValue([{ id: 'draft-1', origin: 'command' }]);
    taskServiceMocks.getTaskDetails.mockResolvedValue({ project_id: 'project-a' });
  });

  it('does not expose the memory command anymore', async () => {
    const commands = await getBuiltInCommands();

    expect(commands.find((command) => command.id === 'memory')).toBeUndefined();
    expect(commands.find((command) => command.name === 'memory')).toBeUndefined();
  });

  it('includes create-tool command with preferred agent and install guidance', async () => {
    const commands = await getBuiltInCommands();
    const createTool = commands.find((command) => command.id === 'create-tool');

    expect(createTool).toBeDefined();
    expect(createTool?.name).toBe('create-tool');
    expect(createTool?.type).toBe(CommandType.AI_PROMPT);
    expect(createTool?.preferredAgentId).toBe('create-tool');

    const result = await createTool?.executor({}, {} as CommandContext);
    expect(result?.success).toBe(true);
    expect(result?.continueProcessing).toBe(true);
    expect(result?.aiMessage).toContain('custom TalkCody tool');
    expect(result?.aiMessage).toContain('Custom Tools');
    expect(result?.aiMessage).toContain('Tool Playground');
  });

  it('includes create-agent command with preferred agent and registration guidance', async () => {
    const commands = await getBuiltInCommands();
    const createAgent = commands.find((command) => command.id === 'create-agent');

    expect(createAgent).toBeDefined();
    expect(createAgent?.name).toBe('create-agent');
    expect(createAgent?.type).toBe(CommandType.AI_PROMPT);
    expect(createAgent?.preferredAgentId).toBe('create-agent');

    const result = await createAgent?.executor({}, {} as CommandContext);
    expect(result?.success).toBe(true);
    expect(result?.continueProcessing).toBe(true);
    expect(result?.aiMessage).toContain('custom TalkCody agent');
    expect(result?.aiMessage).toContain('.talkcody/agents');
    expect(result?.aiMessage).toContain('writeFile tool');
  });

  it('includes create-skill command with preferred agent and skill guidance', async () => {
    const commands = await getBuiltInCommands();
    const createSkill = commands.find((command) => command.id === 'create-skill');

    expect(createSkill).toBeDefined();
    expect(createSkill?.name).toBe('create-skill');
    expect(createSkill?.type).toBe(CommandType.AI_PROMPT);
    expect(createSkill?.preferredAgentId).toBe('create-skill');

    const result = await createSkill?.executor({}, {} as CommandContext);
    expect(result?.success).toBe(true);
    expect(result?.continueProcessing).toBe(true);
    expect(result?.aiMessage).toContain('custom local TalkCody skill');
    expect(result?.aiMessage).toContain('SKILL.md');
    expect(result?.aiMessage).toContain('AgentSkillService.getSkillsDirPath');
  });

  it('imports unchecked markdown todos into the queue', async () => {
    const commands = await getBuiltInCommands();
    const importTasks = commands.find((command) => command.id === 'import-tasks');

    const result = await importTasks?.executor({ _raw: 'tasks.md' }, { taskId: 'task-1' } as CommandContext);

    expect(result?.success).toBe(true);
    expect(result?.message).toContain('Imported 1 tasks');
    expect(queueMocks.enqueuePrompts).toHaveBeenCalledWith({
      projectId: 'project-a',
      sourceTaskId: 'task-1',
      prompts: ['First task'],
      repositoryPath: undefined,
      selectedFile: undefined,
      selectedFileContent: undefined,
      origin: 'command',
    });
  });

  it('ignores non-todo markdown bullets during import', async () => {
    fsMocks.readTextFile.mockResolvedValue('- [ ] Real task\n- note bullet\n* another note\n+ [ ] Second task');
    queueMocks.enqueuePrompts.mockResolvedValue([
      { id: 'draft-1', origin: 'command' },
      { id: 'draft-2', origin: 'command' },
    ]);
    const commands = await getBuiltInCommands();
    const importTasks = commands.find((command) => command.id === 'import-tasks');

    const result = await importTasks?.executor({ _raw: 'tasks.md' }, { taskId: 'task-1' } as CommandContext);

    expect(result?.success).toBe(true);
    expect(queueMocks.enqueuePrompts).toHaveBeenCalledWith(
      expect.objectContaining({
        prompts: ['Real task', 'Second task'],
      })
    );
  });

  it('uses the current project when importing without an active task', async () => {
    const commands = await getBuiltInCommands();
    const importTasks = commands.find((command) => command.id === 'import-tasks');

    const result = await importTasks?.executor({ _raw: 'tasks.md' }, {} as CommandContext);

    expect(result?.success).toBe(true);
    expect(queueMocks.enqueuePrompts).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'project-a',
        sourceTaskId: null,
      })
    );
  });

  it('returns a clear error when the tasks file is missing', async () => {
    fsMocks.exists.mockResolvedValue(false);
    const commands = await getBuiltInCommands();
    const importTasks = commands.find((command) => command.id === 'import-tasks');

    const result = await importTasks?.executor({ _raw: 'missing tasks.md' }, { taskId: 'task-1' } as CommandContext);

    expect(result?.success).toBe(false);
    expect(result?.error).toContain('Tasks file not found');
  });

  it('returns a clear error when the markdown has no actionable todos', async () => {
    fsMocks.readTextFile.mockResolvedValue('## Notes\n- [x] done');
    const commands = await getBuiltInCommands();
    const importTasks = commands.find((command) => command.id === 'import-tasks');

    const result = await importTasks?.executor({ _raw: 'tasks.md' }, { taskId: 'task-1' } as CommandContext);

    expect(result?.success).toBe(false);
    expect(result?.error).toContain('No actionable todo items found');
  });
});
