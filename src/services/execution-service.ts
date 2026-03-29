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
import { autoCodeReviewHookService } from '@/services/agents/auto-code-review-hook-service';
import { completionHookPipeline } from '@/services/agents/llm-completion-hooks';
import { createLLMService, type LLMService } from '@/services/agents/llm-service';
import { ralphLoopService } from '@/services/agents/ralph-loop-service';
import { stopHookService } from '@/services/agents/stop-hook-service';
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
  private hooksRegistered = false;

  /**
   * Register completion hooks (called once during app initialization)
   */
  registerCompletionHooks(): void {
    if (this.hooksRegistered) {
      return;
    }

    // Register hooks in priority order:
    // 10: Stop Hook (first)
    // 20: Ralph Loop (second)
    // 30: Auto Code Review (last)
    completionHookPipeline.register(stopHookService);
    completionHookPipeline.register(ralphLoopService);
    completionHookPipeline.register(autoCodeReviewHookService);

    logger.info('[ExecutionService] Registered completion hooks', {
      hooks: completionHookPipeline.getRegisteredHooks(),
    });

    this.hooksRegistered = true;
  }

  /**
   * Start execution for a task
   */
  async startExecution(config: ExecutionConfig, callbacks?: ExecutionCallbacks): Promise<void> {
    const { taskId, messages, model, systemPrompt, tools, agentId } = config;

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
    let worktreePath: string | null = null;
    try {
      worktreePath = await useWorktreeStore.getState().acquireForTask(taskId, runningTaskIds);
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

    let currentMessageId = '';
    let streamedContent = '';
    let llmService: LLMService | undefined;

    try {
      // 3. Create independent LLMService instance for this task
      llmService = createLLMService(taskId);
      this.llmServiceInstances.set(taskId, llmService);

      const finalizeExecution = async (finalText?: string) => {
        // Prefer finalText if it's longer (complete) over potentially truncated streamedContent
        const text =
          finalText && finalText.length >= streamedContent.length
            ? finalText
            : streamedContent || '';
        if (currentMessageId && text) {
          await messageService.finalizeMessage(taskId, currentMessageId, text);
          streamedContent = '';
        }

        const runningUsage = useTaskStore.getState().runningTaskUsage.get(taskId);
        if (runningUsage) {
          try {
            await taskService.updateTaskUsage(
              taskId,
              runningUsage.costDelta,
              runningUsage.inputTokensDelta,
              runningUsage.outputTokensDelta,
              runningUsage.requestCountDelta,
              runningUsage.contextUsage
            );
            useTaskStore.getState().flushRunningTaskUsage(taskId);
          } catch (err) {
            logger.warn('[ExecutionService] Failed to persist task usage', err);
          } finally {
            useTaskStore.getState().clearRunningTaskUsage(taskId);
          }
        }
      };

      const handleCompletion = async (fullText: string, success: boolean = true) => {
        if (abortController.signal.aborted) return;

        await finalizeExecution(fullText);

        if (success) {
          try {
            await notificationService.notifyHooked(
              taskId,
              'Task Complete',
              'TalkCody agent has finished processing',
              'agent_complete'
            );
          } catch (err) {
            logger.warn('[ExecutionService] Notification failed', err);
          }
        }

        callbacks?.onComplete?.({ success, fullText });
      };

      // Run agent loop with callbacks that route through services
      // Completion hooks (stop hook, ralph loop, auto review) are handled internally by LLMService
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

            await handleCompletion(fullText);
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

          onAttachment: async (attachment) => {
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

      // Release worktree if acquired
      if (worktreePath && useWorktreeStore.getState().isTaskUsingWorktree(taskId)) {
        useWorktreeStore
          .getState()
          .releaseForTask(taskId)
          .catch((err) => {
            logger.warn('[ExecutionService] Failed to release worktree', err);
          });
      }

      // Only mark as completed if still running (not already stopped or errored)
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

    // Clear running usage to avoid stale metrics
    useTaskStore.getState().clearRunningTaskUsage(taskId);

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
}

export const executionService = new ExecutionService();
