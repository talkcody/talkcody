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
        text: 'listProjectsTitle\nProject One (project-1)\nProject Two (project-2)',
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
        text: 'listModelsTitle\nGPT-4 (gpt-4) - openai',
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
        text: 'listAgentsTitle\nPlanner (planner)',
      })
    );
  });

  it('sends final complete answer from execution.streamingContent when task store has stale data', async () => {
    vi.useFakeTimers();

    // Simulate scenario where task store has stale content (tool call initial response)
    // but execution.streamingContent has the final complete answer
    const staleContent = '我来帮您查找关于康凯森的信息。\n';
    const finalContent =
      '我来帮您查找关于康凯森的信息。\n## Answer\n\n康凯森（Kaisen Kang）是一名**数据库工程师**。';

    const session = {
      channelId: 'telegram',
      chatId: '1',
      taskId: 'task-1',
      lastSentAt: 0,
      sentChunks: [staleContent], // Previously sent stale content during streaming
      streamingMessageId: 'msg-1',
      lastStatusAck: 'running',
      lastStreamStatus: 'running',
    };

    // Mock execution with final complete content
    const execution = {
      taskId: 'task-1',
      status: 'completed',
      streamingContent: finalContent,
    };

    mocks.useExecutionStore.getState.mockReturnValue({
      getExecution: vi.fn().mockReturnValue(execution),
    });

    // Mock task store with stale content (simulating race condition)
    mocks.useTaskStore.getState.mockReturnValue({
      getMessages: vi.fn().mockReturnValue([
        {
          id: 'msg-1',
          role: 'assistant',
          content: staleContent, // Stale content in task store
        },
      ]),
    });

    // @ts-expect-error - test setup
    remoteChatService.sessions.set('telegram:1', session);

    await remoteChatService.start();

    // Trigger the execution listener (simulating status change to completed)
    await mocks.executionListener();
    vi.advanceTimersByTime(1100);
    await Promise.resolve();

    // Should send the final complete content, not the stale content
    expect(mocks.editMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: 'telegram',
        chatId: '1',
        messageId: 'msg-1',
        text: expect.stringContaining('康凯森（Kaisen Kang）'),
      })
    );

    vi.useRealTimers();
  });

  it('sends final answer after tool call when content was partially streamed', async () => {
    vi.useFakeTimers();

    // Simulate tool call scenario:
    // 1. Initial streaming: "我来帮您查找..."
    // 2. Tool call happens
    // 3. Final answer generated with complete information
    const initialStreamingContent = '我来帮您查找关于康凯森的信息。\n';
    const finalCompleteContent = `我来帮您查找关于康凯森的信息。
## Answer

康凯森（Kaisen Kang）是一名**数据库工程师**，专注于OLAP数据库查询引擎领域。

## Supporting Details

**基本信息：**
- 毕业于西安电子科技大学
- 目前在 CelerData 工作

**技术成就：**
- StarRocks 核心开发者
- 个人网站：https://kangkaisen.com/`;

    const session = {
      channelId: 'telegram',
      chatId: '1',
      taskId: 'task-tool-call',
      lastSentAt: Date.now(),
      sentChunks: [initialStreamingContent],
      streamingMessageId: 'msg-tool-1',
      lastStatusAck: 'running',
      lastStreamStatus: 'running',
      lastDeliveredContent: initialStreamingContent,
    };

    // Execution completed with full content
    const execution = {
      taskId: 'task-tool-call',
      status: 'completed',
      streamingContent: finalCompleteContent,
    };

    mocks.useExecutionStore.getState.mockReturnValue({
      getExecution: vi.fn().mockReturnValue(execution),
    });

    // @ts-expect-error - test setup
    remoteChatService.sessions.set('telegram:1', session);

    await remoteChatService.start();

    // Trigger completion
    await mocks.executionListener();
    vi.advanceTimersByTime(1100);
    await Promise.resolve();

    // Verify editMessage is called with content containing final answer details
    const editCalls = mocks.editMessage.mock.calls;
    expect(editCalls.length).toBeGreaterThan(0);

    // Check that the edit contains the final answer content
    const lastEditCall = editCalls[editCalls.length - 1];
    expect(lastEditCall[0]).toMatchObject({
      channelId: 'telegram',
      chatId: '1',
      messageId: 'msg-tool-1',
    });
    expect(lastEditCall[0].text).toContain('StarRocks');
    expect(lastEditCall[0].text).toContain('CelerData');

    // Verify additional chunks are sent as new messages if content is long
    expect(mocks.sendMessage).toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('does not skip sending final content when alreadySent differs from execution content', async () => {
    vi.useFakeTimers();

    const streamingChunk = '我来帮您查找关于康凯森的信息。\n'.slice(0, 100);
    const finalContent =
      '我来帮您查找关于康凯森的信息。\n## Answer\n\n完整答案内容...';

    const session = {
      channelId: 'telegram',
      chatId: '1',
      taskId: 'task-2',
      lastSentAt: 0,
      sentChunks: [streamingChunk], // Truncated content sent during streaming
      streamingMessageId: 'msg-2',
      lastStatusAck: 'running',
      lastStreamStatus: 'running',
      lastDeliveredContent: streamingChunk,
    };

    const execution = {
      taskId: 'task-2',
      status: 'completed',
      streamingContent: finalContent,
    };

    mocks.useExecutionStore.getState.mockReturnValue({
      getExecution: vi.fn().mockReturnValue(execution),
    });

    // @ts-expect-error - test setup
    remoteChatService.sessions.set('telegram:1', session);

    await remoteChatService.start();

    await mocks.executionListener();
    vi.advanceTimersByTime(1100);
    await Promise.resolve();

    // Should not return early - should send the final content
    expect(mocks.editMessage).toHaveBeenCalled();

    vi.useRealTimers();
  });

  // Feishu-specific tests for append mode streaming
  describe('Feishu streaming append mode', () => {
    it('always uses append mode for Feishu streaming (never edits)', async () => {
      vi.useFakeTimers();

      const session = {
        channelId: 'feishu',
        chatId: 'user1',
        taskId: 'task-feishu-1',
        lastSentAt: 0,
        sentChunks: [],
        streamingMessageId: 'msg-1',
        lastStatusAck: 'running',
      };

      const execution = {
        taskId: 'task-feishu-1',
        status: 'running',
        streamingContent: 'Hello world',
      };

      mocks.useExecutionStore.getState.mockReturnValue({
        getExecution: vi.fn().mockReturnValue(execution),
      });

      // @ts-expect-error - test setup
      remoteChatService.sessions.set('feishu:user1', session);

      await remoteChatService.start();

      // Trigger streaming update
      await mocks.executionListener();
      vi.advanceTimersByTime(1100);
      await Promise.resolve();

      // Should NOT call editMessage for Feishu
      expect(mocks.editMessage).not.toHaveBeenCalled();

      // Should call sendMessage instead
      expect(mocks.sendMessage).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('sends only delta in Feishu append mode, not full content', async () => {
      vi.useFakeTimers();

      const session = {
        channelId: 'feishu',
        chatId: 'user1',
        taskId: 'task-feishu-2',
        lastSentAt: 0,
        sentChunks: ['Hello'],
        streamingMessageId: 'msg-2',
        lastStatusAck: 'running',
        lastDeliveredContent: 'Hello',
      };

      // Content that extends previous content
      const execution = {
        taskId: 'task-feishu-2',
        status: 'running',
        streamingContent: 'Hello world this is new',
      };

      mocks.useExecutionStore.getState.mockReturnValue({
        getExecution: vi.fn().mockReturnValue(execution),
      });

      // @ts-expect-error - test setup
      remoteChatService.sessions.set('feishu:user1', session);

      // Clear previous calls
      mocks.sendMessage.mockClear();

      await remoteChatService.start();

      // Trigger streaming update
      await mocks.executionListener();
      vi.advanceTimersByTime(1100);
      await Promise.resolve();

      // Get all sent messages
      const sentTexts = mocks.sendMessage.mock.calls.map((call) => call[0].text);
      const allSentText = sentTexts.join('');

      // Should NOT contain duplicated "HelloHello"
      expect(allSentText).not.toContain('HelloHello');

      // Should contain "world" (the delta part)
      expect(allSentText).toContain('world');

      vi.useRealTimers();
    });

    it('flushes final content in Feishu append mode without editing', async () => {
      vi.useFakeTimers();

      const session = {
        channelId: 'feishu',
        chatId: 'user1',
        taskId: 'task-feishu-3',
        lastSentAt: 0,
        sentChunks: ['Processing...'],
        streamingMessageId: 'msg-3',
        lastStatusAck: 'running',
        lastStreamStatus: 'running',
        lastDeliveredContent: 'Processing...',
      };

      const execution = {
        taskId: 'task-feishu-3',
        status: 'completed',
        streamingContent: 'Final answer is here with complete information',
      };

      mocks.useExecutionStore.getState.mockReturnValue({
        getExecution: vi.fn().mockReturnValue(execution),
      });

      // @ts-expect-error - test setup
      remoteChatService.sessions.set('feishu:user1', session);

      // Clear previous calls
      mocks.sendMessage.mockClear();
      mocks.editMessage.mockClear();

      await remoteChatService.start();

      // Trigger completion
      await mocks.executionListener();
      vi.advanceTimersByTime(1100);
      await Promise.resolve();

      // Should NOT call editMessage for Feishu
      expect(mocks.editMessage).not.toHaveBeenCalled();

      // Should send the remaining delta via sendMessage
      expect(mocks.sendMessage).toHaveBeenCalled();

      // Get all sent texts
      const sentTexts = mocks.sendMessage.mock.calls.map((call) => call[0].text);
      const allSentText = sentTexts.join('');

      // Should contain "Final answer" but not duplicated "Processing"
      expect(allSentText).toContain('Final answer');
      expect(allSentText).not.toContain('Processing...Processing');

      vi.useRealTimers();
    });

    it('handles content reset in Feishu when new content does not start with last delivered', async () => {
      vi.useFakeTimers();

      const session = {
        channelId: 'feishu',
        chatId: 'user1',
        taskId: 'task-feishu-4',
        lastSentAt: 0,
        sentChunks: ['Old content'],
        streamingMessageId: 'msg-4',
        lastStatusAck: 'running',
        lastDeliveredContent: 'Old content',
      };

      // New content that does NOT start with last delivered (complete rewrite)
      const execution = {
        taskId: 'task-feishu-4',
        status: 'running',
        streamingContent: 'Completely new rewritten content',
      };

      mocks.useExecutionStore.getState.mockReturnValue({
        getExecution: vi.fn().mockReturnValue(execution),
      });

      // @ts-expect-error - test setup
      remoteChatService.sessions.set('feishu:user1', session);

      // Clear previous calls
      mocks.sendMessage.mockClear();

      await remoteChatService.start();

      // Trigger streaming update
      await mocks.executionListener();
      vi.advanceTimersByTime(1100);
      await Promise.resolve();

      // Get all sent texts
      const sentTexts = mocks.sendMessage.mock.calls.map((call) => call[0].text);
      const allSentText = sentTexts.join('');

      // Should send the full new content (since it's a rewrite)
      expect(allSentText).toContain('Completely new rewritten content');

      vi.useRealTimers();
    });

    it('does not send empty delta in Feishu when content unchanged', async () => {
      vi.useFakeTimers();

      const session = {
        channelId: 'feishu',
        chatId: 'user1',
        taskId: 'task-feishu-5',
        lastSentAt: 0,
        sentChunks: ['Same content'],
        streamingMessageId: 'msg-5',
        lastStatusAck: 'running',
        lastDeliveredContent: 'Same content',
      };

      // Same content as last delivered
      const execution = {
        taskId: 'task-feishu-5',
        status: 'running',
        streamingContent: 'Same content',
      };

      mocks.useExecutionStore.getState.mockReturnValue({
        getExecution: vi.fn().mockReturnValue(execution),
      });

      // @ts-expect-error - test setup
      remoteChatService.sessions.set('feishu:user1', session);

      // Clear previous calls
      mocks.sendMessage.mockClear();

      await remoteChatService.start();

      // Trigger streaming update
      await mocks.executionListener();
      vi.advanceTimersByTime(1100);
      await Promise.resolve();

      // Should NOT send any message since delta is empty
      expect(mocks.sendMessage).not.toHaveBeenCalled();

      vi.useRealTimers();
    });
  });
});
