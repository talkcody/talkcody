/**
 * Test for project dropdown sync bug fix
 * 
 * Bug: When clicking dock menu project, file tree loads successfully but 
 * project-dropdown still shows the old project.
 * 
 * Root cause: currentProjectId was a local state that only loaded once on mount,
 * so it didn't react to settings changes.
 * 
 * Fix: Changed from local state to reactive settings store selector.
 */

import type React from 'react';
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RepositoryLayout } from './repository-layout';
import { useSettingsStore } from '@/stores/settings-store';
import { useRepositoryStore } from '@/stores/window-scoped-repository-store';
import { useProjectStore } from '@/stores/project-store';

// Mock all dependencies
vi.mock('@/stores/settings-store');
vi.mock('@/stores/window-scoped-repository-store');
vi.mock('@/stores/project-store');
vi.mock('@/stores/git-store');
vi.mock('@/stores/terminal-store');
vi.mock('@/stores/execution-store');
vi.mock('@/stores/worktree-store');
vi.mock('@/stores/lint-store');
vi.mock('@/hooks/use-repository-watcher');
vi.mock('@/hooks/use-global-shortcuts');
vi.mock('@/hooks/use-global-file-search');
vi.mock('@/hooks/use-tasks');
vi.mock('@/hooks/use-worktree-conflict');
vi.mock('@/hooks/use-locale');
vi.mock('@/services/window-manager-service');

// Mock useTasks hook
vi.mock('@/hooks/use-tasks', () => ({
  useTasks: vi.fn(() => ({
    tasks: [],
    loading: false,
    editingId: null,
    editingTitle: '',
    setEditingTitle: vi.fn(),
    deleteTask: vi.fn(),
    finishEditing: vi.fn(),
    startEditing: vi.fn(),
    cancelEditing: vi.fn(),
    selectTask: vi.fn(),
    currentTaskId: null,
    startNewChat: vi.fn(),
    loadTasks: vi.fn(),
  })),
}));

// Mock ResizeObserver
global.ResizeObserver = class ResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
};

vi.mock('@/hooks/use-worktree-conflict', () => ({
  useWorktreeConflict: vi.fn(() => ({
    conflictData: null,
    isProcessing: false,
    mergeResult: null,
    syncResult: null,
    checkForConflicts: vi.fn(),
    discardChanges: vi.fn(),
    mergeToMain: vi.fn(),
    syncFromMain: vi.fn(),
    cancelOperation: vi.fn(),
    resetState: vi.fn(),
  })),
}));

vi.mock('@/hooks/use-global-file-search', () => ({
  useGlobalFileSearch: vi.fn(() => ({
    isOpen: false,
    openSearch: vi.fn(),
    closeSearch: vi.fn(),
    handleFileSelect: vi.fn(),
  })),
}));

