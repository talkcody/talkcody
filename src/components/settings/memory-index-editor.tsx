import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { MemorySettingsCopy } from './memory-settings-copy';

type MemoryIndexEditorProps = {
  title: string;
  description: string;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onRefresh: () => void;
  copy: MemorySettingsCopy;
  disabled: boolean;
  isSaving: boolean;
  showProjectUnavailable: boolean;
};

export function MemoryIndexEditor({
  title,
  description,
  value,
  onChange,
  onSave,
  onRefresh,
  copy,
  disabled,
  isSaving,
  showProjectUnavailable,
}: MemoryIndexEditorProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label className="text-sm font-medium">{title}</Label>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <Textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-[240px] font-mono text-sm"
        disabled={disabled}
        placeholder={copy.indexEditorPlaceholder}
      />
      <div className="flex flex-wrap gap-2">
        <Button onClick={onSave} disabled={disabled}>
          {isSaving ? copy.savingAction : copy.saveAction}
        </Button>
        <Button variant="outline" onClick={onRefresh} disabled={disabled && !isSaving}>
          <RefreshCw className="mr-2 h-4 w-4" />
          {copy.refreshAction}
        </Button>
      </div>
      {showProjectUnavailable && (
        <p className="text-sm text-muted-foreground">{copy.projectUnavailable}</p>
      )}
    </div>
  );
}
