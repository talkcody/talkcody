import { exists } from '@tauri-apps/plugin-fs';
import { logger } from '@/lib/logger';
import type {
  RemoteChannelAdapter,
  RemoteChannelCapabilities,
  RemoteChannelStatus,
} from '@/services/remote/remote-channel-types';
import { wechatContextTokenStore } from '@/services/remote/wechat/wechat-context-token-store';
import { wechatCredentialsStore } from '@/services/remote/wechat/wechat-credentials-store';
import { WechatIlinkClient } from '@/services/remote/wechat/wechat-ilink-client';
import { WechatMessageParser } from '@/services/remote/wechat/wechat-message-parser';
import { wechatStatusStore } from '@/services/remote/wechat/wechat-status-store';
import { wechatSyncStateStore } from '@/services/remote/wechat/wechat-sync-state';
import {
  type ILinkApiError,
  WECHAT_BACKOFF_DELAY_MS,
  WECHAT_CONTEXT_TOKEN_TTL_MS,
  WECHAT_MAX_CONSECUTIVE_FAILURES,
  WECHAT_MESSAGE_LIMIT,
  WECHAT_RETRY_DELAY_MS,
  WECHAT_SESSION_EXPIRED_ERRCODE,
  type WechatStoredCredentials,
} from '@/services/remote/wechat/wechat-types';
import { useSettingsStore } from '@/stores/settings-store';
import type {
  RemoteEditMessageRequest,
  RemoteInboundMessage,
  RemoteSendMessageRequest,
  RemoteSendMessageResponse,
  WechatRemoteStatus,
} from '@/types/remote-control';

