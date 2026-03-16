import { z } from 'zod';
import { GenericToolDoing } from '@/components/tools/generic-tool-doing';
import { GenericToolResult } from '@/components/tools/generic-tool-result';
import { createTool } from '@/lib/create-tool';
import { resolveMemoryContext } from '@/lib/tools/memory-workspace-root';
import { buildMemoryWriteGuidance } from '@/services/memory/memory-guidance';
import { memoryService } from '@/services/memory/memory-service';

type MemoryWriteResult = {
  success: boolean;
  message: string;
  scope?: 'global' | 'project';
  path?: string | null;
  content?: string;
  guidance?: string[];
  error?: string;
  failureKind?: 'missing_project_context' | 'project_write_failed' | 'write_failed';
  allowScopeFallback?: boolean;
  suggestedAction?: 'ask_user_to_select_project' | 'report_error_to_user';
};

export const memoryWrite = createTool({
  name: 'memoryWrite',
  description:
    'Write TalkCody auto memory by appending or replacing either a scope MEMORY.md index or a markdown topic file. Use target="index" to edit MEMORY.md and target="topic" with file_name to edit one concrete topic file. Split topic files by stable subject and retrieval purpose: update an existing topic when the memory belongs to the same long-term subject, and create a new topic only when it represents a distinct long-term theme. Use scope="project" for repository-specific facts such as tech stack, architecture, commands, conventions, and workflows. Use scope="global" only for user-wide preferences that apply across projects. Keep entries concise and durable, keep MEMORY.md aligned with topic files, and never retry a failed project write as global memory just because project context is missing.',
  inputSchema: z.object({
    scope: z
      .enum(['global', 'project'])
      .describe('Use project for repo-specific memory. Use global only for user-wide preferences.'),
    mode: z
      .enum(['append', 'replace'])
      .default('append')
      .describe(
        'Use append for incremental notes. For MEMORY.md, prefer replace when rewriting or revising existing routes.'
      ),
    target: z
      .enum(['index', 'topic'])
      .default('index')
      .describe(
        'Use index for MEMORY.md or topic for one specific markdown topic file. Prefer updating an existing topic when the memory belongs to the same stable subject.'
      ),
    file_name: z
      .string()
      .optional()
      .describe(
        'Required when target="topic". Must be a markdown file name such as user.md or architecture.md. Reuse an existing topic file when the new memory belongs to the same long-term subject.'
      ),
    content: z.string().min(1),
  }),
  canConcurrent: false,
  execute: async (
    { scope, mode, target, file_name, content },
    context
  ): Promise<MemoryWriteResult> => {
    if (target === 'topic' && !file_name?.trim()) {
      return {
        success: false,
        message:
          'Writing a topic file requires file_name. Choose the exact markdown topic file to update, then call memoryWrite again with target="topic" and that file_name.',
        error: 'file_name is required when target="topic".',
        failureKind: 'write_failed',
      };
    }

    try {
      if (scope === 'global') {
        const globalContext = { scope: 'global' } as const;
        const document =
          target === 'topic'
            ? mode === 'replace'
              ? await memoryService.saveTopic(globalContext, file_name || '', content)
              : await memoryService.appendTopic(globalContext, file_name || '', content)
            : mode === 'replace'
              ? await memoryService.saveIndex(globalContext, content)
              : await memoryService.appendIndex(globalContext, content);
        return {
          success: true,
          scope,
          path: document.path,
          content: document.content,
          guidance: buildMemoryWriteGuidance(target),
          message:
            target === 'topic'
              ? mode === 'replace'
                ? `Replaced global topic memory at ${document.path}.`
                : `Appended to global topic memory at ${document.path}.`
              : mode === 'replace'
                ? `Replaced global MEMORY.md at ${document.path}.`
                : `Appended to global MEMORY.md at ${document.path}.`,
        };
      }

      const projectContext = await resolveMemoryContext('project', context.taskId);
      if (!projectContext) {
        return {
          success: false,
          message:
            'Project memory is unavailable because there is no active project or workspace root. Do not retry this write as global memory; ask the user to open or select a project first.',
          error: 'Workspace root is missing.',
          failureKind: 'missing_project_context',
          allowScopeFallback: false,
          suggestedAction: 'ask_user_to_select_project',
        };
      }

      const document =
        target === 'topic'
          ? mode === 'replace'
            ? await memoryService.saveTopic(projectContext, file_name || '', content)
            : await memoryService.appendTopic(projectContext, file_name || '', content)
          : mode === 'replace'
            ? await memoryService.saveIndex(projectContext, content)
            : await memoryService.appendIndex(projectContext, content);

      return {
        success: true,
        scope,
        path: document.path,
        content: document.content,
        guidance: buildMemoryWriteGuidance(target),
        message:
          target === 'topic'
            ? mode === 'replace'
              ? `Updated the project topic memory at ${document.path}.`
              : `Appended to the project topic memory at ${document.path}.`
            : mode === 'replace'
              ? `Updated the project MEMORY.md index at ${document.path}.`
              : `Appended to the project MEMORY.md index at ${document.path}.`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (scope === 'project') {
        return {
          success: false,
          message: `Failed to write project memory: ${message}. Do not retry this write as global memory unless the user explicitly asks for global scope.`,
          error: message,
          failureKind: 'project_write_failed',
          allowScopeFallback: false,
          suggestedAction: 'report_error_to_user',
        };
      }

      return {
        success: false,
        message: `Failed to write memory: ${message}`,
        error: message,
        failureKind: 'write_failed',
      };
    }
  },
  renderToolDoing: ({ scope, mode, target, file_name }) => (
    <GenericToolDoing
      operation={mode === 'replace' ? 'edit' : 'write'}
      target={target === 'topic' ? `${scope}:${file_name || 'topic'}` : scope}
      details={
        target === 'topic'
          ? mode === 'replace'
            ? 'Replacing topic memory content'
            : 'Appending topic memory content'
          : mode === 'replace'
            ? 'Replacing MEMORY.md content'
            : 'Appending MEMORY.md content'
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
        {result.path && (
          <div className="text-xs text-muted-foreground">
            <span className="font-medium uppercase tracking-wide">Path:</span>{' '}
            <span className="font-mono">{result.path}</span>
          </div>
        )}
        {result.content && (
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded border p-3 text-sm">
            {result.content}
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
