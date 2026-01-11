// src/services/task-manager.ts

import { logger } from '@/lib/logger';
import { generateConversationTitle, generateId } from '@/lib/utils';
import { databaseService } from '@/services/database-service';
import { settingsManager } from '@/stores/settings-store';
import { useTaskStore } from '@/stores/task-store';
import { aiTaskTitleService } from './ai/ai-task-title-service';

/**
 * TaskManager - Provides a unified interface for task operations for the service layer
 * This class encapsulates all task-related database operations and can be used directly by service classes
 */
export class TaskManager {
  private constructor() {}

  /**
   * Create new task
   */
  static async createTask(userInput: string, projectId?: string): Promise<string> {
    const title = generateConversationTitle(userInput);
    const taskId = generateId();
    const currentProject = projectId || (await settingsManager.getProject());

    await databaseService.createTask(title, taskId, currentProject);

    return taskId;
  }

  /**
   * Get task details
   */
  static async getTaskDetails(taskId: string) {
    return await databaseService.getTaskDetails(taskId);
  }

  /**
   * Update task usage statistics
   */
  static async updateTaskUsage(
    taskId: string,
    cost: number,
    inputToken: number,
    outputToken: number,
    contextUsage?: number
  ): Promise<void> {
    await databaseService.updateTaskUsage(taskId, cost, inputToken, outputToken, contextUsage);
  }

  /**
   * Delete task
   */
  static async deleteTask(taskId: string): Promise<void> {
    await databaseService.deleteTask(taskId);
  }

  /**
   * Update task title
   */
  static async updateTaskTitle(taskId: string, title: string): Promise<void> {
    await databaseService.updateTaskTitle(taskId, title);
  }

  /**
   * Get latest user message content
   */
  static async getLatestUserMessageContent(): Promise<string | null> {
    const taskId = useTaskStore.getState().currentTaskId;
    if (!taskId) return null;
    return await databaseService.getLatestUserMessageContent(taskId);
  }

  /**
   * Update task settings
   */
  static async updateTaskSettings(taskId: string, settings: string): Promise<void> {
    await databaseService.updateTaskSettings(taskId, settings);
  }

  /**
   * Get task settings
   */
  static async getTaskSettings(taskId: string): Promise<string | null> {
    return await databaseService.getTaskSettings(taskId);
  }

  /**
   * Generate AI title for task and update it asynchronously
   * This method is fire-and-forget - it runs in the background without blocking
   */
  static async generateAndUpdateTitle(taskId: string, userInput: string): Promise<void> {
    try {
      logger.info('Generating AI title for task:', taskId);

      const result = await aiTaskTitleService.generateTitle(userInput);

      if (result?.title) {
        await TaskManager.updateTaskTitle(taskId, result.title);
        logger.info('AI title updated successfully:', result.title);
      } else {
        logger.warn('AI title generation returned no result, keeping fallback title');
      }
    } catch (error) {
      logger.error('Failed to generate/update AI title:', error);
      // Silently fail - the fallback title is already in place
    }
  }
}
