import { z } from 'zod';
import { GenericToolDoing } from '@/components/tools/generic-tool-doing';
import { GenericToolResult } from '@/components/tools/generic-tool-result';
import { createTool } from '@/lib/create-tool';
import { resolveMemoryContext } from '@/lib/tools/memory-workspace-root';
import { buildMemoryReadGuidance } from '@/services/memory/memory-guidance';
import { type MemoryDocument, memoryService } from '@/services/memory/memory-service';
import type { MemoryContext } from '@/services/memory/memory-types';

type MemoryReadSuccess = {
  success: true;
  mode: 'read' | 'topics' | 'audit';
  scope: 'global' | 'project' | 'all';
  message: string;
  documents?: MemoryDocument[];
  audit?: Record<string, unknown>;
  guidance?: string[];
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

function getProjectContextOrPlaceholder(projectContext: MemoryContext | null): MemoryContext {
  return projectContext ?? { scope: 'project' };
}

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

export const memoryRead = createTool({
  name: 'memoryRead',
  description:
    'Read, list, or audit TalkCody auto memory. Supports global memory, project memory, or both. Use target="index" to read the full MEMORY.md file for a scope, target="topics" to discover which topic files exist, target="topic" with file_name to read one specific topic file, and target="audit" to inspect index/topic alignment. Do not assume a topic file\'s contents from MEMORY.md alone.',
  inputSchema: z.object({
    scope: z
      .enum(['global', 'project', 'all'])
      .default('all')
      .describe(
        'Which memory scope to inspect. Use "all" only when you intentionally want both global and project results.'
      ),
    target: z
      .enum(['index', 'topic', 'topics', 'audit'])
      .default('index')
      .describe(
        'Use "index" for MEMORY.md, "topics" to list topic files, "topic" to read one file by name, or "audit" for index/topic consistency checks.'
      ),
    file_name: z
      .string()
      .optional()
      .describe(
        'Required when target="topic". Must be a markdown file name such as user.md or architecture.md.'
      ),
  }),
  canConcurrent: true,
  execute: async ({ scope, target, file_name }, context): Promise<MemoryReadResult> => {
    if (target === 'topic' && !file_name?.trim()) {
      return {
        success: false,
        message:
          'Reading a topic file requires file_name. Read MEMORY.md or list topics first, then call memoryRead again with target="topic" and the exact markdown file name.',
        error: 'file_name is required when target="topic".',
        failureKind: 'read_failed',
      };
    }

    const projectContext =
      scope === 'global' ? null : await resolveMemoryContext('project', context.taskId);

    if (scope === 'project' && !projectContext) {
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

    const resolvedProjectContext = getProjectContextOrPlaceholder(projectContext);

    try {
      if (target === 'topics') {
        const documents =
          scope === 'all'
            ? [
                ...(await memoryService.listTopics({ scope: 'global' })),
                ...(await memoryService.listTopics(resolvedProjectContext)),
              ]
            : await memoryService.listTopics(
                scope === 'global' ? { scope: 'global' } : resolvedProjectContext
              );

        return {
          success: true,
          mode: 'topics',
          scope,
          message:
            documents.length > 0
              ? `Loaded ${documents.length} memory topic file${documents.length === 1 ? '' : 's'}.`
              : 'No memory topic files exist for the requested scope.',
          documents,
          guidance: buildMemoryReadGuidance('topics'),
        };
      }

      if (target === 'audit') {
        const audit =
          scope === 'all'
            ? {
                global: await memoryService.auditWorkspace({ scope: 'global' }),
                project: await memoryService.auditWorkspace(resolvedProjectContext),
              }
            : await memoryService.auditWorkspace(
                scope === 'global' ? { scope: 'global' } : resolvedProjectContext
              );

        return {
          success: true,
          mode: 'audit',
          scope,
          message: 'Loaded memory workspace audit signals.',
          audit: audit as Record<string, unknown>,
          guidance: buildMemoryReadGuidance('audit'),
        };
      }

      const documents =
        target === 'topic'
          ? scope === 'all'
            ? await Promise.all([
                memoryService.getTopic({ scope: 'global' }, file_name || ''),
                memoryService.getTopic(resolvedProjectContext, file_name || ''),
              ])
            : [
                await memoryService.getTopic(
                  scope === 'global' ? { scope: 'global' } : resolvedProjectContext,
                  file_name || ''
                ),
              ]
          : scope === 'all'
            ? await Promise.all([
                memoryService.getIndex({ scope: 'global' }),
                memoryService.getIndex(resolvedProjectContext),
              ])
            : [
                await memoryService.getIndex(
                  scope === 'global' ? { scope: 'global' } : resolvedProjectContext
                ),
              ];

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
        guidance: buildMemoryReadGuidance(target),
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
  renderToolDoing: ({ scope, target, file_name }) => (
    <GenericToolDoing
      operation="read"
      target={target === 'topic' ? `${scope}:${file_name || 'topic'}` : scope}
      details={
        target === 'topic'
          ? `Reading topic file ${file_name || ''}`
          : target === 'topics'
            ? 'Listing topic files'
            : target === 'audit'
              ? 'Auditing memory workspace'
              : 'Reading full MEMORY.md index'
      }
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
        {(result.mode === 'read' || result.mode === 'topics') && result.documents && (
          <div className="space-y-2">
            {result.documents.map((document: MemoryDocument) => renderDocument(document))}
          </div>
        )}
        {result.mode === 'audit' && result.audit && (
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded border p-3 text-sm">
            {JSON.stringify(result.audit, null, 2)}
          </pre>
        )}
        {result.guidance && result.guidance.length > 0 && (
          <div className="rounded border border-dashed p-3 text-sm text-muted-foreground">
            <div className="mb-2 font-medium text-foreground">Usage guidance</div>
            <ul className="space-y-1">
              {result.guidance.map((item: string) => (
                <li key={item}>- {item}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  },
});
