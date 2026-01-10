// src/services/task-service.ts
/**
 * TaskService - Unified entry point for task operations
 *
 * This service provides a single entry point for all task operations,
 * ensuring consistent state updates between TaskStore and database.
 *
 * Design principles:
 * - Synchronous store updates for immediate UI response
 * - Asynchronous database persistence
 * - All task operations go through this service
 */

import { logger } from '@/lib/logger';
import { mapStoredMessagesToUI } from '@/lib/message-mapper';
import { generateConversationTitle, generateId } from '@/lib/utils';
import { databaseService } from '@/services/database-service';
import { taskFileService } from '@/services/task-file-service';
import { useEditReviewStore } from '@/stores/edit-review-store';
import { useExecutionStore } from '@/stores/execution-store';
import { useFileChangesStore } from '@/stores/file-changes-store';
import { usePlanModeStore } from '@/stores/plan-mode-store';
import { settingsManager } from '@/stores/settings-store';
import { useTaskStore } from '@/stores/task-store';
import { useUserQuestionStore } from '@/stores/user-question-store';
import { useWorktreeStore } from '@/stores/worktree-store';
import type { Task, TaskSettings } from '@/types';
import type { UIMessage } from '@/types/agent';

class TaskService {
  async createTask(
    userMessage: string,
    options?: {
      projectId?: string;
      onTaskStart?: (taskId: string, title: string) => void;
    }
  ): Promise<string> {
    const taskId = generateId();
    const title = generateConversationTitle(userMessage);
    const projectId = options?.projectId || (await settingsManager.getProject());

    const task: Task = {
      id: taskId,
      title,
      project_id: projectId,
      created_at: Date.now(),
      updated_at: Date.now(),
      message_count: 0,
      cost: 0,
      input_token: 0,
      output_token: 0,
    };

    // 1. Update store (synchronous)
    useTaskStore.getState().addTask(task);
    useTaskStore.getState().setCurrentTaskId(taskId);

    // 2. Persist to database
    try {
      await databaseService.createTask(title, taskId, projectId);
      logger.info('[TaskService] Task created', { taskId, title });
    } catch (error) {
      logger.error('[TaskService] Failed to create task:', error);
      // Remove from store on error
      useTaskStore.getState().removeTask(taskId);
      throw error;
    }

    // 3. Notify callback
    options?.onTaskStart?.(taskId, title);

    // 4. Acquire worktree if enabled and other tasks are running
    const runningTaskIds = useExecutionStore.getState().getRunningTaskIds();
    logger.info('[TaskService] createTask checking worktree', {
      taskId,
      runningTaskIds,
      count: runningTaskIds.length,
    });
    if (runningTaskIds.length > 0) {
      try {
        const worktreePath = await useWorktreeStore
          .getState()
          .acquireForTask(taskId, runningTaskIds);
        logger.info('[TaskService] Acquired worktree for task', { taskId, worktreePath });
      } catch (error) {
        logger.warn('[TaskService] Failed to acquire worktree:', error);
      }
    }

    return taskId;
  }

  /**
   * Load all tasks for a project
   */
  async loadTasks(projectId?: string): Promise<void> {
    const taskStore = useTaskStore.getState();
    taskStore.setLoadingTasks(true);
    taskStore.setError(null);

    try {
      const tasks = projectId
        ? await databaseService.getTasks(projectId)
        : await databaseService.getTasks();

      taskStore.setTasks(tasks);
      logger.info('[TaskService] Tasks loaded', { projectId, count: tasks.length });
    } catch (error) {
      logger.error('[TaskService] Failed to load tasks:', error);
      taskStore.setError('Failed to load tasks');
    } finally {
      taskStore.setLoadingTasks(false);
    }
  }

  /**
   * Load messages for a task
   */
  async loadMessages(taskId: string): Promise<UIMessage[]> {
    const taskStore = useTaskStore.getState();
    taskStore.setLoadingMessages(taskId, true);

    try {
      const storedMessages = await databaseService.getMessages(taskId);
      const messages = mapStoredMessagesToUI(storedMessages);

      taskStore.setMessages(taskId, messages);

      // LRU: touch cache and evict if needed
      taskStore.touchMessageCache(taskId);
      const runningTaskIds = useExecutionStore.getState().getRunningTaskIds();
      taskStore.evictOldestMessages(runningTaskIds);

      logger.info('[TaskService] Messages loaded', { taskId, count: messages.length });

      return messages;
    } catch (error) {
      logger.error('[TaskService] Failed to load messages:', error);
      taskStore.setError('Failed to load messages');
      return [];
    } finally {
      taskStore.setLoadingMessages(taskId, false);
    }
  }

  /**
   * Select a task (set as current and load messages if not cached)
   */
  async selectTask(taskId: string): Promise<void> {
    const taskStore = useTaskStore.getState();

    // Set as current task
    taskStore.setCurrentTaskId(taskId);
    settingsManager.setCurrentTaskId(taskId);

    // Touch cache for LRU tracking
    taskStore.touchMessageCache(taskId);

    // Load messages if not cached
    const existingMessages = taskStore.getMessages(taskId);
    if (existingMessages.length === 0) {
      await this.loadMessages(taskId);
    }

    // Update usage tracking from database
    try {
      const details = await databaseService.getTaskDetails(taskId);
      if (details) {
        taskStore.updateTask(taskId, {
          cost: details.cost,
          input_token: details.input_token,
          output_token: details.output_token,
        });
      }
    } catch (error) {
      logger.error('[TaskService] Failed to load task details:', error);
    }
  }

