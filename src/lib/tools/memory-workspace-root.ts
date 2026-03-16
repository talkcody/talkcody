import { databaseService } from '@/services/database-service';
import type { MemoryContext } from '@/services/memory/memory-types';
import { getEffectiveWorkspaceRoot } from '@/services/workspace-root-service';
import { DEFAULT_PROJECT, settingsManager } from '@/stores/settings-store';

export async function resolveMemoryWorkspaceRoot(taskId?: string): Promise<string | undefined> {
  if (taskId) {
    return await getEffectiveWorkspaceRoot(taskId);
  }

  const currentRootPath = settingsManager.getCurrentRootPath();
  if (currentRootPath) {
    return currentRootPath;
  }

  const projectId = settingsManager.getProject();
  if (!projectId || projectId === DEFAULT_PROJECT) {
    return undefined;
  }

  try {
    const project = await databaseService.getProject(projectId);
    return project?.root_path || undefined;
  } catch {
    return undefined;
  }
}

export async function resolveMemoryContext(
  scope: 'global' | 'project',
  taskId?: string
): Promise<MemoryContext | null> {
  if (scope === 'global') {
    return { scope: 'global' };
  }

  const workspaceRoot = await resolveMemoryWorkspaceRoot(taskId);
  if (!workspaceRoot) {
    return null;
  }

  return {
    scope: 'project',
    workspaceRoot,
  };
}
