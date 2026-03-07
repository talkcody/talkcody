import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockMemoryService,
  mockGetEffectiveWorkspaceRoot,
  mockSettingsManager,
  mockDatabaseService,
} = vi.hoisted(() => ({
  mockMemoryService: {
    writeGlobal: vi.fn(),
    appendGlobal: vi.fn(),
    writeProjectMemoryDocument: vi.fn(),
    appendProjectMemoryDocument: vi.fn(),
  },
  mockGetEffectiveWorkspaceRoot: vi.fn(),
  mockSettingsManager: {
    getCurrentRootPath: vi.fn(),
    getProject: vi.fn(),
  },
  mockDatabaseService: {
    getProject: vi.fn(),
  },
}));

vi.mock('@/services/memory/memory-service', () => ({
  memoryService: mockMemoryService,
}));

vi.mock('@/services/workspace-root-service', () => ({
  getEffectiveWorkspaceRoot: mockGetEffectiveWorkspaceRoot,
}));

vi.mock('@/stores/settings-store', () => ({
  DEFAULT_PROJECT: 'default',
  settingsManager: mockSettingsManager,
}));

vi.mock('@/services/database-service', () => ({
  databaseService: mockDatabaseService,
}));

import { memoryWrite } from './memory-write-tool';

describe('memoryWrite tool', () => {
  const toolContext = {
    taskId: '',
    toolId: 'memory-write-test',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSettingsManager.getCurrentRootPath.mockReturnValue('');
    mockSettingsManager.getProject.mockReturnValue('default');
    mockGetEffectiveWorkspaceRoot.mockResolvedValue('/repo-from-task');
    mockDatabaseService.getProject.mockResolvedValue(null);
    mockMemoryService.writeGlobal.mockResolvedValue({
      scope: 'global',
      path: '/app/memory/memory.md',
      content: 'global memory',
      exists: true,
    });
    mockMemoryService.appendGlobal.mockResolvedValue({
      scope: 'global',
      path: '/app/memory/memory.md',
      content: 'global memory',
      exists: true,
    });
    mockMemoryService.writeProjectMemoryDocument.mockResolvedValue({
      scope: 'project',
      path: '/repo-from-task/AGENTS.md',
      content: 'project memory',
      exists: true,
    });
    mockMemoryService.appendProjectMemoryDocument.mockResolvedValue({
      scope: 'project',
      path: '/repo-from-task/AGENTS.md',
      content: 'project memory',
      exists: true,
    });
  });

  it('uses the current root path when taskId is missing for project memory writes', async () => {
    mockSettingsManager.getCurrentRootPath.mockReturnValue('/repo-from-settings');
    mockMemoryService.appendProjectMemoryDocument.mockResolvedValueOnce({
      scope: 'project',
      path: '/repo-from-settings/AGENTS.md',
      content: 'The stack is React and TypeScript.',
      exists: true,
    });

    const result = await memoryWrite.execute(
      {
        scope: 'project',
        mode: 'append',
        content: 'The stack is React and TypeScript.',
      },
      toolContext
    );

    expect(mockGetEffectiveWorkspaceRoot).not.toHaveBeenCalled();
    expect(mockSettingsManager.getCurrentRootPath).toHaveBeenCalled();
    expect(mockMemoryService.appendProjectMemoryDocument).toHaveBeenCalledWith(
      '/repo-from-settings',
      'The stack is React and TypeScript.'
    );
    expect(result).toMatchObject({
      success: true,
      scope: 'project',
      path: '/repo-from-settings/AGENTS.md',
    });
  });

  it('uses the selected project root when taskId and current root path are missing', async () => {
    mockSettingsManager.getProject.mockReturnValue('project-1');
    mockDatabaseService.getProject.mockResolvedValue({
      id: 'project-1',
      name: 'Project One',
      root_path: '/repo-from-project',
    });
    mockMemoryService.appendProjectMemoryDocument.mockResolvedValueOnce({
      scope: 'project',
      path: '/repo-from-project/AGENTS.md',
      content: 'The stack is React and TypeScript.',
      exists: true,
    });

    const result = await memoryWrite.execute(
      {
        scope: 'project',
        mode: 'append',
        content: 'The stack is React and TypeScript.',
      },
      toolContext
    );

    expect(mockGetEffectiveWorkspaceRoot).not.toHaveBeenCalled();
    expect(mockSettingsManager.getCurrentRootPath).toHaveBeenCalled();
    expect(mockSettingsManager.getProject).toHaveBeenCalled();
    expect(mockDatabaseService.getProject).toHaveBeenCalledWith('project-1');
    expect(mockMemoryService.appendProjectMemoryDocument).toHaveBeenCalledWith(
      '/repo-from-project',
      'The stack is React and TypeScript.'
    );
    expect(result).toMatchObject({
      success: true,
      scope: 'project',
      path: '/repo-from-project/AGENTS.md',
    });
  });

  it('returns a strict non-fallback failure when project context is missing', async () => {
    mockSettingsManager.getCurrentRootPath.mockReturnValue('');

    const result = await memoryWrite.execute(
      {
        scope: 'project',
        mode: 'append',
        content: 'The stack is React and TypeScript.',
      },
      toolContext
    );

    expect(mockGetEffectiveWorkspaceRoot).not.toHaveBeenCalled();
    expect(mockMemoryService.appendProjectMemoryDocument).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      success: false,
      error: 'Workspace root is missing.',
      failureKind: 'missing_project_context',
      allowScopeFallback: false,
      suggestedAction: 'ask_user_to_select_project',
    });
    expect(result.message).toContain('Do not retry this write as global memory');
  });

  it('does not allow silent project-to-global fallback after a project write error', async () => {
    mockGetEffectiveWorkspaceRoot.mockResolvedValue('/repo-from-task');
    mockMemoryService.appendProjectMemoryDocument.mockRejectedValueOnce(new Error('Disk is read-only'));

    const result = await memoryWrite.execute(
      {
        scope: 'project',
        mode: 'append',
        content: 'The stack is React and TypeScript.',
      },
      {
        taskId: 'task-123',
        toolId: 'memory-write-test',
      }
    );

    expect(mockGetEffectiveWorkspaceRoot).toHaveBeenCalledWith('task-123');
    expect(result).toMatchObject({
      success: false,
      error: 'Disk is read-only',
      failureKind: 'project_write_failed',
      allowScopeFallback: false,
      suggestedAction: 'report_error_to_user',
    });
    expect(result.message).toContain('Do not retry this write as global memory');
  });
});
