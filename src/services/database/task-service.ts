// src/services/database/task-service.ts

import { logger } from '@/lib/logger';
import { timedMethod } from '@/lib/timer';
import { generateId } from '@/lib/utils';
import type { StoredAttachment, StoredMessage, Task } from '@/types';
import type { MessageAttachment } from '@/types/agent';
import { fileService } from '../file-service';
import type { TursoClient } from './turso-client';

export class TaskService {
  constructor(private db: TursoClient) {}

  @timedMethod('createTask')
  async createTask(title: string, taskId: string, projectId = 'default'): Promise<string> {
    const now = Date.now();

    logger.info('createTask', taskId, title, projectId, now);

    await this.db.execute(
      'INSERT INTO conversations (id, title, project_id, created_at, updated_at, message_count) VALUES ($1, $2, $3, $4, $5, $6)',
      [taskId, title, projectId, now, now, 0]
    );

    return taskId;
  }

  async getTasks(projectId?: string): Promise<Task[]> {
    let sql = 'SELECT * FROM conversations';
    const params: unknown[] = [];

    if (projectId) {
      sql += ' WHERE project_id = $1';
      params.push(projectId);
    }

    sql += ' ORDER BY updated_at DESC';

    const result = await this.db.select<Task[]>(sql, params);
    return result;
  }

  async getTasksWithPagination(
    projectId?: string,
    limit: number = 20,
    offset: number = 0
  ): Promise<Task[]> {
    let sql = 'SELECT * FROM conversations';
    const params: unknown[] = [];
    let paramIndex = 1;

    if (projectId) {
      sql += ` WHERE project_id = $${paramIndex}`;
      params.push(projectId);
      paramIndex++;
    }

    sql += ' ORDER BY updated_at DESC';
    sql += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await this.db.select<Task[]>(sql, params);
    return result;
  }

  async searchTasksWithPagination(
    searchTerm: string,
    projectId?: string,
    limit: number = 20,
    offset: number = 0
  ): Promise<Task[]> {
    const trimmedSearch = searchTerm.trim();
    let sql = 'SELECT * FROM conversations';
    const params: unknown[] = [];
    let paramIndex = 1;

    const conditions: string[] = [];
    if (projectId) {
      conditions.push(`project_id = $${paramIndex}`);
      params.push(projectId);
      paramIndex++;
    }

    if (trimmedSearch.length > 0) {
      conditions.push(`LOWER(title) LIKE $${paramIndex}`);
      params.push(`%${trimmedSearch.toLowerCase()}%`);
      paramIndex++;
    }

    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }

