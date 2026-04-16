// src/services/agents/llm-completion-hooks.ts
/**
 * Completion Hook Pipeline
 *
 * Manages a pluggable pipeline of completion hooks that run after
 * a successful agent loop finish (no tool calls).
 *
 * Hooks are executed in priority order (lower = earlier) and can:
 * - Return 'continue' to request another iteration with fresh context
 * - Return 'stop' to end execution
 * - Return 'skip' to pass to the next hook
 *
 * Default hook priorities:
 *   - Stop Hook: 10
 *   - Ralph Loop: 20
 *   - Auto Code Review: 30
 */

import { logger } from '@/lib/logger';
import type {
  CompletionHook,
  CompletionHookContext,
  CompletionHookPipelineConfig,
  CompletionHookResult,
} from '@/types/completion-hooks';

const DEFAULT_CONFIG: CompletionHookPipelineConfig = {
  timeoutMs: 30000,
  stopOnFirstAction: true,
};

export class CompletionHookPipeline {
  private hooks: CompletionHook[] = [];
  private config: CompletionHookPipelineConfig;

  constructor(config: CompletionHookPipelineConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Register a completion hook
   * Hooks are automatically sorted by priority (lower = earlier)
   */
  register(hook: CompletionHook): void {
    this.hooks.push(hook);
    // Sort by priority (lower = earlier)
    this.hooks.sort((a, b) => a.priority - b.priority);
    logger.info(
      `[CompletionHookPipeline] Registered hook: ${hook.name} (priority: ${hook.priority})`
    );
  }

  /**
   * Unregister a hook by name
   */
  unregister(name: string): void {
    const index = this.hooks.findIndex((h) => h.name === name);
    if (index >= 0) {
      this.hooks.splice(index, 1);
      logger.info(`[CompletionHookPipeline] Unregistered hook: ${name}`);
    }
  }

  /**
   * Get all registered hooks (for debugging)
   */
  getRegisteredHooks(): Array<{ name: string; priority: number }> {
    return this.hooks.map((h) => ({ name: h.name, priority: h.priority }));
  }

  /**
   * Clear all registered hooks
   */
  clear(): void {
    this.hooks = [];
    logger.info('[CompletionHookPipeline] Cleared all hooks');
  }

  /**
   * Run the completion hook pipeline
   *
   * Executes hooks in priority order until one returns 'stop' or 'continue',
   * or all hooks have been processed.
   *
   * @param context The completion context
   * @returns The final hook result
   */
  async run(context: CompletionHookContext): Promise<CompletionHookResult> {
    const log = this.config.logger || logger;

    log.info('[CompletionHookPipeline] Starting pipeline', {
      taskId: context.taskId,
      iteration: context.iteration,
      hookCount: this.hooks.length,
    });

    for (const hook of this.hooks) {
      // Check if hook should run
      if (!hook.shouldRun(context)) {
        log.debug(
          `[CompletionHookPipeline] Skipping hook: ${hook.name} (shouldRun returned false)`
        );
        continue;
      }

      log.info(`[CompletionHookPipeline] Running hook: ${hook.name}`);

      try {
        const result = await this.runWithTimeout(hook, context);

        log.info(`[CompletionHookPipeline] Hook ${hook.name} returned: ${result.action}`, {
          stopReason: result.stopReason,
          hasNextMessages: !!result.nextMessages?.length,
        });

        // If hook requests continue, return immediately
        if (result.action === 'continue') {
          if (!result.nextMessages || result.nextMessages.length === 0) {
            log.warn(
              `[CompletionHookPipeline] Hook ${hook.name} requested continue but provided no nextMessages`
            );
          }
          return result;
        }

        // If hook requests stop, return immediately
        if (result.action === 'stop') {
          return result;
        }

        // 'skip' - continue to next hook
      } catch (error) {
        log.error(`[CompletionHookPipeline] Hook ${hook.name} threw error:`, error);
        // Continue to next hook on error
      }
    }

    // All hooks processed, default to stop
    log.info('[CompletionHookPipeline] All hooks processed, defaulting to stop');
    return { action: 'stop' };
  }

  /**
   * Run a hook with timeout
   */
  private async runWithTimeout(
    hook: CompletionHook,
    context: CompletionHookContext
  ): Promise<CompletionHookResult> {
    const timeoutMs = hook.timeoutMs ?? this.config.timeoutMs ?? 30000;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    try {
      return await Promise.race([
        hook.run(context),
        new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(() => {
            reject(new Error(`Hook ${hook.name} timed out after ${timeoutMs}ms`));
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }
}

// Singleton instance for application-wide use
export const completionHookPipeline = new CompletionHookPipeline();
