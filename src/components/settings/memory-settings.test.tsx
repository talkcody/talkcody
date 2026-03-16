import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockToast } from '@/test/mocks';

const { mockSettingsState, mockMemoryService, mockDatabaseService } = vi.hoisted(() => ({
  mockSettingsState: {
    language: 'en',
    current_root_path: '',
    project: 'default',
    memory_global_enabled: false,
    memory_project_enabled: false,
    setMemoryGlobalEnabled: vi.fn().mockResolvedValue(undefined),
    setMemoryProjectEnabled: vi.fn().mockResolvedValue(undefined),
  },
  mockMemoryService: {
    getIndex: vi.fn(),
    listTopics: vi.fn(),
    auditWorkspace: vi.fn(),
    saveIndex: vi.fn(),
    saveTopic: vi.fn(),
    renameTopic: vi.fn(),
    deleteTopic: vi.fn(),
  },
  mockDatabaseService: {
    getProject: vi.fn(),
  },
}));

vi.mock('sonner', () => mockToast);

vi.mock('@/stores/settings-store', () => ({
  DEFAULT_PROJECT: 'default',
  useSettingsStore: vi.fn((selector: (state: typeof mockSettingsState) => unknown) =>
    selector(mockSettingsState)
  ),
}));

vi.mock('@/services/database-service', () => ({
  databaseService: mockDatabaseService,
}));

vi.mock('@/services/memory/memory-service', () => ({
  MEMORY_INDEX_INJECTION_LINE_LIMIT: 200,
  memoryService: mockMemoryService,
}));

import { MemorySettings } from './memory-settings';

