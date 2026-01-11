import type { Project } from '@/types';
import type { FileNode, IndexingProgress, LoadingPhase, OpenFile } from '@/types/file-system';
import type { FileStatusMap, GitStatus } from '@/types/git';
import type { SidebarView } from '@/types/navigation';
import type {
  ConflictData,
  FullscreenPanel,
  MergeResult,
  PendingDeletion,
  SyncResult,
} from './types';

export interface RepositoryLayoutState {
  rootPath: string | null;
  fileTree: FileNode | null;
  openFiles: OpenFile[];
  activeFileIndex: number;
  isLoading: boolean;
  expandedPaths: Set<string>;
  loadingPhase: LoadingPhase;
  indexingProgress: IndexingProgress | null;

  sidebarView: SidebarView;
  isHistoryOpen: boolean;
  isContentSearchVisible: boolean;
  fullscreenPanel: FullscreenPanel;
  failedPaths: Set<string>;

  currentProjectId: string;
  isDefaultProject: boolean;
  isTerminalVisible: boolean;
  currentTaskId: string | null;
  pendingDeletion: PendingDeletion | null;
  conflictData: ConflictData | null;
  isWorktreeProcessing: boolean;
  mergeResult: MergeResult | null;
  syncResult: SyncResult | null;

  gitStatus: GitStatus | null;
  fileStatuses: FileStatusMap;

  projects: Project[];

  lintSettings: {
    enabled: boolean;
    showInProblemsPanel: boolean;
  };

  hasRepository: boolean;
  currentFile: OpenFile | null;
  shouldShowSidebar: boolean;
  hasOpenFiles: boolean;
  showFileTree: boolean;
  showMiddlePanel: boolean;
  showChatPanel: boolean;
  showEditor: boolean;
  showTerminal: boolean;
  showProblemsPanel: boolean;
  isEditorFullscreen: boolean;
  isTerminalFullscreen: boolean;
  isChatFullscreen: boolean;
}

export interface RepositoryLayoutActions {
  selectFile: (filePath: string, lineNumber?: number) => Promise<void>;
  switchToTab: (index: number) => Promise<void>;
  closeTab: (index: number) => void;
  closeOthers: (keepIndex: number) => void;
  closeAllFiles: () => void;
  updateFileContent: (filePath: string, content: string, hasUnsavedChanges?: boolean) => void;
  saveFile: (filePath: string, content: string) => Promise<void>;

  openRepository: (path: string, projectId: string) => Promise<void>;
  selectRepository: () => Promise<{ id: string; name: string } | null>;
  closeRepository: () => void;
  refreshFile: (filePath: string) => Promise<void>;
  refreshFileTree: () => Promise<void>;

  createFile: (parentPath: string, fileName: string, isDirectory: boolean) => Promise<void>;
  renameFile: (oldPath: string, newName: string) => Promise<void>;
  loadDirectoryChildren: (node: FileNode) => Promise<FileNode[]>;
  toggleExpansion: (path: string) => void;

  initializeGit: (repoPath: string) => Promise<void>;
  refreshGitStatus: () => Promise<void>;
  clearGitState: () => void;

  refreshProjects: () => Promise<void>;

  toggleTerminalVisible: () => void;
  selectNextSession: () => void;
  selectPreviousSession: () => void;

  startNewTask: () => void;
  selectTask: (taskId: string) => void;

  checkForConflicts: () => Promise<boolean>;
  discardChanges: () => Promise<void>;
  mergeToMain: () => Promise<MergeResult>;
  syncFromMain: () => Promise<SyncResult>;
  cancelOperation: () => void;
  resetWorktreeState: () => void;

  openFileSearch: () => void;
  closeFileSearch: () => void;
  handleSearchFileSelect: (filePath: string) => void;
  searchFiles: (query: string) => Promise<FileNode[]>;

  setSidebarView: (view: SidebarView) => void;
  setIsHistoryOpen: (open: boolean) => void;
  setIsContentSearchVisible: (visible: boolean) => void;
  toggleFullscreen: (panel: 'editor' | 'terminal' | 'chat') => void;
  setPendingDeletion: (deletion: PendingDeletion | null) => void;
}

export type RepositoryLayoutStore = RepositoryLayoutState & RepositoryLayoutActions;
