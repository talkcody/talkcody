import { ListTodo } from 'lucide-react';
import { PromptInputButton } from '@/components/ai-elements/prompt-input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useLocale } from '@/hooks/use-locale';

interface QueueTaskButtonProps {
  disabled?: boolean;
  onClick: () => void;
}

export function QueueTaskButton({ disabled = false, onClick }: QueueTaskButtonProps) {
  const { t } = useLocale();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>
          <PromptInputButton disabled={disabled} onClick={onClick} variant="outline">
            <ListTodo className="size-4" />
            <span className="sr-only">{t.Chat.queue.tooltip}</span>
          </PromptInputButton>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">
        <p>{t.Chat.queue.tooltip}</p>
      </TooltipContent>
    </Tooltip>
  );
}