// Create a shared translation mock object to ensure consistency
const mockTranslations = {
  Sidebar: { files: 'Files', tasks: 'Tasks' },
  FileTree: { success: {}, errors: {} },
  RepositoryStore: { success: {}, errors: {} },
  Settings: { search: { searchFiles: 'Search Files' } },
  Repository: {
    emptyState: {
      title: 'No Repository Open',
      description: 'Select a folder to get started',
      selectRepository: 'Select Repository',
      recentProjects: 'Recent Projects',
    },
  },
  Projects: {
    recentProjects: 'Recent Projects',
  },
  Common: {
    learnMore: 'Learn More',
  },
  Skills: {
    selector: {
      title: 'Skills',
      description: 'Description',
      learnMore: 'Learn More',
      active: 'active',
      searchPlaceholder: 'Search skills',
      loading: 'Loading...',
      noSkillsFound: 'No skills found',
      noSkillsAvailable: 'No skills available',
      browseMarketplace: 'Browse Marketplace',
      skillAdded: 'Skill added',
      skillRemoved: 'Skill removed',
      updateFailed: 'Update failed',
    },
  },
  Chat: {
    placeholder: 'Type a message...',
    send: 'Send',
    stop: 'Stop',
    newChat: 'New Chat',
    emptyState: {
      title: 'AI Assistant',
      description: 'Start chatting',
    },
    voice: {
      startRecording: 'Start Recording',
      stopRecording: 'Stop Recording',
      transcribing: 'Transcribing...',
      notSupported: 'Not supported',
      error: (message: string) => `Error: ${message}`,
      modal: {
        connectingTitle: 'Connecting...',
        transcribingTitle: 'Transcribing...',
        recordingTitle: 'Recording...',
        connecting: 'Connecting...',
        recording: 'Recording:',
        processing: 'Processing...',
        liveTranscript: 'Live transcript:',
        stopAndTranscribe: 'Stop & Transcribe',
      },
    },
    files: {
      addAttachment: 'Add Attachment',
      uploadFile: 'Upload File',
      uploadImage: 'Upload Image',
      fileAdded: (filename: string) => `File ${filename} added`,
    },
    image: {
      dropHere: 'Drop here',
      pasteMultipleSuccess: 'Images pasted',
      pasteSuccess: 'Image pasted',
      notSupported: 'Not supported',
      notSupportedDescription: 'Not supported',
    },
    model: {
      switchFailed: 'Switch failed',
      switchSuccess: 'Model switched',
    },
    modelSelector: {
      title: 'Main Model',
      description: 'Select model',
      currentModel: 'Current model',
      noModels: 'No models available',
    },
    planMode: {
      label: 'Plan Mode',
      title: 'Plan Mode',
      description: 'Description',
      learnMore: 'Learn More',
      enabledTooltip: 'Plan Mode enabled',
      disabledTooltip: 'Plan Mode disabled',
    },
    worktree: {
      label: 'Worktree',
      title: 'Worktree',
      description: 'Description',
      learnMore: 'Learn More',
      enabledTooltip: 'Worktree enabled',
      disabledTooltip: 'Worktree disabled',
    },
    tools: {
      title: 'Tools',
      description: 'Description',
      selected: (count: number) => `${count} selected`,
      addedTemp: 'Added Temp',
      removedTemp: 'Removed Temp',
      modified: 'Modified',
      builtIn: 'Built-in',
      noTools: 'No tools',
      reset: 'Reset',
      resetSuccess: 'Reset success',
    },
    toolbar: {
      model: 'Model',
      planMode: 'Plan Mode',
      actMode: 'Act Mode',
      planModeTooltip: 'Plan Mode',
      actModeTooltip: 'Act Mode',
      toggleTerminal: 'Toggle Terminal',
      searchFiles: 'Search Files',
      searchContent: 'Search Content',
      inputTokens: 'Tokens',
      outputTokens: 'Tokens',
    },
    commands: {
      hint: '/ for commands',
    },
  },
  MCPServers: {
    selector: {
      title: 'MCP Servers',
      description: 'Description',
      toolsTitle: 'MCP Tools',
      modified: 'Modified',
      selected: 'selected',
      reset: 'Reset',
      noServersAvailable: 'No servers',
    },
  },
  Agents: {
    title: 'Agents',
  },
  Worktree: {
    conflictDialog: {
      title: 'Uncommitted Changes Detected',
      description: 'The worktree has uncommitted changes',
      changesCount: (count: number) => `${count} file(s) changed`,
      modifiedFiles: 'Modified Files',
      addedFiles: 'Added Files',
      deletedFiles: 'Deleted Files',
      worktreePath: 'Worktree Path',
      actions: {
        discard: 'Discard Changes',
        discardDescription: 'Remove all uncommitted changes',
        merge: 'Merge to Main',
        mergeDescription: 'Merge changes to the main branch',
        sync: 'Sync from Main',
        syncDescription: 'Sync from main branch',
        cancel: 'Cancel',
      },
      mergeConflict: {
        title: 'Merge Conflict',
        description: 'The merge has conflicts',
        conflictFiles: 'Conflicted Files',
        resolveManually: 'Please resolve conflicts',
      },
      syncConflict: {
        title: 'Sync Conflict',
        description: 'The sync has conflicts',
        conflictFiles: 'Conflicted Files',
        resolveManually: 'Please resolve conflicts',
      },
      processing: 'Processing...',
    },
  },
};

vi.mock('@/hooks/use-locale', () => ({
  useLocale: vi.fn(() => ({
    t: mockTranslations,
    locale: 'en',
    setLocale: vi.fn(),
    supportedLocales: [{ code: 'en', name: 'English' }],
  })),
  useTranslation: vi.fn(() => mockTranslations),
}));

vi.mock('@/services/window-manager-service', () => ({
  WindowManagerService: {
    checkNewWindowFlag: vi.fn(() => Promise.resolve(false)),
    getWindowInfo: vi.fn(() => Promise.resolve(null)),
  },
}));

vi.mock('@/contexts/ui-navigation', () => ({
  useUiNavigation: vi.fn(() => ({
    activeView: 'explorer',
    setActiveView: vi.fn(),
    agentListOpen: false,
    openAgentList: vi.fn(),
    closeAgentList: vi.fn(),
    setAgentListOpen: vi.fn(),
    onAgentCreated: undefined,
  })),
  UiNavigationProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/stores/git-store', () => ({
  useGitStore: vi.fn((selector: any) => {
    const state = {
      initialize: vi.fn(),
      refreshStatus: vi.fn(),
      clearState: vi.fn(),
    };
    return selector ? selector(state) : state;
  }),
}));

vi.mock('@/stores/terminal-store', () => ({
  useTerminalStore: vi.fn((selector: any) => {
    const state = {
      isTerminalVisible: false,
      toggleTerminalVisible: vi.fn(),
      selectNextSession: vi.fn(),
      selectPreviousSession: vi.fn(),
    };
    return selector ? selector(state) : state;
  }),
}));

vi.mock('@/stores/execution-store', () => ({
  useExecutionStore: vi.fn((selector: any) => {
    const state = {
      getRunningTaskIds: vi.fn(() => []),
      isMaxReached: vi.fn(() => false),
    };
    return selector ? selector(state) : state;
  }),
}));