describe('MemorySettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSettingsState.language = 'en';
    mockSettingsState.current_root_path = '';
    mockSettingsState.project = 'default';

    mockMemoryService.getIndex.mockImplementation(async (context: { scope: 'global' | 'project'; workspaceRoot?: string }) => ({
      scope: context.scope,
      path:
        context.scope === 'global'
          ? '/app-data/memory/global/MEMORY.md'
          : context.workspaceRoot
            ? '/app-data/memory/projects/repo/MEMORY.md'
            : null,
      content:
        context.scope === 'global'
          ? '# Global Index\n- preferences.md'
          : context.workspaceRoot
            ? '# Project Index\n- architecture.md'
            : '',
      exists: context.scope === 'global' || Boolean(context.workspaceRoot),
      kind: 'index',
      fileName: 'MEMORY.md',
      sourceType: context.scope === 'global' ? 'global_index' : 'project_index',
    }));
    mockMemoryService.listTopics.mockImplementation(async (context: { scope: 'global' | 'project' }) => {
      if (context.scope === 'global') {
        return [
          {
            scope: 'global',
            path: '/app-data/memory/global/preferences.md',
            content: '## Preferences',
            exists: true,
            kind: 'topic',
            fileName: 'preferences.md',
          },
        ];
      }

      return [
        {
          scope: 'project',
          path: '/app-data/memory/projects/repo/architecture.md',
          content: '## Architecture',
          exists: true,
          kind: 'topic',
          fileName: 'architecture.md',
        },
      ];
    });
    mockMemoryService.auditWorkspace.mockImplementation(async (context: { scope: 'global' | 'project' }) => ({
      overInjectionLimit: false,
      injectedLineCount: 2,
      totalLineCount: 2,
      topicFiles: context.scope === 'global' ? ['preferences.md'] : ['architecture.md'],
      indexedTopicFiles: context.scope === 'global' ? ['preferences.md'] : ['architecture.md'],
      unindexedTopicFiles: [],
      missingTopicFiles: [],
    }));
    mockDatabaseService.getProject.mockImplementation(async (projectId: string) => {
      if (projectId === 'project-1') {
        return {
          id: 'project-1',
          name: 'Project One',
          root_path: '/repo-one',
        };
      }
      return null;
    });
  });

  it('reloads project workspace from the selected project root when current root path is empty', async () => {
    const { rerender } = render(<MemorySettings />);

    fireEvent.click(screen.getByRole('button', { name: 'Project Memory' }));

    await waitFor(() => {
      expect(screen.getByText('Open a project to view or edit project memory.')).toBeInTheDocument();
    });

    mockSettingsState.project = 'project-1';
    rerender(<MemorySettings />);

    await waitFor(() => {
      expect(mockDatabaseService.getProject).toHaveBeenCalledWith('project-1');
    });
    await waitFor(() => {
      expect(mockMemoryService.getIndex).toHaveBeenCalledWith({
        scope: 'project',
        workspaceRoot: '/repo-one',
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Project Memory' }));

    await waitFor(() => {
      expect(screen.getByText('/repo-one')).toBeInTheDocument();
    });
    expect(screen.getAllByText('/app-data/memory/projects/repo/MEMORY.md').length).toBeGreaterThan(0);
  });

  it('renders readable Chinese copy and topic workspace controls', async () => {
    mockSettingsState.language = 'zh';

    render(<MemorySettings />);

    await waitFor(() => {
      expect(screen.getByText('长期记忆工作区')).toBeInTheDocument();
    });

    expect(screen.getByText('提示词注入')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '索引' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Topics' })).toBeInTheDocument();
    expect(screen.getByText('索引审计')).toBeInTheDocument();
  });

  it('renders memory injection switches as off by default', async () => {
    render(<MemorySettings />);

    await waitFor(() => {
      expect(screen.getByText('Prompt Injection')).toBeInTheDocument();
    });

    const switches = screen.getAllByRole('switch');
    expect(switches).toHaveLength(2);
    expect(switches[0]).toHaveAttribute('aria-checked', 'false');
    expect(switches[1]).toHaveAttribute('aria-checked', 'false');
  });

  it('shows topic files and audit signals in the topic workspace view', async () => {
    render(<MemorySettings />);

    await waitFor(() => {
      expect(screen.getByText('Injected lines: 2/200')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Topics' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'preferences.md' })).toBeInTheDocument();
    });
    expect(screen.getByLabelText('Topic file name')).toHaveValue('preferences.md');
    expect(screen.getByDisplayValue('## Preferences')).toBeInTheDocument();
  });

  it('creates a real topic file immediately when clicking New Topic', async () => {
    mockMemoryService.saveTopic.mockResolvedValue({
      scope: 'global',
      path: '/app-data/memory/global/untitled-topic.md',
      content: '',
      exists: true,
      kind: 'topic',
      fileName: 'untitled-topic.md',
    });

    render(<MemorySettings />);

    await waitFor(() => {
      expect(screen.getByText('Injected lines: 2/200')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Topics' }));
    fireEvent.click(screen.getByRole('button', { name: 'New Topic' }));

    await waitFor(() => {
      expect(mockMemoryService.saveTopic).toHaveBeenCalledWith(
        {
          scope: 'global',
        },
        'untitled-topic.md',
        ''
      );
    });
    expect(mockToast.toast.success).toHaveBeenCalledWith('Topic memory saved.');
  });

  it('does not show reload success when reloading memory fails', async () => {
    mockMemoryService.getIndex
      .mockResolvedValueOnce({
        scope: 'global',
        path: '/app-data/memory/global/MEMORY.md',
        content: '# Global Index',
        exists: true,
        kind: 'index',
        fileName: 'MEMORY.md',
        sourceType: 'global_index',
      })
      .mockRejectedValueOnce(new Error('load failed'));

    render(<MemorySettings />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('# Global Index')).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'Refresh' })[0]);

    await waitFor(() => {
      expect(mockToast.toast.error).toHaveBeenCalledWith('Failed to load memory workspace.');
    });
    expect(mockToast.toast.success).not.toHaveBeenCalledWith('Memory workspace reloaded.');
  });
});
