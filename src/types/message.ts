// src/types/message.ts
/**
 * Message storage type definitions
 */

import type { MessageAttachment } from './agent';

export interface StoredMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  reasoning_content?: string | null;
  timestamp: number;
  assistant_id?: string;
  position_index: number;
  attachments?: MessageAttachment[];
}

/**
 * Stored format for tool messages (serialized as JSON in content field)
 * Supports both tool-call and tool-result types
 */
export type StoredToolContent = StoredToolCall | StoredToolResult;

export interface StoredToolCall {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  input?: Record<string, unknown>;
}

export interface StoredToolResult {
  type: 'tool-result';
  toolCallId: string;
  toolName: string;
  input?: Record<string, unknown>;
  output?: unknown; // Full output for proper restoration
  inputSummary?: string; // Deprecated: kept for backward compatibility
  status: 'success' | 'error';
  errorMessage?: string;
}

export interface StoredAttachment {
  id: string;
  message_id: string;
  type: 'image' | 'text' | 'code' | 'markdown' | 'pdf' | 'other';
  filename: string;
  file_path: string;
  mime_type: string;
  size: number;
  created_at: number;
}
