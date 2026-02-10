import { invoke } from '@tauri-apps/api/core';
import { logger } from '@/lib/logger';
import { throttle } from '@/lib/utils/throttle';
import { getLocale, type SupportedLocale } from '@/locales';
import { modelService } from '@/providers/stores/provider-store';
import { agentRegistry } from '@/services/agents/agent-registry';
import { commandExecutor } from '@/services/commands/command-executor';
import { commandRegistry } from '@/services/commands/command-registry';
import { databaseService } from '@/services/database-service';
import { executionService } from '@/services/execution-service';
import { messageService } from '@/services/message-service';
import { remoteChannelManager } from '@/services/remote/remote-channel-manager';
import { remoteMediaService } from '@/services/remote/remote-media-service';
import { formatMessageForChannel } from '@/services/remote/remote-message-format';
import {
  getRemoteMessageLimit,
  isDuplicateRemoteMessage,
  normalizeRemoteCommand,
  splitRemoteText,
} from '@/services/remote/remote-text-utils';
import { taskService } from '@/services/task-service';
import { useEditReviewStore } from '@/stores/edit-review-store';
import { type ExecutionStatus, useExecutionStore } from '@/stores/execution-store';
import { settingsManager, useSettingsStore } from '@/stores/settings-store';
import { useTaskStore } from '@/stores/task-store';
import type { CommandContext } from '@/types/command';
import type {
  FeishuGatewayStatus,
  RemoteInboundMessage,
  RemoteSendMessageRequest,
  TelegramGatewayStatus,
} from '@/types/remote-control';
import type { TaskSettings } from '@/types/task';

const STREAM_THROTTLE_MS = 1000;
const TELEGRAM_STREAM_EDIT_LIMIT = 3800;
const TELEGRAM_DEDUP_TTL_MS = 5 * 60 * 1000;
const FEISHU_STREAM_EDIT_LIMIT = 3600;

interface ChatSessionState {
  channelId: RemoteInboundMessage['channelId'];
  chatId: string;
  taskId: string;
  lastMessageId?: string;
  lastSentAt: number;
  streamingMessageId?: string;
  sentChunks: string[];
  lastStreamStatus?: ExecutionStatus;
  lastStatusAck?: ExecutionStatus | 'accepted';
  streamMode?: 'edit' | 'append';
  lastDeliveredContent?: string;
}

interface PendingApprovalState {
  channelId: RemoteInboundMessage['channelId'];
  chatId: string;
  taskId: string;
  editId: string;
  filePath: string;
  messageId?: string;
}

function buildSessionKey(channelId: string, chatId: string): string {
  return `${channelId}:${chatId}`;
}

class RemoteChatService {
  private executionUnsubscribe: (() => void) | null = null;
  private executionStreamCancel: (() => void) | null = null;
  private editReviewUnsubscribe: (() => void) | null = null;
  private running = false;
  private sessions = new Map<string, ChatSessionState>();
  private approvals = new Map<string, PendingApprovalState>();
  private lastStreamContent = new Map<string, string>();
  private inboundUnsubscribe: (() => void) | null = null;

  async start(): Promise<void> {
    if (this.running) return;

    logger.info('[RemoteChatService] Start');
    await remoteChannelManager.startAll();
    this.running = true;

    if (!this.inboundUnsubscribe) {
      this.inboundUnsubscribe = remoteChannelManager.onInbound((message) => {
        this.handleInboundMessage(message).catch(console.error);
      });
    }

    this.attachExecutionStreamListener();
    this.attachEditReviewListener();
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    logger.info('[RemoteChatService] Stop');
    if (this.inboundUnsubscribe) {
      this.inboundUnsubscribe();
      this.inboundUnsubscribe = null;
    }

    if (this.executionUnsubscribe) {
      this.executionStreamCancel?.();
      this.executionUnsubscribe();
      this.executionUnsubscribe = null;
      this.executionStreamCancel = null;
    }

    if (this.editReviewUnsubscribe) {
      this.editReviewUnsubscribe();
      this.editReviewUnsubscribe = null;
    }

    await remoteChannelManager.stopAll();
  }

  async refresh(): Promise<void> {
    await this.stop();
    await this.start();
  }

