// src/services/worktree-service.ts
/**
 * Service for managing Git worktrees via Tauri commands
 *
 * This service provides methods to:
 * - Acquire and release worktrees from a pool
 * - Get worktree status and changes
 * - Commit changes in worktrees
 * - Merge worktree branches to main
 * - Clean up worktrees
 */

import { invoke } from '@tauri-apps/api/core';
import { logger } from '@/lib/logger';
import { useSettingsStore } from '@/stores/settings-store';
import type {
  MergeResult,
  SyncResult,
  WorktreeChanges,
  WorktreeInfo,
  WorktreePoolStatus,
} from '@/types/worktree';

class WorktreeService {
  /**
   * Get the configured worktree root path from settings
   * Returns undefined if not set (will use default ~/.talkcody on backend)
   */
  private getWorktreeRoot(): string | undefined {
    const root = useSettingsStore.getState().worktree_root_path;
    return root || undefined; // Empty string -> undefined
  }
  /**
   * Acquire a worktree from the pool for a task
   * If the worktree exists and is clean, it will be reset to the current HEAD
   * If it exists but has uncommitted changes, returns an error (unless force=true)
   * If it doesn't exist, it will be created
   *
   * @param force - If true, will discard any uncommitted changes in existing worktree
   */
  async acquireWorktree(
    projectPath: string,
    poolIndex: number,
    taskId: string,
    force?: boolean
  ): Promise<WorktreeInfo> {
    try {
      logger.info('[WorktreeService] Acquiring worktree', {
        projectPath,
        poolIndex,
        taskId,
        force,
      });

      const result = await invoke<WorktreeInfo>('git_acquire_worktree', {
        projectPath,
        poolIndex,
        taskId,
        force: force ?? false,
        worktreeRoot: this.getWorktreeRoot(),
      });

      logger.info('[WorktreeService] Worktree acquired', {
        path: result.path,
        branch: result.branch,
      });

      return result;
    } catch (error) {
      logger.error('[WorktreeService] Failed to acquire worktree', error);
      throw error; // Re-throw original error for special error handling
    }
  }

