import { memo, useEffect, useId, useRef } from 'react';
import { toast } from 'sonner';
import { ResizablePanelGroup } from '@/components/ui/resizable';
import { useGlobalFileSearch } from '@/hooks/use-global-file-search';
import { useTranslation } from '@/hooks/use-locale';
import { useRepositoryLayout } from '@/hooks/use-repository-layout';
import { useRepositoryWatcher } from '@/hooks/use-repository-watcher';
import { logger } from '@/lib/logger';
import { databaseService } from '@/services/database-service';
import type { LintDiagnostic } from '@/services/lint-service';
import { getRelativePath } from '@/services/repository-utils';
import { taskService } from '@/services/task-service';
import { WindowManagerService } from '@/services/window-manager-service';
import { settingsManager } from '@/stores/settings-store';
import { SidebarView } from '@/types/navigation';
import type { ChatBoxRef } from './chat-box';
import { GitStatusBar } from './git/git-status-bar';
import {
  useRepositoryLayoutDerived,
  useRepositoryLayoutUI,
  useRepositoryShortcuts,
  useRepositoryTasks,
  useRepositoryWorktree,
} from './repository-layout/hooks';
import { RepositoryChatPanel } from './repository-layout/repository-chat-panel';
import { RepositoryDialogs } from './repository-layout/repository-dialogs';
import { RepositoryEditorArea } from './repository-layout/repository-editor-area';
import { RepositoryGlobalSearch } from './repository-layout/repository-global-search';
import { RepositorySidebar } from './repository-layout/repository-sidebar';

