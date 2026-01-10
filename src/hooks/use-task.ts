// src/hooks/use-task.ts
/**
 * useTask - Hook for single task operations
 *
 * This hook provides access to a single task's data and operations.
 * It combines data from TaskStore (persistent) and ExecutionStore (ephemeral).
 *
 * Design principles:
 * - Derived state for streaming content (merged into messages)
 * - Memoized selectors for performance
 * - Clean separation between read and write operations
 */

import { useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { messageService } from '@/services/message-service';
import { useExecutionStore } from '@/stores/execution-store';
import { useTaskStore } from '@/stores/task-store';
import type { UIMessage } from '@/types/agent';

// Stable empty array reference
const EMPTY_MESSAGES: UIMessage[] = [];

/**
 * Hook for accessing a single task's data and execution state
 */
export function useTask(taskId: string | null | undefined) {
  // Subscribe to only the current task to avoid unrelated updates
  const task = useTaskStore((state) => (taskId ? state.getTask(taskId) : undefined));

  // Subscribe to only the current task's messages
  const messages = useTaskStore((state) => (taskId ? state.getMessages(taskId) : EMPTY_MESSAGES));

  // Subscribe to only the current task's execution state
  const execution = useExecutionStore((state) => (taskId ? state.getExecution(taskId) : undefined));

  // Derived: is this task currently running?
  const isRunning = execution?.status === 'running';

  // Derived: server status (e.g., "Thinking...", "Executing tool...")
  const serverStatus = execution?.serverStatus;

  // Get loading state
  const isLoadingMessages = useTaskStore((state) =>
    taskId ? state.loadingMessages.has(taskId) : false
  );

  return {
    // Data
    task,
    messages,

    // Execution state
    isRunning,
    serverStatus,
    error: execution?.error,

    // Loading states
    isLoadingMessages,

    // Usage info (from task)
    cost: task?.cost ?? 0,
    inputTokens: task?.input_token ?? 0,
    outputTokens: task?.output_token ?? 0,
    contextUsage: task?.context_usage ?? 0,
  };
}

/**
 * Hook for checking if any task is currently running
 */
export function useAnyTaskRunning(): boolean {
  return useExecutionStore((state) => state.getRunningCount() > 0);
}

/**
 * Hook for getting all running task IDs
 */
export function useRunningTaskIds(): string[] {
  return useExecutionStore(useShallow((state) => state.getRunningTaskIds()));
}

/**
 * Hook for checking if a new task execution can be started
 */
export function useCanStartNewExecution(): boolean {
  return useExecutionStore((state) => state.canStartNew());
}

/**
 * Hook for accessing messages by conversation ID
 * Provides message operations like clear, delete, and stop streaming
 */
export function useMessages(conversationId?: string) {
  // Subscribe to only this conversation's messages
  const messages: UIMessage[] = useTaskStore((state) =>
    conversationId ? state.getMessages(conversationId) : EMPTY_MESSAGES
  );

  // Clear messages
  const clearMessages = useCallback(() => {
    if (conversationId) {
      useTaskStore.getState().clearMessages(conversationId);
    }
  }, [conversationId]);

  // Stop streaming
  const stopStreaming = useCallback(() => {
    if (conversationId) {
      useTaskStore.getState().stopStreaming(conversationId);
    }
  }, [conversationId]);

  // Delete message
  const deleteMessage = useCallback(
    async (messageId: string) => {
      if (conversationId) {
        await messageService.deleteMessage(conversationId, messageId);
      }
    },
    [conversationId]
  );

  // Delete messages from index
  const deleteMessagesFromIndex = useCallback(
    async (index: number) => {
      if (conversationId) {
        await messageService.deleteMessagesFromIndex(conversationId, index);
      }
    },
    [conversationId]
  );

  // Find message index
  const findMessageIndex = useCallback(
    (messageId: string): number => {
      return messages.findIndex((msg) => msg.id === messageId);
    },
    [messages]
  );

  return {
    messages,
    clearMessages,
    stopStreaming,
    deleteMessage,
    deleteMessagesFromIndex,
    findMessageIndex,
  };
}
