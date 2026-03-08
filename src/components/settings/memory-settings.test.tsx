import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockToast } from '@/test/mocks';

const { mockSettingsState, mockMemoryService, mockDatabaseService } = vi.hoisted(() => ({
  mockSettingsState: {
    language: 'en',
    current_root_path: '',
    project: 'default',
    memory_global_enabled: true,
    memory_project_enabled: true,
    setMemoryGlobalEnabled: vi.fn().mockResolvedValue(undefined),
    setMemoryProjectEnabled: vi.fn().mockResolvedValue(undefined),
  },
  mockMemoryService: {
    getGlobalDocument: vi.fn(),
    getProjectMemoryDocument: vi.fn(),
    writeGlobal: vi.fn(),
    writeProjectMemoryDocument: vi.fn(),
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
  memoryService: mockMemoryService,
}));

import { MemorySettings } from './memory-settings';

describe('MemorySettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSettingsState.language = 'en';
    mockSettingsState.current_root_path = '';
    mockSettingsState.project = 'default';

    mockMemoryService.getGlobalDocument.mockResolvedValue({
      scope: 'global',
      path: '/app-data/memory/memory.md',
      content: 'Global memory',
      exists: true,
      sourceType: 'global_file',
    });
    mockMemoryService.getProjectMemoryDocument.mockImplementation(async (root?: string) => ({
      scope: 'project',
      path: root ? `${root}/AGENTS.md` : null,
      content: root ? 'Project memory' : '',
      exists: Boolean(root),
      sourceType: 'project_root_section',
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

  it('reloads project memory from the selected project root when current root path is empty', async () => {
    const { rerender } = render(<MemorySettings />);

    await waitFor(() => {
      expect(mockMemoryService.getProjectMemoryDocument).toHaveBeenCalledWith(undefined);
    });
    expect(screen.getByText('Open a project to view or edit project memory.')).toBeInTheDocument();
    expect(screen.queryByText('Instruction file')).toBeNull();

    mockSettingsState.project = 'project-1';
    rerender(<MemorySettings />);

    await waitFor(() => {
      expect(mockDatabaseService.getProject).toHaveBeenCalledWith('project-1');
    });
    await waitFor(() => {
      expect(mockMemoryService.getProjectMemoryDocument).toHaveBeenLastCalledWith('/repo-one');
    });

    expect(screen.getAllByText('/repo-one/AGENTS.md').length).toBeGreaterThan(0);
    expect(screen.getByDisplayValue('Project memory')).toBeInTheDocument();
  });

  it('renders readable Chinese copy for the memory settings page', async () => {
    mockSettingsState.language = 'zh';

    render(<MemorySettings />);

    await waitFor(() => {
      expect(screen.getByText('长期记忆')).toBeInTheDocument();
    });

    expect(screen.getByText('提示词注入')).toBeInTheDocument();
    expect(screen.getAllByText('项目记忆').length).toBeGreaterThan(0);
    expect(screen.getAllByText('保存').length).toBeGreaterThan(0);
    expect(screen.getAllByText('刷新').length).toBeGreaterThan(0);
    expect(screen.queryByText('项目指令')).toBeNull();
  });

  it('does not show reload success when reloading memory fails', async () => {
    mockMemoryService.getGlobalDocument
      .mockResolvedValueOnce({
        scope: 'global',
        path: '/app-data/memory/memory.md',
        content: 'Global memory',
        exists: true,
        sourceType: 'global_file',
      })
      .mockRejectedValueOnce(new Error('load failed'));

    render(<MemorySettings />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Global memory')).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'Refresh' })[0]);

    await waitFor(() => {
      expect(mockToast.toast.error).toHaveBeenCalledWith('Failed to load memory.');
    });
    expect(mockToast.toast.success).not.toHaveBeenCalledWith('Memory reloaded.');
  });
});