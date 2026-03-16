import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockMemoryService,
  mockGetEffectiveWorkspaceRoot,
  mockSettingsManager,
  mockDatabaseService,
} = vi.hoisted(() => ({
  mockMemoryService: {
    saveIndex: vi.fn(),
    appendIndex: vi.fn(),
    saveTopic: vi.fn(),
    appendTopic: vi.fn(),
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
    mockMemoryService.saveIndex.mockResolvedValue({
      scope: 'global',
      path: '/app/memory/global/MEMORY.md',
      content: 'global memory',
      exists: true,
    });
    mockMemoryService.appendIndex.mockResolvedValue({
      scope: 'global',
      path: '/app/memory/global/MEMORY.md',
      content: 'global memory',
      exists: true,
    });
    mockMemoryService.saveTopic.mockResolvedValue({
      scope: 'global',
      path: '/app/memory/global/user.md',
      content: 'user memory',
      exists: true,
    });
    mockMemoryService.appendTopic.mockResolvedValue({
      scope: 'global',
      path: '/app/memory/global/user.md',
      content: 'user memory',
      exists: true,
    });
  });

  it('uses the current root path when taskId is missing for project memory writes', async () => {
    mockSettingsManager.getCurrentRootPath.mockReturnValue('/repo-from-settings');
    mockMemoryService.appendIndex.mockResolvedValueOnce({
      scope: 'project',
      path: '/app/memory/projects/repo-from-settings/MEMORY.md',
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
    expect(mockMemoryService.appendIndex).toHaveBeenCalledWith(
      {
        scope: 'project',
        workspaceRoot: '/repo-from-settings',
      },
      'The stack is React and TypeScript.'
    );
    expect(result).toMatchObject({
      success: true,
      scope: 'project',
      path: '/app/memory/projects/repo-from-settings/MEMORY.md',
    });
  });

  it('uses the selected project root when taskId and current root path are missing', async () => {
    mockSettingsManager.getProject.mockReturnValue('project-1');
    mockDatabaseService.getProject.mockResolvedValue({
      id: 'project-1',
      name: 'Project One',
      root_path: '/repo-from-project',
    });
    mockMemoryService.appendIndex.mockResolvedValueOnce({
      scope: 'project',
      path: '/app/memory/projects/repo-from-project/MEMORY.md',
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
    expect(mockMemoryService.appendIndex).toHaveBeenCalledWith(
      {
        scope: 'project',
        workspaceRoot: '/repo-from-project',
      },
      'The stack is React and TypeScript.'
    );
    expect(result).toMatchObject({
      success: true,
      scope: 'project',
      path: '/app/memory/projects/repo-from-project/MEMORY.md',
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
    expect(mockMemoryService.appendIndex).not.toHaveBeenCalled();
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
    mockMemoryService.appendIndex.mockRejectedValueOnce(new Error('Disk is read-only'));

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

  it('returns an explicit guidance error when topic writes omit file_name', async () => {
    const result = await memoryWrite.execute(
      {
        scope: 'global',
        mode: 'append',
        target: 'topic',
        content: 'Remember this user preference.',
      },
      toolContext
    );

    expect(result).toMatchObject({
      success: false,
      error: 'file_name is required when target="topic".',
      failureKind: 'write_failed',
    });
    expect(result.message).toContain('requires file_name');
  });

  it('returns follow-up guidance after writing a topic file', async () => {
    const result = await memoryWrite.execute(
      {
        scope: 'global',
        mode: 'replace',
        target: 'topic',
        file_name: 'user.md',
        content: 'Remember this user preference.',
      },
      toolContext
    );

    expect(mockMemoryService.saveTopic).toHaveBeenCalledWith(
      {
        scope: 'global',
      },
      'user.md',
      'Remember this user preference.'
    );
    expect(result).toMatchObject({
      success: true,
      scope: 'global',
      path: '/app/memory/global/user.md',
    });
    expect(result.guidance).toEqual(
      expect.arrayContaining([
        expect.stringContaining('updated a topic file'),
        expect.stringContaining('one stable subject area'),
        expect.stringContaining('ensure MEMORY.md mentions it'),
      ])
    );
  });

  it('returns stronger MEMORY.md guidance for append vs replace on index writes', async () => {
    const result = await memoryWrite.execute(
      {
        scope: 'global',
        mode: 'append',
        target: 'index',
        content: '- user.md: User profile',
      },
      toolContext
    );

    expect(mockMemoryService.appendIndex).toHaveBeenCalledWith(
      {
        scope: 'global',
      },
      '- user.md: User profile'
    );
    expect(result.guidance).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Prefer replace when updating MEMORY.md as a whole'),
        expect.stringContaining('Do not add duplicate topic routes'),
      ])
    );
  });
});
