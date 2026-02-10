export type RemoteChannelId = 'telegram' | 'discord' | 'slack' | 'feishu' | 'whatsapp';

export type RemoteAttachmentType = 'image' | 'audio' | 'voice' | 'file';

export interface RemoteAttachment {
  id: string;
  type: RemoteAttachmentType;
  filePath: string;
  filename: string;
  mimeType: string;
  size: number;
  durationSeconds?: number;
  caption?: string;
}

export interface TelegramRemoteAttachment {
  id: string;
  attachmentType: RemoteAttachmentType;
  filePath: string;
  filename: string;
  mimeType: string;
  size: number;
  durationSeconds?: number;
  caption?: string;
}

export interface RemoteInboundMessage {
  channelId: RemoteChannelId;
  chatId: string;
  messageId: string;
  text: string;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  date: number;
  attachments?: RemoteAttachment[];
}

export type MessageParseMode = 'HTML' | 'MarkdownV2' | 'plain';

export interface RemoteSendMessageRequest {
  channelId: RemoteChannelId;
  chatId: string;
  text: string;
  replyToMessageId?: string;
  disableWebPagePreview?: boolean;
  parseMode?: MessageParseMode;
}

export interface RemoteSendMessageResponse {
  messageId: string;
}

export interface RemoteEditMessageRequest {
  channelId: RemoteChannelId;
  chatId: string;
  messageId: string;
  text: string;
  disableWebPagePreview?: boolean;
  parseMode?: MessageParseMode;
}

export interface FeishuRemoteAttachment {
  id: string;
  attachmentType: RemoteAttachmentType;
  filePath: string;
  filename: string;
  mimeType: string;
  size: number;
  durationSeconds?: number;
  caption?: string;
}

export interface FeishuRemoteConfig {
  enabled: boolean;
  appId: string;
  appSecret: string;
  encryptKey: string;
  verificationToken: string;
  allowedOpenIds: string[];
}

export interface FeishuInboundMessage {
  chatId: string;
  messageId: string;
  text: string;
  openId: string;
  date: number;
  attachments?: FeishuRemoteAttachment[];
}

export interface FeishuSendMessageRequest {
  openId: string;
  text: string;
}

export interface FeishuSendMessageResponse {
  messageId: string;
}

export interface FeishuEditMessageRequest {
  messageId: string;
  text: string;
}

export interface FeishuGatewayStatus {
  running: boolean;
  lastEventAtMs?: number | null;
  lastError?: string | null;
  lastErrorAtMs?: number | null;
  backoffMs?: number | null;
}

export interface TelegramRemoteConfig {
  enabled: boolean;
  token: string;
  allowedChatIds: number[];
  pollTimeoutSecs: number;
}

export interface TelegramInboundMessage {
  chatId: number;
  messageId: number;
  text: string;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  date: number;
  attachments?: TelegramRemoteAttachment[];
}

export interface TelegramSendMessageRequest {
  chatId: number;
  text: string;
  replyToMessageId?: number;
  disableWebPagePreview?: boolean;
  parseMode?: 'HTML' | 'MarkdownV2' | 'plain';
}

export interface TelegramSendMessageResponse {
  messageId: number;
}

export interface TelegramGatewayStatus {
  running: boolean;
  lastUpdateId?: number | null;
  lastPollAtMs?: number | null;
  lastError?: string | null;
  lastErrorAtMs?: number | null;
  backoffMs?: number | null;
}

export interface TelegramEditMessageRequest {
  chatId: number;
  messageId: number;
  text: string;
  disableWebPagePreview?: boolean;
  parseMode?: 'HTML' | 'MarkdownV2' | 'plain';
}