export const RepositoryLayout = memo(function RepositoryLayout() {
  const t = useTranslation();
  const emptyRepoPanelId = useId();
  const fileTreePanelId = useId();
  const fileEditorPanelId = useId();
  const mainChatPanelId = useId();
  const terminalPanelId = useId();
  const editorAreaPanelId = useId();

  const contentSearchInputRef = useRef<HTMLInputElement>(null);
  const taskSearchInputRef = useRef<HTMLInputElement>(null);
  const chatBoxRef = useRef<ChatBoxRef | null>(null);

  const state = useRepositoryLayout();

  const uiState = useRepositoryLayoutUI();

  const derivedState = useRepositoryLayoutDerived({
    hasRepository: state.hasRepository,
    isDefaultProject: state.isDefaultProject,
    openFiles: state.openFiles,
    fullscreenPanel: uiState.fullscreenPanel,
    isTerminalVisible: state.isTerminalVisible,
    lintSettings: state.lintSettings,
  });

  const worktree = useRepositoryWorktree();

  const tasks = useRepositoryTasks(state.currentTaskId);

  const {
    isOpen: isFileSearchOpen,
    openSearch: openFileSearch,
    closeSearch: closeFileSearch,
    handleFileSelect: handleSearchFileSelect,
  } = useGlobalFileSearch(state.selectFile);

  useRepositoryWatcher();

  useRepositoryShortcuts(
    openFileSearch,
    state.toggleTerminalVisible,
    state.selectNextSession,
    state.selectPreviousSession,
    state.rootPath,
    uiState.setIsContentSearchVisible,
    state.isTerminalVisible
  );

  const {
    rootPath,
    fileTree,
    openFiles,
    activeFileIndex,
    isLoading,
    expandedPaths,
    searchFiles,
    selectRepository,
    openRepository,
    selectFile,
    switchToTab,
    closeTab,
    closeOthers,
    updateFileContent,
    closeRepository,
    refreshFile,
    refreshFileTree,
    loadDirectoryChildren,
    closeAllFiles,
    createFile,
    renameFile,
    toggleExpansion,
    getRecentFiles,
    initializeGit,
    refreshGitStatus,
    clearGitState,
    currentProjectId,
    isDefaultProject,
    isTerminalVisible,
    toggleTerminalVisible,
    pendingDeletion,
    setPendingDeletion,
    refreshProjects,
    currentFile,
    hasRepository,
    hasOpenFiles,
    initializeWorktree,
  } = state;

  const {
    sidebarView,
    setSidebarView,
    setIsHistoryOpen,
    isContentSearchVisible,
    setIsContentSearchVisible,
    toggleFullscreen,
    failedPaths,
  } = uiState;

  const {
    shouldShowSidebar,
    showFileTree,
    showMiddlePanel,
    showChatPanel,
    showEditor,
    showTerminal,
    showProblemsPanel,
    isEditorFullscreen,
    isTerminalFullscreen,
    isChatFullscreen,
  } = derivedState;

  const {
    conflictData,
    isWorktreeProcessing,
    mergeResult,
    syncResult,
    checkForConflicts,
    discardChanges,
    mergeToMain,
    syncFromMain,
    cancelOperation,
    resetWorktreeState,
  } = worktree;

  const { currentTask, currentMessages, handleTaskStart } = tasks;

  const handleAddFileToChat = async (filePath: string, fileContent: string) => {
    if (chatBoxRef.current?.addFileToChat) {
      await chatBoxRef.current.addFileToChat(filePath, fileContent);
    }
  };

  const handleNewTask = async () => {
    const hasConflict = await checkForConflicts();
    if (hasConflict) {
      return;
    }
    taskService.startNewTask();
  };

  const handleDiscardAndContinue = async () => {
    await discardChanges();
    resetWorktreeState();
    taskService.startNewTask();
    setIsHistoryOpen(false);
  };

  const handleMergeAndContinue = async () => {
    const result = await mergeToMain();
    if (result.success) {
      resetWorktreeState();
      taskService.startNewTask();
      setIsHistoryOpen(false);
    }
  };

  const handleSyncFromMain = async () => {
    const result = await syncFromMain();
    if (result.success) {
      resetWorktreeState();
    }
  };

  const handleDiffApplied = () => {
    refreshFileTree();
    if (currentFile) {
      refreshFile(currentFile.path);
    }
    refreshGitStatus();
  };

  const handleProjectSelect = async (projectId: string) => {
    try {
      const project = await databaseService.getProject(projectId);
      if (project) {
        await settingsManager.setCurrentProjectId(projectId);

        if (project.root_path) {
          await openRepository(project.root_path, projectId);

          initializeWorktree().catch((error) => {
            logger.warn('[RepositoryLayout] Failed to initialize worktree store:', error);
          });
        } else {
          closeRepository();
        }
      }
    } catch (error) {
      logger.error('Failed to switch project:', error);
      throw error;
    }
  };

  const handleFileDelete = async (filePath: string) => {
    refreshFileTree();
    const fileIndex = openFiles.findIndex((file) => file.path === filePath);
    if (fileIndex !== -1) {
      closeTab(fileIndex);
    }
    refreshGitStatus();
  };

  const handleFileCreate = async (parentPath: string, fileName: string, isDirectory: boolean) => {
    try {
      await createFile(parentPath, fileName, isDirectory);
      refreshGitStatus();
    } catch (error) {
      logger.error('Failed to create file/directory:', error);
    }
  };

  const handleFileRename = async (oldPath: string, newName: string) => {
    try {
      await renameFile(oldPath, newName);
      refreshGitStatus();
    } catch (error) {
      logger.error('Failed to rename file/directory:', error);
    }
  };

  const handleCopyPath = (filePath: string) => {
    navigator.clipboard.writeText(filePath);
    toast.success(t.FileTree.success.pathCopied);
  };

  const handleCopyRelativePath = (filePath: string, rootPath: string) => {
    const relativePath = getRelativePath(filePath, rootPath);
    navigator.clipboard.writeText(relativePath);
    toast.success(t.FileTree.success.relativePathCopied);
  };

  const selectedFilePath = currentFile?.path || null;

  const handleDiagnosticClick = (diagnostic: LintDiagnostic & { filePath: string }) => {
    selectFile(diagnostic.filePath, diagnostic.range.start.line);
  };

  useEffect(() => {
    if (isContentSearchVisible) {
      setTimeout(() => contentSearchInputRef.current?.focus(), 100);
    }
  }, [isContentSearchVisible]);

  useEffect(() => {
    if (!hasRepository && isDefaultProject && sidebarView === SidebarView.FILES) {
      setSidebarView(SidebarView.TASKS);
    }
  }, [hasRepository, isDefaultProject, sidebarView, setSidebarView]);

  useEffect(() => {
    let isMounted = true;

    const loadSavedRepository = async () => {
      if (!isMounted || rootPath) return;

      const isNewWindow = await WindowManagerService.checkNewWindowFlag();
      if (isNewWindow) {
        logger.info('[repository-layout] New window detected - skipping auto-load');
        await WindowManagerService.clearNewWindowFlag();
        return;
      }

      const windowInfo = await WindowManagerService.getWindowInfo();
      if (windowInfo?.rootPath) {
        logger.info('[repository-layout] Window has associated project, skip global load');
        return;
      }

      const savedPath = settingsManager.getCurrentRootPath();
      const projectId = await settingsManager.getProject();

      if (!savedPath || failedPaths.has(savedPath)) {
        return;
      }

      try {
        await openRepository(savedPath, projectId);
        logger.info('[repository-layout] Restored saved repository:', savedPath);
      } catch (error) {
        logger.error('[repository-layout] Failed to restore saved repository:', error);
        failedPaths.add(savedPath);
        settingsManager.setCurrentRootPath('');
      }
    };

    loadSavedRepository();

    return () => {
      isMounted = false;
    };
  }, [openRepository, rootPath, failedPaths]);

  useEffect(() => {
    if (rootPath) {
      initializeGit(rootPath);
    } else {
      clearGitState();
    }
  }, [rootPath, initializeGit, clearGitState]);

  return (
    <>
      <RepositoryGlobalSearch
        getRecentFiles={getRecentFiles}
        isFileSearchOpen={isFileSearchOpen}
        onCloseFileSearch={closeFileSearch}
        onFileSelect={handleSearchFileSelect}
        onSearchFiles={searchFiles}
        repositoryPath={rootPath}
        isContentSearchVisible={isContentSearchVisible}
        onToggleContentSearch={() => setIsContentSearchVisible((prev) => !prev)}
        contentSearchInputRef={contentSearchInputRef}
        showContentSearch={hasRepository}
      />

      <div className="flex h-screen flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-hidden">
          <ResizablePanelGroup className="h-full" direction="horizontal">
            {showFileTree && (
              <RepositorySidebar
                emptyRepoPanelId={emptyRepoPanelId}
                fileTreePanelId={fileTreePanelId}
                shouldShowSidebar={shouldShowSidebar}
                hasRepository={hasRepository}
                sidebarView={sidebarView}
                onSidebarViewChange={(view) => {
                  setSidebarView(view);
                  settingsManager.setSidebarView(view);
                }}
                currentProjectId={currentProjectId}
                onProjectSelect={handleProjectSelect}
                onImportRepository={async () => {
                  const newProject = await selectRepository();
                  if (newProject) {
                    await refreshProjects();
                  }
                }}
                onSelectRepository={async () => {
                  const newProject = await selectRepository();
                  if (newProject) {
                    await refreshProjects();
                  }
                }}
                onOpenRepository={async (path, projectId) => {
                  await openRepository(path, projectId);
                  await refreshProjects();
                }}
                isLoadingProject={isLoading}
                isTerminalVisible={hasRepository ? isTerminalVisible : undefined}
                onToggleTerminal={hasRepository ? toggleTerminalVisible : undefined}
                onOpenFileSearch={hasRepository ? openFileSearch : undefined}
                onOpenContentSearch={
                  hasRepository ? () => setIsContentSearchVisible(true) : undefined
                }
                rootPath={rootPath}
                fileTree={fileTree}
                expandedPaths={expandedPaths}
                selectedFilePath={selectedFilePath}
                onFileCreate={handleFileCreate}
                onFileDelete={handleFileDelete}
                onFileRename={handleFileRename}
                onFileSelect={selectFile}
                onRefreshFileTree={refreshFileTree}
                onLoadChildren={loadDirectoryChildren}
                onToggleExpansion={toggleExpansion}
                taskSearchInputRef={taskSearchInputRef}
              />
            )}

            {hasRepository && showMiddlePanel && (hasOpenFiles || isTerminalVisible) && (
              <RepositoryEditorArea
                editorAreaPanelId={editorAreaPanelId}
                fileEditorPanelId={fileEditorPanelId}
                terminalPanelId={terminalPanelId}
                showChatPanel={showChatPanel}
                showEditor={showEditor}
                showTerminal={showTerminal}
                showProblemsPanel={showProblemsPanel}
                hasOpenFiles={hasOpenFiles}
                isEditorFullscreen={isEditorFullscreen}
                isTerminalFullscreen={isTerminalFullscreen}
                openFiles={openFiles}
                activeFileIndex={activeFileIndex}
                currentFile={currentFile}
                rootPath={rootPath}
                onTabClose={closeTab}
                onCloseOthers={closeOthers}
                onCloseAll={closeAllFiles}
                onCopyPath={handleCopyPath}
                onCopyRelativePath={handleCopyRelativePath}
                onAddFileToChat={handleAddFileToChat}
                onTabSelect={switchToTab}
                onContentChange={(content) => {
                  if (currentFile) {
                    updateFileContent(currentFile.path, content, true);
                  }
                }}
                onToggleContentSearch={() => setIsContentSearchVisible((prev) => !prev)}
                onToggleEditorFullscreen={() => toggleFullscreen('editor')}
                onDiagnosticClick={handleDiagnosticClick}
                onCopyTerminalToChat={(content) => {
                  if (chatBoxRef.current?.appendToInput) {
                    chatBoxRef.current.appendToInput(`\n\n${content}`);
                  }
                }}
                onCloseTerminal={toggleTerminalVisible}
                onToggleTerminalFullscreen={() => toggleFullscreen('terminal')}
              />
            )}

            {showChatPanel && (
              <RepositoryChatPanel
                mainChatPanelId={mainChatPanelId}
                hasRepository={hasRepository}
                hasOpenFiles={hasOpenFiles}
                isTerminalVisible={isTerminalVisible}
                shouldShowSidebar={shouldShowSidebar}
                isChatFullscreen={isChatFullscreen}
                currentTaskId={state.currentTaskId}
                currentTask={currentTask}
                messages={currentMessages}
                onNewChat={handleNewTask}
                onToggleFullscreen={() => toggleFullscreen('chat')}
                chatBoxRef={chatBoxRef}
                rootPath={rootPath}
                currentFile={currentFile}
                onTaskStart={handleTaskStart}
                onDiffApplied={handleDiffApplied}
                onFileSelect={selectFile}
                onAddFileToChat={handleAddFileToChat}
                checkForConflicts={checkForConflicts}
              />
            )}
          </ResizablePanelGroup>
        </div>

        <GitStatusBar />
      </div>

      <RepositoryDialogs
        conflictData={conflictData}
        isProcessing={isWorktreeProcessing}
        mergeResult={mergeResult}
        syncResult={syncResult}
        onDiscard={handleDiscardAndContinue}
        onMerge={handleMergeAndContinue}
        onSync={handleSyncFromMain}
        onCancel={cancelOperation}
        onClose={resetWorktreeState}
        deleteConfirmation={pendingDeletion}
        onCancelDelete={() => setPendingDeletion(null)}
        onConfirmDelete={async () => {
          const deletion = pendingDeletion;
          if (!deletion) return;
          await taskService.deleteTask(deletion.taskId);
          setPendingDeletion(null);
        }}
      />
    </>
  );
});