function createMessageId(): string {
  return `wechat-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function parseList(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timeoutId = window.setTimeout(() => resolve(), ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timeoutId);
        resolve();
      },
      { once: true }
    );
  });
}

export class WechatChannelAdapter implements RemoteChannelAdapter {
  readonly channelId = 'wechat' as const;
  readonly capabilities: RemoteChannelCapabilities = {
    supportsEdit: false,
    supportsReply: true,
    supportsMediaSend: true,
    supportsVoiceInput: true,
    supportsProactiveMessage: false,
    maxMessageLength: WECHAT_MESSAGE_LIMIT,
    streamMode: 'append',
  };

  private handlers = new Set<(message: RemoteInboundMessage) => void>();
  private controller: AbortController | null = null;
  private client: WechatIlinkClient | null = null;
  private parser: WechatMessageParser | null = null;
  private credentials: WechatStoredCredentials | null = null;
  private status: RemoteChannelStatus = {
    running: false,
    sessionExpired: false,
  };
  private allowedUserIds: string[] = [];
  private pollTimeoutMs = 35_000;

  async start(): Promise<void> {
    if (this.controller) {
      return;
    }

    const settings = useSettingsStore.getState();
    if (!settings.wechat_remote_enabled) {
      logger.info('[WechatChannelAdapter] Remote control disabled');
      return;
    }

    this.allowedUserIds = parseList(settings.wechat_remote_allowed_user_ids);
    this.pollTimeoutMs = Math.max(
      10_000,
      Number(settings.wechat_remote_poll_timeout_ms || '35000')
    );
    this.credentials = await this.resolveCredentials();
    if (!this.credentials) {
      this.status = {
        running: false,
        sessionExpired: false,
        details: { state: 'unconfigured' },
      };
      await this.persistStatus();
      logger.info('[WechatChannelAdapter] Missing credentials');
      return;
    }

    await wechatContextTokenStore.pruneExpired();
    this.client = new WechatIlinkClient(this.credentials);
    this.parser = new WechatMessageParser((media) => this.client!.downloadMedia(media));
    this.controller = new AbortController();
    this.status = {
      running: true,
      sessionExpired: false,
      lastError: null,
      lastErrorAtMs: null,
      details: {
        botId: this.credentials.botId,
      },
    };
    await this.persistStatus();
    void this.pollLoop(this.controller.signal);
  }

  async stop(): Promise<void> {
    if (!this.controller) {
      this.status = {
        ...this.status,
        running: false,
      };
      await this.persistStatus();
      return;
    }

    this.controller.abort();
    this.controller = null;
    this.status = {
      ...this.status,
      running: false,
    };
    await this.persistStatus();
  }

  onInbound(handler: (message: RemoteInboundMessage) => void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  async sendMessage(request: RemoteSendMessageRequest): Promise<RemoteSendMessageResponse> {
    const client = this.ensureClient();
    const tokenEntry = await wechatContextTokenStore.get(request.chatId);
    if (!tokenEntry) {
      throw new Error('WeChat reply context expired. Please send a new message from WeChat first.');
    }

    const mediaPaths = request.text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('MEDIA:'))
      .map((line) => line.slice('MEDIA:'.length).trim())
      .filter(Boolean);

    let latestToken = tokenEntry.token;
    for (const mediaPath of mediaPaths) {
      const present = await exists(mediaPath);
      if (!present) {
        continue;
      }
      const response = await client.sendImage({
        toUserId: request.chatId,
        filePath: mediaPath,
        contextToken: latestToken,
      });
      if (response.context_token) {
        latestToken = response.context_token;
        await this.storeContextToken(request.chatId, latestToken);
      }
    }

    const cleanText = request.text
      .split('\n')
      .filter((line) => !line.trim().startsWith('MEDIA:'))
      .join('\n')
      .trim();

    if (cleanText) {
      const response = await client.sendText({
        toUserId: request.chatId,
        text: cleanText,
        contextToken: latestToken,
      });
      client.assertSuccess(response, 'Failed to send WeChat message');
      if (response.context_token) {
        latestToken = response.context_token;
        await this.storeContextToken(request.chatId, latestToken);
      }
    }

    return { messageId: createMessageId() };
  }

  async editMessage(_request: RemoteEditMessageRequest): Promise<void> {
    throw new Error('WeChat does not support message editing');
  }

  async getStatus(): Promise<WechatRemoteStatus> {
    const activeContextCount = await wechatContextTokenStore.countActive();
    return {
      running: this.status.running,
      sessionExpired: this.status.sessionExpired ?? false,
      lastPollAtMs: this.status.lastPollAtMs ?? null,
      lastError: this.status.lastError ?? null,
      lastErrorAtMs: this.status.lastErrorAtMs ?? null,
      syncBufPresent: Boolean((await wechatSyncStateStore.load()).syncBuf),
      activeContextCount,
    };
  }

  private async pollLoop(signal: AbortSignal): Promise<void> {
    let consecutiveFailures = 0;
    let syncState = await wechatSyncStateStore.load();

    while (!signal.aborted) {
      try {
        const client = this.ensureClient();
        const response = await client.getUpdates(syncState.syncBuf);
        const now = Date.now();

        if (response.errcode === WECHAT_SESSION_EXPIRED_ERRCODE) {
          this.status = {
            ...this.status,
            running: false,
            sessionExpired: true,
            lastError: response.errmsg || 'session expired',
            lastErrorAtMs: now,
          };
          await this.persistStatus();
          this.controller = null;
          return;
        }

        if (response.errcode && response.errcode !== 0) {
          throw new Error(response.errmsg || `iLink error ${response.errcode}`);
        }

        const nextSyncBuf = response.sync_buf || response.get_updates_buf || syncState.syncBuf;
        if (nextSyncBuf !== syncState.syncBuf) {
          syncState = {
            syncBuf: nextSyncBuf,
            updatedAt: now,
            lastMessageId: syncState.lastMessageId,
          };
          await wechatSyncStateStore.save(syncState);
        }

        for (const rawMessage of response.msgs ?? []) {
          const parsed = await this.parser?.parse(rawMessage);
          if (!parsed || !this.parser?.filterAllowedUser(parsed, this.allowedUserIds)) {
            continue;
          }

          if (parsed.contextToken) {
            await this.storeContextToken(parsed.chatId, parsed.contextToken);
          }

          syncState = {
            ...syncState,
            lastMessageId: parsed.messageId,
          };
          await wechatSyncStateStore.save(syncState);

          const normalized = this.parser.toRemoteInboundMessage(parsed);
          this.emit(normalized);
        }

        consecutiveFailures = 0;
        this.status = {
          ...this.status,
          running: true,
          sessionExpired: false,
          lastPollAtMs: now,
          lastError: null,
          lastErrorAtMs: null,
        };
        await this.persistStatus();
      } catch (error) {
        if (signal.aborted) {
          return;
        }

        consecutiveFailures += 1;
        const message = error instanceof Error ? error.message : String(error);
        this.status = {
          ...this.status,
          running: true,
          lastError: message,
          lastErrorAtMs: Date.now(),
        };
        await this.persistStatus();

        const delay =
          consecutiveFailures >= WECHAT_MAX_CONSECUTIVE_FAILURES
            ? WECHAT_BACKOFF_DELAY_MS
            : WECHAT_RETRY_DELAY_MS;
        if (consecutiveFailures >= WECHAT_MAX_CONSECUTIVE_FAILURES) {
          consecutiveFailures = 0;
        }
        await sleep(delay, signal);
      }
    }
  }

  private emit(message: RemoteInboundMessage): void {
    for (const handler of this.handlers) {
      handler(message);
    }
  }

  private ensureClient(): WechatIlinkClient {
    if (!this.client) {
      throw new Error('WeChat client is not started');
    }
    return this.client;
  }

  private async resolveCredentials(): Promise<WechatStoredCredentials | null> {
    const settings = useSettingsStore.getState();
    if (
      settings.wechat_remote_bot_token &&
      settings.wechat_remote_bot_id &&
      settings.wechat_remote_ilink_user_id
    ) {
      return {
        botToken: settings.wechat_remote_bot_token,
        botId: settings.wechat_remote_bot_id,
        ilinkUserId: settings.wechat_remote_ilink_user_id,
        baseUrl: settings.wechat_remote_base_url,
        updatedAt: Date.now(),
      };
    }
    return wechatCredentialsStore.load();
  }

  private async storeContextToken(chatId: string, token: string): Promise<void> {
    await wechatContextTokenStore.set(chatId, {
      token,
      updatedAt: Date.now(),
      expiresAt: Date.now() + WECHAT_CONTEXT_TOKEN_TTL_MS,
    });
  }

  private async persistStatus(): Promise<void> {
    await wechatStatusStore.save({
      running: this.status.running,
      sessionExpired: this.status.sessionExpired ?? false,
      lastPollAtMs: this.status.lastPollAtMs ?? null,
      lastError: this.status.lastError ?? null,
      lastErrorAtMs: this.status.lastErrorAtMs ?? null,
      activeContextCount: await wechatContextTokenStore.countActive(),
    });
  }
}
