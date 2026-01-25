# Task Parallel Worktree Integration (Current Code)

This document reflects the current worktree integration and parallel task isolation.

## Overview
TalkCody supports a worktree pool for parallel tasks. When enabled, tasks can acquire isolated worktrees to avoid file conflicts. Worktree state is managed in Rust and mirrored in a Zustand store.

## Key Components
- `src-tauri/src/git/worktree.rs`: worktree pool management and git operations (acquire, release, merge, sync, cleanup).
- `src/services/worktree-service.ts`: Tauri command wrapper with error handling.
- `src/stores/worktree-store.ts`: global toggle, pool state, and task-to-worktree mapping.
- `src/services/workspace-root-service.ts`: resolves effective root path for a task.
- `src/services/execution-service.ts`: acquires worktree on task start.
- `src/hooks/use-worktree-conflict.ts` and `src/components/worktree/*`: conflict resolution UI/logic.

## Worktree Pool Behavior
- Pool size is fixed at 3 in Rust (`MAX_POOL_SIZE`).
- Worktrees are stored under a configurable root (`worktree_root_path` setting), defaulting to `~/.talkcody/{project}`.
- Each worktree tracks `poolIndex`, `taskId`, `inUse`, and `changesCount`.

## Task Acquisition Flow
1. `ExecutionService.startExecution()` calls `useWorktreeStore.acquireForTask()`.
2. The store attempts to acquire an available pool slot via `worktreeService.acquireWorktree()`.
3. On success, the task is mapped to a pool index and tools use `getEffectiveWorkspaceRoot(taskId)`.

## Conflict Handling
- `useWorktreeConflict` checks for idle worktrees with uncommitted changes before starting new tasks.
- Users can discard, merge, or sync changes via the conflict dialog.

## Current Design Flaw
Worktree task mapping is stored only in Rust in-memory state (`WORKTREE_TASK_MAP`). On app restart, active worktree assignments are lost, which can orphan worktrees or require manual recovery.

## Further Optimization
Persist task-to-worktree mapping (or reconstruct it deterministically from worktree metadata) so assignments survive restarts and conflict checks remain accurate.
