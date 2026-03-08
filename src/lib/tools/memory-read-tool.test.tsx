import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockMemoryService,
  mockGetEffectiveWorkspaceRoot,
  mockSettingsManager,
  mockDatabaseService,
} = vi.hoisted(() => ({
  mockMemoryService: {
    getGlobalDocument: vi.fn(),
    getProjectMemoryDocument: vi.fn(),
    read: vi.fn(),
    search: vi.fn(),
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

import { memoryRead } from './memory-read-tool';

describe('memoryRead tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSettingsManager.getCurrentRootPath.mockReturnValue('');
    mockSettingsManager.getProject.mockReturnValue('default');
    mockGetEffectiveWorkspaceRoot.mockResolvedValue('/repo-from-task');
    mockDatabaseService.getProject.mockResolvedValue(null);
    mockMemoryService.getGlobalDocument.mockResolvedValue({
      scope: 'global',
      path: '/app/memory/memory.md',
      content: 'Global memory',
      exists: true,
    });
    mockMemoryService.getProjectMemoryDocument.mockResolvedValue({
      scope: 'project',
      path: '/repo/AGENTS.md',
      content: 'Project memory',
      exists: true,
    });
    mockMemoryService.read.mockResolvedValue([]);
    mockMemoryService.search.mockResolvedValue([]);
  });

  it('uses the selected project root when taskId and current root path are missing', async () => {
    mockSettingsManager.getProject.mockReturnValue('project-1');
    mockDatabaseService.getProject.mockResolvedValue({
      id: 'project-1',
      name: 'Project One',
      root_path: '/repo-from-project',
    });
    mockMemoryService.getProjectMemoryDocument.mockResolvedValueOnce({
      scope: 'project',
      path: '/repo-from-project/AGENTS.md',
      content: 'Project memory',
      exists: true,
    });

    const result = await memoryRead.execute(
      {
        scope: 'all',
      },
      {
        taskId: '',
        toolId: 'memory-read-test',
      }
    );

    expect(mockGetEffectiveWorkspaceRoot).not.toHaveBeenCalled();
    expect(mockSettingsManager.getCurrentRootPath).toHaveBeenCalled();
    expect(mockSettingsManager.getProject).toHaveBeenCalled();
    expect(mockDatabaseService.getProject).toHaveBeenCalledWith('project-1');
    expect(mockMemoryService.getProjectMemoryDocument).toHaveBeenCalledWith('/repo-from-project');
    expect(result).toMatchObject({
      success: true,
      mode: 'read',
      scope: 'all',
    });
  });

  it('uses the selected project root for memory search when taskId and current root path are missing', async () => {
    mockSettingsManager.getProject.mockReturnValue('project-1');
    mockDatabaseService.getProject.mockResolvedValue({
      id: 'project-1',
      name: 'Project One',
      root_path: '/repo-from-project',
    });
    mockMemoryService.search.mockResolvedValueOnce([
      {
        scope: 'project',
        path: '/repo-from-project/AGENTS.md',
        snippet: 'Use React and TypeScript',
        score: 3,
        backend: 'text',
        lineNumber: 1,
      },
    ]);

    const result = await memoryRead.execute(
      {
        scope: 'project',
        query: 'TypeScript',
      },
      {
        taskId: '',
        toolId: 'memory-read-test',
      }
    );

    expect(mockMemoryService.search).toHaveBeenCalledWith('TypeScript', {
      workspaceRoot: '/repo-from-project',
      taskId: '',
      scopes: ['project'],
      maxResults: undefined,
    });
    expect(result).toMatchObject({
      success: true,
      mode: 'search',
      scope: 'project',
    });
  });

  it('renders project search results with section-based memory line labels', () => {
    render(
      memoryRead.renderToolResult(
        {
          success: true,
          mode: 'search',
          scope: 'project',
          message: 'Found 1 memory matches for "TypeScript".',
          results: [
            {
              scope: 'project',
              path: '/repo/AGENTS.md',
              snippet: 'Use React and TypeScript',
              score: 3,
              backend: 'text',
              lineNumber: 4,
            },
          ],
        },
        {
          scope: 'project',
          query: 'TypeScript',
        }
      )
    );

    expect(screen.getByText('/repo/AGENTS.md (memory line 4)')).toBeInTheDocument();
    expect(screen.getByText('Use React and TypeScript')).toBeInTheDocument();
  });
});