  /**
   * Delete a task
   */
  async deleteTask(taskId: string): Promise<void> {
    logger.info('[TaskService] Deleting task and cleaning up all related state', { taskId });

    // 1. Release worktree if task is using one
    const worktreeState = useWorktreeStore.getState();
    if (worktreeState.isTaskUsingWorktree(taskId)) {
      try {
        await worktreeState.releaseForTask(taskId);
        logger.info('[TaskService] Released worktree for deleted task', { taskId });
      } catch (error) {
        logger.warn('[TaskService] Failed to release worktree, continuing with deletion', error);
        // Continue with deletion even if worktree release fails
      }
    }

    // 2. Clean up all task-related state from various stores
    // This prevents memory leaks and stale state when tasks are deleted
    try {
      // Clean up edit review state (pending file edits)
      useEditReviewStore.getState().clearPendingEdit(taskId);

      // Clean up user question state (pending questions)
      useUserQuestionStore.getState().clearQuestions(taskId);

      // Clean up file changes state
      useFileChangesStore.getState().clearTask(taskId);

      // Clean up plan mode state (pending plans)
      usePlanModeStore.getState().clearPendingPlan(taskId);

      // Clean up execution state (only if not running)
      useExecutionStore.getState().cleanupExecution(taskId);

      logger.info('[TaskService] Cleaned up all related stores for task', { taskId });
    } catch (error) {
      logger.warn('[TaskService] Error during store cleanup, continuing with deletion', error);
      // Continue with deletion even if cleanup fails
    }

    // 3. Remove from task store
    useTaskStore.getState().removeTask(taskId);

    // 4. Delete from database
    try {
      await databaseService.deleteTask(taskId);
      logger.info('[TaskService] Task deleted from database', { taskId });
    } catch (error) {
      logger.error('[TaskService] Failed to delete task from database:', error);
      throw error;
    }

    // 5. Clean up compacted messages file
    try {
      await taskFileService.cleanupType('context', taskId);
      logger.info('[TaskService] Cleaned up compacted messages file', { taskId });
    } catch (error) {
      logger.warn('[TaskService] Failed to clean up compacted messages file:', error);
    }
  }

  /**
   * Rename a task
   */
  async renameTask(taskId: string, title: string): Promise<void> {
    // 1. Update store
    useTaskStore.getState().updateTask(taskId, { title, updated_at: Date.now() });

    // 2. Persist to database
    try {
      await databaseService.updateTaskTitle(taskId, title);
      logger.info('[TaskService] Task renamed', { taskId, title });
    } catch (error) {
      logger.error('[TaskService] Failed to rename task:', error);
      throw error;
    }
  }

  /**
   * Update task settings
   */
  async updateTaskSettings(taskId: string, settings: TaskSettings): Promise<void> {
    // 1. Update store
    useTaskStore.getState().updateTaskSettings(taskId, settings);

    // 2. Persist to database
    try {
      await databaseService.updateTaskSettings(taskId, JSON.stringify(settings));
      logger.info('[TaskService] Task settings updated', { taskId, settings });
    } catch (error) {
      logger.error('[TaskService] Failed to update task settings:', error);
      throw error;
    }
  }

  /**
   * Update task usage (cost, tokens)
   */
  async updateTaskUsage(
    taskId: string,
    cost: number,
    inputTokens: number,
    outputTokens: number
  ): Promise<void> {
    // 1. Update store (accumulate)
    useTaskStore.getState().updateTaskUsage(taskId, {
      costDelta: cost,
      inputTokensDelta: inputTokens,
      outputTokensDelta: outputTokens,
    });

    // 2. Persist to database
    try {
      await databaseService.updateTaskUsage(taskId, cost, inputTokens, outputTokens);
      logger.info('[TaskService] Task usage updated', { taskId, cost, inputTokens, outputTokens });
    } catch (error) {
      logger.error('[TaskService] Failed to update task usage:', error);
    }
  }

  /**
   * Get task details
   */
  async getTaskDetails(taskId: string): Promise<Task | null> {
    // Try store first
    const cachedTask = useTaskStore.getState().getTask(taskId);
    if (cachedTask) {
      return cachedTask;
    }

    // Fetch from database
    try {
      const task = await databaseService.getTaskDetails(taskId);
      if (!task) return null;

      // Update store cache
      useTaskStore.getState().addTask(task);

      return task;
    } catch (error) {
      logger.error('[TaskService] Failed to get task details:', error);
      return null;
    }
  }

  /**
   * Start a new chat (clear current task)
   */
  startNewChat(): void {
    useTaskStore.getState().setCurrentTaskId(null);
    // Note: settingsManager.setCurrentTaskId requires a string,
    // but clearing it requires passing empty string to indicate no selection
    settingsManager.setCurrentTaskId('');
  }
}

export const taskService = new TaskService();