  /**
   * Release a worktree back to the pool (keeps directory, clears task association)
   */
  async releaseWorktree(projectPath: string, poolIndex: number): Promise<void> {
    try {
      logger.info('[WorktreeService] Releasing worktree', {
        projectPath,
        poolIndex,
      });

      await invoke('git_release_worktree', {
        projectPath,
        poolIndex,
      });

      logger.info('[WorktreeService] Worktree released');
    } catch (error) {
      logger.error('[WorktreeService] Failed to release worktree', error);
      throw new Error(
        `Failed to release worktree: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Remove a worktree completely from the pool
   */
  async removeWorktree(projectPath: string, poolIndex: number): Promise<void> {
    try {
      logger.info('[WorktreeService] Removing worktree', {
        projectPath,
        poolIndex,
      });

      await invoke('git_remove_worktree', {
        projectPath,
        poolIndex,
        worktreeRoot: this.getWorktreeRoot(),
      });

      logger.info('[WorktreeService] Worktree removed');
    } catch (error) {
      logger.error('[WorktreeService] Failed to remove worktree', error);
      throw new Error(
        `Failed to remove worktree: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * List all worktrees in the pool for a project
   */
  async listWorktrees(projectPath: string): Promise<WorktreePoolStatus> {
    try {
      logger.info('[WorktreeService] Listing worktrees', { projectPath });

      const result = await invoke<WorktreePoolStatus>('git_list_worktrees', {
        projectPath,
        worktreeRoot: this.getWorktreeRoot(),
      });

      logger.info('[WorktreeService] Worktrees listed', {
        count: result.worktrees.length,
        inUseCount: result.inUseCount,
      });

      return result;
    } catch (error) {
      logger.error('[WorktreeService] Failed to list worktrees', error);
      throw new Error(
        `Failed to list worktrees: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Get changes in a worktree
   */
  async getWorktreeChanges(worktreePath: string): Promise<WorktreeChanges> {
    try {
      logger.info('[WorktreeService] Getting worktree changes', { worktreePath });

      const result = await invoke<WorktreeChanges>('git_get_worktree_changes', {
        worktreePath,
      });

      logger.info('[WorktreeService] Worktree changes retrieved', {
        hasUncommittedChanges: result.hasUncommittedChanges,
        modifiedCount: result.modifiedFiles.length,
        addedCount: result.addedFiles.length,
        deletedCount: result.deletedFiles.length,
      });

      return result;
    } catch (error) {
      logger.error('[WorktreeService] Failed to get worktree changes', error);
      throw new Error(
        `Failed to get worktree changes: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Commit all changes in a worktree
   */
  async commitWorktree(worktreePath: string, message: string): Promise<string> {
    try {
      logger.info('[WorktreeService] Committing worktree changes', {
        worktreePath,
        message,
      });

      const commitHash = await invoke<string>('git_commit_worktree', {
        worktreePath,
        message,
      });

      logger.info('[WorktreeService] Worktree changes committed', { commitHash });

      return commitHash;
    } catch (error) {
      logger.error('[WorktreeService] Failed to commit worktree', error);
      throw new Error(
        `Failed to commit worktree: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Merge a worktree's changes back to the main branch
   */
  async mergeWorktree(
    projectPath: string,
    poolIndex: number,
    commitMessage?: string
  ): Promise<MergeResult> {
    try {
      logger.info('[WorktreeService] Merging worktree to main', {
        projectPath,
        poolIndex,
        commitMessage,
      });

      const result = await invoke<MergeResult>('git_merge_worktree', {
        projectPath,
        poolIndex,
        commitMessage,
        worktreeRoot: this.getWorktreeRoot(),
      });

      logger.info('[WorktreeService] Merge result', {
        success: result.success,
        hasConflicts: result.hasConflicts,
        mergedCommit: result.mergedCommit,
      });

      return result;
    } catch (error) {
      logger.error('[WorktreeService] Failed to merge worktree', error);
      throw new Error(
        `Failed to merge worktree: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Abort an in-progress merge
   */
  async abortMerge(projectPath: string): Promise<void> {
    try {
      logger.info('[WorktreeService] Aborting merge', { projectPath });

      await invoke('git_abort_merge', {
        projectPath,
      });

      logger.info('[WorktreeService] Merge aborted');
    } catch (error) {
      logger.error('[WorktreeService] Failed to abort merge', error);
      throw new Error(
        `Failed to abort merge: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Continue a merge after conflicts are resolved
   */
  async continueMerge(projectPath: string, message?: string): Promise<MergeResult> {
    try {
      logger.info('[WorktreeService] Continuing merge', { projectPath, message });

      const result = await invoke<MergeResult>('git_continue_merge', {
        projectPath,
        message,
      });

      logger.info('[WorktreeService] Continue merge result', {
        success: result.success,
        hasConflicts: result.hasConflicts,
        mergedCommit: result.mergedCommit,
      });

      return result;
    } catch (error) {
      logger.error('[WorktreeService] Failed to continue merge', error);
      throw new Error(
        `Failed to continue merge: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Clean up all worktrees for a project
   */
  async cleanupWorktrees(projectPath: string): Promise<void> {
    try {
      logger.info('[WorktreeService] Cleaning up worktrees', { projectPath });

      await invoke('git_cleanup_worktrees', {
        projectPath,
        worktreeRoot: this.getWorktreeRoot(),
      });

      logger.info('[WorktreeService] Worktrees cleaned up');
    } catch (error) {
      logger.error('[WorktreeService] Failed to cleanup worktrees', error);
      throw new Error(
        `Failed to cleanup worktrees: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Sync a worktree with the latest main branch using rebase
   * This brings the main branch's latest changes into the worktree
   */
  async syncWorktreeFromMain(projectPath: string, poolIndex: number): Promise<SyncResult> {
    try {
      logger.info('[WorktreeService] Syncing worktree from main', {
        projectPath,
        poolIndex,
      });

      const result = await invoke<SyncResult>('git_sync_worktree_from_main', {
        projectPath,
        poolIndex,
        worktreeRoot: this.getWorktreeRoot(),
      });

      logger.info('[WorktreeService] Sync result', {
        success: result.success,
        hasConflicts: result.hasConflicts,
        syncedCommit: result.syncedCommit,
      });

      return result;
    } catch (error) {
      logger.error('[WorktreeService] Failed to sync worktree from main', error);
      throw new Error(
        `Failed to sync worktree: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Abort an in-progress rebase in a worktree
   */
  async abortRebase(worktreePath: string): Promise<void> {
    try {
      logger.info('[WorktreeService] Aborting rebase', { worktreePath });

      await invoke('git_abort_rebase', {
        worktreePath,
      });

      logger.info('[WorktreeService] Rebase aborted');
    } catch (error) {
      logger.error('[WorktreeService] Failed to abort rebase', error);
      throw new Error(
        `Failed to abort rebase: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Find the first available pool index
   * Returns null if all slots are in use
   */
  async findAvailablePoolIndex(projectPath: string): Promise<number | null> {
    try {
      const status = await this.listWorktrees(projectPath);

      // Check for unused slots (pool indices 0, 1, 2)
      const usedIndices = new Set(status.worktrees.filter((w) => w.inUse).map((w) => w.poolIndex));

      for (let i = 0; i < 3; i++) {
        if (!usedIndices.has(i)) {
          return i;
        }
      }

      return null; // All slots are in use
    } catch (error) {
      logger.error('[WorktreeService] Failed to find available pool index', error);
      return null;
    }
  }
}

export const worktreeService = new WorktreeService();
