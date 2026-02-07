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
}

export interface TelegramSendMessageRequest {
  chatId: number;
  text: string;
  replyToMessageId?: number;
  disableWebPagePreview?: boolean;
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
}