  async handleInboundMessage(message: RemoteInboundMessage): Promise<void> {
    logger.debug('[RemoteChatService] Inbound message', {
      channelId: message.channelId,
      chatId: message.chatId,
      messageId: message.messageId,
      textLen: message.text.length,
      attachments: message.attachments?.length ?? 0,
    });
    if (
      isDuplicateRemoteMessage(
        message.channelId,
        message.chatId,
        message.messageId,
        TELEGRAM_DEDUP_TTL_MS
      )
    ) {
      logger.debug('[RemoteChatService] Duplicate message ignored', {
        channelId: message.channelId,
        chatId: message.chatId,
        messageId: message.messageId,
      });
      return;
    }

    const trimmedText = message.text.trim();
    if (trimmedText.startsWith('/')) {
      logger.debug('[RemoteChatService] Command detected', { command: trimmedText });
      await this.handleCommand(message, trimmedText);
      return;
    }

    await this.handlePrompt(message);
  }

  private async handleCommand(message: RemoteInboundMessage, text: string): Promise<void> {
    const normalized = normalizeRemoteCommand(text);
    const [command, ...rest] = normalized.split(' ');
    const args = rest.join(' ').trim();

    if (command === '/approve') {
      logger.info('[RemoteChatService] Approve command');
      await this.handleApprove(message, true, args);
      return;
    }

    if (command === '/reject') {
      logger.info('[RemoteChatService] Reject command');
      await this.handleApprove(message, false, args);
      return;
    }

    if (command === '/new') {
      logger.info('[RemoteChatService] New task command');
      await this.resetSession(message.channelId, message.chatId, args || 'Remote task');
      await this.handlePrompt({ ...message, text: args || '' });
      return;
    }

    if (command === '/status') {
      logger.info('[RemoteChatService] Status command');
      await this.handleStatus(message);
      return;
    }

    if (command === '/model') {
      logger.info('[RemoteChatService] Model switch command');
      await this.handleModelSwitch(message, args);
      return;
    }

    if (command === '/project') {
      logger.info('[RemoteChatService] Project switch command');
      await this.handleProjectSwitch(message, args);
      return;
    }

    if (command === '/agent') {
      logger.info('[RemoteChatService] Agent switch command');
      await this.handleAgentSwitch(message, args);
      return;
    }

    if (command === '/list') {
      logger.info('[RemoteChatService] List command');
      await this.handleList(message, args);
      return;
    }

    if (command === '/help') {
      logger.info('[RemoteChatService] Help command');
      await this.sendMessage(message, this.getLocaleText().RemoteControl.help);
      return;
    }

    try {
      await commandRegistry.initialize();
      const parsed = commandExecutor.parseCommand(normalized);
      if (parsed.isValid && parsed.command) {
        await this.executeCommand(parsed.command.name, parsed.rawArgs, message);
        return;
      }
    } catch (error) {
      logger.warn('[RemoteChatService] Failed to execute command', error);
    }

    await this.sendMessage(message, this.getLocaleText().RemoteControl.unknownCommand);
  }

  private async executeCommand(
    commandName: string,
    rawArgs: string,
    message: RemoteInboundMessage
  ): Promise<void> {
    const session = await this.getOrCreateSession(message.channelId, message.chatId, message.text);
    logger.info('[RemoteChatService] Executing command', {
      commandName,
      taskId: session.taskId,
    });
    const parsed = commandExecutor.parseCommand(`/${commandName} ${rawArgs}`);
    if (!parsed.command) {
      await this.sendMessage(message, this.getLocaleText().RemoteControl.unknownCommand);
      return;
    }

    const context: CommandContext = {
      taskId: session.taskId,
      sendMessage: async (reply) => {
        await this.sendMessage(message, reply);
      },
      createNewTask: async () => {
        const taskId = await taskService.createTask('Remote command');
        await taskService.selectTask(taskId);
        session.taskId = taskId;
      },
    };

    await commandExecutor.executeCommand(parsed, context);
  }