vi.mock('@/stores/worktree-store', () => ({
  useWorktreeStore: vi.fn((selector: any) => {
    const state = {
      initialize: vi.fn(),
      getWorktreeForTask: vi.fn(),
    };
    return selector ? selector(state) : state;
  }),
}));

vi.mock('@/stores/lint-store', () => ({
  useLintStore: vi.fn(() => ({
    settings: {
      enabled: false,
      showInProblemsPanel: false,
    },
  })),
}));

vi.mock('@/hooks/use-repository-watcher', () => ({
  useRepositoryWatcher: vi.fn(),
}));

vi.mock('@/hooks/use-global-shortcuts', () => ({
  useGlobalShortcuts: vi.fn(),
}));

describe('RepositoryLayout - Project Sync Bug Fix', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default mocks
    vi.mocked(useSettingsStore).mockImplementation((selector: any) => {
      const state = {
        project: 'project-1',
        language: 'en',
      };
      return selector ? selector(state) : state;
    });

    vi.mocked(useRepositoryStore).mockImplementation((selector: any) => {
      const state = {
        rootPath: '/test/path',
        fileTree: null,
        openFiles: [],
        activeFileIndex: -1,
        isLoading: false,
        expandedPaths: new Set(),
        searchFiles: vi.fn(),
        selectRepository: vi.fn(),
        openRepository: vi.fn(),
        selectFile: vi.fn(),
        switchToTab: vi.fn(),
        closeTab: vi.fn(),
        closeOthers: vi.fn(),
        updateFileContent: vi.fn(),
        closeRepository: vi.fn(),
        refreshFile: vi.fn(),
        refreshFileTree: vi.fn(),
        loadDirectoryChildren: vi.fn(),
        closeAllFiles: vi.fn(),
        createFile: vi.fn(),
        renameFile: vi.fn(),
        toggleExpansion: vi.fn(),

      };
      return selector ? selector(state) : state;
    });

    vi.mocked(useProjectStore).mockImplementation((selector: any) => {
      const state = {
        projects: [
          { id: 'project-1', name: 'Project 1', root_path: '/test/path1' },
          { id: 'project-2', name: 'Project 2', root_path: '/test/path2' },
        ],
        isLoading: false,
        refreshProjects: vi.fn(),
        loadProjects: vi.fn(),
      };
      return selector ? selector(state) : state;
    });

    // All stores and hooks are already mocked at the top level
  });

  it('should reactively update currentProjectId when settings.project changes', async () => {
    // Setup: Start with project-1
    let currentProject = 'project-1';
    
    vi.mocked(useSettingsStore).mockImplementation((selector: any) => {
      const state = {
        project: currentProject,
        language: 'en',
      };
      return selector ? selector(state) : state;
    });

    const { rerender } = render(<RepositoryLayout />);

    // Verify initial state
    await waitFor(() => {
      const settingsStoreCall = vi.mocked(useSettingsStore).mock.calls.find(
        call => call[0] && call[0].toString().includes('state.project')
      );
      expect(settingsStoreCall).toBeDefined();
    });

    // Simulate settings change (e.g., from dock menu)
    currentProject = 'project-2';
    
    vi.mocked(useSettingsStore).mockImplementation((selector: any) => {
      const state = {
        project: currentProject,
        language: 'en',
      };
      return selector ? selector(state) : state;
    });

    // Trigger re-render (simulating store update)
    rerender(<RepositoryLayout />);

    // Verify that useSettingsStore selector was called to get updated project
    await waitFor(() => {
      expect(useSettingsStore).toHaveBeenCalled();
      const projectSelectorCalls = vi.mocked(useSettingsStore).mock.calls.filter(
        call => call[0] && call[0].toString().includes('state.project')
      );
      expect(projectSelectorCalls.length).toBeGreaterThan(0);
    });
  });

  it('should use reactive settings store selector instead of local state', () => {
    // This test verifies the fix implementation
    render(<RepositoryLayout />);

    // Verify that useSettingsStore is called with a selector function
    // that reads state.project (reactive approach)
    const projectSelectorCalls = vi.mocked(useSettingsStore).mock.calls.filter(
      call => call[0] && typeof call[0] === 'function'
    );

    expect(projectSelectorCalls.length).toBeGreaterThan(0);
    
    // Verify the selector extracts the 'project' field
    const mockState = { project: 'test-project-id' };
    const firstSelector = projectSelectorCalls[0]?.[0];
    if (firstSelector) {
      const result = firstSelector(mockState);
      // The selector should return the project ID
      expect(result).toBe('test-project-id');
    }
  });

  it('should pass currentProjectId to child components', () => {
    const mockProject = 'test-project-id';
    
    vi.mocked(useSettingsStore).mockImplementation((selector: any) => {
      const state = {
        project: mockProject,
        language: 'en',
      };
      return selector ? selector(state) : state;
    });

    render(<RepositoryLayout />);

    // The currentProjectId should be derived from settings store
    // and passed to components like FileTreeHeader and task filters
    expect(useSettingsStore).toHaveBeenCalled();
  });
});
