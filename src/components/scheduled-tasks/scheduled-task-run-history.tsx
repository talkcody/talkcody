// src/components/scheduled-tasks/scheduled-task-run-history.tsx
import { Clock, ExternalLink } from 'lucide-react';
import { useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useLocale } from '@/hooks/use-locale';
import { useScheduledTaskStore } from '@/stores/scheduled-task-store';
import { useTaskStore } from '@/stores/task-store';
import type { ScheduledTaskRunStatus } from '@/types/scheduled-task';

interface ScheduledTaskRunHistoryProps {
  jobId: string;
}

function formatDuration(startMs: number, endMs: number | null): string {
  if (!endMs) return '—';
  const diffSec = Math.round((endMs - startMs) / 1000);
  if (diffSec < 60) return `${diffSec}s`;
  return `${Math.floor(diffSec / 60)}m ${diffSec % 60}s`;
}

function formatRelativeTime(ms: number): string {
  const diffSec = Math.round((Date.now() - ms) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

function RunStatusBadge({ status }: { status: ScheduledTaskRunStatus }) {
  const { t } = useLocale();
  const label = t.ScheduledTasks.runStatus[status];
  const variantMap: Record<
    ScheduledTaskRunStatus,
    'default' | 'secondary' | 'destructive' | 'outline'
  > = {
    queued: 'outline',
    running: 'default',
    completed: 'secondary',
    failed: 'destructive',
    skipped: 'outline',
    cancelled: 'outline',
  };
  return <Badge variant={variantMap[status]}>{label}</Badge>;
}

export function ScheduledTaskRunHistory({ jobId }: ScheduledTaskRunHistoryProps) {
  const { t } = useLocale();
  const { runs, loadRuns } = useScheduledTaskStore();
  const { setCurrentTaskId } = useTaskStore();
  const jobRuns = runs.get(jobId) ?? [];

  useEffect(() => {
    loadRuns(jobId);
  }, [jobId, loadRuns]);

  if (jobRuns.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
        <Clock className="mr-2 h-4 w-4" />
        {t.ScheduledTasks.noRuns}
      </div>
    );
  }

  return (
    <ScrollArea className="h-64">
      <div className="space-y-1 p-2">
        {jobRuns.map((run) => (
          <div
            key={run.id}
            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-accent"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <RunStatusBadge status={run.status} />
                <span className="text-muted-foreground">{formatRelativeTime(run.triggeredAt)}</span>
                <span className="text-muted-foreground">
                  {formatDuration(run.triggeredAt, run.completedAt)}
                </span>
                {run.attempt > 1 && (
                  <Badge variant="outline">{t.ScheduledTasks.attemptLabel(run.attempt)}</Badge>
                )}
                {run.triggerSource && (
                  <Badge variant="outline">
                    {t.ScheduledTasks.triggerSource[run.triggerSource]}
                  </Badge>
                )}
              </div>
              {run.error && <p className="mt-0.5 truncate text-xs text-destructive">{run.error}</p>}
              {run.deliveryError && (
                <p className="mt-0.5 truncate text-xs text-amber-600 dark:text-amber-400">
                  {t.ScheduledTasks.deliveryErrorPrefix}: {run.deliveryError}
                </p>
              )}
            </div>
            {run.taskId && (
              <button
                type="button"
                title={t.ScheduledTasks.actions.viewTask}
                className="shrink-0 text-muted-foreground hover:text-foreground"
                onClick={() => setCurrentTaskId(run.taskId)}
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