  private async handlePrompt(message: RemoteInboundMessage): Promise<void> {
    const session = await this.getOrCreateSession(message.channelId, message.chatId, message.text);

    logger.info('[RemoteChatService] Handling prompt', {
      channelId: message.channelId,
      chatId: message.chatId,
      taskId: session.taskId,
    });

    session.streamingMessageId = undefined;

    const statusText = this.getLocaleText().RemoteControl.accepted;
    const statusMessage = await this.sendMessage(message, statusText);
    logger.debug('[RemoteChatService] Sent acceptance message', {
      channelId: message.channelId,
      chatId: message.chatId,
      messageId: statusMessage.messageId,
    });
    session.streamingMessageId = statusMessage.messageId;
    session.lastMessageId = statusMessage.messageId;
    session.sentChunks = [statusText];
    session.lastStreamStatus = undefined;
    session.lastStatusAck = 'accepted';

    const taskSettings: TaskSettings = { autoApprovePlan: true };
    await taskService.updateTaskSettings(session.taskId, taskSettings);

    const mediaResult = await remoteMediaService.prepareInboundMessage(message);
    const promptText = mediaResult.text.trim();

    if (!promptText && mediaResult.attachments.length === 0) {
      logger.debug('[RemoteChatService] Empty prompt after media processing', {
        channelId: message.channelId,
        chatId: message.chatId,
      });
      if (session.streamingMessageId) {
        await this.editMessage(session, this.getLocaleText().RemoteControl.noActiveTask);
        session.sentChunks = [];
      }
      return;
    }

    await messageService.addUserMessage(session.taskId, promptText, {
      attachments: mediaResult.attachments,
    });

    const agentId = await settingsManager.getAgentId();
    let agent = await agentRegistry.getWithResolvedTools(agentId);
    if (!agent) {
      agent = await agentRegistry.getWithResolvedTools('planner');
    }
    const model = await modelService.getCurrentModel();

    const messages = useTaskStore.getState().getMessages(session.taskId);

    const systemPrompt = typeof agent?.systemPrompt === 'string' ? agent.systemPrompt : undefined;

    await executionService.startExecution({
      taskId: session.taskId,
      messages,
      model,
      systemPrompt,
      tools: agent?.tools,
      agentId,
      isNewTask: false,
      userMessage: promptText,
    });

    logger.info('[RemoteChatService] Execution started', {
      taskId: session.taskId,
      model,
    });

    const processingText = this.getLocaleText().RemoteControl.processing;
    if (session.streamingMessageId) {
      await this.editMessage(session, processingText);
      session.sentChunks = [processingText];
    } else {
      const statusMessage = await this.sendMessage(message, processingText);
      session.streamingMessageId = statusMessage.messageId;
      session.lastMessageId = statusMessage.messageId;
      session.sentChunks = [processingText];
    }
    session.lastStatusAck = 'running';
    session.lastStreamStatus = undefined;
  }

  private async handleStatus(message: RemoteInboundMessage): Promise<void> {
    const session = this.sessions.get(buildSessionKey(message.channelId, message.chatId));
    const execution = session
      ? useExecutionStore.getState().getExecution(session.taskId)
      : undefined;
    const taskStatus = execution?.status || 'idle';

    const localeText = this.getLocaleText();
    const projectId = await settingsManager.getProject();
    const agentId = await settingsManager.getAgentId();
    const planModeEnabled = await settingsManager.getPlanModeEnabled();

    let projectDisplay = projectId || '-';
    if (projectId) {
      try {
        const project = await databaseService.getProject(projectId);
        if (project?.name) {
          projectDisplay = `${project.name} (${projectId})`;
        }
      } catch (error) {
        logger.warn('[RemoteChatService] Failed to resolve project for status', {
          projectId,
          error,
        });
      }
    }

    let model = '';
    try {
      model = await modelService.getCurrentModel();
    } catch (error) {
      logger.warn('[RemoteChatService] Failed to resolve current model for status', error);
    }

    const statusText = localeText.RemoteControl.statusDetail({
      projectDisplay,
      model: model || '-',
      agentId,
      planModeEnabled,
      taskStatus,
      setProjectHint: localeText.RemoteControl.setProjectHint,
    });
    await this.sendMessage(message, statusText);

    if (!execution) {
      logger.debug('[RemoteChatService] Status requested with no active task', {
        channelId: message.channelId,
        chatId: message.chatId,
      });
    }

    const gatewayStatus = await this.getGatewayStatus(message.channelId);
    if (gatewayStatus?.lastError) {
      const detail = localeText.RemoteControl.gatewayError(gatewayStatus.lastError);
      await this.sendMessage(message, detail);
    }
  }

