// src/services/execution-service.ts
/**
 * ExecutionService - LLM execution management
 *
 * This service manages the execution of AI agent loops:
 * - Starts and stops task executions
 * - Manages LLMService instances per task
 * - Coordinates between stores and services
 *
 * Design principles:
 * - Each task gets its own LLMService instance for isolation
 * - Concurrent execution support (up to maxConcurrent tasks)
 * - All callbacks route through MessageService for persistence
 */

import { logger } from '@/lib/logger';
import { createLLMService, type LLMService } from '@/services/agents/llm-service';
import { messageService } from '@/services/message-service';
import { notificationService } from '@/services/notification-service';
import { taskService } from '@/services/task-service';
import { useExecutionStore } from '@/stores/execution-store';
import { useTaskStore } from '@/stores/task-store';
import { useWorktreeStore } from '@/stores/worktree-store';
import type { AgentToolSet, UIMessage } from '@/types/agent';

/**
 * Configuration for starting an execution
 */
export interface ExecutionConfig {
  taskId: string;
  messages: UIMessage[];
  model: string;
  systemPrompt?: string;
  tools?: AgentToolSet;
  agentId?: string;
  isNewTask?: boolean;
  userMessage?: string;
}

/**
 * Callbacks for execution events
 */
export interface ExecutionCallbacks {
  onComplete?: (result: { success: boolean; fullText: string }) => void;
  onError?: (error: Error) => void;
}

class ExecutionService {
  private llmServiceInstances = new Map<string, LLMService>();

