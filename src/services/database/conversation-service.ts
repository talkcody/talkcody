// src/services/database/conversation-service.ts

import { logger } from '@/lib/logger';
import { timedMethod } from '@/lib/timer';
import { generateId } from '@/lib/utils';
import type { MessageAttachment } from '@/types/agent';
import { fileService } from '../file-service';
import type { TursoClient } from './turso-client';
import type { Conversation, StoredAttachment, StoredMessage } from './types';

export class ConversationService {
  constructor(private db: TursoClient) {}

  @timedMethod('createConversation')
  async createConversation(
    title: string,
    conversationId: string,
    projectId = 'default'
  ): Promise<string> {
    const now = Date.now();

    logger.info('createConversation', conversationId, title, projectId, now);

    await this.db.execute(
      'INSERT INTO conversations (id, title, project_id, created_at, updated_at, message_count) VALUES ($1, $2, $3, $4, $5, $6)',
      [conversationId, title, projectId, now, now, 0]
    );

    return conversationId;
  }

  async getConversations(projectId?: string): Promise<Conversation[]> {
    let sql = 'SELECT * FROM conversations';
    const params: any[] = [];

    if (projectId) {
      sql += ' WHERE project_id = $1';
      params.push(projectId);
    }

    sql += ' ORDER BY updated_at DESC';

    const result = await this.db.select<Conversation[]>(sql, params);
    return result;
  }

  async getConversationDetails(conversationId: string): Promise<Conversation | null> {
    const result = await this.db.select<Conversation[]>(
      'SELECT * FROM conversations WHERE id = $1',
      [conversationId]
    );

    return result[0] || null;
  }

  @timedMethod('updateConversationTitle')
  async updateConversationTitle(conversationId: string, title: string): Promise<void> {
    await this.db.execute('UPDATE conversations SET title = $1, updated_at = $2 WHERE id = $3', [
      title,
      Date.now(),
      conversationId,
    ]);
  }

  @timedMethod('updateConversationProject')
  async updateConversationProject(conversationId: string, projectId: string): Promise<void> {
    await this.db.execute(
      'UPDATE conversations SET project_id = $1, updated_at = $2 WHERE id = $3',
      [projectId, Date.now(), conversationId]
    );
  }

  @timedMethod('deleteConversation')
  async deleteConversation(conversationId: string): Promise<void> {
    logger.info('deleteConversation', conversationId);

    // Get all attachments for this conversation to delete files
    const messages = await this.db.select<{ id: string }[]>(
      'SELECT id FROM messages WHERE conversation_id = $1',
      [conversationId]
    );

    // Delete attachment files
    for (const message of messages) {
      const attachments = await this.db.select<StoredAttachment[]>(
        'SELECT file_path FROM message_attachments WHERE message_id = $1',
        [message.id]
      );

      for (const attachment of attachments) {
        await fileService.deleteAttachmentFile(attachment.file_path);
      }
    }

    // Delete attachments from database
    for (const message of messages) {
      await this.db.execute('DELETE FROM message_attachments WHERE message_id = $1', [message.id]);
    }

    // Delete messages
    await this.db.execute('DELETE FROM messages WHERE conversation_id = $1', [conversationId]);

    // Delete conversation
    await this.db.execute('DELETE FROM conversations WHERE id = $1', [conversationId]);
  }