  private async handleApprove(
    message: RemoteInboundMessage,
    approved: boolean,
    _args: string
  ): Promise<void> {
    const approval = this.approvals.get(buildSessionKey(message.channelId, message.chatId));
    if (!approval) {
      logger.debug('[RemoteChatService] Approve/reject with no pending approval', {
        channelId: message.channelId,
        chatId: message.chatId,
      });
      await this.sendMessage(message, this.getLocaleText().RemoteControl.noPendingApproval);
      return;
    }

    if (approved) {
      await useEditReviewStore.getState().approveEdit(approval.taskId);
      await this.sendMessage(message, this.getLocaleText().RemoteControl.approved);
    } else {
      await useEditReviewStore.getState().rejectEdit(approval.taskId, 'Rejected via remote chat');
      await this.sendMessage(message, this.getLocaleText().RemoteControl.rejected);
    }

    this.approvals.delete(buildSessionKey(message.channelId, message.chatId));
    logger.info('[RemoteChatService] Approval handled', {
      approved,
      taskId: approval.taskId,
    });
  }

  private async handleModelSwitch(message: RemoteInboundMessage, args: string): Promise<void> {
    const modelIdentifier = args.trim();
    if (!modelIdentifier) {
      await this.sendMessage(message, this.getLocaleText().RemoteControl.missingModelArg);
      return;
    }

    const isAvailable = await modelService.isModelAvailable(modelIdentifier);
    if (!isAvailable) {
      await this.sendMessage(
        message,
        this.getLocaleText().RemoteControl.invalidModel(modelIdentifier)
      );
      return;
    }

    await settingsManager.set('model_type_main', modelIdentifier);
    await this.sendMessage(
      message,
      this.getLocaleText().RemoteControl.modelSwitched(modelIdentifier)
    );
  }

  private async handleProjectSwitch(message: RemoteInboundMessage, args: string): Promise<void> {
    const projectId = args.trim();
    if (!projectId) {
      await this.sendMessage(message, this.getLocaleText().RemoteControl.missingProjectArg);
      return;
    }

    let project: { root_path?: string | null } | null = null;
    try {
      project = await databaseService.getProject(projectId);
    } catch (error) {
      logger.warn('[RemoteChatService] Project not found', {
        projectId,
        error,
      });
      await this.sendMessage(message, this.getLocaleText().RemoteControl.invalidProject(projectId));
      return;
    }

    const projectRoot = typeof project?.root_path === 'string' ? project.root_path : '';
    settingsManager.setCurrentRootPath(projectRoot || '');

    await settingsManager.setCurrentProjectId(projectId);
    await this.sendMessage(message, this.getLocaleText().RemoteControl.projectSwitched(projectId));
  }

  private async handleAgentSwitch(message: RemoteInboundMessage, args: string): Promise<void> {
    const agentId = args.trim();
    if (!agentId) {
      await this.sendMessage(message, this.getLocaleText().RemoteControl.missingAgentArg);
      return;
    }

    const agent = await agentRegistry.getWithResolvedTools(agentId);
    if (!agent) {
      await this.sendMessage(message, this.getLocaleText().RemoteControl.invalidAgent(agentId));
      return;
    }

    await settingsManager.setAssistant(agentId);
    await this.sendMessage(message, this.getLocaleText().RemoteControl.agentSwitched(agentId));
  }

  private async handleList(message: RemoteInboundMessage, args: string): Promise<void> {
    const localeText = this.getLocaleText();
    const tokens = args.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) {
      await this.sendMessage(message, localeText.RemoteControl.listUsage);
      return;
    }

    const flags = new Set<'p' | 'm' | 'a'>();
    let invalid = false;
    for (const token of tokens) {
      if (!token.startsWith('-') || token === '-') {
        invalid = true;
        break;
      }
      for (const flag of token.slice(1)) {
        if (flag === 'p' || flag === 'm' || flag === 'a') {
          flags.add(flag);
        } else {
          invalid = true;
          break;
        }
      }
      if (invalid) break;
    }

    if (invalid || flags.size === 0) {
      await this.sendMessage(message, localeText.RemoteControl.listUsage);
      return;
    }

    const sections: string[] = [];
    const addSection = (title: string, lines: string[]) => {
      const body = lines.length > 0 ? lines.join('\n') : localeText.RemoteControl.listEmpty;
      sections.push(`${title}\n${body}`);
    };

