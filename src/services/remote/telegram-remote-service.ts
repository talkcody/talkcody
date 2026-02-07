import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { logger } from '@/lib/logger';
import { debounce } from '@/lib/utils/debounce';
import { getLocale, type SupportedLocale } from '@/locales';
import { modelService } from '@/providers/stores/provider-store';
import { agentRegistry } from '@/services/agents/agent-registry';
import { commandExecutor } from '@/services/commands/command-executor';
import { commandRegistry } from '@/services/commands/command-registry';
import { executionService } from '@/services/execution-service';
import { messageService } from '@/services/message-service';
import {
  isDuplicateTelegramMessage,
  normalizeTelegramCommand,
  splitTelegramText,
} from '@/services/remote/telegram-remote-utils';
import { taskService } from '@/services/task-service';
import { useEditReviewStore } from '@/stores/edit-review-store';
import { type ExecutionStatus, useExecutionStore } from '@/stores/execution-store';
import { settingsManager, useSettingsStore } from '@/stores/settings-store';
import { taskStore } from '@/stores/task-store';
import type { CommandContext } from '@/types/command';
import type {
  TelegramEditMessageRequest,
  TelegramGatewayStatus,
  TelegramInboundMessage,
  TelegramRemoteConfig,
  TelegramSendMessageRequest,
  TelegramSendMessageResponse,
} from '@/types/remote-control';
import type { TaskSettings } from '@/types/task';

const STREAM_THROTTLE_MS = 1000;
const TELEGRAM_MESSAGE_LIMIT = 4096;
const TELEGRAM_STREAM_EDIT_LIMIT = 3800;
const TELEGRAM_DEDUP_TTL_MS = 5 * 60 * 1000;

interface ChatSessionState {
  taskId: string;
  lastMessageId?: number;
  lastSentAt: number;
  streamingMessageId?: number;
  sentChunks: string[];
  lastStreamStatus?: ExecutionStatus;
}

interface PendingApprovalState {
  chatId: number;
  taskId: string;
  editId: string;
  filePath: string;
  messageId?: number;
}

class TelegramRemoteService {
  private inboundUnlisten: UnlistenFn | null = null;
  private executionUnsubscribe: (() => void) | null = null;
  private running = false;
  private sessions = new Map<number, ChatSessionState>();
  private approvals = new Map<string, PendingApprovalState>();
  private lastStreamContent = new Map<string, string>();

  async start(): Promise<void> {
    if (this.running) return;

    const config = await this.loadConfig();
    if (!config.enabled || !config.token) {
      logger.info('[TelegramRemoteService] Disabled or missing token');
      this.running = false;
      return;
    }

    this.running = true;

    await invoke('telegram_set_config', { config: this.toRustConfig(config) });
    await invoke('telegram_start');

    this.inboundUnlisten = await listen<TelegramInboundMessage>(
      'telegram-inbound-message',
      (event) => {
        this.handleInboundMessage(event.payload).catch(console.error);
      }
    );

    this.attachExecutionStreamListener();
    this.attachEditReviewListener();
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    if (this.inboundUnlisten) {
      this.inboundUnlisten();
      this.inboundUnlisten = null;
    }

    await invoke('telegram_stop');
  }

  async refresh(): Promise<void> {
    await this.stop();
    await this.start();
  }

  async handleInboundMessage(message: TelegramInboundMessage): Promise<void> {
    if (isDuplicateTelegramMessage(message.chatId, message.messageId, TELEGRAM_DEDUP_TTL_MS)) {
      return;
    }
    const text = message.text.trim();
    if (!text) return;

    if (text.startsWith('/')) {
      await this.handleCommand(message, text);
      return;
    }

    await this.handlePrompt(message, text);
  }

