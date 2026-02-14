import { Folder, ListTodo, Plus, Search } from 'lucide-react';
import type React from 'react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { EmptyRepositoryState } from '@/components/empty-repository-state';
import { FileTree } from '@/components/file-tree';
import { FileTreeHeader } from '@/components/file-tree-header';
import { TaskList } from '@/components/task-list';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ResizableHandle, ResizablePanel } from '@/components/ui/resizable';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useTranslation } from '@/hooks/use-locale';
import { useStableRunningIds } from '@/hooks/use-stable-running-ids';
import { useTasks } from '@/hooks/use-tasks';
import { useExecutionStore } from '@/stores/execution-store';
import { useWorktreeStore } from '@/stores/worktree-store';
import type { FileNode } from '@/types/file-system';
import { SidebarView } from '@/types/navigation';

interface RepositorySidebarProps {
  emptyRepoPanelId: string;
  fileTreePanelId: string;
  shouldShowSidebar: boolean;
  hasRepository: boolean;
  sidebarView: SidebarView;
  onSidebarViewChange: (view: SidebarView) => void;
  currentProjectId: string;
  onProjectSelect: (projectId: string) => Promise<void>;
  onImportRepository: () => Promise<void>;
  onSelectRepository: () => Promise<void>;
  onOpenRepository: (path: string, projectId: string) => Promise<void>;
  isLoadingProject: boolean;
  isTerminalVisible?: boolean;
  onToggleTerminal?: () => void;
  onOpenFileSearch?: () => void;
  onOpenContentSearch?: () => void;
  rootPath: string | null;
  fileTree: FileNode | null;
  expandedPaths: Set<string>;
  selectedFilePath: string | null;
  onFileCreate: (parentPath: string, fileName: string, isDirectory: boolean) => Promise<void>;
  onFileDelete: (filePath: string) => Promise<void>;
  onFileRename: (oldPath: string, newName: string) => Promise<void>;
  onFileSelect: (filePath: string, lineNumber?: number) => void;
  onRefreshFileTree: () => void;
  onLoadChildren: (node: FileNode) => Promise<FileNode[]>;
  onToggleExpansion: (path: string) => void;
  taskSearchInputRef: React.RefObject<HTMLInputElement | null>;
}

