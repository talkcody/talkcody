import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const inboundUnsubscribe = vi.fn();
  const executionUnsubscribe = vi.fn();
  const editReviewUnsubscribe = vi.fn();

  const startAll = vi.fn().mockResolvedValue(undefined);
  const stopAll = vi.fn().mockResolvedValue(undefined);
  const onInbound = vi.fn().mockReturnValue(inboundUnsubscribe);
  const sendMessage = vi.fn().mockResolvedValue({ messageId: '1' });
  const editMessage = vi.fn().mockResolvedValue(undefined);
  const executionListener = vi.fn();

  const executionSubscribe = vi.fn().mockImplementation((listener) => {
    mocks.executionListener = listener;
    return executionUnsubscribe;
  });
  const useExecutionStore = Object.assign(vi.fn(), {
    subscribe: executionSubscribe,
    getState: vi.fn().mockReturnValue({
      getExecution: vi.fn(),
    }),
  });

  const editReviewSubscribe = vi.fn().mockReturnValue(editReviewUnsubscribe);
  const useEditReviewStore = Object.assign(vi.fn(), {
    subscribe: editReviewSubscribe,
    getState: vi.fn().mockReturnValue({
      pendingEdits: new Map(),
    }),
  });

  const useTaskStore = Object.assign(vi.fn(), {
    getState: vi.fn().mockReturnValue({
      getMessages: vi.fn().mockReturnValue([]),
    }),
  });

  const useSettingsStore = Object.assign(vi.fn(), {
    getState: vi.fn().mockReturnValue({
      language: 'en',
    }),
  });

  const settingsManager = {
    getAgentId: vi.fn().mockResolvedValue('planner'),
    getProject: vi.fn().mockResolvedValue('project-1'),
    getPlanModeEnabled: vi.fn().mockResolvedValue(false),
    set: vi.fn().mockResolvedValue(undefined),
    setAssistant: vi.fn().mockResolvedValue(undefined),
    setCurrentProjectId: vi.fn().mockResolvedValue(undefined),
    setCurrentRootPath: vi.fn(),
  };

  const modelService = {
    getCurrentModel: vi.fn().mockResolvedValue('gpt-4@openai'),
    isModelAvailable: vi.fn().mockResolvedValue(true),
    getAvailableModels: vi.fn().mockResolvedValue([
      { key: 'gpt-4', name: 'GPT-4', provider: 'openai' },
    ]),
  };

  const agentRegistry = {
    getWithResolvedTools: vi.fn().mockResolvedValue({ id: 'planner' }),
    listAll: vi.fn().mockResolvedValue([
      { id: 'planner', name: 'Planner', hidden: false },
      { id: 'hidden', name: 'Hidden', hidden: true },
    ]),
    isSystemAgentEnabled: vi.fn().mockReturnValue(true),
  };

  const databaseService = {
    getProject: vi.fn().mockResolvedValue({ id: 'project-1', name: 'Project One' }),
    getProjects: vi.fn().mockResolvedValue([
      { id: 'project-1', name: 'Project One' },
      { id: 'project-2', name: 'Project Two' },
    ]),
  };

  const commandRegistry = {
    initialize: vi.fn().mockResolvedValue(undefined),
  };

  const commandExecutor = {
    parseCommand: vi.fn().mockReturnValue({ isValid: false }),
    executeCommand: vi.fn().mockResolvedValue(undefined),
  };

  return {
    inboundUnsubscribe,
    executionUnsubscribe,
    editReviewUnsubscribe,
    startAll,
    stopAll,
    onInbound,
    sendMessage,
    editMessage,
    executionSubscribe,
    executionListener,
    editReviewSubscribe,
    useExecutionStore,
    useEditReviewStore,
    useTaskStore,
    useSettingsStore,
    settingsManager,
    modelService,
    agentRegistry,
    databaseService,
    commandRegistry,
    commandExecutor,
  };
});