  private async handleCommand(message: TelegramInboundMessage, text: string): Promise<void> {
    const normalized = normalizeTelegramCommand(text);
    const [command, ...rest] = normalized.split(' ');
    const args = rest.join(' ').trim();

    if (command === '/approve') {
      await this.handleApprove(message, true, args);
      return;
    }

    if (command === '/reject') {
      await this.handleApprove(message, false, args);
      return;
    }

    if (command === '/new') {
      await this.resetSession(message.chatId);
      await this.handlePrompt(message, args || '');
      return;
    }

    if (command === '/status') {
      await this.handleStatus(message);
      return;
    }

    if (command === '/stop') {
      await this.handleStop(message);
      return;
    }

    if (command === '/help') {
      await this.sendMessage(message.chatId, this.getLocaleText().RemoteControl.help);
      return;
    }

    // Forward unknown commands to command registry when possible
    try {
      await commandRegistry.initialize();
      const parsed = commandExecutor.parseCommand(normalized);
      if (parsed.isValid && parsed.command) {
        await this.executeCommand(parsed.command.name, parsed.rawArgs, message);
        return;
      }
    } catch (error) {
      logger.warn('[TelegramRemoteService] Failed to execute command', error);
    }

    await this.sendMessage(message.chatId, this.getLocaleText().RemoteControl.unknownCommand);
  }

  private async executeCommand(
    commandName: string,
    rawArgs: string,
    message: TelegramInboundMessage
  ): Promise<void> {
    const session = await this.getOrCreateSession(message.chatId, message.text);
    const parsed = commandExecutor.parseCommand(`/${commandName} ${rawArgs}`);
    if (!parsed.command) {
      await this.sendMessage(message.chatId, this.getLocaleText().RemoteControl.unknownCommand);
      return;
    }

    const context: CommandContext = {
      taskId: session.taskId,
      sendMessage: async (reply) => {
        await this.sendMessage(message.chatId, reply);
      },
      createNewTask: async () => {
        const taskId = await taskService.createTask('Remote command');
        await taskService.selectTask(taskId);
        session.taskId = taskId;
      },
    };

    await commandExecutor.executeCommand(parsed, context);
  }

  private async handlePrompt(message: TelegramInboundMessage, text: string): Promise<void> {
    const session = await this.getOrCreateSession(message.chatId, text);

    const taskSettings: TaskSettings = { autoApprovePlan: true };
    await taskService.updateTaskSettings(session.taskId, taskSettings);

    await messageService.addUserMessage(session.taskId, text, {});

    const agentId = await settingsManager.getAgentId();
    let agent = await agentRegistry.getWithResolvedTools(agentId);
    if (!agent) {
      agent = await agentRegistry.getWithResolvedTools('planner');
    }
    const model = await modelService.getCurrentModel();

    const messages = taskStore.getState().getMessages(session.taskId);

    const systemPrompt = typeof agent?.systemPrompt === 'string' ? agent.systemPrompt : undefined;

    await executionService.startExecution({
      taskId: session.taskId,
      messages,
      model,
      systemPrompt,
      tools: agent?.tools,
      agentId: agent?.id ?? agentId,
      isNewTask: false,
      userMessage: text,
    });

    const statusText = this.getLocaleText().RemoteControl.processing;
    const statusMessage = await this.sendMessage(message.chatId, statusText);
    session.streamingMessageId = statusMessage.messageId;
    session.lastMessageId = statusMessage.messageId;
    session.sentChunks = [statusText];
  }

  private async handleStatus(message: TelegramInboundMessage): Promise<void> {
    const session = this.sessions.get(message.chatId);
    const execution = session
      ? useExecutionStore.getState().getExecution(session.taskId)
      : undefined;
    if (!execution) {
      await this.sendMessage(message.chatId, this.getLocaleText().RemoteControl.noActiveTask);
      return;
    }

    const statusText = this.getLocaleText().RemoteControl.status(execution.status);
    await this.sendMessage(message.chatId, statusText);

    const gatewayStatus = await this.getGatewayStatus();
    if (gatewayStatus?.lastError) {
      const detail = this.getLocaleText().RemoteControl.gatewayError(gatewayStatus.lastError);
      await this.sendMessage(message.chatId, detail);
    }
  }

