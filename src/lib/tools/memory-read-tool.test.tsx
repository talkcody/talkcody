import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockMemoryService,
  mockGetEffectiveWorkspaceRoot,
  mockSettingsManager,
  mockDatabaseService,
} = vi.hoisted(() => ({
  mockMemoryService: {
    getIndex: vi.fn(),
    getTopic: vi.fn(),
    listTopics: vi.fn(),
    auditWorkspace: vi.fn(),
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
    mockMemoryService.getIndex.mockImplementation(async (context: { scope: string; workspaceRoot?: string }) => ({
      scope: context.scope,
      path:
        context.scope === 'global'
          ? '/app/memory/global/MEMORY.md'
          : context.workspaceRoot
            ? '/app/memory/projects/repo/MEMORY.md'
            : null,
      content: context.scope === 'global' ? 'Global memory' : 'Project memory',
      exists: true,
      kind: 'index',
      fileName: 'MEMORY.md',
    }));
    mockMemoryService.getTopic.mockResolvedValue({
      scope: 'global',
      path: '/app/memory/global/user.md',
      content: 'User topic',
      exists: true,
      kind: 'topic',
      fileName: 'user.md',
    });
    mockMemoryService.listTopics.mockResolvedValue([]);
    mockMemoryService.auditWorkspace.mockResolvedValue({});
  });

  it('returns an explicit guidance error when target topic is missing file_name', async () => {
    const result = await memoryRead.execute(
      {
        scope: 'global',
        target: 'topic',
      },
      {
        taskId: '',
        toolId: 'memory-read-test',
      }
    );

    expect(result).toMatchObject({
      success: false,
      error: 'file_name is required when target="topic".',
      failureKind: 'read_failed',
    });
    expect(result.message).toContain('Read MEMORY.md or list topics first');
  });

  it('returns index-specific guidance after reading MEMORY.md', async () => {
    mockMemoryService.getIndex.mockResolvedValueOnce({
      scope: 'global',
      path: '/app/memory/global/MEMORY.md',
      content: '# Memory Index\n- user.md',
      exists: true,
      kind: 'index',
      fileName: 'MEMORY.md',
    });

    const result = await memoryRead.execute(
      {
        scope: 'global',
        target: 'index',
      },
      {
        taskId: '',
        toolId: 'memory-read-test',
      }
    );

    expect(result).toMatchObject({
      success: true,
      mode: 'read',
      scope: 'global',
    });
    if (result.success) {
      expect(result.guidance).toEqual(
        expect.arrayContaining([
          expect.stringContaining('MEMORY.md is only the routing index'),
          expect.stringContaining('full MEMORY.md file'),
          expect.stringContaining('call memoryRead again with target="topic"'),
        ])
      );
    }
  });

  it('uses the selected project root when taskId and current root path are missing', async () => {
    mockSettingsManager.getProject.mockReturnValue('project-1');
    mockDatabaseService.getProject.mockResolvedValue({
      id: 'project-1',
      name: 'Project One',
      root_path: '/repo-from-project',
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
    expect(mockMemoryService.getIndex).toHaveBeenCalledWith({
      scope: 'project',
      workspaceRoot: '/repo-from-project',
    });
    expect(result).toMatchObject({
      success: true,
      mode: 'read',
      scope: 'all',
    });
  });

  it('reads the full project MEMORY.md file when selected project root resolution is needed', async () => {
    mockSettingsManager.getProject.mockReturnValue('project-1');
    mockDatabaseService.getProject.mockResolvedValue({
      id: 'project-1',
      name: 'Project One',
      root_path: '/repo-from-project',
    });
    mockMemoryService.getIndex.mockResolvedValueOnce({
      scope: 'project',
      path: '/app/memory/projects/repo-from-project/MEMORY.md',
      content: '# Memory Index\n- stack.md',
      exists: true,
      kind: 'index',
      fileName: 'MEMORY.md',
    });

    const result = await memoryRead.execute(
      {
        scope: 'project',
        target: 'index',
      },
      {
        taskId: '',
        toolId: 'memory-read-test',
      }
    );

    expect(mockMemoryService.getIndex).toHaveBeenCalledWith({
      scope: 'project',
      workspaceRoot: '/repo-from-project',
    });
    expect(result).toMatchObject({
      success: true,
      mode: 'read',
      scope: 'project',
    });
  });

  it('renders full memory reads without a search-results block', () => {
    render(
      memoryRead.renderToolResult(
        {
          success: true,
          mode: 'read',
          scope: 'project',
          message: 'Loaded 1 memory document.',
          documents: [
            {
              scope: 'project',
              path: '/app/memory/projects/repo/MEMORY.md',
              content: '# Memory Index\n- stack.md',
              exists: true,
              kind: 'index',
              fileName: 'MEMORY.md',
            },
          ],
          guidance: ['This reads the full MEMORY.md file for the selected scope, not just the first 200 injected lines.'],
        },
        {
          scope: 'project',
          target: 'index',
        }
      )
    );

    expect(screen.getByText('/app/memory/projects/repo/MEMORY.md')).toBeInTheDocument();
    expect(
      screen.getByText((content) => content.includes('# Memory Index') && content.includes('- stack.md'))
    ).toBeInTheDocument();
    expect(screen.getByText('Usage guidance')).toBeInTheDocument();
  });
});
