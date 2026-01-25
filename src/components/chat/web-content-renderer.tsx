// src/components/chat/web-content-renderer.tsx

import { useMemo, useState } from 'react';
import { useLocale } from '@/hooks/use-locale';
import { cn } from '@/lib/utils';

interface WebContentRendererProps {
  content: string;
  className?: string;
}

function stripHtmlCodeFence(content: string): string {
  const trimmed = content.trim();
  if (trimmed.startsWith('```html')) {
    const withoutStart = trimmed.replace(/^```html\s*/i, '');
    return withoutStart.replace(/```\s*$/, '').trim();
  }
  if (trimmed.startsWith('```')) {
    const withoutStart = trimmed.replace(/^```\s*/i, '');
    return withoutStart.replace(/```\s*$/, '').trim();
  }
  return trimmed;
}

export function WebContentRenderer({ content, className }: WebContentRendererProps) {
  const { t } = useLocale();
  const [viewMode, setViewMode] = useState<'rendered' | 'source'>('rendered');

  const html = useMemo(() => stripHtmlCodeFence(content), [content]);
  const isSafeHtml = useMemo(() => {
    const lowered = html.toLowerCase();
    return !lowered.includes('<script') && !lowered.includes('javascript:');
  }, [html]);

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => setViewMode(viewMode === 'rendered' ? 'source' : 'rendered')}
          className="ml-auto px-2 py-1 text-xs rounded border border-border bg-muted hover:bg-muted/80"
        >
          {viewMode === 'rendered'
            ? t.Chat.outputFormat.viewSource
            : t.Chat.outputFormat.viewRendered}
        </button>
      </div>
      {viewMode === 'rendered' && isSafeHtml ? (
        <div className="border rounded bg-background overflow-hidden">
          <iframe
            className="w-full h-[360px]"
            sandbox=""
            srcDoc={html}
            title="Web content preview"
          />
        </div>
      ) : (
        <pre className="p-3 bg-muted rounded text-xs overflow-auto border border-border whitespace-pre-wrap">
          {html}
        </pre>
      )}
    </div>
  );
}