  async saveMessage(
    conversationId: string,
    role: 'user' | 'assistant' | 'tool',
    content: string,
    positionIndex: number,
    assistant_id?: string,
    attachments?: MessageAttachment[],
    messageId?: string
  ): Promise<string> {
    const finalMessageId = messageId || generateId();
    const timestamp = Date.now();
    try {
      // Start transaction by saving message first
      await this.db.execute(
        'INSERT INTO messages (id, conversation_id, role, content, timestamp, assistant_id, position_index) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [
          finalMessageId,
          conversationId,
          role,
          content,
          timestamp,
          assistant_id || null,
          positionIndex,
        ]
      );

      // Save attachments if present
      if (attachments && attachments.length > 0) {
        for (const attachment of attachments) {
          await this.saveAttachment(finalMessageId, attachment);
        }
      }

      // Update conversation
      await this.db.execute(
        'UPDATE conversations SET message_count = message_count + 1, updated_at = $1 WHERE id = $2',
        [timestamp, conversationId]
      );

      return finalMessageId;
    } catch (error) {
      logger.error('Failed to save message:', error);
      throw error;
    }
  }

  async updateMessage(messageId: string, content: string): Promise<void> {
    try {
      await this.db.execute('UPDATE messages SET content = $1 WHERE id = $2', [content, messageId]);
    } catch (error) {
      logger.error('Failed to update message:', error);
      throw error;
    }
  }

  async saveAttachment(messageId: string, attachment: MessageAttachment): Promise<void> {
    const now = Date.now();

    await this.db.execute(
      'INSERT INTO message_attachments (id, message_id, type, filename, file_path, mime_type, size, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [
        attachment.id,
        messageId,
        attachment.type,
        attachment.filename,
        attachment.filePath || '',
        attachment.mimeType,
        attachment.size,
        now,
      ]
    );
  }

  async getMessages(conversationId: string): Promise<StoredMessage[]> {
    const messages = await this.db.select<StoredMessage[]>(
      'SELECT * FROM messages WHERE conversation_id = $1 ORDER BY timestamp ASC',
      [conversationId]
    );

    // Load attachments for each message
    for (const message of messages) {
      message.attachments = await this.getAttachmentsForMessage(message.id);
    }

    return messages;
  }

  async getMessagesForPosition(
    conversationId: string,
    positionIndex: number
  ): Promise<StoredMessage[]> {
    const messages = await this.db.select<StoredMessage[]>(
      `SELECT * FROM messages
             WHERE conversation_id = $1 AND position_index = $2
             ORDER BY timestamp ASC`,
      [conversationId, positionIndex]
    );

    // Load attachments for each message
    for (const message of messages) {
      message.attachments = await this.getAttachmentsForMessage(message.id);
    }

    return messages;
  }

  async getAttachmentsForMessage(messageId: string): Promise<MessageAttachment[]> {
    const result = await this.db.select<StoredAttachment[]>(
      'SELECT * FROM message_attachments WHERE message_id = $1 ORDER BY created_at ASC',
      [messageId]
    );

    const attachments: MessageAttachment[] = [];

    for (const attachment of result) {
      try {
        const messageAttachment: MessageAttachment = {
          id: attachment.id,
          type: attachment.type as MessageAttachment['type'],
          filename: attachment.filename,
          filePath: attachment.file_path,
          mimeType: attachment.mime_type,
          size: attachment.size,
        };

        // Only load base64Data for image types
        if (this.isImageMimeType(attachment.mime_type)) {
          const base64Data = await fileService.getFileBase64(attachment.file_path);
          messageAttachment.content = base64Data;
        }

        attachments.push(messageAttachment);
      } catch (error) {
        logger.error(`Failed to load attachment file: ${attachment.file_path}`, error);
        // Skip corrupted attachments
      }
    }

    return attachments;
  }

  @timedMethod('getLatestUserMessageContent')
  async getLatestUserMessageContent(conversationId: string): Promise<string | null> {
    const result = await this.db.select<{ content: string }[]>(
      `SELECT content FROM messages
             WHERE conversation_id = $1 AND role = 'user'
             ORDER BY timestamp DESC
             LIMIT 1`,
      [conversationId]
    );

    return result.length > 0 ? (result[0]?.content ?? null) : null;
  }

  async deleteMessage(messageId: string): Promise<void> {
    // Get attachment files to delete
    const attachments = await this.db.select<StoredAttachment[]>(
      'SELECT file_path FROM message_attachments WHERE message_id = $1',
      [messageId]
    );

    // Delete attachment files
    for (const attachment of attachments) {
      await fileService.deleteAttachmentFile(attachment.file_path);
    }

    // Delete attachments from database
    await this.db.execute('DELETE FROM message_attachments WHERE message_id = $1', [messageId]);

    // Delete message
    await this.db.execute('DELETE FROM messages WHERE id = $1', [messageId]);
  }

  private isImageMimeType(mimeType: string): boolean {
    return mimeType.startsWith('image/');
  }

  @timedMethod('updateConversationUsage')
  async updateConversationUsage(
    conversationId: string,
    cost: number,
    inputToken: number,
    outputToken: number
  ): Promise<void> {
    await this.db.execute(
      'UPDATE conversations SET cost = cost + $1, input_token = input_token + $2, output_token = output_token + $3, updated_at = $4 WHERE id = $5',
      [cost, inputToken, outputToken, Date.now(), conversationId]
    );
  }

  @timedMethod('updateConversationSettings')
  async updateConversationSettings(conversationId: string, settings: string): Promise<void> {
    await this.db.execute('UPDATE conversations SET settings = $1, updated_at = $2 WHERE id = $3', [
      settings,
      Date.now(),
      conversationId,
    ]);
  }

  @timedMethod('getConversationSettings')
  async getConversationSettings(conversationId: string): Promise<string | null> {
    const result = await this.db.select<{ settings: string | null }[]>(
      'SELECT settings FROM conversations WHERE id = $1',
      [conversationId]
    );

    return result.length > 0 ? (result[0]?.settings ?? null) : null;
  }
}
