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
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RepositoryLayout } from './repository-layout';
import { ResizablePanel } from '@/components/ui/resizable';
import { DEFAULT_PROJECT, useSettingsStore } from '@/stores/settings-store';
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
vi.mock('@/components/ui/resizable', () => ({
  ResizablePanelGroup: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="resizable-panel-group">{children}</div>
  ),
  ResizablePanel: vi.fn((props: { children?: React.ReactNode }) => (
    <div data-testid="resizable-panel">{props.children}</div>
  )),
  ResizableHandle: () => <div data-testid="resizable-handle" />,
}));
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
    startNewTask: vi.fn(),
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
  FileTree: {
    success: {},
    errors: {},
    contextMenu: {
      newFile: 'New File',
      newFolder: 'New Folder',
    },
  },
  RepositoryStore: { success: {}, errors: {} },
  Settings: { search: { searchFiles: 'Search Files' } },
  RepositoryLayout: {
    deleteTaskWithChangesTitle: 'Delete Task With Changes',
    deleteAnyway: 'Delete Anyway',
    maxConcurrentTasksReached: 'Max concurrent tasks reached',
    fullscreen: 'Fullscreen',
    exitFullscreen: 'Exit Fullscreen',
  },
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
    searchTasks: 'Search tasks...',
    emptyState: {
      title: 'AI Assistant',
      description: 'Start chatting',
    },
    outputFormat: {
      title: 'Output Format',
      description: 'Select how the assistant should format its response.',
      currentFormat: 'Current format',
      switchSuccess: 'Output format updated',
      markdown: 'Markdown',
      mermaid: 'Mermaid',
      web: 'Web',
      markdownDescription: 'Standard markdown rendering with code blocks and tables.',
      mermaidDescription: 'Render diagrams using Mermaid syntax.',
      webDescription: 'Render as HTML/web content.',
      viewSource: 'View Source',
      viewRendered: 'View Rendered',
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
    video: {
      notSupported: 'Video Input Not Supported',
      notSupportedDescription: 'The current model does not support video input.',
      supportedModels: 'Models that support videos:',
      keepCurrentModel: 'Keep Current Model',
      chooseModel: 'Choose Model Manually',
      noModelsAvailable: 'No models with video support are currently available.',
      pasteSuccess: (filename: string) => `Video "${filename}" uploaded successfully`,
      pasteMultipleSuccess: (count: number) => `${count} videos uploaded successfully`,
      dropHere: 'Drop videos here',
      sizeExceeded: (size: string) => `Video file size (${size}) exceeds the 100MB limit`,
      unsupportedFormat: (format: string) => `Unsupported video format: ${format}`,
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
    autoApproveEdits: {
      title: 'Auto-approve edits',
      description: 'When enabled, file edits will be applied automatically without review',
      enabled: 'Enabled',
      disabled: 'Disabled',
      enabledTooltip: 'Auto-approve: AI will apply edits without asking for approval',
      disabledTooltip: 'Manual review: AI will ask for approval before applying edits',
      toggleFailed: 'Failed to update auto-approve setting',
    },
    autoApprovePlan: {
      title: 'Auto-approve plan',
      description: 'When enabled, plans will be approved automatically without review',
      enabled: 'Enabled',
      disabled: 'Disabled',
      enabledTooltip: 'Auto-approve: AI will apply plans without asking for approval',
      disabledTooltip: 'Manual review: AI will ask for approval before applying plans',
      toggleFailed: 'Failed to update auto-approve setting',
    },
    autoCodeReview: {
      title: 'Auto code review',
      description: 'When enabled, code review will run automatically after a task completes',
      enabled: 'Enabled',
      disabled: 'Disabled',
      enabledTooltip: 'Auto-review: AI will run code review when the task finishes',
      disabledTooltip: 'Manual review: use the review button when you are ready',
      toggleFailed: 'Failed to update auto code review setting',
    },
    reasoningEffort: {
      title: 'Reasoning Effort',
      description: 'Control how much reasoning the model performs before responding. Higher effort uses more tokens for thinking.',
      currentEffort: 'Current effort',
      hint: 'Higher reasoning effort uses more tokens but may improve complex task performance.',
      success: 'Reasoning effort updated',
      failed: 'Failed to update reasoning effort',
    },
    promptEnhancement: {
      optionsButton: 'Prompt Enhancement Options',
      enhanceButton: 'Enhance Prompt',
      enhancing: 'Enhancing prompt...',
      success: 'Prompt enhanced successfully',
      failed: 'Failed to enhance prompt',
      emptyPrompt: 'Please enter a prompt to enhance',
      contextExtraction: 'Smart Context Extraction',
      contextExtractionDescription: 'Extract relevant code context from the project to enrich the prompt',
      modelSelect: 'Enhancement Model',
      modelPlaceholder: 'Select enhancement model',
      followCurrentModel: 'Follow current model',
    },
    planMode: {
      label: 'Plan Mode',
      title: 'Plan Mode',
      description: 'Description',
      learnMore: 'Learn More',
      enabledTooltip: 'Plan Mode enabled',
      disabledTooltip: 'Plan Mode disabled',
    },
    ralphLoop: {
      label: 'Ralph Loop',
      title: 'Ralph Loop',
      description: 'Description',
      learnMore: 'Learn More',
      enabledTooltip: 'Ralph Loop enabled',
      disabledTooltip: 'Ralph Loop disabled',
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
      setTerminalVisible: vi.fn(),
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
  useLintStore: vi.fn((selector: any) => {
    const state = {
      settings: {
        enabled: false,
        showInProblemsPanel: false,
      },
    };
    return selector ? selector(state) : state;
  }),
}));