vi.mock('@/services/remote/remote-channel-manager', () => ({
  remoteChannelManager: {
    startAll: mocks.startAll,
    stopAll: mocks.stopAll,
    onInbound: mocks.onInbound,
    sendMessage: mocks.sendMessage,
    editMessage: mocks.editMessage,
  },
}));

vi.mock('@/stores/execution-store', () => ({
  useExecutionStore: mocks.useExecutionStore,
}));

vi.mock('@/stores/edit-review-store', () => ({
  useEditReviewStore: mocks.useEditReviewStore,
}));

vi.mock('@/stores/settings-store', () => ({
  settingsManager: mocks.settingsManager,
  useSettingsStore: mocks.useSettingsStore,
}));

vi.mock('@/providers/stores/provider-store', () => ({
  modelService: mocks.modelService,
}));

vi.mock('@/services/agents/agent-registry', () => ({
  agentRegistry: mocks.agentRegistry,
}));

vi.mock('@/services/database-service', () => ({
  databaseService: mocks.databaseService,
}));

vi.mock('@/services/commands/command-registry', () => ({
  commandRegistry: mocks.commandRegistry,
}));

vi.mock('@/services/commands/command-executor', () => ({
  commandExecutor: mocks.commandExecutor,
}));

vi.mock('@/stores/task-store', () => ({
  useTaskStore: mocks.useTaskStore,
}));

vi.mock('@/locales', () => ({
  getLocale: vi.fn().mockReturnValue({
    RemoteControl: {
      help: 'help',
      unknownCommand: 'unknown',
      processing: 'processing',
      accepted: 'accepted',
      completed: 'completed',
      failed: 'failed',
      noActiveTask: 'noActiveTask',
      noPendingApproval: 'noPendingApproval',
      approved: 'approved',
      rejected: 'rejected',
      stopped: 'stopped',
      gatewayError: (message: string) => `gateway:${message}`,
      approvalPrompt: (filePath: string) => `approve:${filePath}`,
      status: (status: string) => `status:${status}`,
      statusDetail: ({ projectDisplay, model, agentId, planModeEnabled, taskStatus, setProjectHint }: {
        projectDisplay: string;
        model: string;
        agentId: string;
        planModeEnabled: boolean;
        taskStatus: string;
        setProjectHint: string;
      }) =>
        `detail:${projectDisplay}:${model}:${agentId}:${planModeEnabled ? '1' : '0'}:${taskStatus}:${setProjectHint}`,
      setProjectHint: 'setProjectHint',
      listUsage: 'listUsage',
      listProjectsTitle: 'listProjectsTitle',
      listModelsTitle: 'listModelsTitle',
      listAgentsTitle: 'listAgentsTitle',
      listEmpty: 'listEmpty',
      listError: 'listError',
      missingModelArg: 'missingModelArg',
      invalidModel: (model: string) => `invalidModel:${model}`,
      modelSwitched: (model: string) => `modelSwitched:${model}`,
      missingProjectArg: 'missingProjectArg',
      invalidProject: (projectId: string) => `invalidProject:${projectId}`,
      projectSwitched: (projectId: string) => `projectSwitched:${projectId}`,
      missingAgentArg: 'missingAgentArg',
      invalidAgent: (agentId: string) => `invalidAgent:${agentId}`,
      agentSwitched: (agentId: string) => `agentSwitched:${agentId}`,
    },
  }),
}));

import { remoteChatService } from '@/services/remote/remote-chat-service';

