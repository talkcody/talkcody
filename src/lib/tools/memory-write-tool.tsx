import { z } from 'zod';
import { GenericToolDoing } from '@/components/tools/generic-tool-doing';
import { GenericToolResult } from '@/components/tools/generic-tool-result';
import { createTool } from '@/lib/create-tool';
import { resolveMemoryWorkspaceRoot } from '@/lib/tools/memory-workspace-root';
import { memoryService } from '@/services/memory/memory-service';

type MemoryWriteResult = {
  success: boolean;
  message: string;
  scope?: 'global' | 'project';
  path?: string | null;
  content?: string;
  error?: string;
  failureKind?: 'missing_project_context' | 'project_write_failed' | 'write_failed';
  allowScopeFallback?: boolean;
  suggestedAction?: 'ask_user_to_select_project' | 'report_error_to_user';
};

export const memoryWrite = createTool({
  name: 'memoryWrite',
  description:
    'Write TalkCody long-term memory by appending or replacing stored content. Use scope="project" for repository-specific facts such as tech stack, architecture, commands, conventions, and workflows. Use scope="global" only for user-wide preferences that apply across projects. Keep entries concise and durable, and never retry a failed project write as global memory just because project context is missing.',
  inputSchema: z.object({
    scope: z.enum(['global', 'project']),
    mode: z.enum(['append', 'replace']).default('append'),
    content: z.string().min(1),
  }),
  canConcurrent: false,
  execute: async ({ scope, mode, content }, context): Promise<MemoryWriteResult> => {
    try {
      if (scope === 'global') {
        const document =
          mode === 'replace'
            ? await memoryService.writeGlobal(content)
            : await memoryService.appendGlobal(content);
        return {
          success: true,
          scope,
          path: document.path,
          content: document.content,
          message:
            mode === 'replace'
              ? `Replaced global memory at ${document.path}.`
              : `Appended to global memory at ${document.path}.`,
        };
      }

      const workspaceRoot = await resolveMemoryWorkspaceRoot(context.taskId);
      if (!workspaceRoot) {
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
        mode === 'replace'
          ? await memoryService.writeProjectMemoryDocument(workspaceRoot, content)
          : await memoryService.appendProjectMemoryDocument(workspaceRoot, content);
      return {
        success: true,
        scope,
        path: document.path,
        content: document.content,
        message:
          mode === 'replace'
            ? `Updated the Long-Term Memory section in ${document.path}.`
            : `Appended to the Long-Term Memory section in ${document.path}.`,
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
  renderToolDoing: ({ scope, mode }) => (
    <GenericToolDoing
      operation={mode === 'replace' ? 'edit' : 'write'}
      target={scope}
      details={mode === 'replace' ? 'Replacing memory content' : 'Appending memory content'}
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
      </div>
    );
  },
});
