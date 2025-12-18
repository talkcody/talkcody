// src/services/workspace-root-service.ts

import { logger } from '@/lib/logger';
import { databaseService } from '@/services/database-service';
import { settingsManager } from '@/stores/settings-store';
import { worktreeStore } from '@/stores/worktree-store';

/**
 * Returns the workspace root path after validating it against the current project.
 * Throws if the value stored in settings does not match the project's recorded root path.
 */
export async function getValidatedWorkspaceRoot(): Promise<string> {
  const rootPath = settingsManager.getCurrentRootPath();
  const projectId = await settingsManager.getProject();

  if (!projectId) {
    return rootPath;
  }

  const project = await databaseService.getProject(projectId);
  const projectRoot = project?.root_path || '';

  if (!projectRoot) {
    return rootPath;
  }

  if (!rootPath || projectRoot !== rootPath) {
    throw new Error(
      `Workspace root path mismatch: settings="${rootPath || ''}", project="${projectRoot}"`
    );
  }

  return rootPath;
}

/**
 * Returns the effective workspace root path for a task.
 * If the task is using a git worktree, returns the worktree path.
 * Otherwise, returns the main project path.
 *
 * @param taskId - Optional task ID. If not provided, uses the current task ID from settings.
 * @returns The effective workspace root path for the task.
 */
export async function getEffectiveWorkspaceRoot(taskId: string): Promise<string> {
  // Get the base (main project) root path
  const baseRoot = await getValidatedWorkspaceRoot();
  // Get the effective task ID (use nullish coalescing to preserve empty string if explicitly passed)
  const effectiveTaskId = taskId;

  if (!effectiveTaskId) {
    logger.debug('[getEffectiveWorkspaceRoot] No taskId, returning baseRoot', { baseRoot });
    return baseRoot;
  }

  // Check if the task is using a worktree
  const worktreePath = worktreeStore.getState().getEffectiveRootPath(effectiveTaskId);
  const taskWorktreeMap = worktreeStore.getState().taskWorktreeMap;

  logger.info('[getEffectiveWorkspaceRoot]', {
    taskId: effectiveTaskId,
    baseRoot,
    worktreePath,
    hasWorktreeMapping: taskWorktreeMap.has(effectiveTaskId),
    taskWorktreeMapSize: taskWorktreeMap.size,
  });

  // Return worktree path if available and different from base, otherwise return base
  return worktreePath && worktreePath !== baseRoot ? worktreePath : baseRoot;
}