describe('remote-chat-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const service = remoteChatService as {
      running: boolean;
      inboundUnsubscribe: (() => void) | null;
      executionUnsubscribe: (() => void) | null;
      executionStreamCancel: (() => void) | null;
      editReviewUnsubscribe: (() => void) | null;
      sessions: Map<string, unknown>;
      approvals: Map<string, unknown>;
      lastStreamContent: Map<string, string>;
    };
    service.running = false;
    service.inboundUnsubscribe = null;
    service.executionUnsubscribe = null;
    service.executionStreamCancel = null;
    service.editReviewUnsubscribe = null;
    service.sessions.clear();
    service.approvals.clear();
    service.lastStreamContent.clear();
  });

  it('unsubscribes listeners on stop', async () => {
    await remoteChatService.start();

    expect(mocks.startAll).toHaveBeenCalledTimes(1);
    expect(mocks.onInbound).toHaveBeenCalledTimes(1);
    expect(mocks.executionSubscribe).toHaveBeenCalledTimes(1);
    expect(mocks.editReviewSubscribe).toHaveBeenCalledTimes(1);

    await remoteChatService.stop();

    expect(mocks.inboundUnsubscribe).toHaveBeenCalledTimes(1);
    expect(mocks.executionUnsubscribe).toHaveBeenCalledTimes(1);
    expect(mocks.editReviewUnsubscribe).toHaveBeenCalledTimes(1);
    expect(mocks.stopAll).toHaveBeenCalledTimes(1);
  });

  it('streams updates while running', async () => {
    vi.useFakeTimers();
    const session = {
      channelId: 'telegram',
      chatId: '1',
      taskId: 'task-1',
      lastSentAt: 0,
      sentChunks: [],
      streamingMessageId: 'msg-1',
      lastStatusAck: 'running',
    };
    const execution = {
      taskId: 'task-1',
      status: 'running',
      streamingContent: 'hello world',
    };

    mocks.useExecutionStore.getState.mockReturnValue({
      getExecution: vi.fn().mockReturnValue(execution),
    });

    // @ts-expect-error - test setup
    remoteChatService.sessions.set('telegram:1', session);

    await remoteChatService.start();

    mocks.executionListener();
    vi.advanceTimersByTime(1100);

    expect(mocks.editMessage).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('sends terminal status after completion', async () => {
    vi.useFakeTimers();
    const session = {
      channelId: 'telegram',
      chatId: '1',
      taskId: 'task-1',
      lastSentAt: 0,
      sentChunks: [],
      streamingMessageId: 'msg-1',
      lastStatusAck: 'running',
    };
    const execution = {
      taskId: 'task-1',
      status: 'completed',
      streamingContent: 'done',
    };

    mocks.useExecutionStore.getState.mockReturnValue({
      getExecution: vi.fn().mockReturnValue(execution),
    });

    await remoteChatService.start();

    // @ts-expect-error - test setup
    remoteChatService.sessions.set('telegram:1', session);

    await mocks.executionListener();
    vi.advanceTimersByTime(1100);
    await Promise.resolve();

    expect(mocks.sendMessage).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('does not edit messages when stopped', async () => {
    const session = {
      channelId: 'telegram',
      chatId: '1',
      taskId: 'task-1',
      lastSentAt: 0,
      sentChunks: [],
      streamingMessageId: 'msg-1',
    };

    // @ts-expect-error - testing private method
    await remoteChatService.editMessage(session, 'update');

    expect(mocks.editMessage).not.toHaveBeenCalled();
  });

  it('reports detailed status', async () => {
    await remoteChatService.start();

    mocks.useExecutionStore.getState.mockReturnValue({
      getExecution: vi.fn().mockReturnValue({
        taskId: 'task-42',
        status: 'running',
        streamingContent: '',
      }),
    });

    // @ts-expect-error - test setup
    remoteChatService.sessions.set('telegram:1', {
      channelId: 'telegram',
      chatId: '1',
      taskId: 'task-42',
      lastSentAt: 0,
      sentChunks: [],
    });

    await remoteChatService.handleInboundMessage({
      channelId: 'telegram',
      chatId: '1',
      messageId: 'm1',
      text: '/status',
      date: Date.now(),
    });

    expect(mocks.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: 'telegram',
        chatId: '1',
        text: 'detail:Project One (project-1):gpt-4@openai:planner:0:running:setProjectHint',
      })
    );
  });

  it('switches model with /model', async () => {
    await remoteChatService.start();

    await remoteChatService.handleInboundMessage({
      channelId: 'telegram',
      chatId: '1',
      messageId: 'm2',
      text: '/model gpt-4@openai',
      date: Date.now(),
    });

    expect(mocks.modelService.isModelAvailable).toHaveBeenCalledWith('gpt-4@openai');
    expect(mocks.settingsManager.set).toHaveBeenCalledWith('model_type_main', 'gpt-4@openai');
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: 'telegram',
        chatId: '1',
        text: 'modelSwitched:gpt-4@openai',
      })
    );
  });

  it('switches project with /project', async () => {
    mocks.databaseService.getProject.mockResolvedValueOnce({
      id: 'project-2',
      name: 'Project Two',
      root_path: '/Users/kks/mygit/ai',
    });

    await remoteChatService.start();

    await remoteChatService.handleInboundMessage({
      channelId: 'telegram',
      chatId: '1',
      messageId: 'm3',
      text: '/project project-2',
      date: Date.now(),
    });

    expect(mocks.databaseService.getProject).toHaveBeenCalledWith('project-2');
    expect(mocks.settingsManager.setCurrentRootPath).toHaveBeenCalledWith('/Users/kks/mygit/ai');
    expect(mocks.settingsManager.setCurrentProjectId).toHaveBeenCalledWith('project-2');
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: 'telegram',
        chatId: '1',
        text: 'projectSwitched:project-2',
      })
    );
  });

  it('clears root path if project has no root_path', async () => {
    mocks.databaseService.getProject.mockResolvedValueOnce({
      id: 'project-3',
      name: 'Project Three',
    });

    await remoteChatService.start();

    await remoteChatService.handleInboundMessage({
      channelId: 'telegram',
      chatId: '1',
      messageId: 'm4',
      text: '/project project-3',
      date: Date.now(),
    });

    expect(mocks.databaseService.getProject).toHaveBeenCalledWith('project-3');
    expect(mocks.settingsManager.setCurrentRootPath).toHaveBeenCalledWith('');
    expect(mocks.settingsManager.setCurrentProjectId).toHaveBeenCalledWith('project-3');
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: 'telegram',
        chatId: '1',
        text: 'projectSwitched:project-3',
      })
    );
  });

  it('lists projects with /list -p', async () => {
    await remoteChatService.start();

    await remoteChatService.handleInboundMessage({
      channelId: 'telegram',
      chatId: '1',
      messageId: 'm5',
      text: '/list -p',
      date: Date.now(),
    });

    expect(mocks.databaseService.getProjects).toHaveBeenCalled();
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: 'telegram',
        chatId: '1',
        text: 'listProjectsTitle<br>Project One (project-1)<br>Project Two (project-2)',
      })
    );
  });

  it('lists models with /list -m', async () => {
    await remoteChatService.start();

    await remoteChatService.handleInboundMessage({
      channelId: 'telegram',
      chatId: '1',
      messageId: 'm6',
      text: '/list -m',
      date: Date.now(),
    });

    expect(mocks.modelService.getAvailableModels).toHaveBeenCalled();
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: 'telegram',
        chatId: '1',
        text: 'listModelsTitle<br>GPT-4 (gpt-4) - openai',
      })
    );
  });

  it('lists agents with /list -a', async () => {
    await remoteChatService.start();

    await remoteChatService.handleInboundMessage({
      channelId: 'telegram',
      chatId: '1',
      messageId: 'm7',
      text: '/list -a',
      date: Date.now(),
    });

    expect(mocks.agentRegistry.listAll).toHaveBeenCalled();
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: 'telegram',
        chatId: '1',
        text: 'listAgentsTitle<br>Planner (planner)',
      })
    );
  });
});