  private async handleApprove(
    message: TelegramInboundMessage,
    approved: boolean,
    _args: string
  ): Promise<void> {
    const approval = this.approvals.get(String(message.chatId));
    if (!approval) {
      await this.sendMessage(message.chatId, this.getLocaleText().RemoteControl.noPendingApproval);
      return;
    }

    if (approved) {
      await useEditReviewStore.getState().approveEdit(approval.taskId);
      await this.sendMessage(message.chatId, this.getLocaleText().RemoteControl.approved);
    } else {
      await useEditReviewStore.getState().rejectEdit(approval.taskId, 'Rejected via Telegram');
      await this.sendMessage(message.chatId, this.getLocaleText().RemoteControl.rejected);
    }

    this.approvals.delete(String(message.chatId));
  }

  private async handleStop(message: TelegramInboundMessage): Promise<void> {
    const session = this.sessions.get(message.chatId);
    if (!session) {
      await this.sendMessage(message.chatId, this.getLocaleText().RemoteControl.noActiveTask);
      return;
    }

    executionService.stopExecution(session.taskId);
    await this.sendMessage(message.chatId, this.getLocaleText().RemoteControl.stopped);
  }

  private async getOrCreateSession(
    chatId: number,
    firstMessage: string
  ): Promise<ChatSessionState> {
    let session = this.sessions.get(chatId);
    if (session) return session;

    const taskId = await taskService.createTask(firstMessage || 'Remote task');
    session = {
      taskId,
      lastSentAt: 0,
      sentChunks: [],
    };
    this.sessions.set(chatId, session);
    return session;
  }

  private async resetSession(chatId: number): Promise<void> {
    const session = this.sessions.get(chatId);
    if (!session) {
      return;
    }
    this.lastStreamContent.delete(session.taskId);
    session.streamingMessageId = undefined;
    session.lastMessageId = undefined;
    session.sentChunks = [];
    session.lastStreamStatus = undefined;
    session.lastSentAt = 0;
  }

  private attachExecutionStreamListener(): void {
    if (this.executionUnsubscribe) {
      return;
    }

    const onChange = debounce(() => {
      for (const [chatId, session] of this.sessions) {
        const execution = useExecutionStore.getState().getExecution(session.taskId);
        if (!execution) {
          continue;
        }

        if (execution.status !== 'running') {
          if (session.lastStreamStatus !== execution.status) {
            session.lastStreamStatus = execution.status;
            this.flushFinalStream(chatId, session).catch(console.error);
          }
          continue;
        }

        const content = execution.streamingContent;
        if (!content) continue;

        const lastContent = this.lastStreamContent.get(session.taskId) || '';
        if (content === lastContent) continue;

        this.lastStreamContent.set(session.taskId, content);
        this.sendStreamUpdate(chatId, session, content).catch(console.error);
      }
    }, STREAM_THROTTLE_MS);

    this.executionUnsubscribe = useExecutionStore.subscribe(onChange);
  }

