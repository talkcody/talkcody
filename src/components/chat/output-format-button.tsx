// src/components/chat/output-format-button.tsx

import { FileText, GitBranch, Globe } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useLocale } from '@/hooks/use-locale';
import { cn } from '@/lib/utils';
import { useOutputFormatStore } from '@/stores/output-format-store';
import { OUTPUT_FORMAT_OPTIONS, type OutputFormatType } from '@/types/output-format';

const FORMAT_ICON_MAP: Record<OutputFormatType, typeof FileText> = {
  markdown: FileText,
  mermaid: GitBranch,
  web: Globe,
};

export function OutputFormatButton() {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);

  const outputFormat = useOutputFormatStore((state) => state.outputFormat);
  const setOutputFormat = useOutputFormatStore((state) => state.setOutputFormat);

  const formatLabels = useMemo<Record<OutputFormatType, string>>(
    () => ({
      markdown: t.Chat.outputFormat.markdown,
      mermaid: t.Chat.outputFormat.mermaid,
      web: t.Chat.outputFormat.web,
    }),
    [t.Chat.outputFormat.markdown, t.Chat.outputFormat.mermaid, t.Chat.outputFormat.web]
  );

  const formatDescriptions = useMemo<Record<OutputFormatType, string>>(
    () => ({
      markdown: t.Chat.outputFormat.markdownDescription,
      mermaid: t.Chat.outputFormat.mermaidDescription,
      web: t.Chat.outputFormat.webDescription,
    }),
    [
      t.Chat.outputFormat.markdownDescription,
      t.Chat.outputFormat.mermaidDescription,
      t.Chat.outputFormat.webDescription,
    ]
  );

  const currentLabel = formatLabels[outputFormat];
  const formatDescription = formatDescriptions[outputFormat];

  const handleSelectFormat = (format: OutputFormatType) => {
    setOutputFormat(format);
    toast.success(t.Chat.outputFormat.switchSuccess);
    setOpen(false);
  };

  const CurrentIcon = FORMAT_ICON_MAP[outputFormat];

  return (
    <HoverCard>
      <Popover open={open} onOpenChange={setOpen}>
        <HoverCardTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 relative">
              <CurrentIcon className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
        </HoverCardTrigger>
        <HoverCardContent side="top" className="w-72">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <CurrentIcon className="h-4 w-4" />
              <h4 className="font-medium text-sm">{t.Chat.outputFormat.title}</h4>
            </div>
            <p className="text-xs text-muted-foreground">{formatDescription}</p>
            <p className="text-xs">
              <span className="text-muted-foreground">{t.Chat.outputFormat.currentFormat}: </span>
              <span className="font-medium">{currentLabel}</span>
            </p>
          </div>
        </HoverCardContent>

        <PopoverContent className="w-64 p-0" align="end">
          <div className="flex items-center justify-between px-3 py-2 border-b">
            <div className="font-semibold text-sm">{t.Chat.outputFormat.title}</div>
            <span className="text-xs text-muted-foreground">{currentLabel}</span>
          </div>

          <div className="p-1">
            {OUTPUT_FORMAT_OPTIONS.map((option) => {
              const Icon = FORMAT_ICON_MAP[option];
              const selected = outputFormat === option;
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => handleSelectFormat(option)}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
                    selected ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                  )}
                >
                  <div
                    className={cn(
                      'w-4 h-4 rounded-full border flex items-center justify-center flex-shrink-0',
                      selected
                        ? 'border-primary-foreground bg-primary-foreground'
                        : 'border-current opacity-50'
                    )}
                  >
                    {selected && <div className="w-2 h-2 rounded-full bg-primary" />}
                  </div>
                  <Icon className="h-4 w-4" />
                  <div className="flex-1 text-left">
                    <div className="font-medium">{formatLabels[option]}</div>
                    <div className="text-xs opacity-80">{formatDescriptions[option]}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
    </HoverCard>
  );
}
