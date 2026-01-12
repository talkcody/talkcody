// src/services/message-service.ts
/**
 * MessageService - Unified entry point for message operations
 *
 * This service provides a single entry point for all message operations,
 * ensuring consistent state updates between TaskStore and database.
 *
 * Design principles:
 * - Synchronous store updates for immediate UI response
 * - Asynchronous database persistence (fire-and-forget or awaited)
 * - All message operations go through this service
 */

import { logger } from '@/lib/logger';
import { timedMethod } from '@/lib/timer';
import { generateId } from '@/lib/utils';
import { databaseService } from '@/services/database-service';
import { useExecutionStore } from '@/stores/execution-store';
import { useTaskStore } from '@/stores/task-store';

const FRAME_BUDGET_MS = 16;

function scheduleRafFlush(run: () => void): void {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(() => run());
  } else {
    setTimeout(run, FRAME_BUDGET_MS);
  }
}

import type { MessageAttachment, ToolMessageContent, UIMessage } from '@/types/agent';

/**
 * Stored format for tool content in database
 */
interface StoredToolCall {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  input?: Record<string, unknown>;
}

interface StoredToolResult {
  type: 'tool-result';
  toolCallId: string;
  toolName: string;
  input?: Record<string, unknown>;
  output?: unknown;
  status: 'success' | 'error';
  errorMessage?: string;
}

type StoredToolContent = StoredToolCall | StoredToolResult;

class MessageService {
  private streamingBuffers = new Map<string, { content: string; messageId: string }>();
  private rafScheduled = false;

  private flushStreamingBuffers(): void {
    const buffers = this.streamingBuffers;
    if (buffers.size === 0) {
      this.rafScheduled = false;
      return;
    }

    this.streamingBuffers = new Map();
    this.rafScheduled = false;

    for (const [taskId, payload] of buffers) {
      useTaskStore
        .getState()
        .updateMessageContent(taskId, payload.messageId, payload.content, true);
      useExecutionStore.getState().updateStreamingContent(taskId, payload.content);
    }
  }

  private scheduleStreamingFlush(): void {
    if (this.rafScheduled) return;
    this.rafScheduled = true;

    scheduleRafFlush(() => {
      this.flushStreamingBuffers();
    });
  }
  /**
   * Add a user message and persist to database
   */
  async addUserMessage(
    taskId: string,
    content: string,
    options?: {
      attachments?: MessageAttachment[];
      agentId?: string;
    }
  ): Promise<string> {
    const messageId = generateId();
    const message: UIMessage = {
      id: messageId,
      role: 'user',
      content,
      timestamp: new Date(),
      attachments: options?.attachments,
      assistantId: options?.agentId,
    };

    // 1. Update store (synchronous, UI updates immediately)
    // Note: addMessage automatically updates task's updatedAt
    useTaskStore.getState().addMessage(taskId, message);

    // 2. Persist to database (asynchronous)
    try {
      await databaseService.saveMessage(
        taskId,
        'user',
        content,
        0, // positionIndex
        options?.agentId,
        options?.attachments,
        messageId
      );
      logger.info('[MessageService] User message persisted', { taskId, messageId });
    } catch (error) {
      logger.error('[MessageService] Failed to persist user message:', error);
    }

    return messageId;
  }

  /**
   * Create an assistant message (for streaming start)
   * Returns message ID synchronously; DB persistence is fire-and-forget.
   */
  createAssistantMessage(taskId: string, agentId?: string): string {
    const messageId = generateId();
    const message: UIMessage = {
      id: messageId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      isStreaming: true,
      assistantId: agentId,
    };

    // 1. Update store (synchronous)
    useTaskStore.getState().addMessage(taskId, message);

    // 2. Persist to database (fire-and-forget)
    databaseService
      .saveMessage(
        taskId,
        'assistant',
        '',
        0, // positionIndex
        agentId,
        undefined,
        messageId
      )
      .then(() => {
        // logger.info('[MessageService] Assistant message persisted', { taskId, messageId });
      })
      .catch((error) => {
        logger.error('[MessageService] Failed to persist assistant message:', error);
      });

    return messageId;
  }

  /**
   * Update streaming content
   * Only updates store, does NOT persist to database.
   * Use finalizeMessage when streaming is complete.
   */
  updateStreamingContent(taskId: string, messageId: string, content: string): void {
    this.streamingBuffers.set(taskId, { content, messageId });
    this.scheduleStreamingFlush();
  }

