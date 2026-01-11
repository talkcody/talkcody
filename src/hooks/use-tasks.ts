// src/hooks/use-tasks.ts

import { useCallback, useState } from 'react';
import { logger } from '@/lib/logger';
import { databaseService } from '@/services/database-service';
import { taskService } from '@/services/task-service';
import { useTaskStore } from '@/stores/task-store';
import { useUIStateStore } from '@/stores/ui-state-store';
import { useWorktreeStore } from '@/stores/worktree-store';

// Import for local use
import type { Task } from '@/types';

// Type for delete task result
export interface DeleteTaskResult {
  deleted: boolean;
  requiresConfirmation?: boolean;
  changesCount?: number;
  message?: string;
}

export function useTasks(onTaskStart?: (taskId: string, title: string) => void) {
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState<number>(0);
  const [hasMore, setHasMore] = useState<boolean>(true);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);

  const normalizeSearch = useCallback((searchTerm?: string) => {
    const trimmed = searchTerm?.trim() ?? '';
    return trimmed.length > 0 ? trimmed : '';
  }, []);

  // Get task list from store (sorted with internal cache)
  const tasks = useTaskStore((state) => state.getTaskList());
  const currentTaskId = useTaskStore((state) => state.currentTaskId);
  const loadingTasks = useTaskStore((state) => state.loadingTasks);

  // UI state for editing
  const editingTaskId = useUIStateStore((state) => state.editingTaskId);
  const editingTitle = useUIStateStore((state) => state.editingTitle);
  const setEditingTitle = useUIStateStore((state) => state.setEditingTitle);
  const startEditingUI = useUIStateStore((state) => state.startEditing);
  const cancelEditingUI = useUIStateStore((state) => state.cancelEditing);
  const finishEditingUI = useUIStateStore((state) => state.finishEditing);

  const limit = 20;

  // Load tasks with pagination (initial load)
  const loadTasks = useCallback(
    async (projectId?: string, searchTerm?: string) => {
      try {
        setOffset(0);
        setHasMore(true);
        const normalizedSearch = normalizeSearch(searchTerm);
        const tasks = normalizedSearch
          ? await taskService.loadTasksWithSearchPagination(
              normalizedSearch,
              projectId,
              limit,
              0,
              true,
              true
            )
          : await taskService.loadTasksWithPagination(projectId, limit, 0, true, true);
        // Update offset for next load
        setOffset(tasks.length);
        // Check if there are more tasks
        if (tasks.length < limit) {
          setHasMore(false);
        }
      } catch (err) {
        logger.error('Failed to load tasks:', err);
        setError('Failed to load tasks');
      }
    },
    [normalizeSearch]
  );

  // Load more tasks (infinite scroll)
  const loadMoreTasks = useCallback(
    async (projectId?: string, searchTerm?: string) => {
      if (loadingMore || !hasMore) return;

      setLoadingMore(true);
      try {
        const normalizedSearch = normalizeSearch(searchTerm);
        const tasks = normalizedSearch
          ? await taskService.loadTasksWithSearchPagination(
              normalizedSearch,
              projectId,
              limit,
              offset,
              false,
              false
            )
          : await taskService.loadTasksWithPagination(projectId, limit, offset, false, false);
        // Update offset for next load
        setOffset((prev) => prev + tasks.length);
        // Check if there are more tasks
        if (tasks.length < limit) {
          setHasMore(false);
        }
      } catch (err) {
        logger.error('Failed to load more tasks:', err);
        setError('Failed to load more tasks');
      } finally {
        setLoadingMore(false);
      }
    },
    [offset, hasMore, loadingMore, normalizeSearch]
  );

  const loadTask = useCallback(
    async (
      taskId: string,
      onMessagesLoaded?: (
        messages: Array<{ id: string; role: string; content: string; created_at: number }>
      ) => void
    ) => {
      try {
        const messages = await taskService.loadMessages(taskId);
        // Convert UIMessage[] to the expected format with created_at timestamp
        const formattedMessages = messages.map((msg) => ({
          id: msg.id,
          role: msg.role,
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
          created_at: msg.timestamp.getTime(),
        }));
        onMessagesLoaded?.(formattedMessages);
        useTaskStore.getState().setCurrentTaskId(taskId);
      } catch (err) {
        logger.error('Failed to load task:', err);
        setError('Failed to load task');
      }
    },
    []
  );

  // Create task
  const createTask = useCallback(
    async (userMessage: string): Promise<string> => {
      const taskId = await taskService.createTask(userMessage, {
        onTaskStart: onTaskStart,
      });
      return taskId;
    },
    [onTaskStart]
  );

  // Select task
  const selectTask = useCallback(async (taskId: string) => {
    await taskService.selectTask(taskId);
  }, []);

  // Set current task ID
  const setCurrentTaskId = useCallback((taskId: string | undefined) => {
    useTaskStore.getState().setCurrentTaskId(taskId || null);
  }, []);

  // Delete task - checks for worktree changes and returns warning if needed
  const deleteTask = useCallback(
    async (taskId: string, options?: { force?: boolean }): Promise<DeleteTaskResult> => {
      // Check for worktree changes if not forcing deletion
      const worktreeState = useWorktreeStore.getState();
      if (worktreeState.isTaskUsingWorktree(taskId) && !options?.force) {
        const worktree = worktreeState.getWorktreeForTask(taskId);
        if (worktree && worktree.changesCount > 0) {
          // Return warning instead of deleting
          return {
            deleted: false,
            requiresConfirmation: true,
            changesCount: worktree.changesCount,
            message: `This task has ${worktree.changesCount} uncommitted file changes in worktree that will be lost.`,
          };
        }
      }
      await taskService.deleteTask(taskId);
      return { deleted: true };
    },
    []
  );

  // Save message (for backward compatibility)
  const saveMessage = useCallback(
    async (
      taskId: string,
      role: string,
      content: string,
      positionIndex: number,
      agentId?: string,
      attachments?: Array<{ name: string; type: string; data: string }>
    ) => {
      // Transform attachments to match MessageAttachment interface
      const transformedAttachments = attachments?.map((att) => ({
        id: crypto.randomUUID(),
        type: att.type as 'image' | 'file' | 'code',
        filename: att.name,
        filePath: '',
        mimeType: '',
        size: 0,
        content: att.data,
      }));
      await databaseService.saveMessage(
        taskId,
        role as 'user' | 'assistant' | 'tool',
        content,
        positionIndex,
        agentId,
        transformedAttachments
      );
    },
    []
  );

  // Get task details
  const getTaskDetails = useCallback(async (taskId: string) => {
    return await databaseService.getTaskDetails(taskId);
  }, []);

  // Start new chat
  const startNewTask = useCallback(() => {
    taskService.startNewTask();
  }, []);

  // Editing functions
  const startEditing = useCallback(
    (task: Task, e?: React.MouseEvent) => {
      const existingTask = useTaskStore.getState().getTask(task.id);
      if (existingTask) {
        startEditingUI(existingTask, e);
      }
    },
    [startEditingUI]
  );

  const cancelEditing = useCallback(() => {
    cancelEditingUI();
  }, [cancelEditingUI]);

  const finishEditing = useCallback(async () => {
    const result = finishEditingUI();
    if (result) {
      await taskService.renameTask(result.taskId, result.title);
    }
  }, [finishEditingUI]);

  return {
    // Data
    tasks,
    currentTaskId: currentTaskId ?? undefined,
    loading: loadingTasks,
    loadingMore,
    error,
    offset,
    hasMore,

    // Editing state
    editingId: editingTaskId,
    editingTitle,
    setEditingTitle,

    // Actions
    loadTasks,
    loadMoreTasks,
    loadTask,
    createTask,
    selectTask,
    setCurrentTaskId,
    deleteTask,
    saveMessage,
    getTaskDetails,
    startNewTask,
    setError,

    // Editing actions
    startEditing,
    cancelEditing,
    finishEditing,
  };
}