    if (flags.has('p')) {
      try {
        const projects = await databaseService.getProjects();
        const lines = projects.map((project) => `${project.name} (${project.id})`);
        addSection(localeText.RemoteControl.listProjectsTitle, lines);
      } catch (error) {
        logger.warn('[RemoteChatService] Failed to list projects', error);
        sections.push(
          `${localeText.RemoteControl.listProjectsTitle}\n${localeText.RemoteControl.listError}`
        );
      }
    }

    if (flags.has('m')) {
      try {
        const models = await modelService.getAvailableModels();
        const lines = models.map((model) => `${model.name} (${model.key}) - ${model.provider}`);
        addSection(localeText.RemoteControl.listModelsTitle, lines);
      } catch (error) {
        logger.warn('[RemoteChatService] Failed to list models', error);
        sections.push(
          `${localeText.RemoteControl.listModelsTitle}\n${localeText.RemoteControl.listError}`
        );
      }
    }

    if (flags.has('a')) {
      try {
        const agents = await agentRegistry.listAll();
        const lines = agents
          .filter((agent) => !agent.hidden && agentRegistry.isSystemAgentEnabled(agent.id))
          .map((agent) => `${agent.name} (${agent.id})`);
        addSection(localeText.RemoteControl.listAgentsTitle, lines);
      } catch (error) {
        logger.warn('[RemoteChatService] Failed to list agents', error);
        sections.push(
          `${localeText.RemoteControl.listAgentsTitle}\n${localeText.RemoteControl.listError}`
        );
      }
    }

