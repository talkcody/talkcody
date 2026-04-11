// src/services/agents/auto-git-commit-hook-service.ts
/**
 * Auto Git Commit Hook Service - Completion Hook Implementation
 *
 * Implements auto git commit as a completion hook.
 * Priority: 25 (runs after Stop Hook: 10, Ralph Loop: 20, and BEFORE Auto Code Review: 30)
 * Only runs when there are file changes detected for the task.
 */

import { logger } from '@/lib/logger';
import { aiGitMessagesService } from '@/services/ai/ai-git-messages-service';
import { gitService } from '@/services/git-service';
import { getEffectiveWorkspaceRoot } from '@/services/workspace-root-service';
import { useFileChangesStore } from '@/stores/file-changes-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useTaskStore } from '@/stores/task-store';
import type {
  CompletionHook,
  CompletionHookContext,
  CompletionHookResult,
} from '@/types/completion-hooks';
import type { TaskSettings } from '@/types/task';
import { gitAddAndCommit } from '@/utils/git-utils';

function getTaskSettings(taskId: string): TaskSettings | null {
  const task = useTaskStore.getState().getTask(taskId);
  if (!task?.settings) return null;
  try {
    return JSON.parse(task.settings) as TaskSettings;
  } catch (error) {
    logger.warn('[AutoGitCommit] Failed to parse task settings', { taskId, error });
    return null;
  }
}

function isAutoGitCommitEnabled(taskId: string): boolean {
  const globalEnabled = useSettingsStore.getState().getAutoGitCommitGlobal();
  const settings = getTaskSettings(taskId);
  if (typeof settings?.autoGitCommit === 'boolean') {
    return settings.autoGitCommit;
  }
  return globalEnabled;
}

export class AutoGitCommitHookService implements CompletionHook {
  /** Hook name for identification */
  readonly name = 'auto-git-commit';

  /** Hook priority (25 = after stop hook and ralph loop, before auto code review) */
  readonly priority = 25;

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
   * Execute auto git commit
   */
  async run(context: CompletionHookContext): Promise<CompletionHookResult> {
    const { taskId } = context;

    if (!taskId) {
      return { action: 'skip' };
    }

    if (!isAutoGitCommitEnabled(taskId)) {
      return { action: 'skip' };
    }

    // Only run when there are file changes
    const changes = useFileChangesStore.getState().getChanges(taskId);
    if (changes.length === 0) {
      logger.info('[AutoGitCommit] No file changes, skipping', { taskId });
      return { action: 'skip' };
    }

    logger.info('[AutoGitCommit] Running auto git commit', {
      taskId,
      changesCount: changes.length,
    });

    try {
      const workspaceRoot = await getEffectiveWorkspaceRoot(taskId);

      // Get raw diff for AI message generation
      const diffText = await gitService.getRawDiffText(workspaceRoot);

      if (!diffText || diffText.trim().length === 0) {
        logger.info('[AutoGitCommit] No diff text found, skipping commit', { taskId });
        return { action: 'skip' };
      }

      // Generate AI commit message
      const commitResult = await aiGitMessagesService.generateCommitMessage({ diffText });

      if (!commitResult?.message) {
        logger.warn('[AutoGitCommit] Failed to generate commit message, skipping', { taskId });
        return { action: 'skip' };
      }

      // Execute git add + commit
      const result = await gitAddAndCommit(commitResult.message, workspaceRoot);

      if (result.success) {
        logger.info('[AutoGitCommit] Successfully committed changes', {
          taskId,
          message: commitResult.message,
        });
      } else {
        logger.warn('[AutoGitCommit] Git commit failed', { taskId, error: result.error });
      }

      // Always skip (let pipeline continue to auto code review regardless of commit result)
      return { action: 'skip' };
    } catch (error) {
      logger.error('[AutoGitCommit] Unexpected error during auto git commit', { taskId, error });
      // On error, skip to allow code review to still run
      return { action: 'skip' };
    }
  }
}

// Singleton instance
export const autoGitCommitHookService = new AutoGitCommitHookService();
