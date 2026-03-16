import { Badge } from '@/components/ui/badge';
import {
  MEMORY_INDEX_INJECTION_LINE_LIMIT,
  type MemoryWorkspaceAudit,
} from '@/services/memory/memory-service';
import type { MemorySettingsCopy } from './memory-settings-copy';

type MemoryAuditPanelProps = {
  audit: MemoryWorkspaceAudit | null;
  copy: MemorySettingsCopy;
};

export function MemoryAuditPanel({ audit, copy }: MemoryAuditPanelProps) {
  if (!audit) {
    return null;
  }

  const hasIssues = audit.missingTopicFiles.length > 0 || audit.unindexedTopicFiles.length > 0;

  return (
    <div className="space-y-3 rounded-md border p-4">
      <h4 className="text-sm font-medium">{copy.auditTitle}</h4>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={audit.overInjectionLimit ? 'destructive' : 'secondary'}>
          {copy.injectedLines}: {audit.injectedLineCount}/{MEMORY_INDEX_INJECTION_LINE_LIMIT}
        </Badge>
        <Badge variant={audit.missingTopicFiles.length > 0 ? 'destructive' : 'secondary'}>
          {copy.missingTopics}: {audit.missingTopicFiles.length}
        </Badge>
        <Badge variant={audit.unindexedTopicFiles.length > 0 ? 'destructive' : 'secondary'}>
          {copy.unindexedTopics}: {audit.unindexedTopicFiles.length}
        </Badge>
      </div>
      {!hasIssues && <p className="text-sm text-muted-foreground">{copy.allTopicsIndexed}</p>}
      {audit.missingTopicFiles.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {copy.missingTopics}: {audit.missingTopicFiles.join(', ')}
        </p>
      )}
      {audit.unindexedTopicFiles.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {copy.unindexedTopics}: {audit.unindexedTopicFiles.join(', ')}
        </p>
      )}
    </div>
  );
}
