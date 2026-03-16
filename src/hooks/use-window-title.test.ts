// src/hooks/use-window-title.test.ts
import { renderHook, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useSettingsStore } from '@/stores/settings-store';
import { useProjectStore } from '@/stores/project-store';

// ─── Module mocks ────────────────────────────────────────────────────────────

const mockSetTitle = vi.fn().mockResolvedValue(undefined);

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: vi.fn(() => ({ setTitle: mockSetTitle })),
}));

// Mutable state that controls the settings store mock
const settingsState = { project: 'default' };

vi.mock('@/stores/settings-store', () => ({
  DEFAULT_PROJECT: 'default',
  useSettingsStore: vi.fn((selector?: (s: typeof settingsState) => unknown) =>
    selector ? selector(settingsState) : settingsState
  ),
}));

// Mutable state that controls the project store mock
const projectState = {
  projects: [] as Array<{ id: string; name: string }>,
  refreshProjects: vi.fn().mockResolvedValue(undefined),
};

vi.mock('@/stores/project-store', () => ({
  useProjectStore: vi.fn((selector?: (s: typeof projectState) => unknown) =>
    selector ? selector(projectState) : projectState
  ),
}));

// ─── Import hook under test (after mocks are in place) ───────────────────────

import { useWindowTitle } from './use-window-title';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const mockedGetCurrentWindow = vi.mocked(getCurrentWindow);
const mockedUseSettingsStore = vi.mocked(useSettingsStore);
const mockedUseProjectStore = vi.mocked(useProjectStore);

function setSelectedProject(id: string) {
  settingsState.project = id;
  mockedUseSettingsStore.mockImplementation(
    (selector?: (s: typeof settingsState) => unknown) =>
      selector ? selector(settingsState) : settingsState
  );
}

