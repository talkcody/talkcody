import { History, Plus, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useTranslation } from '@/hooks/use-locale';
import { useTasks } from '@/hooks/use-tasks';
import { useExecutionStore } from '@/stores/execution-store';
import { TaskList } from './task-list';

interface ChatHistoryProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  currentTaskId?: string;
  onTaskSelect: (taskId: string) => void;
  onNewChat: () => void;
}

export function ChatHistory({
  isOpen,
  onOpenChange,
  currentTaskId,
  onTaskSelect,
  onNewChat,
}: ChatHistoryProps) {
  const t = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  // Use selectors to avoid re-rendering on every streaming chunk
  const runningTaskIds = useExecutionStore(useShallow((state) => state.getRunningTaskIds()));
  const isMaxReached = useExecutionStore((state) => state.isMaxReached());

  // Worktree deletion confirmation state
  const [deleteConfirmation, setDeleteConfirmation] = useState<{
    taskId: string;
    changesCount: number;
    message: string;
  } | null>(null);

  const {
    tasks,
    loading,
    editingId,
    editingTitle,
    setEditingTitle,
    loadTasks,
    deleteTask,
    finishEditing,
    startEditing,
    cancelEditing,
    selectTask,
  } = useTasks();

  // Refresh tasks when history opens or active task changes
  useEffect(() => {
    if (isOpen) {
      loadTasks();
    }
  }, [isOpen, loadTasks]);

  const handleTaskSelect = (taskId: string) => {
    selectTask(taskId);
    onTaskSelect(taskId);
    onOpenChange(false);
  };

  const handleNewChat = () => {
    onNewChat();
    onOpenChange(false);
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

  const filteredTasks = tasks.filter((task) =>
    task.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <>
      <Popover onOpenChange={onOpenChange} open={isOpen}>
        <PopoverTrigger asChild>
          <Button
            className="h-6 w-6 p-0 hover:bg-gray-200 dark:hover:bg-gray-700"
            size="sm"
            title={t.Chat.chatHistory}
            variant="ghost"
          >
            <History className="h-3.5 w-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-0">
          <div className="flex h-96 flex-col">
            {/* Search Header */}
            <div className="border-b p-3">
              <div className="mb-2 flex items-center justify-between">
                <h4 className="font-medium text-sm">{t.Chat.chatHistory}</h4>
                <Button
                  className="h-6 px-2 text-xs"
                  disabled={isMaxReached}
                  onClick={handleNewChat}
                  size="sm"
                  title={isMaxReached ? 'Maximum concurrent tasks reached' : undefined}
                  variant="ghost"
                >
                  <Plus className="mr-1 h-3 w-3" />
                  {t.Common.add}
                </Button>
              </div>
              <div className="relative">
                <Search className="-translate-y-1/2 absolute top-1/2 left-3 h-4 w-4 transform text-gray-400" />
                <Input
                  className="h-8 pl-9"
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t.Chat.searchTasks}
                  value={searchQuery}
                />
              </div>
            </div>

            <div className="flex-1 overflow-auto">
              <TaskList
                tasks={filteredTasks}
                currentTaskId={currentTaskId}
                editingId={editingId}
                editingTitle={editingTitle}
                loading={loading}
                onCancelEdit={cancelEditing}
                onTaskSelect={handleTaskSelect}
                onDeleteTask={handleDeleteTask}
                onSaveEdit={finishEditing}
                onStartEditing={startEditing}
                onTitleChange={setEditingTitle}
                runningTaskIds={runningTaskIds}
              />
            </div>
          </div>
        </PopoverContent>
      </Popover>

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
