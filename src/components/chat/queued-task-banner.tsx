import { AlertTriangle, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useLocale } from '@/hooks/use-locale';
import type { QueuedTaskDraft } from '@/types';

interface QueuedTaskBannerProps {
  draft: QueuedTaskDraft;
  queueCount: number;
  onRemove: () => void;
}

export function QueuedTaskBanner({ draft, queueCount, onRemove }: QueuedTaskBannerProps) {
  const { t } = useLocale();
  const remainingCount = Math.max(0, queueCount - 1);
  const isBlocked = draft.status === 'blocked';

  return (
    <div
      className={`mx-3 mb-2 flex items-start justify-between gap-3 rounded-lg border px-3 py-2 text-sm ${
        isBlocked
          ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100'
          : 'border-border bg-muted/40'
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <Badge variant={isBlocked ? 'destructive' : 'outline'}>
            {isBlocked ? t.Chat.queue.blocked : t.Chat.queue.nextUp}
          </Badge>
          {remainingCount > 0 && (
            <Badge variant="outline">{t.Chat.queue.plusMore(remainingCount)}</Badge>
          )}
        </div>
        <p className="line-clamp-2 break-words text-sm">{draft.prompt}</p>
        {isBlocked && draft.blockedReason && (
          <div className="mt-1 flex items-center gap-1 text-xs opacity-90">
            <AlertTriangle className="size-3" />
            <span>{draft.blockedReason}</span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-1">
        <Button type="button" className="h-7 w-7 p-0" onClick={onRemove} variant="ghost">
          <X className="size-4" />
        </Button>
      </div>
    </div>
  );
}
