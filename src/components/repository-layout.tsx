import { Folder, ListTodo, Maximize2, Minimize2, Plus, Search } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useShallow } from 'zustand/react/shallow';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useGlobalFileSearch } from '@/hooks/use-global-file-search';
import { useGlobalShortcuts } from '@/hooks/use-global-shortcuts';
import { useTranslation } from '@/hooks/use-locale';
import { useRepositoryWatcher } from '@/hooks/use-repository-watcher';
import { useTasks } from '@/hooks/use-tasks';
import { useWorktreeConflict } from '@/hooks/use-worktree-conflict';
import { logger } from '@/lib/logger';
import { databaseService } from '@/services/database-service';
import type { LintDiagnostic } from '@/services/lint-service';
import { getRelativePath } from '@/services/repository-utils';
import { terminalService } from '@/services/terminal-service';
import { WindowManagerService } from '@/services/window-manager-service';
import { useExecutionStore } from '@/stores/execution-store';
import { useGitStore } from '@/stores/git-store';
import { useLintStore } from '@/stores/lint-store';
import { useProjectStore } from '@/stores/project-store';
import { settingsManager, useSettingsStore } from '@/stores/settings-store';
import { useTerminalStore } from '@/stores/terminal-store';
import { useRepositoryStore } from '@/stores/window-scoped-repository-store';
import { useWorktreeStore } from '@/stores/worktree-store';
import { SidebarView } from '@/types/navigation';
import { ChatBox, type ChatBoxRef } from './chat-box';
import { ChatPanelHeader } from './chat-panel-header';
import { DiagnosticsPanel } from './diagnostics/diagnostics-panel';
import { EmptyRepositoryState } from './empty-repository-state';
import { FileEditor } from './file-editor';
import { FileTabs } from './file-tabs';
import { FileTree } from './file-tree';
import { FileTreeHeader } from './file-tree-header';
import { GitStatusBar } from './git/git-status-bar';
import { GlobalContentSearch } from './search/global-content-search';
import { GlobalFileSearch } from './search/global-file-search';
import { TaskList } from './task-list';
import { TerminalPanel } from './terminal/terminal-panel';
import { WorktreeConflictDialog } from './worktree/worktree-conflict-dialog';

