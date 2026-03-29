// src/services/agents/stop-hook-service.ts
/**
 * Stop Hook Service - Completion Hook Implementation
 *
 * Implements the existing stop hook logic as a completion hook.
 * Priority: 10 (runs before Ralph Loop: 20)
 */

import { logger } from '@/lib/logger';
import { hookService } from '@/services/hooks/hook-service';
import { hookStateService } from '@/services/hooks/hook-state-service';
import { messageService } from '@/services/message-service';
import type {
  CompletionHook,
  CompletionHookContext,
  CompletionHookResult,
} from '@/types/completion-hooks';

export class StopHookService implements CompletionHook {
  /** Hook name for identification */
  readonly name = 'stop-hook';

  /** Hook priority (10 = first in pipeline) */
  readonly priority = 10;

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
    // Subagents typically have special indicators in loopState or context
    // For now, check if taskId indicates nested execution
    return context.taskId === 'nested' || context.taskId?.startsWith('nested-') || false;
  }

  /**
   * Execute stop hook
   */
  async run(context: CompletionHookContext): Promise<CompletionHookResult> {
    const { taskId } = context;

    if (!taskId) {
      return { action: 'skip' };
    }

    logger.info('[StopHook] Running stop hook', { taskId });

    try {
      const stopSummary = await hookService.runStop(taskId);
      hookService.applyHookSummary(stopSummary);

      if (stopSummary.blocked) {
        const reason = stopSummary.blockReason || stopSummary.stopReason;
        logger.info('[StopHook] Stop hook blocked execution', { taskId, reason });

        // Always set stop hook active when blocked
        hookStateService.setStopHookActive(true);

        if (reason) {
          // Add blocking message as user message for next iteration
          await messageService.addUserMessage(taskId, reason);

          return {
            action: 'continue',
            continuationMode: 'replace',
            nextMessages: [
              {
                id: `stop-hook-${Date.now()}`,
                role: 'user',
                content: reason,
                timestamp: new Date(),
              },
            ],
          };
        }

        return {
          action: 'continue',
          continuationMode: 'replace',
          nextMessages: [],
        };
      }

      // Stop hook passed, allow next hook to run
      logger.info('[StopHook] Stop hook passed', { taskId });
      return { action: 'skip' };
    } catch (error) {
      logger.error('[StopHook] Error running stop hook:', error);
      // On error, allow continuation to next hook
      return { action: 'skip' };
    }
  }
}

// Singleton instance
export const stopHookService = new StopHookService();
