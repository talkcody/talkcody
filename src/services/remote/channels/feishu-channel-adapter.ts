import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { logger } from '@/lib/logger';
import type {
  RemoteChannelAdapter,
  RemoteChannelCapabilities,
  RemoteChannelStatus,
} from '@/services/remote/remote-channel-types';
import { useSettingsStore } from '@/stores/settings-store';
import type {
  FeishuEditMessageRequest,
  FeishuGatewayStatus,
  FeishuInboundMessage,
  FeishuRemoteAttachment,
  FeishuRemoteConfig,
  FeishuSendMessageRequest,
  FeishuSendMessageResponse,
  RemoteAttachment,
  RemoteEditMessageRequest,
  RemoteInboundMessage,
  RemoteSendMessageRequest,
  RemoteSendMessageResponse,
} from '@/types/remote-control';

function toRemoteAttachment(attachment: FeishuRemoteAttachment): RemoteAttachment {
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

function toRemoteInboundMessage(message: FeishuInboundMessage): RemoteInboundMessage {
  return {
    channelId: 'feishu',
    chatId: message.openId,
    messageId: message.messageId,
    text: message.text,
    username: null,
    firstName: null,
    lastName: null,
    date: message.date,
    attachments: message.attachments
      ? message.attachments.map((attachment) => toRemoteAttachment(attachment))
      : [],
  };
}

function toFeishuSendMessageRequest(request: RemoteSendMessageRequest): FeishuSendMessageRequest {
  return {
    openId: request.chatId,
    text: request.text,
  };
}

function toFeishuEditMessageRequest(request: RemoteEditMessageRequest): FeishuEditMessageRequest {
  return {
    messageId: request.messageId,
    text: request.text,
  };
}

export class FeishuChannelAdapter implements RemoteChannelAdapter {
  readonly channelId = 'feishu' as const;
  readonly capabilities: RemoteChannelCapabilities = {
    supportsEdit: false,
    supportsReply: true,
    supportsMediaSend: false,
    supportsVoiceInput: true,
    supportsProactiveMessage: true,
    maxMessageLength: 4000,
    streamMode: 'append',
  };
  private inboundUnlisten: UnlistenFn | null = null;

  async start(): Promise<void> {
    const settings = useSettingsStore.getState();
    if (!settings.feishu_remote_enabled || !settings.feishu_remote_app_id) {
      logger.info('[FeishuChannelAdapter] Remote control disabled or missing app id');
      return;
    }

    logger.info('[FeishuChannelAdapter] Starting gateway');
    await invoke('feishu_set_config', { config: this.toRustConfig(settings) });
    await invoke('feishu_start');
  }

  async stop(): Promise<void> {
    logger.info('[FeishuChannelAdapter] Stopping gateway');
    await invoke('feishu_stop');
  }

  onInbound(handler: (message: RemoteInboundMessage) => void): () => void {
    const listenPromise = listen<FeishuInboundMessage>('feishu-inbound-message', (event) => {
      logger.debug('[FeishuChannelAdapter] Inbound event received', event.payload);
      handler(toRemoteInboundMessage(event.payload));
    });

    listenPromise
      .then((unlisten) => {
        this.inboundUnlisten = unlisten;
      })
      .catch((error) => {
        logger.warn('[FeishuChannelAdapter] Failed to listen inbound', error);
      });

    return () => {
      if (this.inboundUnlisten) {
        this.inboundUnlisten();
        this.inboundUnlisten = null;
      }
    };
  }

  async sendMessage(request: RemoteSendMessageRequest): Promise<RemoteSendMessageResponse> {
    logger.debug('[FeishuChannelAdapter] sendMessage', {
      chatId: request.chatId,
      textLen: request.text.length,
    });
    const response = await invoke<FeishuSendMessageResponse>('feishu_send_message', {
      request: toFeishuSendMessageRequest(request),
    });
    return { messageId: response.messageId };
  }

  async editMessage(request: RemoteEditMessageRequest): Promise<void> {
    logger.debug('[FeishuChannelAdapter] editMessage', {
      chatId: request.chatId,
      messageId: request.messageId,
      textLen: request.text.length,
    });
    await invoke('feishu_edit_message', {
      request: toFeishuEditMessageRequest(request),
    });
  }

  async getStatus(): Promise<RemoteChannelStatus> {
    const status = await invoke<FeishuGatewayStatus>('feishu_get_status');
    return {
      running: status.running,
      lastPollAtMs: status.lastEventAtMs ?? null,
      lastError: status.lastError ?? null,
      lastErrorAtMs: status.lastErrorAtMs ?? null,
      details: {
        backoffMs: status.backoffMs ?? null,
      },
    };
  }

  async getConfig(): Promise<FeishuRemoteConfig> {
    return invoke('feishu_get_config');
  }

  private toRustConfig(settings: ReturnType<typeof useSettingsStore.getState>): FeishuRemoteConfig {
    return {
      enabled: settings.feishu_remote_enabled,
      appId: settings.feishu_remote_app_id,
      appSecret: settings.feishu_remote_app_secret,
      encryptKey: settings.feishu_remote_encrypt_key,
      verificationToken: settings.feishu_remote_verification_token,
      allowedOpenIds: settings.feishu_remote_allowed_open_ids
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0),
    };
  }
}