function setProjects(projects: Array<{ id: string; name: string }>) {
  projectState.projects = projects;
  mockedUseProjectStore.mockImplementation(
    (selector?: (s: typeof projectState) => unknown) =>
      selector ? selector(projectState) : projectState
  );
  // Also update getState
  (useProjectStore as ReturnType<typeof vi.fn>).getState = vi.fn(() => projectState);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('useWindowTitle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetTitle.mockResolvedValue(undefined);
    projectState.refreshProjects = vi.fn().mockResolvedValue(undefined);
    settingsState.project = 'default';
    projectState.projects = [];
    document.title = 'TalkCody';

    // Wire mocks back after clearAllMocks
    mockedGetCurrentWindow.mockImplementation(() => ({ setTitle: mockSetTitle }) as ReturnType<typeof getCurrentWindow>);
    mockedUseSettingsStore.mockImplementation(
      (selector?: (s: typeof settingsState) => unknown) =>
        selector ? selector(settingsState) : settingsState
    );
    mockedUseProjectStore.mockImplementation(
      (selector?: (s: typeof projectState) => unknown) =>
        selector ? selector(projectState) : projectState
    );
    (useProjectStore as ReturnType<typeof vi.fn>).getState = vi.fn(() => projectState);
  });

  // ── 1. Default / no project ───────────────────────────────────────────────

  it('uses the base title when no project is selected (default)', async () => {
    setSelectedProject('default');
    setProjects([]);

    renderHook(() => useWindowTitle());

    await vi.waitFor(() => {
      expect(mockSetTitle).toHaveBeenCalledWith('TalkCody');
    });
  });

  it('uses the base title when selectedProjectId is empty string', async () => {
    setSelectedProject('');
    setProjects([]);

    renderHook(() => useWindowTitle());

    await vi.waitFor(() => {
      expect(mockSetTitle).toHaveBeenCalledWith('TalkCody');
    });
  });

  // ── 2. Known project in cache ─────────────────────────────────────────────

  it('shows "projectName - baseTitle" when project is found in cached list', async () => {
    setSelectedProject('proj-1');
    setProjects([{ id: 'proj-1', name: 'My Awesome Project' }]);

    renderHook(() => useWindowTitle());

    await vi.waitFor(() => {
      expect(mockSetTitle).toHaveBeenCalledWith('My Awesome Project - TalkCody');
    });
  });

  it('does NOT call refreshProjects when the project is already in the cached list', async () => {
    setSelectedProject('proj-2');
    setProjects([{ id: 'proj-2', name: 'Cached Project' }]);

    renderHook(() => useWindowTitle());

    await vi.waitFor(() => {
      expect(mockSetTitle).toHaveBeenCalledWith('Cached Project - TalkCody');
    });
    expect(projectState.refreshProjects).not.toHaveBeenCalled();
  });

  // ── 3. Unknown project — slow path ────────────────────────────────────────

  it('calls refreshProjects and sets title when project is not in initial cache', async () => {
    setSelectedProject('proj-unknown');
    setProjects([]); // initially empty

    // After refresh, projects list will be populated
    projectState.refreshProjects = vi.fn().mockImplementation(async () => {
      projectState.projects = [{ id: 'proj-unknown', name: 'Loaded From DB' }];
      (useProjectStore as ReturnType<typeof vi.fn>).getState = vi.fn(() => projectState);
    });

    renderHook(() => useWindowTitle());

    await vi.waitFor(() => {
      expect(projectState.refreshProjects).toHaveBeenCalled();
    });
    await vi.waitFor(() => {
      expect(mockSetTitle).toHaveBeenCalledWith('Loaded From DB - TalkCody');
    });
  });

  it('falls back to base title when project is not found even after refresh', async () => {
    setSelectedProject('proj-ghost');
    setProjects([]);
    projectState.refreshProjects = vi.fn().mockResolvedValue(undefined); // refresh finds nothing
    (useProjectStore as ReturnType<typeof vi.fn>).getState = vi.fn(() => projectState); // still empty

    renderHook(() => useWindowTitle());

    await vi.waitFor(() => {
      expect(mockSetTitle).toHaveBeenCalledWith('TalkCody');
    });
  });

  // ── 4. Reactive updates when project changes ──────────────────────────────

  it('updates the title when selectedProjectId changes (re-render)', async () => {
    const allProjects = [
      { id: 'proj-a', name: 'Project Alpha' },
      { id: 'proj-b', name: 'Project Beta' },
    ];

    setSelectedProject('proj-a');
    setProjects(allProjects);

    const { rerender } = renderHook(() => useWindowTitle());

    await vi.waitFor(() => {
      expect(mockSetTitle).toHaveBeenCalledWith('Project Alpha - TalkCody');
    });

    // Switch to project B
    setSelectedProject('proj-b');
    act(() => { rerender(); });

    await vi.waitFor(() => {
      expect(mockSetTitle).toHaveBeenCalledWith('Project Beta - TalkCody');
    });
  });

  // ── 5. Dev mode — respects document.title as base ─────────────────────────

  it('uses "TalkCody Dev" as base when document.title is "TalkCody Dev"', async () => {
    document.title = 'TalkCody Dev';
    setSelectedProject('proj-dev');
    setProjects([{ id: 'proj-dev', name: 'Dev Project' }]);

    renderHook(() => useWindowTitle());

    await vi.waitFor(() => {
      expect(mockSetTitle).toHaveBeenCalledWith('Dev Project - TalkCody Dev');
    });
  });

  // ── 6. document.title fallback when empty ─────────────────────────────────

  it('falls back to "TalkCody" fallback string when document.title is empty', async () => {
    document.title = '';
    setSelectedProject('default');
    setProjects([]);

    renderHook(() => useWindowTitle());

    await vi.waitFor(() => {
      expect(mockSetTitle).toHaveBeenCalledWith('TalkCody');
    });
  });

  // ── 7. setTitle error handling ────────────────────────────────────────────

  it('does not throw when setTitle rejects (handles error gracefully)', async () => {
    mockSetTitle.mockRejectedValueOnce(new Error('Tauri IPC error'));
    setSelectedProject('proj-err');
    setProjects([{ id: 'proj-err', name: 'Error Project' }]);

    expect(() => {
      renderHook(() => useWindowTitle());
    }).not.toThrow();

    // Let async effects settle without throwing
    await new Promise((r) => setTimeout(r, 50));
  });

  // ── 8. Multiple rapid project switches — stale update guard ───────────────

  it('does not apply a stale async title when the project changes rapidly', async () => {
    let resolveSlowRefresh!: () => void;

    // First project: not in cache, triggers slow refresh
    setSelectedProject('proj-slow');
    setProjects([]);

    const slowProjectsAfterRefresh = [{ id: 'proj-slow', name: 'Slow Project' }];
    const fastProjects = [
      { id: 'proj-slow', name: 'Slow Project' },
      { id: 'proj-fast', name: 'Fast Project' },
    ];

    projectState.refreshProjects = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSlowRefresh = () => {
            projectState.projects = slowProjectsAfterRefresh;
            (useProjectStore as ReturnType<typeof vi.fn>).getState = vi.fn(() => projectState);
            resolve();
          };
        })
    );

    const { rerender } = renderHook(() => useWindowTitle());

    // Immediately switch to proj-fast (which IS in the new cache)
    setSelectedProject('proj-fast');
    setProjects(fastProjects);
    (useProjectStore as ReturnType<typeof vi.fn>).getState = vi.fn(() => projectState);

    act(() => { rerender(); });

    // Fast project should be set
    await vi.waitFor(() => {
      expect(mockSetTitle).toHaveBeenCalledWith('Fast Project - TalkCody');
    });

    // Now resolve the slow refresh — should be a no-op for the title
    act(() => { resolveSlowRefresh(); });
    await new Promise((r) => setTimeout(r, 50));

    // The final title should still be for the fast project
    const calls = mockSetTitle.mock.calls;
    const lastTitle = calls[calls.length - 1]?.[0];
    expect(lastTitle).toBe('Fast Project - TalkCody');
  });

  // ── 9. Multiple projects in store, selects correct one ───────────────────

  it('selects the correct project when multiple projects exist in the store', async () => {
    setSelectedProject('proj-b');
    setProjects([
      { id: 'proj-a', name: 'Alpha' },
      { id: 'proj-b', name: 'Beta' },
      { id: 'proj-c', name: 'Gamma' },
    ]);

    renderHook(() => useWindowTitle());

    await vi.waitFor(() => {
      expect(mockSetTitle).toHaveBeenCalledWith('Beta - TalkCody');
    });
    // Should NOT have called with other project names
    expect(mockSetTitle).not.toHaveBeenCalledWith('Alpha - TalkCody');
    expect(mockSetTitle).not.toHaveBeenCalledWith('Gamma - TalkCody');
  });
});
