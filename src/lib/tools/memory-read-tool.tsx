import { z } from 'zod';
import { GenericToolDoing } from '@/components/tools/generic-tool-doing';
import { GenericToolResult } from '@/components/tools/generic-tool-result';
import { createTool } from '@/lib/create-tool';
import { resolveMemoryWorkspaceRoot } from '@/lib/tools/memory-workspace-root';
import {
  type MemoryDocument,
  type MemoryScope,
  type MemorySearchResult,
  memoryService,
} from '@/services/memory/memory-service';

type MemoryReadSuccess = {
  success: true;
  mode: 'read' | 'search';
  scope: 'global' | 'project' | 'all';
  message: string;
  documents?: MemoryDocument[];
  results?: MemorySearchResult[];
};

type MemoryReadFailure = {
  success: false;
  message: string;
  error?: string;
  failureKind?: 'missing_project_context' | 'read_failed';
  allowScopeFallback?: boolean;
  suggestedAction?: 'ask_user_to_select_project' | 'report_error_to_user';
};

type MemoryReadResult = MemoryReadSuccess | MemoryReadFailure;

function renderDocument(document: MemoryDocument) {
  return (
    <div key={`${document.scope}-${document.path ?? 'none'}`} className="rounded border p-3">
      <div className="mb-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span className="font-medium uppercase tracking-wide">{document.scope}</span>
        <span className="truncate font-mono">{document.path ?? 'Unavailable'}</span>
      </div>
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-sm">
        {document.content || '(empty)'}
      </pre>
    </div>
  );
}

function renderSearchResult(result: MemorySearchResult, index: number) {
  const locationLabel = (() => {
    if (!result.path) {
      return 'Unavailable';
    }

    if (result.scope === 'project' && result.lineNumber) {
      return `${result.path} (memory line ${result.lineNumber})`;
    }

    return `${result.path}${result.lineNumber ? `:${result.lineNumber}` : ''}`;
  })();

  return (
    <div key={`${result.scope}-${result.lineNumber}-${index}`} className="rounded border p-3">
      <div className="mb-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span className="font-medium uppercase tracking-wide">{result.scope}</span>
        <span className="truncate font-mono">{locationLabel}</span>
      </div>
      <div className="text-sm">{result.snippet}</div>
    </div>
  );
}

export const memoryRead = createTool({
  name: 'memoryRead',
  description:
    "Read or search TalkCody long-term memory. Supports global memory, project memory, or both. Use this tool to inspect what is already stored, or to search for persisted preferences, repository facts, commands, conventions, and prior notes. Project memory is read from the root instruction file's Long-Term Memory section.",
  inputSchema: z.object({
    scope: z.enum(['global', 'project', 'all']).default('all'),
    query: z
      .string()
      .optional()
      .describe('Optional text query. If provided, performs text search instead of full read.'),
    max_results: z.number().min(1).max(20).optional(),
  }),
  canConcurrent: true,
  execute: async ({ scope, query, max_results }, context): Promise<MemoryReadResult> => {
    const workspaceRoot = await resolveMemoryWorkspaceRoot(context.taskId);

    if (scope === 'project' && !workspaceRoot) {
      return {
        success: false,
        message:
          'Project memory is unavailable because there is no active project or workspace root. Do not retry this read against global memory; ask the user to open or select a project first.',
        error: 'Workspace root is missing.',
        failureKind: 'missing_project_context',
        allowScopeFallback: false,
        suggestedAction: 'ask_user_to_select_project',
      };
    }

    try {
      if (query?.trim()) {
        const scopes: MemoryScope[] | undefined = scope === 'all' ? ['global', 'project'] : [scope];
        const results = await memoryService.search(query, {
          workspaceRoot,
          taskId: context.taskId,
          scopes,
          maxResults: max_results,
        });
        return {
          success: true,
          mode: 'search',
          scope,
          message:
            results.length > 0
              ? `Found ${results.length} memory matches for "${query.trim()}".`
              : `No memory matches found for "${query.trim()}".`,
          results,
        };
      }

      const documents =
        scope === 'all'
          ? await Promise.all([
              memoryService.getGlobalDocument(),
              memoryService.getProjectMemoryDocument(workspaceRoot),
            ])
          : await memoryService.read(scope, {
              workspaceRoot,
              taskId: context.taskId,
            });
      const nonEmptyCount = documents.filter(
        (document) => document.content.trim().length > 0
      ).length;
      return {
        success: true,
        mode: 'read',
        scope,
        message:
          nonEmptyCount > 0
            ? `Loaded ${nonEmptyCount} memory document${nonEmptyCount === 1 ? '' : 's'}.`
            : 'All requested memory documents are currently empty.',
        documents,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message:
          scope === 'project'
            ? `Failed to read project memory: ${message}. Do not retry this read against global memory unless the user explicitly asks for global scope.`
            : `Failed to read memory: ${message}`,
        error: message,
        failureKind: 'read_failed',
        ...(scope === 'project'
          ? {
              allowScopeFallback: false,
              suggestedAction: 'report_error_to_user' as const,
            }
          : {}),
      };
    }
  },
  renderToolDoing: ({ scope, query }) => (
    <GenericToolDoing
      operation={query?.trim() ? 'search' : 'read'}
      target={scope}
      details={query?.trim() ? `Query: ${query.trim()}` : 'Reading memory scope'}
      type="memory"
    />
  ),
  renderToolResult: (result) => {
    if (!result.success) {
      return <GenericToolResult success={false} error={result.error || result.message} />;
    }

    return (
      <div className="space-y-3 rounded border bg-card p-4">
        <GenericToolResult success={true} message={result.message} />
        {result.mode === 'search' && result.results && result.results.length > 0 && (
          <div className="space-y-2">
            {result.results.map((item: MemorySearchResult, index: number) =>
              renderSearchResult(item, index)
            )}
          </div>
        )}
        {result.mode === 'read' && result.documents && (
          <div className="space-y-2">
            {result.documents.map((document: MemoryDocument) => renderDocument(document))}
          </div>
        )}
      </div>
    );
  },
});
