import { useCallback, useState } from 'react';
import { logger } from '@/lib/logger';
import { worktreeService } from '@/services/worktree-service';
import { useExecutionStore } from '@/stores/execution-store';
import { useWorktreeStore } from '@/stores/worktree-store';
import type { MergeResult, SyncResult, WorktreeChanges } from '@/types/worktree';

export interface ConflictData {
  poolIndex: number;
  worktreePath: string;
  changes: WorktreeChanges;
}

export interface UseWorktreeConflictReturn {
  /** Data about the worktree with conflicts */
  conflictData: ConflictData | null;
  /** Whether we're currently checking for conflicts */
  isChecking: boolean;
  /** Whether we're currently processing an action (discard/merge/sync) */
  isProcessing: boolean;
  /** Result of a merge operation (for showing conflicts) */
  mergeResult: MergeResult | null;
  /** Result of a sync operation (for showing conflicts) */
  syncResult: SyncResult | null;

  /** Check if there are worktrees with uncommitted changes. Returns true if conflicts found. */
  checkForConflicts: () => Promise<boolean>;
  /** Discard all changes in the conflicting worktree */
  discardChanges: () => Promise<void>;
  /** Merge the worktree changes to main branch */
  mergeToMain: () => Promise<MergeResult>;
  /** Sync the worktree from main branch (rebase) */
  syncFromMain: () => Promise<SyncResult>;
  /** Cancel the operation (close dialog without action) */
  cancelOperation: () => void;
  /** Reset all state */
  resetState: () => void;
}

