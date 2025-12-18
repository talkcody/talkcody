// src/stores/worktree-store.ts
/**
 * WorktreeStore - Git Worktree state management
 *
 * This store manages:
 * - Global worktree feature toggle (like plan mode)
 * - Worktree pool state per project
 * - Task to worktree mapping
 * - Merge operation state
 *
 * Design principles:
 * - Global worktree toggle (persisted in settings-store)
 * - When enabled, new tasks will use worktree for parallel execution
 * - Worktree pool state is synchronized with Rust backend
 * - One task can use one worktree at a time
 * - projectPath/projectId are obtained from settings-store
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { logger } from '@/lib/logger';
import { databaseService } from '@/services/database-service';
import { worktreeService } from '@/services/worktree-service';
import { settingsManager, useSettingsStore } from '@/stores/settings-store';
import type { MergeResult, MergeStatus, WorktreeInfo, WorktreePoolStatus } from '@/types/worktree';
import { MAX_POOL_SIZE } from '@/types/worktree';

// Special error class for worktree with uncommitted changes
export class WorktreeHasChangesError extends Error {
  constructor(
    public readonly poolIndex: number,
    public readonly changesCount: number
  ) {
    super(`Worktree at pool-${poolIndex} has ${changesCount} uncommitted changes`);
    this.name = 'WorktreeHasChangesError';
  }
}

interface WorktreeState {
  // Global worktree toggle (like plan mode)
  isWorktreeEnabled: boolean;

  // Worktree pool state (poolIndex -> WorktreeInfo)
  pool: Map<number, WorktreeInfo>;

  // Task to worktree mapping (taskId -> poolIndex)
  taskWorktreeMap: Map<string, number>;

  // Merge operation state
  isMerging: boolean;
  currentMergeTaskId: string | null;
  mergeStatus: MergeStatus;
  lastMergeResult: MergeResult | null;

  // Loading state
  isLoading: boolean;
  isInitialized: boolean;
  error: string | null;
}

interface WorktreeActions {
  // Project info helpers (from settings-store)
  getProjectPath: () => string | null;
  getProjectId: () => string | null;

  // Initialization
  initialize: () => Promise<void>;
  refresh: () => Promise<void>;

  // Global feature toggle (like plan mode)
  toggleWorktreeMode: () => void;
  setWorktreeMode: (enabled: boolean) => void;

  // Worktree management
  shouldUseWorktree: (taskId: string, runningTaskIds: string[]) => boolean;
  acquireForTask: (
    taskId: string,
    runningTaskIds: string[],
    force?: boolean
  ) => Promise<string | null>;
  releaseForTask: (taskId: string) => Promise<void>;

  // Path resolution
  getEffectiveRootPath: (taskId: string) => string | null;
  isTaskUsingWorktree: (taskId: string) => boolean;

  // Merge operations
  mergeTask: (taskId: string, commitMessage?: string) => Promise<MergeResult>;
  abortMerge: () => Promise<void>;
  continueMerge: (message?: string) => Promise<MergeResult>;

  // Cleanup
  cleanup: () => Promise<void>;
  cleanupForTask: (taskId: string) => Promise<void>;

  // Selectors
  getWorktreeForTask: (taskId: string) => WorktreeInfo | null;
  getInUseCount: () => number;
  getAvailableCount: () => number;
}

export const useWorktreeStore = create<WorktreeState & WorktreeActions>()(
  devtools(
    (set, get) => ({
      // Initial state
      isWorktreeEnabled: false,
      pool: new Map(),
      taskWorktreeMap: new Map(),
      isMerging: false,
      currentMergeTaskId: null,
      mergeStatus: 'idle',
      lastMergeResult: null,
      isLoading: false,
      isInitialized: false,
      error: null,

      // ============================================
      // Project Info Helpers
      // ============================================

      getProjectPath: () => {
        return settingsManager.getCurrentRootPath() || null;
      },

      getProjectId: () => {
        return settingsManager.getProject() || null;
      },

      // ============================================
      // Initialization
      // ============================================

      initialize: async () => {
        const state = get();
        const projectPath = get().getProjectPath();

        if (!projectPath) {
          logger.warn('[WorktreeStore] No project path available, skipping initialization');
          set({ isInitialized: true });
          return;
        }

        if (state.isInitialized) {
          return; // Already initialized
        }

        logger.info('[WorktreeStore] Initializing', { projectPath });
        set({ isLoading: true, error: null });

        try {
          // Load global worktree mode from settings store
          const isWorktreeEnabled = useSettingsStore.getState().getWorktreeModeEnabled();

          // Load current pool state from backend
          let poolStatus: WorktreePoolStatus | null = null;
          try {
            poolStatus = await worktreeService.listWorktrees(projectPath);
          } catch (error) {
            logger.warn('[WorktreeStore] Failed to list worktrees', error);
          }

          // Build pool map from status
          const pool = new Map<number, WorktreeInfo>();
          const taskWorktreeMap = new Map<string, number>();

          if (poolStatus) {
            for (const wt of poolStatus.worktrees) {
              pool.set(wt.poolIndex, wt);
              if (wt.taskId) {
                taskWorktreeMap.set(wt.taskId, wt.poolIndex);
              }
            }

            // Cleanup orphaned worktrees (worktrees with taskIds that no longer exist)
            for (const wt of poolStatus.worktrees) {
              if (wt.taskId) {
                try {
                  // Check if task still exists in database
                  const taskExists = await databaseService.getTaskDetails(wt.taskId);
                  if (!taskExists) {
                    // Task no longer exists - cleanup worktree
                    if (wt.changesCount === 0) {
                      // No changes, safe to remove worktree completely
                      try {
                        await worktreeService.removeWorktree(projectPath, wt.poolIndex);
                        pool.delete(wt.poolIndex);
                        taskWorktreeMap.delete(wt.taskId);
                        logger.info('[WorktreeStore] Removed orphaned worktree', {
                          poolIndex: wt.poolIndex,
                          taskId: wt.taskId,
                        });
                      } catch (error) {
                        logger.warn('[WorktreeStore] Failed to remove orphaned worktree', {
                          poolIndex: wt.poolIndex,
                          error,
                        });
                      }
                    } else {
                      // Has changes, just release (clear task association) but keep directory
                      try {
                        await worktreeService.releaseWorktree(projectPath, wt.poolIndex);
                        const updatedWt = { ...wt, taskId: null, inUse: false };
                        pool.set(wt.poolIndex, updatedWt);
                        taskWorktreeMap.delete(wt.taskId);
                        logger.warn('[WorktreeStore] Released orphaned worktree with changes', {
                          poolIndex: wt.poolIndex,
                          changesCount: wt.changesCount,
                          taskId: wt.taskId,
                        });
                      } catch (error) {
                        logger.warn('[WorktreeStore] Failed to release orphaned worktree', {
                          poolIndex: wt.poolIndex,
                          error,
                        });
                      }
                    }
                  }
                } catch (error) {
                  logger.warn('[WorktreeStore] Failed to check task existence', {
                    taskId: wt.taskId,
                    error,
                  });
                }
              }
            }
          }

          set({
            isWorktreeEnabled,
            pool,
            taskWorktreeMap,
            isLoading: false,
            isInitialized: true,
          });

          logger.info('[WorktreeStore] Initialized', {
            isWorktreeEnabled,
            poolCount: pool.size,
            inUseCount: taskWorktreeMap.size,
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.error('[WorktreeStore] Initialization failed', error);
          set({ error: errorMessage, isLoading: false, isInitialized: true });
        }
      },

      refresh: async () => {
        const projectPath = get().getProjectPath();
        if (!projectPath) return;

        try {
          const poolStatus = await worktreeService.listWorktrees(projectPath);
          const pool = new Map<number, WorktreeInfo>();
          const taskWorktreeMap = new Map<string, number>();

          for (const wt of poolStatus.worktrees) {
            pool.set(wt.poolIndex, wt);
            if (wt.taskId) {
              taskWorktreeMap.set(wt.taskId, wt.poolIndex);
            }
          }

          set({ pool, taskWorktreeMap });
        } catch (error) {
          logger.error('[WorktreeStore] Refresh failed', error);
        }
      },

      // ============================================
      // Global Feature Toggle (like plan mode)
      // ============================================

      toggleWorktreeMode: () => {
        const currentEnabled = get().isWorktreeEnabled;
        const newEnabled = !currentEnabled;

        logger.info('[WorktreeStore] Toggling worktree mode', { newEnabled });
        set({ isWorktreeEnabled: newEnabled });

        // Persist to settings store
        useSettingsStore
          .getState()
          .setWorktreeModeEnabled(newEnabled)
          .catch((error) => {
            logger.error('[WorktreeStore] Failed to persist worktree mode:', error);
          });
      },

      setWorktreeMode: (enabled: boolean) => {
        logger.info('[WorktreeStore] Setting worktree mode', { enabled });
        set({ isWorktreeEnabled: enabled });

        // Persist to settings store
        useSettingsStore
          .getState()
          .setWorktreeModeEnabled(enabled)
          .catch((error) => {
            logger.error('[WorktreeStore] Failed to persist worktree mode:', error);
          });
      },

      // ============================================
      // Worktree Management
      // ============================================

      shouldUseWorktree: (taskId: string, runningTaskIds: string[]) => {
        const { isWorktreeEnabled } = get();
        // Use worktree when:
        // 1. Global worktree mode is enabled
        // 2. There are other tasks running (parallel execution scenario)
        return isWorktreeEnabled && runningTaskIds.length > 0;
      },

      acquireForTask: async (taskId: string, runningTaskIds: string[], force?: boolean) => {
        const projectPath = get().getProjectPath();
        const { taskWorktreeMap, pool, isWorktreeEnabled } = get();

        logger.info('[WorktreeStore] acquireForTask called', {
          taskId,
          runningTaskIds,
          isWorktreeEnabled,
          hasExistingMapping: taskWorktreeMap.has(taskId),
          force,
        });

        if (!projectPath) return null;

        // Check if worktree should be used
        if (!isWorktreeEnabled || runningTaskIds.length === 0) {
          logger.info('[WorktreeStore] Worktree not needed', {
            isWorktreeEnabled,
            runningTaskCount: runningTaskIds.length,
          });
          return null;
        }

        // Check if task already has a worktree
        if (taskWorktreeMap.has(taskId)) {
          const poolIndex = taskWorktreeMap.get(taskId)!;
          const wt = pool.get(poolIndex);
          logger.info('[WorktreeStore] Task already has worktree', { taskId, path: wt?.path });
          return wt?.path || null;
        }

        // Find available pool index
        const poolIndex = await worktreeService.findAvailablePoolIndex(projectPath);
        if (poolIndex === null) {
          logger.warn('[WorktreeStore] No available worktree slots');
          throw new Error(
            `All ${MAX_POOL_SIZE} worktree slots are in use. Please merge or cancel existing tasks.`
          );
        }

        logger.info('[WorktreeStore] Acquiring worktree', { taskId, poolIndex, force });

        try {
          const worktreeInfo = await worktreeService.acquireWorktree(
            projectPath,
            poolIndex,
            taskId,
            force
          );

          // Update state
          set((state) => {
            const newPool = new Map(state.pool);
            newPool.set(poolIndex, worktreeInfo);

            const newTaskMap = new Map(state.taskWorktreeMap);
            newTaskMap.set(taskId, poolIndex);

            return { pool: newPool, taskWorktreeMap: newTaskMap };
          });

          return worktreeInfo.path;
        } catch (error) {
          // Check for special error format: WORKTREE_HAS_CHANGES:poolIndex:changesCount
          const errorMsg = String(error);
          if (errorMsg.includes('WORKTREE_HAS_CHANGES:')) {
            const match = errorMsg.match(/WORKTREE_HAS_CHANGES:(\d+):(\d+)/);
            if (match) {
              const [, poolIdx, changesCount] = match;
              throw new WorktreeHasChangesError(Number(poolIdx), Number(changesCount));
            }
          }
          logger.error('[WorktreeStore] Failed to acquire worktree', error);
          throw error;
        }
      },

      releaseForTask: async (taskId: string) => {
        const projectPath = get().getProjectPath();
        const { taskWorktreeMap } = get();
        if (!projectPath || !taskWorktreeMap.has(taskId)) return;

        const poolIndex = taskWorktreeMap.get(taskId)!;
        logger.info('[WorktreeStore] Releasing worktree', { taskId, poolIndex });

        try {
          await worktreeService.releaseWorktree(projectPath, poolIndex);

          // Update state
          set((state) => {
            const newPool = new Map(state.pool);
            const wt = newPool.get(poolIndex);
            if (wt) {
              newPool.set(poolIndex, { ...wt, inUse: false, taskId: null });
            }

            const newTaskMap = new Map(state.taskWorktreeMap);
            newTaskMap.delete(taskId);

            return { pool: newPool, taskWorktreeMap: newTaskMap };
          });
        } catch (error) {
          logger.error('[WorktreeStore] Failed to release worktree', error);
        }
      },

      // ============================================
      // Path Resolution
      // ============================================

      getEffectiveRootPath: (taskId: string) => {
        const { pool, taskWorktreeMap } = get();

        if (!taskWorktreeMap.has(taskId)) {
          return null; // Task not using worktree
        }

        const poolIndex = taskWorktreeMap.get(taskId)!;
        const wt = pool.get(poolIndex);
        return wt?.path || null;
      },

      isTaskUsingWorktree: (taskId: string) => {
        return get().taskWorktreeMap.has(taskId);
      },

      // ============================================
      // Merge Operations
      // ============================================

      mergeTask: async (taskId: string, commitMessage?: string) => {
        const projectPath = get().getProjectPath();
        const { taskWorktreeMap, isMerging } = get();

        if (!projectPath) {
          throw new Error('No project path set');
        }

        if (!taskWorktreeMap.has(taskId)) {
          throw new Error('Task is not using a worktree');
        }

        if (isMerging) {
          throw new Error('A merge is already in progress');
        }

        const poolIndex = taskWorktreeMap.get(taskId)!;
        logger.info('[WorktreeStore] Starting merge', { taskId, poolIndex });

        set({ isMerging: true, currentMergeTaskId: taskId, mergeStatus: 'merging' });

        try {
          const result = await worktreeService.mergeWorktree(projectPath, poolIndex, commitMessage);

          if (result.success) {
            // Release the worktree on successful merge
            await get().releaseForTask(taskId);

            set({
              isMerging: false,
              currentMergeTaskId: null,
              mergeStatus: 'success',
              lastMergeResult: result,
            });
          } else if (result.hasConflicts) {
            set({
              isMerging: false,
              mergeStatus: 'conflict',
              lastMergeResult: result,
            });
          } else {
            set({
              isMerging: false,
              currentMergeTaskId: null,
              mergeStatus: 'error',
              lastMergeResult: result,
            });
          }

          return result;
        } catch (error) {
          logger.error('[WorktreeStore] Merge failed', error);
          set({
            isMerging: false,
            currentMergeTaskId: null,
            mergeStatus: 'error',
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      },

      abortMerge: async () => {
        const projectPath = get().getProjectPath();
        const { currentMergeTaskId } = get();
        if (!projectPath || !currentMergeTaskId) return;

        logger.info('[WorktreeStore] Aborting merge');

        try {
          await worktreeService.abortMerge(projectPath);
          set({
            isMerging: false,
            currentMergeTaskId: null,
            mergeStatus: 'idle',
            lastMergeResult: null,
          });
        } catch (error) {
          logger.error('[WorktreeStore] Failed to abort merge', error);
          throw error;
        }
      },

      continueMerge: async (message?: string) => {
        const projectPath = get().getProjectPath();
        const { currentMergeTaskId } = get();
        if (!projectPath || !currentMergeTaskId) {
          throw new Error('No merge in progress');
        }

        logger.info('[WorktreeStore] Continuing merge');

        set({ isMerging: true, mergeStatus: 'merging' });

        try {
          const result = await worktreeService.continueMerge(projectPath, message);

          if (result.success) {
            // Release the worktree on successful merge
            await get().releaseForTask(currentMergeTaskId);

            set({
              isMerging: false,
              currentMergeTaskId: null,
              mergeStatus: 'success',
              lastMergeResult: result,
            });
          } else if (result.hasConflicts) {
            set({
              isMerging: false,
              mergeStatus: 'conflict',
              lastMergeResult: result,
            });
          }

          return result;
        } catch (error) {
          logger.error('[WorktreeStore] Continue merge failed', error);
          set({
            isMerging: false,
            mergeStatus: 'error',
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      },

      // ============================================
      // Cleanup
      // ============================================

      cleanup: async () => {
        const projectPath = get().getProjectPath();
        if (!projectPath) return;

        logger.info('[WorktreeStore] Cleaning up all worktrees');

        try {
          await worktreeService.cleanupWorktrees(projectPath);
          set({
            pool: new Map(),
            taskWorktreeMap: new Map(),
            isMerging: false,
            currentMergeTaskId: null,
            mergeStatus: 'idle',
            lastMergeResult: null,
          });
        } catch (error) {
          logger.error('[WorktreeStore] Cleanup failed', error);
          throw error;
        }
      },

      cleanupForTask: async (taskId: string) => {
        const projectPath = get().getProjectPath();
        const { taskWorktreeMap } = get();
        if (!projectPath || !taskWorktreeMap.has(taskId)) return;

        const poolIndex = taskWorktreeMap.get(taskId)!;
        logger.info('[WorktreeStore] Cleaning up worktree for task', { taskId, poolIndex });

        try {
          await worktreeService.removeWorktree(projectPath, poolIndex);

          // Update state
          set((state) => {
            const newPool = new Map(state.pool);
            newPool.delete(poolIndex);

            const newTaskMap = new Map(state.taskWorktreeMap);
            newTaskMap.delete(taskId);

            return { pool: newPool, taskWorktreeMap: newTaskMap };
          });
        } catch (error) {
          logger.error('[WorktreeStore] Task cleanup failed', error);
          throw error;
        }
      },

      // ============================================
      // Selectors
      // ============================================

      getWorktreeForTask: (taskId: string) => {
        const { pool, taskWorktreeMap } = get();
        if (!taskWorktreeMap.has(taskId)) return null;
        const poolIndex = taskWorktreeMap.get(taskId)!;
        return pool.get(poolIndex) || null;
      },

      getInUseCount: () => {
        return get().taskWorktreeMap.size;
      },

      getAvailableCount: () => {
        return MAX_POOL_SIZE - get().taskWorktreeMap.size;
      },
    }),
    {
      name: 'worktree-store',
      enabled: import.meta.env.DEV,
    }
  )
);

// Export store instance for direct access in non-React contexts
export const worktreeStore = useWorktreeStore;
