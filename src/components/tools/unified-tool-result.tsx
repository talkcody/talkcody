import { formatToolInputSummary as sharedFormatToolInputSummary } from '@talkcody/shared/utils';
import { Check, ChevronDown, ChevronRight, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { getAllToolsSync, getToolMetadata } from '@/lib/tools';
import { getRelativePath } from '@/services/repository-utils';
import { useFileChangesStore } from '@/stores/file-changes-store';
import { useRepositoryStore } from '@/stores/window-scoped-repository-store';
import { EditFileResult } from './edit-file-result';
import { WriteFileResult } from './write-file-result';

interface UnifiedToolResultProps {
  toolName: string;
  input: Record<string, unknown>;
  output?: unknown;
  isError?: boolean;
  children: React.ReactNode;
  taskId?: string;
  toolCallId?: string;
}

/**
 * Format tool input for display summary
 * Desktop wrapper that adds relative path conversion for file tools
 * Exported for use in persisting tool messages
 */
export function formatToolInputSummary(
  toolName: string,
  input: Record<string, unknown>,
  options?: {
    rootPath?: string;
    output?: unknown;
  }
): string {
  if (!input) return '';
  const { rootPath, output } = options || {};

  // For file tools, convert absolute paths to relative paths
  let processedInput = input;
  if (
    rootPath &&
    input.file_path &&
    typeof input.file_path === 'string' &&
    (toolName === 'readFile' || toolName === 'writeFile' || toolName === 'editFile')
  ) {
    processedInput = {
      ...input,
      file_path: getRelativePath(input.file_path, rootPath),
    };
  }

  // Use shared formatter (no sanitization for desktop)
  return sharedFormatToolInputSummary(toolName, processedInput, {
    output,
    sanitize: false,
  });
}

export function UnifiedToolResult({
  toolName,
  input,
  output,
  isError: explicitError,
  children,
  taskId,
  toolCallId,
}: UnifiedToolResultProps) {
  const shouldExpandByDefault = useMemo(() => {
    try {
      // Try to get tool from registry first
      const tools = getAllToolsSync();
      const tool = tools[toolName];
      if (tool?.showResultUIAlways) {
        return true;
      }
    } catch {
      // Tools not loaded yet, fall back to metadata
    }

    // Use metadata
    const metadata = getToolMetadata(toolName);
    return metadata.showResultUIAlways === true;
  }, [toolName]);

  const [isOpen, setIsOpen] = useState(shouldExpandByDefault);
  const rootPath = useRepositoryStore((state) => state.rootPath);

  // Determine if error based on explicit prop or output content
  const isError = useMemo(() => {
    if (explicitError !== undefined) {
      return explicitError;
    }
    if (!output || typeof output !== 'object') {
      return false;
    }

    const outputObj = output as Record<string, unknown>;

    // For bash tool: use 'success' field (error field contains stderr, not an error indicator)
    if ('success' in outputObj && typeof outputObj.success === 'boolean') {
      return !outputObj.success;
    }

    // For other tools: check for error indicators
    if ('status' in outputObj && outputObj.status === 'error') {
      return true;
    }
    if ('error' in outputObj && !!outputObj.error) {
      return true;
    }

    return false;
  }, [explicitError, output]);

  const inputSummary = useMemo(
    () => formatToolInputSummary(toolName, input, { rootPath: rootPath ?? undefined, output }),
    [toolName, input, rootPath, output]
  );

  const specializedContent = useMemo(() => {
    if (!isOpen) {
      return null;
    }

    const filePath = typeof input.file_path === 'string' ? input.file_path : undefined;
    const content = typeof input.content === 'string' ? input.content : undefined;

    // For writeFile: get content from input
    if (toolName === 'writeFile' && filePath && content) {
      return <WriteFileResult filePath={filePath} content={content} />;
    }

    // For editFile: get diff from file-changes-store
    if (toolName === 'editFile' && filePath && taskId) {
      const changes = useFileChangesStore.getState().getChanges(taskId);
      const fileChange = toolCallId
        ? changes.find((c) => c.toolId === toolCallId)
        : changes.find((c) => c.filePath === filePath);

      if (fileChange?.originalContent && fileChange?.newContent) {
        return (
          <EditFileResult
            filePath={filePath}
            originalContent={fileChange.originalContent}
            newContent={fileChange.newContent}
          />
        );
      }
    }

    return null;
  }, [isOpen, input, toolName, taskId, toolCallId]);

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      className="w-full border rounded-md bg-card text-card-foreground shadow-sm mb-1"
    >
      <CollapsibleTrigger className="flex items-center w-full p-1 hover:bg-muted/50 transition-colors text-left">
        <div className="mr-2 flex-shrink-0">
          {isError ? (
            <X className="h-4 w-4 text-red-500" />
          ) : (
            <Check className="h-4 w-4 text-green-500" />
          )}
        </div>
        <div className="font-medium mr-2 flex-shrink-0">{toolName}</div>
        <div className="text-muted-foreground flex-1 font-mono text-xs break-all overflow-hidden line-clamp-2">
          {inputSummary}
        </div>
        <div className="ml-2 flex-shrink-0">
          {isOpen ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t bg-muted/20 p-2 overflow-x-auto">
        <div className="text-sm">{specializedContent || children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}