  private async flushFinalStream(chatId: number, session: ChatSessionState): Promise<void> {
    const execution = useExecutionStore.getState().getExecution(session.taskId);
    if (!execution) {
      return;
    }

    const content = execution.streamingContent || '';
    if (!content.trim()) {
      return;
    }

    const chunks = splitTelegramText(content, TELEGRAM_MESSAGE_LIMIT);
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
        await this.editMessage(chatId, session.streamingMessageId, first);
        session.sentChunks = [first];
      }
    } else if (!session.streamingMessageId) {
      const first = chunks[0] ?? '';
      if (!first.trim()) {
        return;
      }
      const message = await this.sendMessage(chatId, first);
      session.streamingMessageId = message.messageId;
      session.sentChunks = [first];
    }

    if (chunks.length > 1) {
      for (let i = 1; i < chunks.length; i += 1) {
        const chunk = chunks[i];
        if (!chunk) continue;
        await this.sendMessage(chatId, chunk);
        session.sentChunks.push(chunk);
      }
    }
  }

  private attachEditReviewListener(): void {
    useEditReviewStore.subscribe((state) => {
      for (const [taskId, entry] of state.pendingEdits.entries()) {
        const session = Array.from(this.sessions.entries()).find(
          ([, value]) => value.taskId === taskId
        );
        if (!session) continue;
        const [chatId] = session;
        if (this.approvals.has(String(chatId))) continue;

        const pending = entry.pendingEdit;
        const prompt = this.getLocaleText().RemoteControl.approvalPrompt(pending.filePath);
        this.sendMessage(chatId, prompt)
          .then((msg) => {
            this.approvals.set(String(chatId), {
              chatId,
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
    chatId: number,
    session: ChatSessionState,
    content: string
  ): Promise<void> {
    const now = Date.now();
    if (now - session.lastSentAt < STREAM_THROTTLE_MS) {
      return;
    }

    session.lastSentAt = now;
    const chunks = splitTelegramText(content, TELEGRAM_MESSAGE_LIMIT);
    if (chunks.length === 0) {
      return;
    }

    const firstChunk = chunks[0] ?? '';
    const streamingChunk = firstChunk.slice(0, TELEGRAM_STREAM_EDIT_LIMIT).trim();
    if (!streamingChunk) {
      return;
    }

    if (session.streamingMessageId) {
      await this.editMessage(chatId, session.streamingMessageId, streamingChunk);
      session.sentChunks = [streamingChunk];
      return;
    }

    const message = await this.sendMessage(chatId, streamingChunk);
    session.streamingMessageId = message.messageId;
    session.sentChunks = [streamingChunk];
  }

  private async sendMessage(chatId: number, text: string): Promise<TelegramSendMessageResponse> {
    const request: TelegramSendMessageRequest = {
      chatId,
      text,
      disableWebPagePreview: true,
    };
    return invoke('telegram_send_message', { request });
  }

  private async editMessage(chatId: number, messageId: number, text: string): Promise<void> {
    if (!text.trim()) {
      return;
    }
    const request: TelegramEditMessageRequest = {
      chatId,
      messageId,
      text,
      disableWebPagePreview: true,
    };
    await invoke('telegram_edit_message', { request });
  }

  private async loadConfig(): Promise<TelegramRemoteConfig> {
    const settings = useSettingsStore.getState();
    return {
      enabled: settings.telegram_remote_enabled,
      token: settings.telegram_remote_token,
      allowedChatIds: this.parseAllowedChats(settings.telegram_remote_allowed_chats),
      pollTimeoutSecs: Number(settings.telegram_remote_poll_timeout || '25'),
    };
  }

  private async getGatewayStatus(): Promise<TelegramGatewayStatus | null> {
    try {
      return await invoke('telegram_get_status');
    } catch (error) {
      logger.warn('[TelegramRemoteService] Failed to fetch gateway status', error);
      return null;
    }
  }

  private parseAllowedChats(raw: string): number[] {
    if (!raw) return [];
    return raw
      .split(',')
      .map((id) => Number(id.trim()))
      .filter((id) => !Number.isNaN(id));
  }

  private toRustConfig(config: TelegramRemoteConfig) {
    return {
      enabled: config.enabled,
      token: config.token,
      allowedChatIds: config.allowedChatIds,
      pollTimeoutSecs: config.pollTimeoutSecs,
    };
  }

  private getLocaleText() {
    const language = (useSettingsStore.getState().language || 'en') as SupportedLocale;
    const locale = getLocale(language);
    return locale;
  }
}

export const telegramRemoteService = new TelegramRemoteService();