    sql += ' ORDER BY updated_at DESC';
    sql += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await this.db.select<Task[]>(sql, params);
    return result;
  }

  async getTaskDetails(taskId: string): Promise<Task | null> {
    const result = await this.db.select<Task[]>('SELECT * FROM conversations WHERE id = $1', [
      taskId,
    ]);

    return result[0] || null;
  }

  @timedMethod('updateTaskTitle')
  async updateTaskTitle(taskId: string, title: string): Promise<void> {
    await this.db.execute('UPDATE conversations SET title = $1, updated_at = $2 WHERE id = $3', [
      title,
      Date.now(),
      taskId,
    ]);
  }

  @timedMethod('updateTaskProject')
  async updateTaskProject(taskId: string, projectId: string): Promise<void> {
    await this.db.execute(
      'UPDATE conversations SET project_id = $1, updated_at = $2 WHERE id = $3',
      [projectId, Date.now(), taskId]
    );
  }

  @timedMethod('deleteTask')
  async deleteTask(taskId: string): Promise<void> {
    logger.info('deleteTask', taskId);

    // Get all attachments for this task to delete files
    const messages = await this.db.select<{ id: string }[]>(
      'SELECT id FROM messages WHERE conversation_id = $1',
      [taskId]
    );

    // Delete attachment files
    for (const message of messages) {
      const attachments = await this.db.select<StoredAttachment[]>(
        'SELECT file_path, type FROM message_attachments WHERE message_id = $1',
        [message.id]
      );

      for (const attachment of attachments) {
        // Only delete temp files, not code files from repository
        if (attachment.type !== 'code') {
          await fileService.deleteAttachmentFile(attachment.file_path);
        }
      }
    }

    // Delete attachments from database
    for (const message of messages) {
      await this.db.execute('DELETE FROM message_attachments WHERE message_id = $1', [message.id]);
    }

    // Delete messages
    await this.db.execute('DELETE FROM messages WHERE conversation_id = $1', [taskId]);

    // Delete task
    await this.db.execute('DELETE FROM conversations WHERE id = $1', [taskId]);
  }

  async saveMessage(
    taskId: string,
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
        [finalMessageId, taskId, role, content, timestamp, assistant_id || null, positionIndex]
      );

      // Save attachments if present
      if (attachments && attachments.length > 0) {
        for (const attachment of attachments) {
          await this.saveAttachment(finalMessageId, attachment);
        }
      }

      // Update task
      await this.db.execute(
        'UPDATE conversations SET message_count = message_count + 1, updated_at = $1 WHERE id = $2',
        [timestamp, taskId]
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

  async getMessages(taskId: string): Promise<StoredMessage[]> {
    const messages = await this.db.select<StoredMessage[]>(
      'SELECT * FROM messages WHERE conversation_id = $1 ORDER BY timestamp ASC',
      [taskId]
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
  async getLatestUserMessageContent(taskId: string): Promise<string | null> {
    const result = await this.db.select<{ content: string }[]>(
      `SELECT content FROM messages
             WHERE conversation_id = $1 AND role = 'user'
             ORDER BY timestamp DESC
             LIMIT 1`,
      [taskId]
    );

    return result.length > 0 ? (result[0]?.content ?? null) : null;
  }

  async deleteMessage(messageId: string): Promise<void> {
    // Get attachment files to delete
    const attachments = await this.db.select<StoredAttachment[]>(
      'SELECT file_path, type FROM message_attachments WHERE message_id = $1',
      [messageId]
    );

    // Delete attachment files
    for (const attachment of attachments) {
      // Only delete temp files, not code files from repository
      if (attachment.type !== 'code') {
        await fileService.deleteAttachmentFile(attachment.file_path);
      }
    }

    // Delete attachments from database
    await this.db.execute('DELETE FROM message_attachments WHERE message_id = $1', [messageId]);

    // Delete message
    await this.db.execute('DELETE FROM messages WHERE id = $1', [messageId]);
  }

  private isImageMimeType(mimeType: string): boolean {
    return mimeType.startsWith('image/');
  }

  @timedMethod('updateTaskUsage')
  async updateTaskUsage(
    taskId: string,
    cost: number,
    inputToken: number,
    outputToken: number,
    contextUsage?: number
  ): Promise<void> {
    if (contextUsage === undefined) {
      await this.db.execute(
        'UPDATE conversations SET cost = cost + $1, input_token = input_token + $2, output_token = output_token + $3, updated_at = $4 WHERE id = $5',
        [cost, inputToken, outputToken, Date.now(), taskId]
      );
      return;
    }

    await this.db.execute(
      'UPDATE conversations SET cost = cost + $1, input_token = input_token + $2, output_token = output_token + $3, context_usage = $4, updated_at = $5 WHERE id = $6',
      [cost, inputToken, outputToken, contextUsage, Date.now(), taskId]
    );
  }

  @timedMethod('updateTaskSettings')
  async updateTaskSettings(taskId: string, settings: string): Promise<void> {
    await this.db.execute('UPDATE conversations SET settings = $1, updated_at = $2 WHERE id = $3', [
      settings,
      Date.now(),
      taskId,
    ]);
  }

  @timedMethod('getTaskSettings')
  async getTaskSettings(taskId: string): Promise<string | null> {
    const result = await this.db.select<{ settings: string | null }[]>(
      'SELECT settings FROM conversations WHERE id = $1',
      [taskId]
    );

    return result.length > 0 ? (result[0]?.settings ?? null) : null;
  }
}
