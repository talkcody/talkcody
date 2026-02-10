import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { logger } from '@/lib/logger';
import type { RemoteChannelAdapter } from '@/services/remote/remote-channel-types';
import { parseAllowedChatIds } from '@/services/remote/telegram-remote-utils';
import { useSettingsStore } from '@/stores/settings-store';
import type {
  RemoteAttachment,
  RemoteEditMessageRequest,
  RemoteInboundMessage,
  RemoteSendMessageRequest,
  RemoteSendMessageResponse,
  TelegramEditMessageRequest,
  TelegramInboundMessage,
  TelegramRemoteAttachment,
  TelegramRemoteConfig,
  TelegramSendMessageRequest,
  TelegramSendMessageResponse,
} from '@/types/remote-control';

function toRemoteAttachment(attachment: TelegramRemoteAttachment): RemoteAttachment {
  return {
    id: attachment.id,
    type: attachment.attachmentType,
    filePath: attachment.filePath,
    filename: attachment.filename,
    mimeType: attachment.mimeType,
    size: attachment.size,
    durationSeconds: attachment.durationSeconds,
    caption: attachment.caption,
  };
}

function toRemoteInboundMessage(message: TelegramInboundMessage): RemoteInboundMessage {
  return {
    channelId: 'telegram',
    chatId: String(message.chatId),
    messageId: String(message.messageId),
    text: message.text,
    username: message.username ?? null,
    firstName: message.firstName ?? null,
    lastName: message.lastName ?? null,
    date: message.date,
    attachments: message.attachments
      ? message.attachments.map((attachment) => toRemoteAttachment(attachment))
      : [],
  };
}

function toTelegramSendMessageRequest(
  request: RemoteSendMessageRequest
): TelegramSendMessageRequest {
  return {
    chatId: Number(request.chatId),
    text: request.text,
    replyToMessageId: request.replyToMessageId ? Number(request.replyToMessageId) : undefined,
    disableWebPagePreview: request.disableWebPagePreview,
    parseMode: request.parseMode,
  };
}

function toTelegramEditMessageRequest(
  request: RemoteEditMessageRequest
): TelegramEditMessageRequest {
  return {
    chatId: Number(request.chatId),
    messageId: Number(request.messageId),
    text: request.text,
    disableWebPagePreview: request.disableWebPagePreview,
    parseMode: request.parseMode,
  };
}

export class TelegramChannelAdapter implements RemoteChannelAdapter {
  readonly channelId = 'telegram' as const;
  private inboundUnlisten: UnlistenFn | null = null;

  async start(): Promise<void> {
    const settings = useSettingsStore.getState();
    if (!settings.telegram_remote_enabled || !settings.telegram_remote_token) {
      logger.info('[TelegramChannelAdapter] Remote control disabled or missing token');
      return;
    }

    logger.info('[TelegramChannelAdapter] Starting gateway');
    await invoke('telegram_set_config', { config: this.toRustConfig(settings) });
    await invoke('telegram_start');
  }

  async stop(): Promise<void> {
    logger.info('[TelegramChannelAdapter] Stopping gateway');
    await invoke('telegram_stop');
  }

  onInbound(handler: (message: RemoteInboundMessage) => void): () => void {
    const listenPromise = listen<TelegramInboundMessage>('telegram-inbound-message', (event) => {
      logger.debug('[TelegramChannelAdapter] Inbound event received', event.payload);
      handler(toRemoteInboundMessage(event.payload));
    });

    listenPromise
      .then((unlisten) => {
        this.inboundUnlisten = unlisten;
      })
      .catch((error) => {
        logger.warn('[TelegramChannelAdapter] Failed to listen inbound', error);
      });

    return () => {
      if (this.inboundUnlisten) {
        this.inboundUnlisten();
        this.inboundUnlisten = null;
      }
    };
  }

  async sendMessage(request: RemoteSendMessageRequest): Promise<RemoteSendMessageResponse> {
    logger.debug('[TelegramChannelAdapter] sendMessage', {
      chatId: request.chatId,
      textLen: request.text.length,
      replyToMessageId: request.replyToMessageId,
    });
    const response = await invoke<TelegramSendMessageResponse>('telegram_send_message', {
      request: toTelegramSendMessageRequest(request),
    });
    return { messageId: String(response.messageId) };
  }

  async editMessage(request: RemoteEditMessageRequest): Promise<void> {
    logger.debug('[TelegramChannelAdapter] editMessage', {
      chatId: request.chatId,
      messageId: request.messageId,
      textLen: request.text.length,
    });
    await invoke('telegram_edit_message', {
      request: toTelegramEditMessageRequest(request),
    });
  }

  async getConfig(): Promise<TelegramRemoteConfig> {
    return invoke('telegram_get_config');
  }

  private toRustConfig(
    settings: ReturnType<typeof useSettingsStore.getState>
  ): TelegramRemoteConfig {
    return {
      enabled: settings.telegram_remote_enabled,
      token: settings.telegram_remote_token,
      allowedChatIds: parseAllowedChatIds(settings.telegram_remote_allowed_chats),
      pollTimeoutSecs: Number(settings.telegram_remote_poll_timeout || '25'),
    };
  }
}
