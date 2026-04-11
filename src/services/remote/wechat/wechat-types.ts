import type { RemoteAttachment, RemoteAttachmentType } from '@/types/remote-control';

export const WECHAT_BASE_URL = 'https://ilinkai.weixin.qq.com';
export const WECHAT_LONG_POLL_TIMEOUT_MS = 35_000;
export const WECHAT_RETRY_DELAY_MS = 2_000;
export const WECHAT_BACKOFF_DELAY_MS = 30_000;
export const WECHAT_MAX_CONSECUTIVE_FAILURES = 3;
export const WECHAT_SESSION_EXPIRED_ERRCODE = -14;
export const WECHAT_CONTEXT_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
export const WECHAT_MESSAGE_LIMIT = 2000;
export const WECHAT_MEDIA_DIR = 'remote/wechat/attachments';
export const WECHAT_CREDENTIALS_FILE = 'remote/wechat/credentials.json';
export const WECHAT_SYNC_STATE_FILE = 'remote/wechat/sync-state.json';
export const WECHAT_CONTEXT_TOKENS_FILE = 'remote/wechat/context-tokens.json';
export const WECHAT_STATUS_FILE = 'remote/wechat/status.json';

export type WechatBindStatus = 'idle' | 'wait' | 'scanned' | 'expired' | 'confirmed' | 'error';
export type WechatSessionState = 'ready' | 'session_expired' | 'unconfigured';

export interface WechatStoredCredentials {
  botToken: string;
  botId: string;
  ilinkUserId: string;
  baseUrl: string;
  updatedAt: number;
}

export interface WechatSyncState {
  syncBuf: string;
  updatedAt: number;
  lastMessageId?: string;
}

export interface WechatContextTokenEntry {
  token: string;
  updatedAt: number;
  expiresAt: number;
}

export interface WechatStatusSnapshot {
  running: boolean;
  sessionExpired: boolean;
  lastPollAtMs?: number | null;
  lastError?: string | null;
  lastErrorAtMs?: number | null;
  activeContextCount?: number;
  bindStatus?: WechatBindStatus;
}

export interface WechatBindSession {
  sessionId: string;
  qrCode: string;
  qrImageUrl: string;
  status: WechatBindStatus;
  createdAt: number;
  expiresAt?: number;
  credentials?: WechatStoredCredentials;
  error?: string;
}

export interface ILinkBaseInfo {
  channel_version: string;
}

export interface ILinkApiError {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  err_msg?: string;
}

export interface ILinkGetUpdatesRequest {
  get_updates_buf?: string;
  base_info: ILinkBaseInfo;
}

export interface ILinkGetUpdatesResponse extends ILinkApiError {
  msgs?: ILinkInboundMessage[];
  get_updates_buf?: string;
  sync_buf?: string;
}

export interface ILinkTextItem {
  text?: string;
}

export interface ILinkVoiceItem {
  media?: ILinkMedia;
  text?: string;
}

export interface ILinkFileItem {
  file_name?: string;
  media?: ILinkMedia;
}

export interface ILinkImageItem {
  media?: ILinkMedia;
  mid_size?: number;
}

export interface ILinkVideoItem {
  media?: ILinkMedia;
}

export interface ILinkRefMessage {
  title?: string;
  message_item?: {
    text_item?: ILinkTextItem;
  };
}

export interface ILinkMedia {
  url?: string;
  encrypt_query_param?: string;
  aes_key?: string;
  encrypt_type?: number;
  file_size?: number;
}

export interface ILinkMessageItem {
  type: number | string;
  text_item?: ILinkTextItem;
  image_item?: ILinkImageItem;
  voice_item?: ILinkVoiceItem;
  file_item?: ILinkFileItem;
  video_item?: ILinkVideoItem;
  ref_msg?: ILinkRefMessage;
}

export interface ILinkInboundMessage {
  msg_id?: string | number;
  message_id?: string | number;
  from_user_id?: string;
  to_user_id?: string;
  group_id?: string;
  create_time_ms?: number;
  create_time?: number;
  context_token?: string;
  session_id?: string;
  msg_state?: number;
  item_list?: ILinkMessageItem[];
}

export interface ILinkSendMessageTextItem {
  type: 1;
  text_item: {
    text: string;
  };
}

export interface ILinkSendMessageImageItem {
  type: 2;
  image_item: {
    media: {
      encrypt_query_param: string;
      aes_key: string;
      encrypt_type: number;
    };
    mid_size?: number;
  };
}

export type ILinkSendMessageItem = ILinkSendMessageTextItem | ILinkSendMessageImageItem;

export interface ILinkOutboundMessage {
  from_user_id?: string;
  to_user_id: string;
  client_id: string;
  message_type: number;
  message_state: number;
  item_list: ILinkSendMessageItem[];
  context_token?: string;
}

export interface ILinkSendMessageRequest {
  msg: ILinkOutboundMessage;
  base_info: ILinkBaseInfo;
}

export interface ILinkSendMessageResponse extends ILinkApiError {
  context_token?: string;
}

export interface ILinkGetUploadUrlRequest {
  filekey: string;
  media_type: number;
  to_user_id: string;
  rawsize: number;
  rawfilemd5: string;
  filesize: number;
  no_need_thumb: boolean;
  aeskey: string;
  base_info: ILinkBaseInfo;
}

export interface ILinkGetUploadUrlResponse extends ILinkApiError {
  upload_param?: string;
}

export interface ILinkQrCodeResponse extends ILinkApiError {
  qrcode?: string;
  qrcode_img_content?: string;
}

export interface ILinkQrStatusResponse extends ILinkApiError {
  status?: 'wait' | 'scaned' | 'scanned' | 'expired' | 'confirmed' | string;
  qrcode?: string;
  qrcode_img_content?: string;
  bot_token?: string;
  ilink_bot_id?: string;
  baseurl?: string;
  ilink_user_id?: string;
}

export interface ParsedWechatMessage {
  chatId: string;
  messageId: string;
  text: string;
  date: number;
  contextToken?: string;
  attachments: RemoteAttachment[];
}

export interface WechatMediaDownloadResult {
  filePath: string;
  filename: string;
  mimeType: string;
  size: number;
}

export function getWechatBaseInfo(): ILinkBaseInfo {
  return {
    channel_version: 'talkcody-wechat-1.0.0',
  };
}

export function isSessionExpiredError(response?: ILinkApiError | null): boolean {
  if (!response) {
    return false;
  }
  return response.errcode === WECHAT_SESSION_EXPIRED_ERRCODE;
}

export function getItemType(item: ILinkMessageItem): number {
  if (typeof item.type === 'number') {
    return item.type;
  }

  switch (item.type) {
    case 'text':
      return 1;
    case 'image':
      return 2;
    case 'voice':
      return 3;
    case 'file':
      return 4;
    case 'video':
      return 5;
    default:
      return -1;
  }
}

export function toRemoteAttachmentType(item: ILinkMessageItem): RemoteAttachmentType {
  const itemType = getItemType(item);
  switch (itemType) {
    case 2:
      return 'image';
    case 3:
      return 'voice';
    case 4:
      return 'file';
    case 5:
      return 'file';
    default:
      return 'file';
  }
}
