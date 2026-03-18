// src/pages/scheduled-tasks-page.tsx
import { ChevronDown, ChevronRight, Clock, Play, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ScheduledTaskFormModal } from '@/components/scheduled-tasks/scheduled-task-form-modal';
import { ScheduledTaskRunHistory } from '@/components/scheduled-tasks/scheduled-task-run-history';
import { ScheduledTaskStatsDashboard } from '@/components/scheduled-tasks/scheduled-task-stats-dashboard';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useLocale } from '@/hooks/use-locale';
import { useScheduledTaskStore } from '@/stores/scheduled-task-store';
import { type JobStatus, type ScheduledTask, scheduleToSummary } from '@/types/scheduled-task';

function JobStatusBadge({ status }: { status: JobStatus }) {
  const { t } = useLocale();
  const variantMap: Record<JobStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
    enabled: 'default',
    disabled: 'outline',
    completed: 'secondary',
    error: 'destructive',
  };
  return <Badge variant={variantMap[status]}>{t.ScheduledTasks.status[status]}</Badge>;
}

function formatNextRun(ms: number | null): string {
  if (!ms) return '—';
  const diff = ms - Date.now();
  if (diff < 0) return 'overdue';
  if (diff < 60_000) return `in ${Math.round(diff / 1000)}s`;
  if (diff < 3_600_000) return `in ${Math.round(diff / 60_000)}m`;
  if (diff < 86_400_000) return `in ${Math.round(diff / 3_600_000)}h`;
  return `in ${Math.round(diff / 86_400_000)}d`;
}

interface TaskRowProps {
  task: ScheduledTask;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleEnable: () => void;
  onRunNow: () => void;
}

function TaskRow({
  task,
  isExpanded,
  onToggleExpand,
  onEdit,
  onDelete,
  onToggleEnable,
  onRunNow,
}: TaskRowProps) {
  const { t } = useLocale();
  const ExpandIcon = isExpanded ? ChevronDown : ChevronRight;

  return (
    <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
      <div className="flex items-center gap-3 p-3">
        <button
          type="button"
          className="shrink-0 text-muted-foreground hover:text-foreground"
          onClick={onToggleExpand}
        >
          <ExpandIcon className="h-4 w-4" />
        </button>

        <div className="min-w-0 flex-1 cursor-pointer" onClick={onToggleExpand}>
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{task.name}</span>
            <JobStatusBadge status={task.status} />
            {task.offlinePolicy?.enabled && (
              <Badge variant="outline">{t.ScheduledTasks.offlineEnabled}</Badge>
            )}
            {task.deliveryPolicy?.enabled && (
              <Badge variant="outline">{t.ScheduledTasks.deliveryEnabled}</Badge>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {scheduleToSummary(task.schedule)}
          </p>
        </div>

        <div className="hidden shrink-0 text-right sm:block">
          <p className="text-xs text-muted-foreground">{t.ScheduledTasks.nextRun}</p>
          <p className="text-xs font-medium">{formatNextRun(task.nextRunAt)}</p>
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <Switch
              checked={task.status === 'enabled'}
              onCheckedChange={onToggleEnable}
              disabled={task.status === 'completed' || task.status === 'error'}
            />
          </TooltipTrigger>
          <TooltipContent>
            {task.status === 'enabled'
              ? t.ScheduledTasks.actions.disable
              : t.ScheduledTasks.actions.enable}
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onRunNow}>
              <Play className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t.ScheduledTasks.actions.runNow}</TooltipContent>
        </Tooltip>

        <Button variant="ghost" size="sm" className="h-7 shrink-0 text-xs" onClick={onEdit}>
          {t.Common.edit}
        </Button>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-destructive/70 hover:text-destructive"
              onClick={onDelete}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t.Common.delete}</TooltipContent>
        </Tooltip>
      </div>

      {isExpanded && (
        <div className="border-t px-3 pb-3 pt-2">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            {t.ScheduledTasks.runHistory}
          </p>
          <ScheduledTaskRunHistory jobId={task.id} />
        </div>
      )}
    </div>
  );
}

export function ScheduledTasksPage() {
  const { t } = useLocale();
  const {
    tasks,
    isLoading,
    stats,
    loadTasks,
    loadStats,
    deleteTask,
    enableTask,
    disableTask,
    triggerNow,
  } = useScheduledTaskStore();

  const [formOpen, setFormOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<ScheduledTask | undefined>();
  const [deleteTarget, setDeleteTarget] = useState<ScheduledTask | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadTasks();
    loadStats();
  }, [loadTasks, loadStats]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteTask(deleteTarget.id);
      toast.success(t.ScheduledTasks.deleted);
      await loadStats();
    } catch (err) {
      toast.error(String(err));
    } finally {
      setDeleteTarget(null);
    }
  };

  const handleToggleEnable = async (task: ScheduledTask) => {
    try {
      if (task.status === 'enabled') {
        await disableTask(task.id);
      } else {
        await enableTask(task.id);
      }
    } catch (err) {
      toast.error(String(err));
    }
  };

  const handleRunNow = async (task: ScheduledTask) => {
    try {
      await triggerNow(task.id);
      toast.success(t.ScheduledTasks.triggered);
      await loadStats();
    } catch (err) {
      toast.error(String(err));
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h1 className="text-base font-semibold">{t.ScheduledTasks.title}</h1>
        <Button
          size="sm"
          onClick={() => {
            setEditingTask(undefined);
            setFormOpen(true);
          }}
        >
          <Plus className="mr-1.5 h-4 w-4" />
          {t.ScheduledTasks.newTask}
        </Button>
      </div>

      <Tabs defaultValue="list" className="flex min-h-0 flex-1 flex-col">
        <div className="border-b px-4 py-2">
          <TabsList>
            <TabsTrigger value="list">{t.ScheduledTasks.tabs.list}</TabsTrigger>
            <TabsTrigger value="dashboard">{t.ScheduledTasks.tabs.dashboard}</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="dashboard" className="m-0 flex-1 overflow-auto p-4">
          <ScheduledTaskStatsDashboard stats={stats} />
        </TabsContent>

        <TabsContent value="list" className="m-0 flex-1 min-h-0">
          <ScrollArea className="flex-1">
            <div className="space-y-2 p-4">
              {isLoading && tasks.length === 0 && (
                <p className="text-center text-sm text-muted-foreground">{t.Common.loading}</p>
              )}

              {!isLoading && tasks.length === 0 && (
                <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
                  <Clock className="h-10 w-10 opacity-30" />
                  <p className="text-sm">{t.ScheduledTasks.noTasks}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditingTask(undefined);
                      setFormOpen(true);
                    }}
                  >
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    {t.ScheduledTasks.newTask}
                  </Button>
                </div>
              )}

              {tasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  isExpanded={expandedIds.has(task.id)}
                  onToggleExpand={() => toggleExpand(task.id)}
                  onEdit={() => {
                    setEditingTask(task);
                    setFormOpen(true);
                  }}
                  onDelete={() => setDeleteTarget(task)}
                  onToggleEnable={() => handleToggleEnable(task)}
                  onRunNow={() => handleRunNow(task)}
                />
              ))}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>

      <ScheduledTaskFormModal
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditingTask(undefined);
        }}
        task={editingTask}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.ScheduledTasks.deleteConfirm}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.ScheduledTasks.deleteDescription(deleteTarget?.name ?? '')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.Common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
            >
              {t.Common.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
