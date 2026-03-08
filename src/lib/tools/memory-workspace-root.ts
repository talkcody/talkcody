import { databaseService } from '@/services/database-service';
import { getEffectiveWorkspaceRoot } from '@/services/workspace-root-service';
import { DEFAULT_PROJECT, settingsManager } from '@/stores/settings-store';

export async function resolveMemoryWorkspaceRoot(taskId: string): Promise<string | undefined> {
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