export function useWorktreeConflict(): UseWorktreeConflictReturn {
  const [conflictData, setConflictData] = useState<ConflictData | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [mergeResult, setMergeResult] = useState<MergeResult | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);

  const getProjectPath = useWorktreeStore((state) => state.getProjectPath);
  const isWorktreeEnabled = useWorktreeStore((state) => state.isWorktreeEnabled);
  const getRunningTaskIds = useExecutionStore((state) => state.getRunningTaskIds);

  const checkForConflicts = useCallback(async (): Promise<boolean> => {
    const projectPath = getProjectPath();
    const runningTaskIds = getRunningTaskIds();

    // If worktree is not enabled or no running tasks, no need to check
    if (!isWorktreeEnabled || runningTaskIds.length === 0 || !projectPath) {
      logger.info('[useWorktreeConflict] No need to check for conflicts', {
        isWorktreeEnabled,
        runningTaskCount: runningTaskIds.length,
        hasProjectPath: !!projectPath,
      });
      return false;
    }

    setIsChecking(true);
    try {
      // Get all worktrees status
      const poolStatus = await worktreeService.listWorktrees(projectPath);

      // Find the first available slot (not in use) that has uncommitted changes
      const worktreeWithChanges = poolStatus.worktrees.find(
        (wt) => !wt.inUse && wt.changesCount > 0
      );

      if (worktreeWithChanges) {
        logger.info('[useWorktreeConflict] Found worktree with changes', {
          poolIndex: worktreeWithChanges.poolIndex,
          changesCount: worktreeWithChanges.changesCount,
          path: worktreeWithChanges.path,
        });

        // Get detailed changes
        const changes = await worktreeService.getWorktreeChanges(worktreeWithChanges.path);

        setConflictData({
          poolIndex: worktreeWithChanges.poolIndex,
          worktreePath: worktreeWithChanges.path,
          changes,
        });

        return true;
      }

      logger.info('[useWorktreeConflict] No worktrees with uncommitted changes found');
      return false;
    } catch (error) {
      logger.error('[useWorktreeConflict] Error checking for conflicts', error);
      return false;
    } finally {
      setIsChecking(false);
    }
  }, [getProjectPath, isWorktreeEnabled, getRunningTaskIds]);

  const discardChanges = useCallback(async () => {
    if (!conflictData) {
      logger.warn('[useWorktreeConflict] No conflict data to discard');
      return;
    }

    const projectPath = getProjectPath();
    if (!projectPath) {
      logger.error('[useWorktreeConflict] No project path');
      return;
    }

    setIsProcessing(true);
    try {
      logger.info('[useWorktreeConflict] Discarding changes', {
        poolIndex: conflictData.poolIndex,
      });

      // Force acquire will clean the worktree (git clean -fd && git reset --hard)
      await worktreeService.acquireWorktree(
        projectPath,
        conflictData.poolIndex,
        'temp-cleanup', // Temporary task ID for cleanup
        true // force = true to discard changes
      );

      // Immediately release it
      await worktreeService.releaseWorktree(projectPath, conflictData.poolIndex);

      logger.info('[useWorktreeConflict] Changes discarded successfully');
      setConflictData(null);
    } catch (error) {
      logger.error('[useWorktreeConflict] Failed to discard changes', error);
      throw error;
    } finally {
      setIsProcessing(false);
    }
  }, [conflictData, getProjectPath]);

  const mergeToMain = useCallback(async (): Promise<MergeResult> => {
    if (!conflictData) {
      throw new Error('No conflict data to merge');
    }

    const projectPath = getProjectPath();
    if (!projectPath) {
      throw new Error('No project path');
    }

    setIsProcessing(true);
    try {
      logger.info('[useWorktreeConflict] Merging worktree to main', {
        poolIndex: conflictData.poolIndex,
      });

      const result = await worktreeService.mergeWorktree(projectPath, conflictData.poolIndex);

      setMergeResult(result);

      if (result.success) {
        logger.info('[useWorktreeConflict] Merge successful');
        setConflictData(null);
      } else if (result.hasConflicts) {
        logger.warn('[useWorktreeConflict] Merge has conflicts', {
          conflictedFiles: result.conflictedFiles,
        });
      }

      return result;
    } catch (error) {
      logger.error('[useWorktreeConflict] Failed to merge', error);
      throw error;
    } finally {
      setIsProcessing(false);
    }
  }, [conflictData, getProjectPath]);

  const syncFromMain = useCallback(async (): Promise<SyncResult> => {
    if (!conflictData) {
      throw new Error('No conflict data to sync');
    }

    const projectPath = getProjectPath();
    if (!projectPath) {
      throw new Error('No project path');
    }

    setIsProcessing(true);
    try {
      logger.info('[useWorktreeConflict] Syncing worktree from main', {
        poolIndex: conflictData.poolIndex,
      });

      const result = await worktreeService.syncWorktreeFromMain(
        projectPath,
        conflictData.poolIndex
      );

      setSyncResult(result);

      if (result.success) {
        logger.info('[useWorktreeConflict] Sync successful');
        // Don't clear conflictData - user may want to continue working
        // Close the dialog after successful sync
        setConflictData(null);
      } else if (result.hasConflicts) {
        logger.warn('[useWorktreeConflict] Sync has conflicts', {
          conflictedFiles: result.conflictedFiles,
        });
      }

      return result;
    } catch (error) {
      logger.error('[useWorktreeConflict] Failed to sync', error);
      throw error;
    } finally {
      setIsProcessing(false);
    }
  }, [conflictData, getProjectPath]);

  const cancelOperation = useCallback(() => {
    logger.info('[useWorktreeConflict] Operation cancelled');
    setConflictData(null);
    setMergeResult(null);
    setSyncResult(null);
  }, []);

  const resetState = useCallback(() => {
    setConflictData(null);
    setMergeResult(null);
    setSyncResult(null);
    setIsChecking(false);
    setIsProcessing(false);
  }, []);

  return {
    conflictData,
    isChecking,
    isProcessing,
    mergeResult,
    syncResult,
    checkForConflicts,
    discardChanges,
    mergeToMain,
    syncFromMain,
    cancelOperation,
    resetState,
  };
}