    await this.sendMessage(message, sections.join('\n\n'));
  }

  private async handleStop(message: RemoteInboundMessage): Promise<void> {
    const session = this.sessions.get(buildSessionKey(message.channelId, message.chatId));
    if (!session) {
      logger.debug('[RemoteChatService] Stop requested without active session', {
        channelId: message.channelId,
        chatId: message.chatId,
      });
      await this.sendMessage(message, this.getLocaleText().RemoteControl.noActiveTask);
      return;
    }

    executionService.stopExecution(session.taskId);
    await this.sendMessage(message, this.getLocaleText().RemoteControl.stopped);
  }

  private async getOrCreateSession(
    channelId: RemoteInboundMessage['channelId'],
    chatId: string,
    firstMessage: string
  ): Promise<ChatSessionState> {
    const key = buildSessionKey(channelId, chatId);
    let session = this.sessions.get(key);
    if (session) return session;

    const taskId = await taskService.createTask(firstMessage || 'Remote task');
    logger.info('[RemoteChatService] Created session', {
      channelId,
      chatId,
      taskId,
    });
    session = {
      channelId,
      chatId,
      taskId,
      lastSentAt: 0,
      sentChunks: [],
    };
    this.sessions.set(key, session);
    return session;
  }

  private async resetSession(
    channelId: RemoteInboundMessage['channelId'],
    chatId: string,
    firstMessage: string = ''
  ): Promise<void> {
    const key = buildSessionKey(channelId, chatId);
    const session = this.sessions.get(key);
    if (!session) {
      return;
    }

    logger.info('[RemoteChatService] Reset session', {
      channelId,
      chatId,
      taskId: session.taskId,
    });

    this.lastStreamContent.delete(session.taskId);
    session.streamingMessageId = undefined;
    session.lastMessageId = undefined;
    session.sentChunks = [];
    session.lastStreamStatus = undefined;
    session.lastStatusAck = undefined;
    session.lastSentAt = 0;
    session.streamMode = undefined;
    session.lastDeliveredContent = undefined;

    const newTaskId = await taskService.createTask(firstMessage || 'Remote task');
    session.taskId = newTaskId;
  }

  private attachExecutionStreamListener(): void {
    if (this.executionUnsubscribe) {
      return;
    }

    const onChange = throttle(() => {
      for (const [sessionKey, session] of this.sessions) {
        const execution = useExecutionStore.getState().getExecution(session.taskId);
        if (!execution) {
          continue;
        }

        if (execution.status !== 'running') {
          if (session.lastStreamStatus !== execution.status) {
            session.lastStreamStatus = execution.status;
            this.flushFinalStream(sessionKey, session).catch(console.error);
          }
          continue;
        }

        if (session.lastStatusAck !== 'running' && session.streamingMessageId) {
          const processingText = this.getLocaleText().RemoteControl.processing;
          this.editMessage(session, processingText).catch(console.error);
          session.lastStatusAck = 'running';
          session.sentChunks = [processingText];
        }

        const content = execution.streamingContent;
        if (!content) continue;

        const lastContent = this.lastStreamContent.get(session.taskId) || '';
        if (content === lastContent) continue;

        this.lastStreamContent.set(session.taskId, content);
        this.sendStreamUpdate(sessionKey, session, content).catch(console.error);
      }
    }, STREAM_THROTTLE_MS);

    this.executionStreamCancel = onChange.cancel;
    this.executionUnsubscribe = useExecutionStore.subscribe(onChange);
  }

  private async flushFinalStream(sessionKey: string, session: ChatSessionState): Promise<void> {
    const execution = useExecutionStore.getState().getExecution(session.taskId);
    if (!execution) {
      return;
    }

    const messages = useTaskStore.getState().getMessages(session.taskId);
    const lastAssistantMessage = messages
      .slice()
      .reverse()
      .find((m) => m.role === 'assistant');
    const content = lastAssistantMessage?.content?.toString() || execution.streamingContent || '';
    if (!content.trim()) {
      return;
    }

    // In append mode, send only the remaining delta as new messages
    if (session.streamMode === 'append') {
      await this.flushAppendFinal(session, content, execution.status);
      return;
    }

    const chunks = splitRemoteText(content, session.channelId);
    if (chunks.length === 0) {
      return;
    }

    const alreadySent = session.sentChunks.join('');
    if (alreadySent === content) {
      return;
    }

    if (session.streamingMessageId && chunks.length > 0) {
      const first = chunks[0] ?? '';
      if (first.trim()) {
        await this.editMessage(session, first);
        session.sentChunks = [first];
      }
    } else if (!session.streamingMessageId) {
      const first = chunks[0] ?? '';
      if (!first.trim()) {
        return;
      }
      const message = await this.sendMessage(
        { channelId: session.channelId, chatId: session.chatId } as RemoteInboundMessage,
        first
      );
      session.streamingMessageId = message.messageId;
      session.sentChunks = [first];
    }

    const startIndex = session.streamingMessageId ? 1 : 0;
    for (let i = startIndex; i < chunks.length; i += 1) {
      const chunk = chunks[i];
      if (!chunk) continue;
      await this.sendMessage(
        { channelId: session.channelId, chatId: session.chatId } as RemoteInboundMessage,
        chunk
      );
      session.sentChunks.push(chunk);
    }

    if (execution.status !== 'running' && session.lastStatusAck !== execution.status) {
      const statusText = this.getTerminalStatusText(execution.status);
      if (statusText) {
        await this.sendMessage(
          { channelId: session.channelId, chatId: session.chatId } as RemoteInboundMessage,
          statusText
        );
        session.lastStatusAck = execution.status;
      }
    }
  }

  /**
   * Flush final stream in append mode - send remaining delta without editing
   */
  private async flushAppendFinal(
    session: ChatSessionState,
    content: string,
    status: ExecutionStatus
  ): Promise<void> {
    const lastDelivered = session.lastDeliveredContent ?? '';
    const normalizedContent = content.trim();
    const normalizedLast = lastDelivered.trim();

    // Compute delta (remaining content)
    let delta: string;
    if (normalizedContent.startsWith(normalizedLast)) {
      delta = normalizedContent.slice(normalizedLast.length).trim();
    } else {
      delta = normalizedContent;
    }

    // Send delta if any
    if (delta) {
      const limit = getRemoteMessageLimit(session.channelId);
      const chunks = this.splitByPreference(delta, limit);

      for (const chunk of chunks) {
        if (!chunk.trim()) continue;
        const message = await this.sendMessage(
          { channelId: session.channelId, chatId: session.chatId } as RemoteInboundMessage,
          chunk
        );
        if (message.messageId) {
          session.streamingMessageId = message.messageId;
        }
        session.sentChunks.push(chunk);
      }
    }

    session.lastDeliveredContent = normalizedContent;

    // Always send terminal status
    if (status !== 'running' && session.lastStatusAck !== status) {
      const statusText = this.getTerminalStatusText(status);
      if (statusText) {
        await this.sendMessage(
          { channelId: session.channelId, chatId: session.chatId } as RemoteInboundMessage,
          statusText
        );
        session.lastStatusAck = status;
      }
    }
  }

  private attachEditReviewListener(): void {
    if (this.editReviewUnsubscribe) {
      return;
    }
    this.editReviewUnsubscribe = useEditReviewStore.subscribe((state) => {
      if (!this.running) {
        return;
      }
      for (const [taskId, entry] of state.pendingEdits.entries()) {
        const sessionEntry = Array.from(this.sessions.entries()).find(
          ([, value]) => value.taskId === taskId
        );
        if (!sessionEntry) continue;
        const [sessionKey, session] = sessionEntry;
        if (this.approvals.has(sessionKey)) continue;

        const pending = entry.pendingEdit;
        const prompt = this.getLocaleText().RemoteControl.approvalPrompt(pending.filePath);
        this.sendMessage(
          { channelId: session.channelId, chatId: session.chatId } as RemoteInboundMessage,
          prompt
        )
          .then((msg) => {
            this.approvals.set(sessionKey, {
              channelId: session.channelId,
              chatId: session.chatId,
              taskId,
              editId: entry.editId,
              filePath: pending.filePath,
              messageId: msg.messageId,
            });
          })
          .catch(console.error);
      }
    });
  }

  private async sendStreamUpdate(
    _sessionKey: string,
    session: ChatSessionState,
    content: string
  ): Promise<void> {
    const now = Date.now();
    if (now - session.lastSentAt < STREAM_THROTTLE_MS) {
      return;
    }

    session.lastSentAt = now;

    // In append mode (Feishu edit failed), send only the delta
    if (session.streamMode === 'append') {
      await this.sendAppendDelta(session, content);
      return;
    }

    const chunks = splitRemoteText(content, session.channelId);
    if (chunks.length === 0) {
      return;
    }

    const streamLimit =
      session.channelId === 'feishu' ? FEISHU_STREAM_EDIT_LIMIT : TELEGRAM_STREAM_EDIT_LIMIT;
    const firstChunk = chunks[0] ?? '';
    const streamingChunk = firstChunk.slice(0, streamLimit).trim();
    if (!streamingChunk) {
      return;
    }

    if (session.streamingMessageId) {
      // For Feishu, try edit but catch failure and switch to append mode
      if (session.channelId === 'feishu') {
        const editSuccess = await this.tryEditMessage(session, streamingChunk);
        if (!editSuccess) {
          // Switch to append mode and send delta
          session.streamMode = 'append';
          await this.sendAppendDelta(session, content);
          return;
        }
      } else {
        await this.editMessage(session, streamingChunk);
      }
      session.sentChunks = [streamingChunk];
      session.lastDeliveredContent = streamingChunk;
      return;
    }

    const message = await this.sendMessage(
      { channelId: session.channelId, chatId: session.chatId } as RemoteInboundMessage,
      streamingChunk
    );
    session.streamingMessageId = message.messageId;
    session.sentChunks = [streamingChunk];
    session.lastDeliveredContent = streamingChunk;
  }

  /**
   * Try to edit a message, return true if successful, false if failed
   */
  private async tryEditMessage(session: ChatSessionState, text: string): Promise<boolean> {
    if (!this.running || !text.trim() || !session.streamingMessageId) {
      return false;
    }
    try {
      const { text: formattedText, parseMode } = formatMessageForChannel(text, session.channelId);
      await remoteChannelManager.editMessage({
        channelId: session.channelId,
        chatId: session.chatId,
        messageId: session.streamingMessageId,
        text: formattedText,
        disableWebPagePreview: true,
        parseMode,
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Send only the delta (new content) when in append mode
   */
  private async sendAppendDelta(session: ChatSessionState, content: string): Promise<void> {
    const lastDelivered = session.lastDeliveredContent ?? '';
    const normalizedContent = content.trim();
    const normalizedLast = lastDelivered.trim();

    // If content doesn't start with last delivered, it might be a rewrite
    // In this case, send the full content as a new message
    let delta: string;
    if (normalizedContent.startsWith(normalizedLast)) {
      delta = normalizedContent.slice(normalizedLast.length).trim();
    } else {
      delta = normalizedContent;
    }

    if (!delta) {
      return;
    }

    // Split delta into chunks and send as new messages
    const limit = getRemoteMessageLimit(session.channelId);
    const chunks = this.splitByPreference(delta, limit);

    for (const chunk of chunks) {
      if (!chunk.trim()) continue;
      const message = await this.sendMessage(
        { channelId: session.channelId, chatId: session.chatId } as RemoteInboundMessage,
        chunk
      );
      if (message.messageId) {
        session.streamingMessageId = message.messageId;
      }
      session.sentChunks.push(chunk);
    }

    // Update last delivered content
    session.lastDeliveredContent = normalizedContent;
  }

  /**
   * Split text into chunks by preference (paragraphs, lines, sentences)
   */
  private splitByPreference(text: string, limit: number): string[] {
    if (text.length <= limit) {
      return [text];
    }

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > limit) {
      let sliceEnd = remaining.lastIndexOf('\n\n', limit);
      if (sliceEnd < 0) {
        sliceEnd = remaining.lastIndexOf('\n', limit);
      }
      if (sliceEnd < 0) {
        sliceEnd = remaining.lastIndexOf('. ', limit);
      }
      if (sliceEnd < 0 || sliceEnd < Math.floor(limit * 0.6)) {
        sliceEnd = limit;
      }

      chunks.push(remaining.slice(0, sliceEnd).trim());
      remaining = remaining.slice(sliceEnd).trim();
    }

    if (remaining.trim()) {
      chunks.push(remaining.trim());
    }

    return chunks.filter((chunk) => chunk.length > 0);
  }

  private getTerminalStatusText(status: ExecutionStatus): string | null {
    if (status === 'completed') {
      return this.getLocaleText().RemoteControl.completed;
    }
    if (status === 'error') {
      return this.getLocaleText().RemoteControl.failed;
    }
    if (status === 'stopped') {
      return this.getLocaleText().RemoteControl.stopped;
    }
    return null;
  }

  private async sendMessage(
    message: Pick<RemoteInboundMessage, 'channelId' | 'chatId'>,
    text: string
  ): Promise<{ messageId: string }> {
    if (!this.running) {
      return { messageId: '' };
    }
    logger.debug('[RemoteChatService] sendMessage', {
      channelId: message.channelId,
      chatId: message.chatId,
      textLen: text.length,
    });
    const { text: formattedText, parseMode } = formatMessageForChannel(text, message.channelId);
    const request: RemoteSendMessageRequest = {
      channelId: message.channelId,
      chatId: message.chatId,
      text: formattedText,
      disableWebPagePreview: true,
      parseMode,
    };
    return remoteChannelManager.sendMessage(request);
  }

  private async editMessage(session: ChatSessionState, text: string): Promise<void> {
    if (!this.running) {
      return;
    }
    if (!text.trim() || !session.streamingMessageId) {
      return;
    }
    logger.debug('[RemoteChatService] editMessage', {
      channelId: session.channelId,
      chatId: session.chatId,
      messageId: session.streamingMessageId,
      textLen: text.length,
    });
    const { text: formattedText, parseMode } = formatMessageForChannel(text, session.channelId);
    try {
      await remoteChannelManager.editMessage({
        channelId: session.channelId,
        chatId: session.chatId,
        messageId: session.streamingMessageId,
        text: formattedText,
        disableWebPagePreview: true,
        parseMode,
      });
    } catch (error) {
      logger.warn('[RemoteChatService] Failed to edit message', error);
      if (session.channelId !== 'feishu') {
        return;
      }
      const fallback = await this.sendMessage(
        { channelId: session.channelId, chatId: session.chatId } as RemoteInboundMessage,
        text
      );
      if (fallback.messageId) {
        session.streamingMessageId = fallback.messageId;
      }
    }
  }

  private async getGatewayStatus(
    channelId: RemoteInboundMessage['channelId']
  ): Promise<TelegramGatewayStatus | FeishuGatewayStatus | null> {
    if (channelId === 'telegram') {
      try {
        return await invoke('telegram_get_status');
      } catch (error) {
        logger.warn('[RemoteChatService] Failed to fetch telegram status', error);
        return null;
      }
    }

    if (channelId === 'feishu') {
      try {
        return await invoke('feishu_get_status');
      } catch (error) {
        logger.warn('[RemoteChatService] Failed to fetch feishu status', error);
        return null;
      }
    }

    return null;
  }

  private getLocaleText() {
    const language = (useSettingsStore.getState().language || 'en') as SupportedLocale;
    return getLocale(language);
  }
}

export const remoteChatService = new RemoteChatService();