export function RepositoryLayout() {
  const t = useTranslation();
  const [sidebarView, setSidebarView] = useState<SidebarView>(SidebarView.FILES);
  const [taskSearchQuery, setTaskSearchQuery] = useState('');

  const emptyRepoPanelId = useId();
  const fileTreePanelId = useId();
  const fileEditorPanelId = useId();
  const mainChatPanelId = useId();
  const terminalPanelId = useId();
  const editorAreaPanelId = useId();

  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isContentSearchVisible, setIsContentSearchVisible] = useState(false);
  const contentSearchInputRef = useRef<HTMLInputElement>(null);

  // Get current project ID from settings store (reactive to changes)
  const currentProjectId = useSettingsStore((state) => state.project);

  // Circuit breaker: track paths that failed to open to prevent infinite retry loops
  const [failedPaths] = useState(() => new Set<string>());

  // Fullscreen panel state
  type FullscreenPanel = 'none' | 'editor' | 'terminal' | 'chat';
  const [fullscreenPanel, setFullscreenPanel] = useState<FullscreenPanel>('none');

  const toggleFullscreen = (panel: 'editor' | 'terminal' | 'chat') => {
    setFullscreenPanel((prev) => (prev === panel ? 'none' : panel));
  };

  // Terminal state
  const isTerminalVisible = useTerminalStore((state) => state.isTerminalVisible);
  const toggleTerminalVisible = useTerminalStore((state) => state.toggleTerminalVisible);
  const selectNextSession = useTerminalStore((state) => state.selectNextSession);
  const selectPreviousSession = useTerminalStore((state) => state.selectPreviousSession);

  // Use zustand store for repository state
  const rootPath = useRepositoryStore((state) => state.rootPath);
  const fileTree = useRepositoryStore((state) => state.fileTree);
  const openFiles = useRepositoryStore((state) => state.openFiles);
  const activeFileIndex = useRepositoryStore((state) => state.activeFileIndex);
  const isLoading = useRepositoryStore((state) => state.isLoading);
  const expandedPaths = useRepositoryStore((state) => state.expandedPaths);
  const searchFiles = useRepositoryStore((state) => state.searchFiles);
  const selectRepository = useRepositoryStore((state) => state.selectRepository);
  const openRepository = useRepositoryStore((state) => state.openRepository);
  const selectFile = useRepositoryStore((state) => state.selectFile);
  const switchToTab = useRepositoryStore((state) => state.switchToTab);
  const closeTab = useRepositoryStore((state) => state.closeTab);
  const closeOthers = useRepositoryStore((state) => state.closeOthers);
  const updateFileContent = useRepositoryStore((state) => state.updateFileContent);
  const closeRepository = useRepositoryStore((state) => state.closeRepository);
  const refreshFile = useRepositoryStore((state) => state.refreshFile);
  const refreshFileTree = useRepositoryStore((state) => state.refreshFileTree);
  const loadDirectoryChildren = useRepositoryStore((state) => state.loadDirectoryChildren);
  const closeAllFiles = useRepositoryStore((state) => state.closeAllFiles);
  const createFile = useRepositoryStore((state) => state.createFile);
  const renameFile = useRepositoryStore((state) => state.renameFile);
  const toggleExpansion = useRepositoryStore((state) => state.toggleExpansion);

  // Derive currentFile from openFiles and activeFileIndex
  const currentFile =
    activeFileIndex >= 0 && activeFileIndex < openFiles.length ? openFiles[activeFileIndex] : null;

  // Set up file system watcher
  useRepositoryWatcher();

  // Git store actions
  const initializeGit = useGitStore((state) => state.initialize);
  const refreshGitStatus = useGitStore((state) => state.refreshStatus);
  const clearGitState = useGitStore((state) => state.clearState);

  // Project store actions
  const refreshProjects = useProjectStore((state) => state.refreshProjects);

  // Worktree store actions
  const initializeWorktree = useWorktreeStore((state) => state.initialize);

  const chatBoxRef = useRef<ChatBoxRef>(null);

  // Determine if we have a loaded repository
  const hasRepository = !!(rootPath && fileTree);

  // Determine if we should show sidebar (show when has repository OR has project selected)
  const shouldShowSidebar = hasRepository || !!currentProjectId;

  const handleAddFileToChat = async (filePath: string, fileContent: string) => {
    // This will be handled by ChatBox's internal handleExternalAddFileToChat
    // which will delegate to ChatInput's addFileToChat method
    if (chatBoxRef.current?.addFileToChat) {
      await chatBoxRef.current.addFileToChat(filePath, fileContent);
    }
  };

  const {
    tasks,
    loading: tasksLoading,
    editingId,
    editingTitle,
    setEditingTitle,
    deleteTask,
    finishEditing,
    startEditing,
    cancelEditing,
    selectTask,
    currentTaskId,
    startNewChat,
    loadTasks,
  } = useTasks();

  // Task History state
  const runningTaskIds = useExecutionStore(useShallow((state) => state.getRunningTaskIds()));
  const isMaxReached = useExecutionStore((state) => state.isMaxReached());
  const getWorktreeForTask = useWorktreeStore((state) => state.getWorktreeForTask);

  // Worktree deletion confirmation state
  const [deleteConfirmation, setDeleteConfirmation] = useState<{
    taskId: string;
    changesCount: number;
    message: string;
  } | null>(null);

  // Filter tasks based on search query and current project
  const filteredTasks = tasks.filter((task) => {
    const matchesSearch = task.title.toLowerCase().includes(taskSearchQuery.toLowerCase());
    const matchesProject = currentProjectId ? task.project_id === currentProjectId : true;
    return matchesSearch && matchesProject;
  });

  // Worktree conflict handling
  const {
    conflictData,
    isProcessing: isWorktreeProcessing,
    mergeResult,
    syncResult,
    checkForConflicts,
    discardChanges,
    mergeToMain,
    syncFromMain,
    cancelOperation,
    resetState: resetWorktreeState,
  } = useWorktreeConflict();

  // Removed isSpecOpen state as it's replaced by mode system

  const {
    isOpen: isFileSearchOpen,
    openSearch: openFileSearch,
    closeSearch: closeFileSearch,
    handleFileSelect: handleSearchFileSelect,
  } = useGlobalFileSearch(selectFile);

  // Setup global shortcuts
  useGlobalShortcuts({
    globalFileSearch: () => {
      openFileSearch();
    },
    globalContentSearch: () => {
      setIsContentSearchVisible((prev) => !prev);
    },
    saveFile: () => {
      // TODO: Implement save functionality
      logger.debug('Save file shortcut triggered');
    },
    fileSearch: () => {
      // TODO: Implement file search in editor
      logger.debug('File search shortcut triggered');
    },
    toggleTerminal: () => {
      toggleTerminalVisible();
    },
    nextTerminalTab: () => {
      if (isTerminalVisible) {
        selectNextSession();
      }
    },
    previousTerminalTab: () => {
      if (isTerminalVisible) {
        selectPreviousSession();
      }
    },
    newTerminalTab: async () => {
      if (isTerminalVisible) {
        await terminalService.createTerminal(rootPath || undefined);
      }
    },
  });

  useEffect(() => {
    if (isContentSearchVisible) {
      setTimeout(() => contentSearchInputRef.current?.focus(), 100);
    }
  }, [isContentSearchVisible]);

  useEffect(() => {
    if (sidebarView === SidebarView.TASKS) {
      loadTasks(currentProjectId || undefined);
    }
  }, [sidebarView, currentProjectId, loadTasks]);

  // Force switch to Tasks view when no repository but has project
  useEffect(() => {
    if (!hasRepository && currentProjectId && sidebarView === SidebarView.FILES) {
      setSidebarView(SidebarView.TASKS);
    }
  }, [hasRepository, currentProjectId, sidebarView]);

  // Load saved repository on component mount
  useEffect(() => {
    let isMounted = true;

    const loadSavedRepository = async () => {
      // Only execute if app.tsx hasn't loaded a project yet
      if (!isMounted || rootPath) return;

      // Check if this is a new window
      const isNewWindow = await WindowManagerService.checkNewWindowFlag();
      if (isNewWindow) {
        logger.info('[repository-layout] New window detected - skipping auto-load');
        await WindowManagerService.clearNewWindowFlag();
        return;
      }

      // Check if window has associated project
      const windowInfo = await WindowManagerService.getWindowInfo();
      if (windowInfo?.rootPath) {
        logger.info('[repository-layout] Window has associated project, skip global load');
        return;
      }

      // Load global saved project
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

  // Initialize Git when repository changes
  useEffect(() => {
    if (rootPath) {
      initializeGit(rootPath);
    } else {
      clearGitState();
    }
  }, [rootPath, initializeGit, clearGitState]);

  const handleNewChat = async () => {
    const hasConflict = await checkForConflicts();
    if (hasConflict) {
      return;
    }
    startNewChat();
    // If we're in tasks view, we don't need to close anything
    // If we were in history sidebar (old design), we would close it
  };

  // Handle task deletion with worktree confirmation
  const handleDeleteTask = async (taskId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const result = await deleteTask(taskId);
    if (result.requiresConfirmation && result.changesCount && result.message) {
      setDeleteConfirmation({
        taskId,
        changesCount: result.changesCount,
        message: result.message,
      });
    }
  };

  const handleConfirmDelete = async () => {
    if (deleteConfirmation) {
      await deleteTask(deleteConfirmation.taskId, { force: true });
      setDeleteConfirmation(null);
    }
  };

  const handleCancelDelete = () => {
    setDeleteConfirmation(null);
  };

  // Handle discard and continue with new chat
  const handleDiscardAndContinue = async () => {
    await discardChanges();
    resetWorktreeState();
    startNewChat();
    setIsHistoryOpen(false);
  };

  // Handle merge and continue with new chat
  const handleMergeAndContinue = async () => {
    const result = await mergeToMain();
    if (result.success) {
      resetWorktreeState();
      startNewChat();
      setIsHistoryOpen(false);
    }
    // If there are conflicts, the dialog will show them
  };

  // Handle sync from main (user wants to keep working with latest main changes)
  const handleSyncFromMain = async () => {
    const result = await syncFromMain();
    if (result.success) {
      // Sync successful - dialog will close, user can continue working
      resetWorktreeState();
    }
    // If there are conflicts, the dialog will show them
  };

  const handleHistoryTaskSelect = (taskId: string) => {
    selectTask(taskId);
    // No need to close history sidebar anymore as it's part of the main layout
  };

  const handleTaskStart = (taskId: string, _title: string) => {
    selectTask(taskId);
  };

  const handleDiffApplied = () => {
    refreshFileTree();
    if (currentFile) {
      refreshFile(currentFile.path);
    }
    // Refresh Git status when files change
    refreshGitStatus();
  };

  const handleProjectSelect = async (projectId: string) => {
    try {
      // Get the project from database
      const project = await databaseService.getProject(projectId);
      if (project) {
        // Save project ID to settings (will trigger reactive update)
        await settingsManager.setProject(projectId);

        // If project has root_path, open the repository
        if (project.root_path) {
          await openRepository(project.root_path, projectId);

          // Initialize worktree store for this project
          initializeWorktree().catch((error) => {
            logger.warn('[RepositoryLayout] Failed to initialize worktree store:', error);
          });
        } else {
          // If project has no root_path, close current repository to clear the UI
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
    // Close the tab if the deleted file is open
    const fileIndex = openFiles.findIndex((file) => file.path === filePath);
    if (fileIndex !== -1) {
      closeTab(fileIndex);
    }
    // Refresh Git status
    refreshGitStatus();
  };

  const handleFileCreate = async (parentPath: string, fileName: string, isDirectory: boolean) => {
    try {
      await createFile(parentPath, fileName, isDirectory);
      // Refresh Git status
      refreshGitStatus();
    } catch (error) {
      logger.error('Failed to create file/directory:', error);
      // The toast error will be shown by the service
    }
  };

  const handleFileRename = async (oldPath: string, newName: string) => {
    try {
      await renameFile(oldPath, newName);
      // Refresh Git status
      refreshGitStatus();
    } catch (error) {
      logger.error('Failed to rename file/directory:', error);
      // The toast error will be shown by the service
    }
  };

  const handleCopyPath = (filePath: string) => {
    navigator.clipboard.writeText(filePath);
    toast.success('Path copied to clipboard');
  };

  const handleCopyRelativePath = (filePath: string, rootPath: string) => {
    const relativePath = getRelativePath(filePath, rootPath);
    navigator.clipboard.writeText(relativePath);
    toast.success('Relative path copied to clipboard');
  };

  // Get the currently selected file path for the file tree
  const selectedFilePath = currentFile?.path || null;

  const hasOpenFiles = openFiles.length > 0;

  // Lint diagnostics state
  const { settings } = useLintStore();
  const showDiagnostics = settings.enabled && settings.showInProblemsPanel;

  // Fullscreen panel display logic
  const showFileTree = fullscreenPanel === 'none';
  const showMiddlePanel =
    fullscreenPanel === 'none' || fullscreenPanel === 'editor' || fullscreenPanel === 'terminal';
  const showChatPanel = fullscreenPanel === 'none' || fullscreenPanel === 'chat';
  const showEditor = fullscreenPanel !== 'terminal' && fullscreenPanel !== 'chat';
  const showTerminal =
    isTerminalVisible && fullscreenPanel !== 'editor' && fullscreenPanel !== 'chat';
  const showProblemsPanel = showDiagnostics && hasOpenFiles && fullscreenPanel === 'none';
  const isEditorFullscreen = fullscreenPanel === 'editor';
  const isTerminalFullscreen = fullscreenPanel === 'terminal';
  const isChatFullscreen = fullscreenPanel === 'chat';

  // Handle diagnostic click
  const handleDiagnosticClick = (diagnostic: LintDiagnostic & { filePath: string }) => {
    selectFile(diagnostic.filePath, diagnostic.range.start.line);
  };

  return (
    <>
      <GlobalFileSearch
        isOpen={isFileSearchOpen}
        onClose={closeFileSearch}
        onFileSelect={handleSearchFileSelect}
        onSearch={searchFiles}
        repositoryPath={rootPath}
      />

      {hasRepository && (
        <GlobalContentSearch
          inputRef={contentSearchInputRef}
          isSearchVisible={isContentSearchVisible}
          onFileSelect={selectFile}
          repositoryPath={rootPath}
          toggleSearchVisibility={() => setIsContentSearchVisible((prev) => !prev)}
        />
      )}

      <div className="flex h-screen flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-hidden">
          <ResizablePanelGroup className="h-full" direction="horizontal">
            {/* Left Panel: FileTree when repository is loaded, EmptyRepositoryState when not */}
            {showFileTree && (
              <>
                <ResizablePanel
                  id={shouldShowSidebar ? fileTreePanelId : emptyRepoPanelId}
                  order={1}
                  className={
                    shouldShowSidebar
                      ? 'border-r bg-white dark:bg-gray-950'
                      : 'flex items-center justify-center bg-white dark:bg-gray-950'
                  }
                  defaultSize={shouldShowSidebar ? 20 : 50}
                  maxSize={shouldShowSidebar ? 40 : 70}
                  minSize={shouldShowSidebar ? 10 : 30}
                >
                  {shouldShowSidebar ? (
                    <div className="flex h-full flex-col">
                      <FileTreeHeader
                        currentProjectId={currentProjectId}
                        onProjectSelect={handleProjectSelect}
                        onImportRepository={async () => {
                          const newProject = await selectRepository();
                          if (newProject) {
                            // Project ID will be updated via settings store reactivity
                            await refreshProjects();
                          }
                        }}
                        isLoadingProject={isLoading}
                        isTerminalVisible={hasRepository ? isTerminalVisible : undefined}
                        onToggleTerminal={hasRepository ? toggleTerminalVisible : undefined}
                        onOpenFileSearch={hasRepository ? openFileSearch : undefined}
                        onOpenContentSearch={
                          hasRepository ? () => setIsContentSearchVisible(true) : undefined
                        }
                      />

                      {/* View Switcher Tabs - only show when has repository */}
                      {hasRepository && (
                        <div className=" border-b px-2 py-1">
                          <Tabs
                            value={sidebarView}
                            onValueChange={(v) => {
                              setSidebarView(v as SidebarView);
                              settingsManager.setSidebarView(v);
                            }}
                          >
                            <TabsList className="grid w-full grid-cols-2 h-7 bg-muted/50 p-0.5">
                              <TabsTrigger
                                value={SidebarView.FILES}
                                className="h-6 gap-1.5 px-2.5 text-[11px] data-[state=active]:shadow-none"
                              >
                                <Folder className="h-3.5 w-3.5" />
                                {t.Sidebar.files || 'Files'}
                              </TabsTrigger>
                              <TabsTrigger
                                value={SidebarView.TASKS}
                                className="h-6 gap-1.5 px-2.5 text-[11px] data-[state=active]:shadow-none"
                              >
                                <ListTodo className="h-3.5 w-3.5" />
                                {t.Sidebar.tasks || 'Tasks'}
                              </TabsTrigger>
                            </TabsList>
                          </Tabs>
                        </div>
                      )}

                      {/* Files View - only render when has repository */}
                      {hasRepository && (
                        <div
                          className={
                            sidebarView === SidebarView.FILES ? 'flex-1 overflow-auto' : 'hidden'
                          }
                        >
                          <FileTree
                            key={rootPath}
                            fileTree={fileTree}
                            repositoryPath={rootPath}
                            expandedPaths={expandedPaths}
                            onFileCreate={handleFileCreate}
                            onFileDelete={handleFileDelete}
                            onFileRename={handleFileRename}
                            onFileSelect={selectFile}
                            onRefresh={refreshFileTree}
                            selectedFile={selectedFilePath}
                            onLoadChildren={async (node) => {
                              await loadDirectoryChildren(node);
                              return node.children || [];
                            }}
                            onToggleExpansion={toggleExpansion}
                          />
                        </div>
                      )}

                      {/* Tasks View - always render, conditionally display */}
                      <div
                        className={
                          !hasRepository || sidebarView === SidebarView.TASKS
                            ? 'flex flex-1 flex-col overflow-hidden'
                            : 'hidden'
                        }
                      >
                        {/* Task Tools */}
                        <div className="flex items-center gap-2 border-b p-2">
                          <div className="relative flex-1">
                            <Search className="-translate-y-1/2 absolute top-1/2 left-2.5 h-3.5 w-3.5 text-gray-400" />
                            <Input
                              className="h-8 pl-8 text-xs"
                              onChange={(e) => setTaskSearchQuery(e.target.value)}
                              placeholder={t.Sidebar.tasks || 'Search tasks...'}
                              value={taskSearchQuery}
                            />
                          </div>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                className="h-8 w-8 p-0"
                                disabled={isMaxReached}
                                onClick={handleNewChat}
                                size="sm"
                                variant="outline"
                              >
                                <Plus className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            {isMaxReached && (
                              <TooltipContent>
                                <p>Maximum concurrent tasks reached</p>
                              </TooltipContent>
                            )}
                          </Tooltip>
                        </div>

                        {/* Task List */}
                        <div className="flex-1 overflow-auto">
                          <TaskList
                            tasks={filteredTasks}
                            currentTaskId={currentTaskId}
                            editingId={editingId}
                            editingTitle={editingTitle}
                            loading={tasksLoading}
                            getWorktreeForTask={getWorktreeForTask}
                            onCancelEdit={cancelEditing}
                            onTaskSelect={handleHistoryTaskSelect}
                            onDeleteTask={handleDeleteTask}
                            onSaveEdit={finishEditing}
                            onStartEditing={startEditing}
                            onTitleChange={setEditingTitle}
                            runningTaskIds={runningTaskIds}
                          />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <EmptyRepositoryState
                      isLoading={isLoading}
                      onSelectRepository={async () => {
                        const newProject = await selectRepository();
                        if (newProject) {
                          // Project ID will be updated via settings store reactivity
                          await refreshProjects();
                        }
                      }}
                      onOpenRepository={async (path, projectId) => {
                        await openRepository(path, projectId);
                        // Project ID will be updated via settings store reactivity
                        await refreshProjects();
                      }}
                    />
                  )}
                </ResizablePanel>

                <ResizableHandle withHandle />
              </>
            )}

            {/* Middle Panel: Contains file editor and/or terminal - only when repository is loaded */}
            {hasRepository && showMiddlePanel && (hasOpenFiles || isTerminalVisible) && (
              <>
                <ResizablePanel
                  id={editorAreaPanelId}
                  order={2}
                  className={showChatPanel ? 'border-r' : ''}
                  defaultSize={isEditorFullscreen || isTerminalFullscreen ? 100 : 40}
                  minSize={20}
                  maxSize={100}
                >
                  <ResizablePanelGroup direction="vertical">
                    {/* File Editor Panel - Only show if files are open and not terminal/chat fullscreen */}
                    {hasOpenFiles && showEditor && (
                      <>
                        <ResizablePanel
                          id={fileEditorPanelId}
                          order={1}
                          defaultSize={isEditorFullscreen ? 100 : showTerminal ? 60 : 100}
                          minSize={20}
                        >
                          <div className="flex h-full flex-col">
                            {/* File Tabs with Fullscreen Button */}
                            <div className="flex items-center border-b">
                              <div className="flex-1 overflow-hidden">
                                <FileTabs
                                  activeFileIndex={activeFileIndex}
                                  onTabClose={closeTab}
                                  onCloseOthers={closeOthers}
                                  onCloseAll={closeAllFiles}
                                  onCopyPath={handleCopyPath}
                                  onCopyRelativePath={handleCopyRelativePath}
                                  onAddFileToChat={handleAddFileToChat}
                                  onTabSelect={switchToTab}
                                  openFiles={openFiles}
                                  rootPath={rootPath}
                                />
                              </div>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 mr-1"
                                    onClick={() => toggleFullscreen('editor')}
                                  >
                                    {isEditorFullscreen ? (
                                      <Minimize2 className="h-3.5 w-3.5" />
                                    ) : (
                                      <Maximize2 className="h-3.5 w-3.5" />
                                    )}
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent side="bottom">
                                  {isEditorFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                                </TooltipContent>
                              </Tooltip>
                            </div>

                            {/* File Editor */}
                            <div className="flex-1 overflow-auto">
                              <FileEditor
                                error={currentFile?.error || null}
                                fileContent={currentFile?.content || null}
                                filePath={currentFile?.path || null}
                                hasUnsavedChanges={currentFile?.hasUnsavedChanges}
                                isLoading={currentFile?.isLoading ?? false}
                                lineNumber={currentFile?.lineNumber}
                                onContentChange={(content) => {
                                  if (currentFile) {
                                    updateFileContent(currentFile.path, content, true);
                                  }
                                }}
                                onGlobalSearch={() => setIsContentSearchVisible((prev) => !prev)}
                              />
                            </div>
                          </div>
                        </ResizablePanel>

                        {/* Resize handle between editor and terminal */}
                        {showTerminal && <ResizableHandle withHandle />}

                        {/* Problems Panel - Show between editor and terminal */}
                        {showProblemsPanel && (
                          <>
                            <ResizableHandle withHandle />
                            <DiagnosticsPanel onDiagnosticClick={handleDiagnosticClick} />
                          </>
                        )}
                      </>
                    )}

                    {/* Terminal Panel - Can be shown independently */}
                    {showTerminal && (
                      <ResizablePanel
                        id={terminalPanelId}
                        order={2}
                        defaultSize={
                          isTerminalFullscreen ? 100 : hasOpenFiles && showEditor ? 40 : 100
                        }
                        minSize={15}
                        maxSize={100}
                      >
                        <TerminalPanel
                          onCopyToChat={(content) => {
                            if (chatBoxRef.current?.appendToInput) {
                              chatBoxRef.current.appendToInput(`\n\n${content}`);
                            }
                          }}
                          onClose={() => toggleTerminalVisible()}
                          onToggleFullscreen={() => toggleFullscreen('terminal')}
                          isFullscreen={isTerminalFullscreen}
                        />
                      </ResizablePanel>
                    )}
                  </ResizablePanelGroup>
                </ResizablePanel>

                {showChatPanel && <ResizableHandle withHandle />}
              </>
            )}

            {/* Chat Panel - ALWAYS RENDERED to preserve state during project switches */}
            {showChatPanel && (
              <ResizablePanel
                id={mainChatPanelId}
                order={hasRepository ? 3 : 2}
                className="bg-white dark:bg-gray-950"
                defaultSize={
                  isChatFullscreen
                    ? 100
                    : hasRepository
                      ? hasOpenFiles || isTerminalVisible
                        ? 40
                        : 80
                      : 50
                }
                maxSize={100}
                minSize={hasRepository ? 20 : 30}
              >
                <div className="flex h-full flex-col">
                  {/* Chat Panel Header - always show */}
                  <ChatPanelHeader
                    currentTaskId={currentTaskId}
                    isHistoryOpen={isHistoryOpen}
                    onHistoryOpenChange={setIsHistoryOpen}
                    onTaskSelect={handleHistoryTaskSelect}
                    onNewChat={handleNewChat}
                    isFullscreen={isChatFullscreen}
                    onToggleFullscreen={() => toggleFullscreen('chat')}
                  />
                  <div className="flex-1 overflow-hidden">
                    <ChatBox
                      ref={chatBoxRef}
                      taskId={currentTaskId}
                      fileContent={hasRepository ? currentFile?.content || null : null}
                      onTaskStart={handleTaskStart}
                      onDiffApplied={handleDiffApplied}
                      repositoryPath={rootPath ?? undefined}
                      selectedFile={hasRepository ? currentFile?.path || null : null}
                      onFileSelect={selectFile}
                      onAddFileToChat={handleAddFileToChat}
                      checkForConflicts={checkForConflicts}
                    />
                  </div>
                </div>
              </ResizablePanel>
            )}
          </ResizablePanelGroup>
        </div>

        <GitStatusBar />
      </div>

      <WorktreeConflictDialog
        open={!!conflictData}
        worktreePath={conflictData?.worktreePath ?? ''}
        changes={conflictData?.changes ?? null}
        isProcessing={isWorktreeProcessing}
        mergeResult={mergeResult}
        syncResult={syncResult}
        onDiscard={handleDiscardAndContinue}
        onMerge={handleMergeAndContinue}
        onSync={handleSyncFromMain}
        onCancel={cancelOperation}
        onClose={resetWorktreeState}
      />

      {/* Worktree deletion confirmation dialog */}
      <AlertDialog open={!!deleteConfirmation} onOpenChange={() => setDeleteConfirmation(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Task with Uncommitted Changes?</AlertDialogTitle>
            <AlertDialogDescription>{deleteConfirmation?.message}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancelDelete}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleConfirmDelete}
            >
              Delete Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