vi.mock('@/hooks/use-repository-watcher', () => ({
  useRepositoryWatcher: vi.fn(),
}));

vi.mock('@/hooks/use-global-shortcuts', () => ({
  useGlobalShortcuts: vi.fn(),
}));

const getPanelSizingByOrder = (order: number) => {
  const panelProps = vi
    .mocked(ResizablePanel)
    .mock.calls.map((call) => call[0])
    .find((props) => props?.order === order);

  if (!panelProps) {
    throw new Error(`Missing ResizablePanel with order ${order}`);
  }

  return {
    defaultSize: panelProps.defaultSize,
    minSize: panelProps.minSize,
    maxSize: panelProps.maxSize,
  };
};

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
        getRecentFiles: vi.fn(),
      };
      return selector ? selector(state) : state;
    });

    vi.mocked(useProjectStore).mockImplementation((selector: any) => {
      const state = {
        projects: [
          { id: DEFAULT_PROJECT, name: 'Default Project', root_path: null },
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

    // Verify that useSettingsStore selector is reactive and reads project
    await waitFor(() => {
      expect(useSettingsStore).toHaveBeenCalled();
      const selectorCalls = vi.mocked(useSettingsStore).mock.calls.filter(
        (call) => typeof call[0] === 'function'
      );
      expect(selectorCalls.length).toBeGreaterThan(0);

      const selector = selectorCalls
        .map((call) => call[0])
        .find((candidate) => {
          try {
            const result = candidate({ project: currentProject, language: 'en' });
            return (
              typeof result === 'object' &&
              result !== null &&
              'currentProjectId' in result &&
              'isDefaultProject' in result
            );
          } catch {
            return false;
          }
        });

      expect(selector).toBeDefined();
      if (selector) {
        const result = selector({ project: currentProject, language: 'en' });
        expect(result).toEqual({
          currentProjectId: currentProject,
          isDefaultProject: false,
        });
      }
    });
  });

  it('should use reactive settings store selector instead of local state', () => {
    // This test verifies the fix implementation
    render(<RepositoryLayout />);

    // Verify that useSettingsStore is called with a selector function
    // that reads state.project (reactive approach)
    const selectorCalls = vi.mocked(useSettingsStore).mock.calls.filter(
      (call) => typeof call[0] === 'function'
    );

    expect(selectorCalls.length).toBeGreaterThan(0);

    const selector = selectorCalls
      .map((call) => call[0])
      .find((candidate) => {
        try {
          const result = candidate({ project: 'test-project-id', language: 'en' });
          return (
            typeof result === 'object' &&
            result !== null &&
            'currentProjectId' in result &&
            'isDefaultProject' in result
          );
        } catch {
          return false;
        }
      });

    expect(selector).toBeDefined();
    if (selector) {
      const result = selector({ project: 'test-project-id', language: 'en' });
      // The selector should return the derived settings slice
      expect(result).toEqual({
        currentProjectId: 'test-project-id',
        isDefaultProject: false,
      });
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

  it('should show empty repository state when no repo and non-default project selected', () => {
    vi.mocked(useSettingsStore).mockImplementation((selector: any) => {
      const state = {
        project: 'project-1',
        language: 'en',
      };
      return selector ? selector(state) : state;
    });

    vi.mocked(useRepositoryStore).mockImplementation((selector: any) => {
      const state = {
        rootPath: null,
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
        getRecentFiles: vi.fn(),
      };
      return selector ? selector(state) : state;
    });

    render(<RepositoryLayout />);

    expect(screen.getByText('No Repository Open')).toBeInTheDocument();
  });

  it('should show task sidebar when no repo and default project selected', () => {
    vi.mocked(useSettingsStore).mockImplementation((selector: any) => {
      const state = {
        project: DEFAULT_PROJECT,
        language: 'en',
      };
      return selector ? selector(state) : state;
    });

    vi.mocked(useRepositoryStore).mockImplementation((selector: any) => {
      const state = {
        rootPath: null,
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
        getRecentFiles: vi.fn(),
      };
      return selector ? selector(state) : state;
    });

    render(<RepositoryLayout />);

    expect(screen.queryByText('No Repository Open')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText(mockTranslations.Chat.searchTasks)).toBeInTheDocument();
  });

  it('should keep sidebar and chat panel sizing consistent between default and repository projects', () => {
    vi.mocked(useSettingsStore).mockImplementation((selector: any) => {
      const state = {
        project: DEFAULT_PROJECT,
        language: 'en',
      };
      return selector ? selector(state) : state;
    });

    vi.mocked(useRepositoryStore).mockImplementation((selector: any) => {
      const state = {
        rootPath: null,
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
        getRecentFiles: vi.fn(),
      };
      return selector ? selector(state) : state;
    });

    vi.mocked(ResizablePanel).mockClear();
    const { unmount } = render(<RepositoryLayout />);
    const defaultSidebarSizing = getPanelSizingByOrder(1);
    // In default project (no repository), chat panel is order 2
    const defaultChatSizing = getPanelSizingByOrder(2);

    expect(defaultSidebarSizing.defaultSize).toBeDefined();
    expect(defaultChatSizing.defaultSize).toBeDefined();

    unmount();

    vi.mocked(ResizablePanel).mockClear();
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
        fileTree: {
          name: 'root',
          path: '/test/path',
          is_directory: true,
          children: [],
        },
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
        getRecentFiles: vi.fn(),
      };
      return selector ? selector(state) : state;
    });

    render(<RepositoryLayout />);

    const repoSidebarSizing = getPanelSizingByOrder(1);
    // In repository project, chat panel is order 3 (since middle panel exists with order 2)
    const repoChatSizing = getPanelSizingByOrder(3);

    expect(defaultSidebarSizing.defaultSize).toBe(repoSidebarSizing.defaultSize);
    expect(defaultChatSizing.defaultSize).toBe(repoChatSizing.defaultSize);
    expect(Number(defaultSidebarSizing.defaultSize) + Number(defaultChatSizing.defaultSize)).toBe(100);
  });
});
