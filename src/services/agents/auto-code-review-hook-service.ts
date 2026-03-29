// src/services/agents/auto-code-review-hook-service.ts
/**
 * Auto Code Review Hook Service - Completion Hook Implementation
 *
 * Implements auto code review as a completion hook.
 * Priority: 30 (runs after Stop Hook: 10 and Ralph Loop: 20)
 */

import { logger } from '@/lib/logger';
import {
  autoCodeReviewService,
  lastReviewedChangeTimestamp,
} from '@/services/auto-code-review-service';
import { messageService } from '@/services/message-service';
import type {
  CompletionHook,
  CompletionHookContext,
  CompletionHookResult,
} from '@/types/completion-hooks';

export class AutoCodeReviewHookService implements CompletionHook {
  /** Hook name for identification */
  readonly name = 'auto-code-review';

  /** Hook priority (30 = after stop hook and ralph loop) */
  readonly priority = 30;

  /**
   * Check if this hook should run
   */
  shouldRun(context: CompletionHookContext): boolean {
    // Only run for main tasks (not subagents)
    return !!context.taskId && !this.isSubagent(context);
  }

  /**
   * Check if this is a subagent execution
   */
  private isSubagent(context: CompletionHookContext): boolean {
    return context.taskId === 'nested' || context.taskId?.startsWith('nested-') || false;
  }

  /**
   * Execute auto code review
   */
  async run(context: CompletionHookContext): Promise<CompletionHookResult> {
    const { taskId } = context;

    if (!taskId) {
      return { action: 'skip' };
    }

    logger.info('[AutoCodeReviewHook] Running auto code review', { taskId });

    try {
      const reviewText = await autoCodeReviewService.run(taskId);

      if (reviewText) {
        logger.info('[AutoCodeReviewHook] Code review found issues, requesting continuation', {
          taskId,
        });

        // Add review message as user message for next iteration
        await messageService.addUserMessage(taskId, reviewText);

        return {
          action: 'continue',
          continuationMode: 'append',
          nextMessages: [
            {
              id: `auto-review-${Date.now()}`,
              role: 'user',
              content: reviewText,
              timestamp: new Date(),
            },
          ],
        };
      }

      // No issues found, clear timestamp
      lastReviewedChangeTimestamp.delete(taskId);

      // Allow stop
      logger.info('[AutoCodeReviewHook] Code review passed', { taskId });
      return { action: 'stop' };
    } catch (error) {
      logger.error('[AutoCodeReviewHook] Error running auto code review:', error);
      // On error, allow stop (don't block on review errors)
      return { action: 'stop' };
    }
  }
}

// Singleton instance
export const autoCodeReviewHookService = new AutoCodeReviewHookService();
