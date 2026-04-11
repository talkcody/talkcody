import { logger } from '@/lib/logger';
import { wechatMediaService } from '@/services/remote/wechat/wechat-media-service';
import {
  getItemType,
  type ILinkInboundMessage,
  type ILinkMedia,
  type ILinkMessageItem,
  type ParsedWechatMessage,
  toRemoteAttachmentType,
} from '@/services/remote/wechat/wechat-types';
import type { RemoteAttachment, RemoteInboundMessage } from '@/types/remote-control';

function createMessageId(raw: ILinkInboundMessage): string {
  if (raw.msg_id !== undefined || raw.message_id !== undefined) {
    return String(raw.msg_id ?? raw.message_id);
  }
  return `wx-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function extractQuotedText(item: ILinkMessageItem): string | null {
  const ref = item.ref_msg;
  if (!ref) {
    return null;
  }

  const parts = [ref.title, ref.message_item?.text_item?.text].filter((value): value is string =>
    Boolean(value?.trim())
  );
  if (parts.length === 0) {
    return null;
  }
  return `[Quoted: ${parts.join(' | ')}]`;
}

function getMediaForItem(item: ILinkMessageItem): ILinkMedia | undefined {
  const itemType = getItemType(item);
  if (itemType === 2) return item.image_item?.media;
  if (itemType === 3) return item.voice_item?.media;
  if (itemType === 4) return item.file_item?.media;
  if (itemType === 5) return item.video_item?.media;
  return undefined;
}

function getFilename(item: ILinkMessageItem, index: number): string {
  const itemType = getItemType(item);
  if (itemType === 4 && item.file_item?.file_name) {
    return item.file_item.file_name;
  }
  if (itemType === 2) return `image-${index + 1}.jpg`;
  if (itemType === 3) return `voice-${index + 1}.silk`;
  if (itemType === 5) return `video-${index + 1}.mp4`;
  return `file-${index + 1}.bin`;
}

function getFallbackMimeType(item: ILinkMessageItem): string {
  const itemType = getItemType(item);
  if (itemType === 2) return 'image/jpeg';
  if (itemType === 3) return 'audio/silk';
  if (itemType === 5) return 'video/mp4';
  return 'application/octet-stream';
}

export class WechatMessageParser {
  constructor(private readonly downloadMedia: (media: ILinkMedia) => Promise<Uint8Array>) {}

  async parse(raw: ILinkInboundMessage): Promise<ParsedWechatMessage | null> {
    if (raw.group_id) {
      return null;
    }

    const chatId = raw.from_user_id?.trim();
    if (!chatId) {
      return null;
    }

    const messageId = createMessageId(raw);
    const attachments: RemoteAttachment[] = [];
    const textParts: string[] = [];

    for (const [index, item] of (raw.item_list ?? []).entries()) {
      const quoted = extractQuotedText(item);
      if (quoted) {
        textParts.push(quoted);
      }

      const itemType = getItemType(item);
      if (itemType === 1 && item.text_item?.text?.trim()) {
        textParts.push(item.text_item.text.trim());
      }

      if (itemType === 3 && item.voice_item?.text?.trim()) {
        textParts.push(item.voice_item.text.trim());
      }

      const media = getMediaForItem(item);
      if (!media?.encrypt_query_param || !media.aes_key) {
        continue;
      }

      try {
        const encryptedBytes = await this.downloadMedia(media);
        const saved = await wechatMediaService.saveDecryptedMedia({
          messageId,
          filename: getFilename(item, index),
          encryptedBytes,
          media,
          fallbackMimeType: getFallbackMimeType(item),
        });

        attachments.push({
          id: `${messageId}-${index}`,
          type: toRemoteAttachmentType(item),
          filePath: saved.filePath,
          filename: saved.filename,
          mimeType: saved.mimeType,
          size: saved.size,
        });
      } catch (error) {
        wechatMediaService.logDownloadFailure(messageId, error);
      }
    }

    if (textParts.length === 0 && attachments.length > 0) {
      const labels = attachments.map((attachment) => {
        if (attachment.type === 'image') return '[Image received]';
        if (attachment.type === 'voice') return '[Voice received]';
        return `[File received: ${attachment.filename}]`;
      });
      textParts.push(...labels);
    }

    const text = textParts.join('\n').trim();
    if (!text && attachments.length === 0) {
      return null;
    }

    return {
      chatId,
      messageId,
      text,
      date: raw.create_time_ms ?? raw.create_time ?? Date.now(),
      contextToken: raw.context_token,
      attachments,
    };
  }

  toRemoteInboundMessage(message: ParsedWechatMessage): RemoteInboundMessage {
    return {
      channelId: 'wechat',
      chatId: message.chatId,
      messageId: message.messageId,
      text: message.text,
      date: message.date,
      username: null,
      firstName: null,
      lastName: null,
      attachments: message.attachments,
    };
  }

  filterAllowedUser(message: ParsedWechatMessage, allowedUserIds: string[]): boolean {
    if (allowedUserIds.length === 0) {
      return true;
    }
    const allowed = new Set(allowedUserIds.map((value) => value.trim()).filter(Boolean));
    const accepted = allowed.has(message.chatId);
    if (!accepted) {
      logger.info('[WechatMessageParser] Ignoring non-allowlisted message', {
        chatId: message.chatId,
      });
    }
    return accepted;
  }
}