  async finalizeMessage(taskId: string, messageId: string, content: string): Promise<void> {
    // Flush any pending streaming updates for this task
    if (this.streamingBuffers.has(taskId)) {
      this.streamingBuffers.delete(taskId);
    }

    // 1. Update store (isStreaming = false)
    useTaskStore.getState().updateMessageContent(taskId, messageId, content, false);

    // 2. Clear streaming state in ExecutionStore
    useExecutionStore.getState().clearStreamingContent(taskId);

    // 3. Persist to database
    try {
      await databaseService.updateMessage(messageId, content);
    } catch (error) {
      logger.error('[MessageService] Failed to persist finalized message:', error);
    }
  }

  @timedMethod('addToolMessage')
  async addToolMessage(taskId: string, toolMessage: UIMessage): Promise<void> {
    // Handle nested tool messages (only update parent's nestedMessages array)
    if (toolMessage.parentToolCallId) {
      useTaskStore
        .getState()
        .addNestedToolMessage(taskId, toolMessage.parentToolCallId, toolMessage);
      return;
    }

    // Add to store (synchronous)
    useTaskStore.getState().addMessage(taskId, toolMessage);

    // Extract tool content from UIMessage format
    const toolContent = Array.isArray(toolMessage.content)
      ? (toolMessage.content[0] as ToolMessageContent)
      : null;
    if (!toolContent) {
      logger.error('[MessageService] Tool message has invalid content format', {
        messageId: toolMessage.id,
      });
      return;
    }

    // Persist to database (asynchronous)
    try {
      const storedContent: StoredToolContent =
        toolContent.type === 'tool-call'
          ? {
              type: 'tool-call',
              toolCallId: toolContent.toolCallId,
              toolName: toolContent.toolName,
              input: toolContent.input as Record<string, unknown>,
            }
          : {
              type: 'tool-result',
              toolCallId: toolContent.toolCallId,
              toolName: toolContent.toolName,
              input: toolContent.input as Record<string, unknown>,
              output: toolContent.output,
              status:
                toolContent.output &&
                typeof toolContent.output === 'object' &&
                'error' in toolContent.output
                  ? 'error'
                  : 'success',
            };

      await databaseService.saveMessage(
        taskId,
        'tool',
        JSON.stringify(storedContent),
        0,
        undefined,
        undefined,
        toolMessage.id
      );
    } catch (error) {
      logger.error('[MessageService] Failed to persist tool message:', error);
    }
  }

  /**
   * Add an attachment to a message and persist
   */
  async addAttachment(
    taskId: string,
    messageId: string,
    attachment: MessageAttachment
  ): Promise<void> {
    // 1. Update store
    const taskStore = useTaskStore.getState();
    const messages = taskStore.getMessages(taskId);
    const message = messages.find((m) => m.id === messageId);

    if (message) {
      const updatedAttachments = [...(message.attachments || []), attachment];
      taskStore.updateMessage(taskId, messageId, { attachments: updatedAttachments });
    }

    // 2. Persist to database
    try {
      await databaseService.saveAttachment(messageId, attachment);
      logger.info('[MessageService] Attachment persisted', {
        messageId,
        attachmentId: attachment.id,
        type: attachment.type,
      });
    } catch (error) {
      logger.error('[MessageService] Failed to persist attachment:', error);
    }
  }

  /**
   * Delete a message from store and database
   */
  async deleteMessage(taskId: string, messageId: string): Promise<void> {
    // 1. Delete from store
    useTaskStore.getState().deleteMessage(taskId, messageId);

    // 2. Delete from database
    try {
      await databaseService.deleteMessage(messageId);
      logger.info('[MessageService] Message deleted', { taskId, messageId });
    } catch (error) {
      logger.error('[MessageService] Failed to delete message from database:', error);
    }
  }

  /**
   * Delete messages from a specific index onwards
   */
  async deleteMessagesFromIndex(taskId: string, index: number): Promise<void> {
    const messages = useTaskStore.getState().getMessages(taskId);
    const messagesToDelete = messages.slice(index);

    // 1. Delete from store
    useTaskStore.getState().deleteMessagesFromIndex(taskId, index);

    // 2. Delete from database (fire-and-forget)
    for (const msg of messagesToDelete) {
      databaseService.deleteMessage(msg.id).catch((error) => {
        logger.error(`[MessageService] Failed to delete message ${msg.id}:`, error);
      });
    }
  }

  /**
   * Update message in store (without persistence)
   * Use this for UI-only updates like collapse state
   */
  updateMessageLocal(taskId: string, messageId: string, updates: Partial<UIMessage>): void {
    useTaskStore.getState().updateMessage(taskId, messageId, updates);
  }
}

export const messageService = new MessageService();