export const RepositorySidebar = memo(function RepositorySidebar({
  emptyRepoPanelId,
  fileTreePanelId,
  shouldShowSidebar,
  hasRepository,
  sidebarView,
  onSidebarViewChange,
  currentProjectId,
  onProjectSelect,
  onImportRepository,
  onSelectRepository,
  onOpenRepository,
  isLoadingProject,
  isTerminalVisible,
  onToggleTerminal,
  onOpenFileSearch,
  onOpenContentSearch,
  rootPath,
  fileTree,
  expandedPaths,
  selectedFilePath,
  onFileCreate,
  onFileDelete,
  onFileRename,
  onFileSelect,
  onRefreshFileTree,
  onLoadChildren,
  onToggleExpansion,
  taskSearchInputRef,
}: RepositorySidebarProps) {
  const t = useTranslation();
  const panelId = shouldShowSidebar ? fileTreePanelId : emptyRepoPanelId;

  const { isMaxReached } = useExecutionStore(
    useShallow((state) => ({ isMaxReached: state.isMaxReached() }))
  );

  const [sidebarTaskSearch, setSidebarTaskSearch] = useState('');
  const [debouncedTaskSearch, setDebouncedTaskSearch] = useState('');
  const stableRunningTaskIds = useStableRunningIds();

  // Task data + actions scoped to sidebar to avoid rerenders upstream
  const {
    tasks,
    loading: tasksLoading,
    loadingMore,
    hasMore,
    loadMoreTasks,
    editingId,
    editingTitle,
    setEditingTitle,
    deleteTask,
    finishEditing,
    startEditing,
    cancelEditing,
    selectTask,
    currentTaskId,
    startNewTask,
    loadTasks,
  } = useTasks();

  const { getWorktreeForTask } = useWorktreeStore(
    useShallow((state) => ({ getWorktreeForTask: state.getWorktreeForTask }))
  );

  const normalizedTaskSearch = useMemo(() => debouncedTaskSearch.trim(), [debouncedTaskSearch]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedTaskSearch(sidebarTaskSearch);
    }, 200);

    return () => window.clearTimeout(handle);
  }, [sidebarTaskSearch]);

  useEffect(() => {
    if (sidebarView === SidebarView.TASKS) {
      loadTasks(currentProjectId || undefined, normalizedTaskSearch);
    }
  }, [sidebarView, currentProjectId, normalizedTaskSearch, loadTasks]);

  // Keep input controlled externally if provided
  useEffect(() => {
    if (taskSearchInputRef.current) {
      taskSearchInputRef.current.value = sidebarTaskSearch;
    }
  }, [sidebarTaskSearch, taskSearchInputRef]);

  const taskScrollContainerRef = useRef<HTMLDivElement | null>(null);

  return (
    <>
      <ResizablePanel
        id={panelId}
        order={1}
        className={
          shouldShowSidebar
            ? 'border-r bg-white dark:bg-gray-950'
            : 'flex items-center justify-center bg-white dark:bg-gray-950'
        }
        defaultSize={shouldShowSidebar ? 8 : 50}
        maxSize={shouldShowSidebar ? 28 : 70}
        minSize={shouldShowSidebar ? 8 : 10}
      >
        {shouldShowSidebar ? (
          <div className="flex h-full flex-col">
            <FileTreeHeader
              currentProjectId={currentProjectId}
              onProjectSelect={onProjectSelect}
              onImportRepository={onImportRepository}
              isLoadingProject={isLoadingProject}
              isTerminalVisible={hasRepository ? isTerminalVisible : undefined}
              onToggleTerminal={hasRepository ? onToggleTerminal : undefined}
              onOpenFileSearch={hasRepository ? onOpenFileSearch : undefined}
              onOpenContentSearch={hasRepository ? onOpenContentSearch : undefined}
            />

            {hasRepository && (
              <div className=" border-b px-2 py-1">
                <Tabs
                  value={sidebarView}
                  onValueChange={(value) => {
                    onSidebarViewChange(value as SidebarView);
                  }}
                >
                  <TabsList className="grid w-full grid-cols-2 h-7 bg-muted/50 p-0.5">
                    <TabsTrigger
                      value={SidebarView.FILES}
                      className="h-6 gap-1.5 px-2.5 text-[11px] data-[state=active]:shadow-none"
                    >
                      <Folder className="h-3.5 w-3.5" />
                      {t.Sidebar.files}
                    </TabsTrigger>
                    <TabsTrigger
                      value={SidebarView.TASKS}
                      className="h-6 gap-1.5 px-2.5 text-[11px] data-[state=active]:shadow-none"
                    >
                      <ListTodo className="h-3.5 w-3.5" />
                      {t.Sidebar.tasks}
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
            )}

            {hasRepository && (
              <div
                className={sidebarView === SidebarView.FILES ? 'flex-1 overflow-auto' : 'hidden'}
              >
                {fileTree && rootPath && (
                  <FileTree
                    key={rootPath}
                    fileTree={fileTree}
                    repositoryPath={rootPath}
                    expandedPaths={expandedPaths}
                    onFileCreate={onFileCreate}
                    onFileDelete={onFileDelete}
                    onFileRename={onFileRename}
                    onFileSelect={onFileSelect}
                    onRefresh={onRefreshFileTree}
                    selectedFile={selectedFilePath}
                    onLoadChildren={async (node) => {
                      await onLoadChildren(node);
                      return node.children || [];
                    }}
                    onToggleExpansion={onToggleExpansion}
                  />
                )}
              </div>
            )}

            <div
              className={
                !hasRepository || sidebarView === SidebarView.TASKS
                  ? 'flex flex-1 flex-col overflow-hidden'
                  : 'hidden'
              }
            >
              <div className="flex items-center gap-2 border-b p-2">
                <div className="relative flex-1">
                  <Search className="-translate-y-1/2 absolute top-1/2 left-2.5 h-3.5 w-3.5 text-gray-400" />
                  <Input
                    ref={taskSearchInputRef}
                    className="h-8 pl-8 text-xs"
                    onChange={(event) => setSidebarTaskSearch(event.target.value)}
                    placeholder={t.Chat.searchTasks}
                    value={sidebarTaskSearch}
                  />
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      className="h-8 w-8 p-0"
                      disabled={isMaxReached}
                      onClick={() => {
                        setSidebarTaskSearch('');
                        startNewTask();
                      }}
                      size="sm"
                      variant="outline"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  {isMaxReached && (
                    <TooltipContent>
                      <p>{t.RepositoryLayout.maxConcurrentTasksReached}</p>
                    </TooltipContent>
                  )}
                </Tooltip>
              </div>

              <div ref={taskScrollContainerRef} className="flex-1 overflow-auto">
                <TaskList
                  tasks={tasks}
                  currentTaskId={currentTaskId ?? undefined}
                  editingId={editingId}
                  editingTitle={editingTitle}
                  loading={tasksLoading}
                  hasMore={hasMore}
                  loadingMore={loadingMore}
                  onLoadMore={() =>
                    loadMoreTasks(currentProjectId || undefined, normalizedTaskSearch)
                  }
                  getWorktreeForTask={getWorktreeForTask}
                  onCancelEdit={cancelEditing}
                  onTaskSelect={(taskId) => {
                    selectTask(taskId);
                  }}
                  onDeleteTask={(taskId, e) => {
                    e?.stopPropagation();
                    deleteTask(taskId).then((result) => {
                      if (result.requiresConfirmation && result.changesCount && result.message) {
                        useWorktreeStore.getState().setPendingDeletion?.({
                          taskId,
                          changesCount: result.changesCount,
                          message: result.message,
                        });
                      }
                    });
                  }}
                  onSaveEdit={finishEditing}
                  onStartEditing={startEditing}
                  onTitleChange={setEditingTitle}
                  runningTaskIds={stableRunningTaskIds}
                  scrollRoot={taskScrollContainerRef.current}
                />
              </div>
            </div>
          </div>
        ) : (
          <EmptyRepositoryState
            isLoading={isLoadingProject}
            onSelectRepository={onSelectRepository}
            onOpenRepository={onOpenRepository}
          />
        )}
      </ResizablePanel>

      <ResizableHandle withHandle />
    </>
  );
});
