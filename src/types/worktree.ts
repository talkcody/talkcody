/**
 * Git Worktree type definitions matching Rust backend types
 */

/**
 * Information about a single worktree in the pool
 */
export interface WorktreeInfo {
  /** Index in the pool (0, 1, 2) */
  poolIndex: number;
  /** Absolute path to the worktree directory */
  path: string;
  /** Branch name (e.g., "talkcody-pool-0") */
  branch: string;
  /** Whether this worktree is currently in use */
  inUse: boolean;
  /** ID of the task using this worktree (if any) */
  taskId: string | null;
  /** Base commit hash when the worktree was acquired */
  baseCommit: string;
  /** Number of uncommitted changes in the worktree */
  changesCount: number;
}

/**
 * Status of the entire worktree pool for a project
 */
export interface WorktreePoolStatus {
  /** Path to the main project */
  projectPath: string;
  /** Path to the pool directory */
  poolDir: string;
  /** Main branch name (e.g., "main" or "master") */
  mainBranch: string;
  /** Current HEAD commit of main branch */
  headCommit: string;
  /** List of worktrees in the pool */
  worktrees: WorktreeInfo[];
  /** Number of worktrees currently in use */
  inUseCount: number;
}

/**
 * Result of a merge operation
 */
export interface MergeResult {
  /** Whether the merge was successful */
  success: boolean;
  /** Commit hash of the merge commit (if successful) */
  mergedCommit: string | null;
  /** Whether there are conflicts */
  hasConflicts: boolean;
  /** List of files with conflicts */
  conflictedFiles: string[];
  /** Human-readable message about the result */
  message: string;
}

/**
 * Result of a sync (rebase) operation
 */
export interface SyncResult {
  /** Whether the sync was successful */
  success: boolean;
  /** Commit hash after sync (if successful) */
  syncedCommit: string | null;
  /** Whether there are conflicts */
  hasConflicts: boolean;
  /** List of files with conflicts */
  conflictedFiles: string[];
  /** Human-readable message about the result */
  message: string;
}

/**
 * Changes in a worktree compared to its base
 */
export interface WorktreeChanges {
  /** Path to the worktree */
  worktreePath: string;
  /** Base commit when worktree was acquired */
  baseCommit: string;
  /** Current HEAD commit in the worktree */
  currentCommit: string;
  /** List of modified files */
  modifiedFiles: string[];
  /** List of newly added files */
  addedFiles: string[];
  /** List of deleted files */
  deletedFiles: string[];
  /** Whether there are uncommitted changes in working directory */
  hasUncommittedChanges: boolean;
}

/**
 * Status of a merge operation
 */
export type MergeStatus = 'idle' | 'merging' | 'conflict' | 'success' | 'error';

/**
 * Item in the merge queue
 */
export interface MergeQueueItem {
  taskId: string;
  poolIndex: number;
  status: MergeStatus;
  result?: MergeResult;
  error?: string;
}

/**
 * Maximum number of worktrees in the pool
 */
export const MAX_POOL_SIZE = 3;

/**
 * Name of the worktree pool directory
 */
export const POOL_DIR_NAME = '.talkcody-worktrees';

/**
 * Branch name prefix for worktree branches
 */
export const BRANCH_PREFIX = 'talkcody-pool';
