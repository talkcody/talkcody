// src/services/agents/check-finish-hook-service.ts
/**
 * Check Finish Hook Service - Completion Hook Implementation
 *
 * Implements task completion verification as a completion hook.
 * Priority: 26 (runs after Auto Git Commit: 25, before Auto Code Review: 30)
 *
 * This hook uses LLM to check if the current code implementation actually
 * completes the user's task or requirements. If not complete, it outputs
 * a todo list as a user message to continue the task.
 */

import { logger } from '@/lib/logger';
import { checkFinishService, lastCheckFinishTimestamp } from '@/services/check-finish-service';
import { messageService } from '@/services/message-service';
import type {
  CompletionHook,
  CompletionHookContext,
  CompletionHookResult,
} from '@/types/completion-hooks';

export class CheckFinishHookService implements CompletionHook {
  /** Hook name for identification */
  readonly name = 'check-finish';

  /**
   * Hook priority (26 = after auto git commit: 25, before auto code review: 30)
   * This ensures:
   * 1. Code is committed first (if enabled)
   * 2. Then we check if task is truly complete
   * 3. Finally, code review runs (which may find issues even if task appears complete)
   */
  readonly priority = 26;

  /**
   * Check if this hook should run
   */
  shouldRun(context: CompletionHookContext): boolean {
    const hasTaskId = !!context.taskId;
    const isSubagent = this.isSubagent(context);
    const shouldRun = hasTaskId && !isSubagent;

    if (!shouldRun) {
      logger.info('[CheckFinishHook] Skipping hook in shouldRun', {
        taskId: context.taskId,
        iteration: context.iteration,
        hasTaskId,
        isSubagent,
      });
    }

    return shouldRun;
  }

  /**
   * Check if this is a subagent execution
   */
  private isSubagent(context: CompletionHookContext): boolean {
    return context.taskId === 'nested' || context.taskId?.startsWith('nested-') || false;
  }

  /**
   * Execute check finish verification
   */
  async run(context: CompletionHookContext): Promise<CompletionHookResult> {
    const { taskId, userMessage } = context;

    if (!taskId) {
      return { action: 'skip' };
    }

    logger.info('[CheckFinishHook] Running task completion check', {
      taskId,
      iteration: context.iteration,
      toolSummaryCount: context.toolSummaries.length,
      userMessageLength: userMessage?.length ?? 0,
    });

    try {
      const checkResult = await checkFinishService.run(taskId, userMessage);

      if (checkResult) {
        logger.info('[CheckFinishHook] Task incomplete, requesting continuation with todo list', {
          taskId,
          continuationMode: 'append',
          checkResultLength: checkResult.length,
        });

        // Add check result as user message for next iteration
        const persistedMessageId = await messageService.addUserMessage(taskId, checkResult);

        logger.info('[CheckFinishHook] Persisted continuation message for next iteration', {
          taskId,
          persistedMessageId,
        });

        return {
          action: 'continue',
          continuationMode: 'append',
          nextMessages: [
            {
              id: `check-finish-${Date.now()}`,
              role: 'user',
              content: checkResult,
              timestamp: new Date(),
            },
          ],
        };
      }

      // Task appears complete, clear timestamp and skip to next hook (code review)
      lastCheckFinishTimestamp.delete(taskId);

      logger.info('[CheckFinishHook] Check-finish service returned no continuation message', {
        taskId,
        clearedLastCheckTimestamp: true,
      });
      logger.info('[CheckFinishHook] Task appears complete, passing to next hook', { taskId });
      return { action: 'skip' };
    } catch (error) {
      logger.error('[CheckFinishHook] Error running check finish:', error, {
        taskId,
        iteration: context.iteration,
      });
      // On error, skip to allow other hooks to run
      return { action: 'skip' };
    }
  }
}

// Singleton instance
export const checkFinishHookService = new CheckFinishHookService();
