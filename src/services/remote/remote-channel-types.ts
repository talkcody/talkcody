import type {
  RemoteChannelId,
  RemoteEditMessageRequest,
  RemoteInboundMessage,
  RemoteSendMessageRequest,
  RemoteSendMessageResponse,
} from '@/types/remote-control';

export interface RemoteChannelCapabilities {
  supportsEdit: boolean;
  supportsReply: boolean;
  supportsMediaSend: boolean;
  supportsVoiceInput: boolean;
  supportsProactiveMessage: boolean;
  maxMessageLength: number;
  streamMode: 'edit' | 'append';
}

export interface RemoteChannelStatus {
  running: boolean;
  sessionExpired?: boolean;
  lastPollAtMs?: number | null;
  lastError?: string | null;
  lastErrorAtMs?: number | null;
  details?: Record<string, string | number | boolean | null | undefined>;
}

export interface RemoteChannelAdapter {
  readonly channelId: RemoteChannelId;
  readonly capabilities: RemoteChannelCapabilities;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  onInbound: (handler: (message: RemoteInboundMessage) => void) => () => void;
  sendMessage: (request: RemoteSendMessageRequest) => Promise<RemoteSendMessageResponse>;
  editMessage: (request: RemoteEditMessageRequest) => Promise<void>;
  getStatus?: () => Promise<RemoteChannelStatus>;
}
