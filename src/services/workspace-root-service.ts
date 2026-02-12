// src/services/workspace-root-service.ts

import { logger } from '@/lib/logger';
import { databaseService } from '@/services/database-service';
import { settingsManager } from '@/stores/settings-store';
import { useTaskStore } from '@/stores/task-store';
import { worktreeStore } from '@/stores/worktree-store';

const WINDOWS_ROOT_REGEX = /^[A-Za-z]:\/$/;

function normalizeRootPathForCompare(rootPath: string): string {
  const normalized = rootPath.replace(/\\/g, '/');
  if (normalized === '/' || WINDOWS_ROOT_REGEX.test(normalized)) {
    return normalized;
  }
  return normalized.replace(/\/+$/, '');
}

async function getProjectRootById(projectId: string | null | undefined): Promise<string | null> {
  if (!projectId) {
    return null;
  }

  try {
    const project = await databaseService.getProject(projectId);
    return project?.root_path || null;
  } catch (error) {
    logger.debug('[WorkspaceRootService] Failed to load project root', { projectId, error });
    return null;
  }
}

async function getTaskProjectRoot(taskId: string): Promise<string | null> {
  if (!taskId) {
    return null;
  }

  const cachedTask = useTaskStore.getState().getTask(taskId);
  let projectId = cachedTask?.project_id;

  if (!projectId) {
    try {
      const task = await databaseService.getTaskDetails(taskId);
      projectId = task?.project_id;
    } catch (error) {
      logger.debug('[WorkspaceRootService] Failed to load task details', { taskId, error });
    }
  }

  return await getProjectRootById(projectId);
}

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
    const normalizedRootPath = rootPath ? normalizeRootPathForCompare(rootPath) : '';
    const normalizedProjectRoot = normalizeRootPathForCompare(projectRoot);
    if (!normalizedRootPath || normalizedProjectRoot !== normalizedRootPath) {
      throw new Error(
        `Workspace root path mismatch: settings="${rootPath || ''}", project="${projectRoot}"`
      );
    }
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
  // Get the effective task ID (use nullish coalescing to preserve empty string if explicitly passed)
  const effectiveTaskId = taskId;

  if (!effectiveTaskId) {
    const baseRoot = await getValidatedWorkspaceRoot();
    logger.debug('[getEffectiveWorkspaceRoot] No taskId, returning baseRoot', { baseRoot });
    return baseRoot;
  }

  const taskRoot = await getTaskProjectRoot(effectiveTaskId);
  const baseRoot = taskRoot ?? (await getValidatedWorkspaceRoot());

  // Check if the task is using a worktree
  const worktreePath = worktreeStore.getState().getEffectiveRootPath(effectiveTaskId);
  // const taskWorktreeMap = worktreeStore.getState().taskWorktreeMap;

  // logger.info('[getEffectiveWorkspaceRoot]', {
  //   taskId: effectiveTaskId,
  //   baseRoot,
  //   worktreePath,
  //   hasWorktreeMapping: taskWorktreeMap.has(effectiveTaskId),
  //   taskWorktreeMapSize: taskWorktreeMap.size,
  // });

  // Return worktree path if available and different from base, otherwise return base
  return worktreePath && worktreePath !== baseRoot ? worktreePath : baseRoot;
}
