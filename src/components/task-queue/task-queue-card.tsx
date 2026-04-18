import { ListTodo } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useLocale } from '@/hooks/use-locale';
import type { QueuedTaskDraft } from '@/types';

interface TaskQueueCardProps {
  queueCount: number;
  queueHead: QueuedTaskDraft | null;
  onClearQueue: () => void;
}

export function TaskQueueCard({ queueCount, queueHead, onClearQueue }: TaskQueueCardProps) {
  const { t } = useLocale();

  if (!queueHead) {
    return null;
  }

  const isBlocked = queueHead.status === 'blocked';

  return (
    <div className="border-b px-2 py-2">
      <div
        className={`rounded-lg border px-3 py-2 ${
          isBlocked
            ? 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30'
            : 'border-border bg-muted/30'
        }`}
      >
        <div className="mb-1 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ListTodo className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium text-sm">{t.Chat.queue.nextUp}</span>
            <Badge variant={isBlocked ? 'destructive' : 'outline'}>{queueCount}</Badge>
          </div>
          <Button className="h-6 px-2 text-xs" onClick={onClearQueue} variant="ghost">
            {t.Common.clear}
          </Button>
        </div>
        <p className="line-clamp-2 text-xs text-muted-foreground">{queueHead.prompt}</p>
        {isBlocked && queueHead.blockedReason && (
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
            {queueHead.blockedReason}
          </p>
        )}
      </div>
    </div>
  );
}
