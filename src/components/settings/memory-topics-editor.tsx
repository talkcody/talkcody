import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { MemoryDocument, MemoryScope } from '@/services/memory/memory-service';
import type { MemorySettingsCopy } from './memory-settings-copy';

type MemoryTopicsEditorProps = {
  scope: MemoryScope;
  topics: MemoryDocument[];
  selectedTopicOriginalName: string | null;
  topicEditorName: string;
  topicEditorContent: string;
  onCreateTopic: () => void;
  onSelectTopic: (scope: MemoryScope, topic: MemoryDocument) => void;
  onTopicNameChange: (value: string) => void;
  onTopicContentChange: (value: string) => void;
  onSaveTopic: () => void;
  onDeleteTopic: () => void;
  onRefresh: () => void;
  copy: MemorySettingsCopy;
  disabled: boolean;
  isSaving: boolean;
  showProjectUnavailable: boolean;
};

export function MemoryTopicsEditor({
  scope,
  topics,
  selectedTopicOriginalName,
  topicEditorName,
  topicEditorContent,
  onCreateTopic,
  onSelectTopic,
  onTopicNameChange,
  onTopicContentChange,
  onSaveTopic,
  onDeleteTopic,
  onRefresh,
  copy,
  disabled,
  isSaving,
  showProjectUnavailable,
}: MemoryTopicsEditorProps) {
  if (showProjectUnavailable) {
    return <p className="text-sm text-muted-foreground">{copy.projectUnavailable}</p>;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
      <div className="space-y-2 rounded-md border p-3">
        <Button variant="outline" className="w-full" onClick={onCreateTopic} disabled={disabled}>
          {copy.newTopicAction}
        </Button>
        <div className="space-y-2">
          {topics.map((topic) => (
            <Button
              key={topic.fileName ?? topic.path ?? 'topic'}
              variant={selectedTopicOriginalName === topic.fileName ? 'default' : 'ghost'}
              className="w-full justify-start font-mono text-xs"
              onClick={() => onSelectTopic(scope, topic)}
              disabled={disabled}
            >
              {topic.fileName}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="memory-topic-name">{copy.topicFileName}</Label>
          <Input
            id="memory-topic-name"
            value={topicEditorName}
            onChange={(event) => onTopicNameChange(event.target.value)}
            placeholder={copy.topicPlaceholder}
            disabled={disabled}
          />
        </div>
        <Textarea
          value={topicEditorContent}
          onChange={(event) => onTopicContentChange(event.target.value)}
          className="min-h-[240px] font-mono text-sm"
          disabled={disabled}
          placeholder={copy.topicEditorPlaceholder}
        />
        <div className="flex flex-wrap gap-2">
          <Button onClick={onSaveTopic} disabled={disabled}>
            {isSaving ? copy.savingAction : copy.saveAction}
          </Button>
          <Button variant="outline" onClick={onDeleteTopic} disabled={disabled}>
            {copy.deleteAction}
          </Button>
          <Button variant="outline" onClick={onRefresh} disabled={disabled}>
            <RefreshCw className="mr-2 h-4 w-4" />
            {copy.refreshAction}
          </Button>
        </div>
        {!topicEditorName && !topicEditorContent && (
          <p className="text-sm text-muted-foreground">{copy.selectTopic}</p>
        )}
      </div>
    </div>
  );
}