  /**
   * Start execution for a task
   */
  async startExecution(config: ExecutionConfig, callbacks?: ExecutionCallbacks): Promise<void> {
    const { taskId, messages, model, systemPrompt, tools, agentId, isNewTask, userMessage } =
      config;

    const executionStore = useExecutionStore.getState();

    // 1. Check concurrency limit and start execution tracking
    const { success, abortController, error } = executionStore.startExecution(taskId);
    if (!success || !abortController) {
      const execError = new Error(error || 'Failed to start execution');
      callbacks?.onError?.(execError);
      throw execError;
    }

    // 2. Try to acquire worktree for parallel execution (if enabled and needed)
    const runningTaskIds = this.getRunningTaskIds().filter((id) => id !== taskId);
    try {
      const worktreePath = await useWorktreeStore.getState().acquireForTask(taskId, runningTaskIds);
      if (worktreePath) {
        logger.info('[ExecutionService] Task using worktree', { taskId, worktreePath });
      }
    } catch (worktreeError) {
      // Log warning but continue - task will work in main project directory
      logger.warn(
        '[ExecutionService] Worktree acquisition failed, using main project',
        worktreeError
      );
    }

    // 3. Create independent LLMService instance for this task
    const llmService = createLLMService(taskId);
    this.llmServiceInstances.set(taskId, llmService);

    let currentMessageId = '';
    let streamedContent = '';

    try {
      // 4. Run agent loop with callbacks that route through services
      await llmService.runAgentLoop(
        {
          messages,
          model,
          systemPrompt,
          tools,
          agentId,
        },
        {
          onAssistantMessageStart: () => {
            if (abortController.signal.aborted) return;

            // Skip if a message was just created but hasn't received content
            if (currentMessageId && !streamedContent) {
              logger.info('[ExecutionService] Skipping duplicate message start', { taskId });
              return;
            }

            // Finalize previous message if any
            if (currentMessageId && streamedContent) {
              messageService
                .finalizeMessage(taskId, currentMessageId, streamedContent)
                .catch((err) => logger.error('Failed to finalize previous message:', err));
            }

            // Reset for new message
            streamedContent = '';
            currentMessageId = messageService.createAssistantMessage(taskId, agentId);
          },

          onChunk: (chunk: string) => {
            if (abortController.signal.aborted) return;
            streamedContent += chunk;
            if (currentMessageId) {
              messageService.updateStreamingContent(taskId, currentMessageId, streamedContent);
            }
          },

          onComplete: async (fullText: string) => {
            if (abortController.signal.aborted) return;

            // Finalize the last message
            if (currentMessageId && streamedContent) {
              await messageService.finalizeMessage(taskId, currentMessageId, streamedContent);
              streamedContent = '';
            }

            // Persist running usage into task record once per execution
            const runningUsage = useTaskStore.getState().runningTaskUsage.get(taskId);
            if (runningUsage) {
              // Use finally to ensure clearRunningTaskUsage is called only after DB write completes
              await taskService
                .updateTaskUsage(
                  taskId,
                  runningUsage.costDelta,
                  runningUsage.inputTokensDelta,
                  runningUsage.outputTokensDelta,
                  runningUsage.contextUsage
                )
                .then(() => {
                  // Flush running usage into task record after persistence
                  useTaskStore.getState().flushRunningTaskUsage(taskId);
                })
                .finally(() => {
                  // Clear running usage only after DB write completes
                  useTaskStore.getState().clearRunningTaskUsage(taskId);
                });
            }

            // Post-processing
            await this.handlePostProcessing(taskId, isNewTask, userMessage);

            // Call external callback
            callbacks?.onComplete?.({ success: true, fullText });
          },

          onError: (error: Error) => {
            if (abortController.signal.aborted) return;

            logger.error('[ExecutionService] Agent loop error', error);
            executionStore.setError(taskId, error.message);

            // Clear running usage on error to avoid stale data
            useTaskStore.getState().clearRunningTaskUsage(taskId);

            callbacks?.onError?.(error);
          },

          onStatus: (status: string) => {
            if (abortController.signal.aborted) return;
            executionStore.setServerStatus(taskId, status);
          },

          onToolMessage: async (uiMessage: UIMessage) => {
            if (abortController.signal.aborted) return;

            const toolMessage: UIMessage = {
              ...uiMessage,
              assistantId: uiMessage.assistantId || agentId,
            };

            await messageService.addToolMessage(taskId, toolMessage);
          },

          onAttachment: async (attachment: any) => {
            if (abortController.signal.aborted) return;
            if (currentMessageId) {
              await messageService.addAttachment(taskId, currentMessageId, attachment);
            }
          },
        },
        abortController
      );
    } catch (error) {
      if (!abortController.signal.aborted) {
        const execError = error instanceof Error ? error : new Error(String(error));
        executionStore.setError(taskId, execError.message);
        callbacks?.onError?.(execError);
      }
    } finally {
      this.llmServiceInstances.delete(taskId);

      // Ensure execution is marked as completed/stopped
      if (executionStore.isRunning(taskId)) {
        executionStore.completeExecution(taskId);
      }
    }
  }

  /**
   * Stop execution for a task
   */
  stopExecution(taskId: string): void {
    const executionStore = useExecutionStore.getState();
    executionStore.stopExecution(taskId);
    this.llmServiceInstances.delete(taskId);

    // Stop streaming in task store
    useTaskStore.getState().stopStreaming(taskId);

    logger.info('[ExecutionService] Execution stopped', { taskId });
  }

  /**
   * Check if a task is running
   */
  isRunning(taskId: string): boolean {
    return useExecutionStore.getState().isRunning(taskId);
  }

  /**
   * Get running task IDs
   */
  getRunningTaskIds(): string[] {
    return useExecutionStore.getState().getRunningTaskIds();
  }

  /**
   * Check if a new execution can be started
   */
  canStartNew(): boolean {
    return useExecutionStore.getState().canStartNew();
  }

  /**
   * Handle post-processing after agent loop completes
   */
  private async handlePostProcessing(
    taskId: string,
    isNewTask?: boolean,
    userMessage?: string
  ): Promise<void> {
    // AI title generation is now done asynchronously immediately after task creation
    // to provide faster title updates without waiting for the entire task to complete

    // Send notification if window is not focused
    await notificationService.notifyAgentComplete();
  }
}

export const executionService = new ExecutionService();
