import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useGitStore } from '@/stores/git-store';
import { useProjectStore } from '@/stores/project-store';
import { DEFAULT_PROJECT, useSettingsStore } from '@/stores/settings-store';
import { useTaskStore } from '@/stores/task-store';
import { useTerminalStore } from '@/stores/terminal-store';
import { useRepositoryStore } from '@/stores/window-scoped-repository-store';
import { useWorktreeStore } from '@/stores/worktree-store';

export function useRepositoryLayout() {
  // Repository store state
  const repositoryState = useRepositoryStore(
    useShallow((state) => ({
      rootPath: state.rootPath,
      fileTree: state.fileTree,
      openFiles: state.openFiles,
      activeFileIndex: state.activeFileIndex,
      isLoading: state.isLoading,
      expandedPaths: state.expandedPaths,
      loadingPhase: state.loadingPhase,
      indexingProgress: state.indexingProgress,
      selectFile: state.selectFile,
      switchToTab: state.switchToTab,
      closeTab: state.closeTab,
      closeOthers: state.closeOthers,
      closeAllFiles: state.closeAllFiles,
      updateFileContent: state.updateFileContent,
      saveFile: state.saveFile,
      openRepository: state.openRepository,
      selectRepository: state.selectRepository,
      closeRepository: state.closeRepository,
      refreshFile: state.refreshFile,
      refreshFileTree: state.refreshFileTree,
      createFile: state.createFile,
      renameFile: state.renameFile,
      loadDirectoryChildren: state.loadDirectoryChildren,
      toggleExpansion: state.toggleExpansion,
      searchFiles: state.searchFiles,
      getRecentFiles: state.getRecentFiles,
    }))
  );

  const gitState = useGitStore(
    useShallow((state) => ({
      gitStatus: state.gitStatus,
      fileStatuses: state.fileStatuses,
      initializeGit: state.initialize,
      refreshGitStatus: state.refreshStatus,
      clearGitState: state.clearState,
    }))
  );

  const settingsState = useSettingsStore(
    useShallow((state) => ({
      currentProjectId: state.project,
      isDefaultProject: state.project === DEFAULT_PROJECT,
    }))
  );

  const terminalState = useTerminalStore(
    useShallow((state) => ({
      isTerminalVisible: state.isTerminalVisible,
      setTerminalVisible: state.setTerminalVisible,
      selectNextSession: state.selectNextSession,
      selectPreviousSession: state.selectPreviousSession,
    }))
  );

  const taskState = useTaskStore(
    useShallow((state) => ({
      currentTaskId: state.currentTaskId,
    }))
  );

  const worktreeState = useWorktreeStore(
    useShallow((state) => ({
      pendingDeletion: state.pendingDeletion,
      setPendingDeletion: state.setPendingDeletion,
      initializeWorktree: state.initialize,
    }))
  );

  const projectState = useProjectStore(
    useShallow((state) => ({
      projects: state.projects,
      refreshProjects: state.refreshProjects,
    }))
  );

  // Derived state
  const currentFile = useMemo(() => {
    return repositoryState.activeFileIndex >= 0 &&
      repositoryState.activeFileIndex < repositoryState.openFiles.length
      ? repositoryState.openFiles[repositoryState.activeFileIndex]
      : null;
  }, [repositoryState.activeFileIndex, repositoryState.openFiles]);

  const hasRepository = useMemo(
    () => !!(repositoryState.rootPath && repositoryState.fileTree),
    [repositoryState.rootPath, repositoryState.fileTree]
  );
  const hasOpenFiles = useMemo(
    () => repositoryState.openFiles.length > 0,
    [repositoryState.openFiles.length]
  );

  // Return aggregated state and actions
  return {
    // Repository state
    ...repositoryState,
    // Git state
    ...gitState,
    // Settings state
    ...settingsState,
    // Terminal state
    ...terminalState,
    // Task state
    ...taskState,
    // Worktree state
    ...worktreeState,
    // Project state
    ...projectState,

    // Derived state
    currentFile,
    hasRepository,
    hasOpenFiles,
  };
}
