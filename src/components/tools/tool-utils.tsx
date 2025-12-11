import { Wrench } from 'lucide-react';
import type { UIMessage } from '@/types/agent';

const MAX_TOOL_DETAIL_LENGTH = 100;

/**
 * Helper function to format tool details based on tool type
 */
export function formatToolDetails(toolName: string, input?: Record<string, unknown>): string {
  if (!input) return '';

  const truncate = (text: string, maxLength: number = MAX_TOOL_DETAIL_LENGTH) => {
    if (text.length <= maxLength) return text;
    return `${text.substring(0, maxLength)}...`;
  };

  // Extract relevant details based on tool name
  switch (toolName) {
    case 'read-file':
      return input.file_path ? truncate(String(input.file_path)) : '';

    case 'GrepTool':
      return input.pattern ? `"${truncate(String(input.pattern))}"` : '';

    case 'write-file':
    case 'edit-file':
      return input.file_path ? truncate(String(input.file_path)) : '';

    case 'list-files':
    case 'glob':
      return input.path
        ? truncate(String(input.path))
        : input.pattern
          ? truncate(String(input.pattern))
          : '';

    case 'bash':
      return input.command ? truncate(String(input.command)) : '';

    case 'todo-write':
      if (input.todos && Array.isArray(input.todos)) {
        return `${input.todos.length} task${input.todos.length !== 1 ? 's' : ''}`;
      }
      return '';

    case 'callAgent':
    case 'callAgentV2':
      if (input.agentId) {
        const agentInfo = `agent: ${String(input.agentId)}`;
        if (input.task) {
          return `${agentInfo}, task: ${truncate(String(input.task), 30)}`;
        }
        return agentInfo;
      }
      return input.task ? truncate(String(input.task), 40) : '';

    case 'tavily-search':
    case 'jina-crawl':
    case 'web-fetch':
      return input.query
        ? truncate(String(input.query))
        : input.url
          ? truncate(String(input.url))
          : '';

    default: {
      // For unknown tools, try to find the first meaningful property
      const meaningfulKeys = ['path', 'file_path', 'query', 'pattern', 'command', 'url', 'task'];
      for (const key of meaningfulKeys) {
        if (input[key]) {
          return truncate(String(input[key]));
        }
      }

      // If nothing found, return empty string
      return '';
    }
  }
}

/**
 * Render nested tools with consistent styling
 */
export function renderNestedToolsList(
  nestedTools: UIMessage[],
  options?: {
    pendingColor?: string;
    completedColor?: string;
  }
) {
  if (nestedTools.length === 0) return null;

  const pendingColor = options?.pendingColor || 'purple';
  const completedColor = options?.completedColor || 'green';

  // Collect all tool-call messages
  const toolCalls = nestedTools.filter(
    (msg) =>
      msg.role === 'tool' &&
      Array.isArray(msg.content) &&
      msg.content.some((c) => c.type === 'tool-call')
  );

  // Collect all tool-result messages
  const toolResults = nestedTools.filter(
    (msg) => msg.role === 'tool' && Array.isArray(msg.content)
  );

  // Get set of completed tool call IDs
  const resultToolCallIds = new Set(
    toolResults.flatMap((msg) =>
      Array.isArray(msg.content) ? msg.content.map((c) => c.toolCallId) : []
    )
  );

  return (
    <div className="border rounded-lg p-3 bg-white dark:bg-gray-900 dark:border-gray-700 w-full">
      <div className="flex items-center gap-2 text-gray-700 border-b pb-2 dark:text-gray-300 dark:border-gray-600">
        <Wrench className="h-4 w-4" />
        <span className="text-sm font-medium">Agent is using tools:</span>
      </div>
      <div className="space-y-1 mt-2">
        {toolCalls.map((msg) => {
          const toolCall = Array.isArray(msg.content)
            ? msg.content.find((c) => c.type === 'tool-call')
            : null;
          if (!toolCall) return null;

          const isCompleted = resultToolCallIds.has(toolCall.toolCallId);
          const toolDetails = formatToolDetails(toolCall.toolName, toolCall.input);

          return (
            <div key={toolCall.toolCallId} className="flex items-start gap-2">
              <Wrench
                className={`h-3 w-3 flex-shrink-0 mt-0.5 ${
                  isCompleted ? `text-${completedColor}-500` : `text-${pendingColor}-500`
                }`}
              />
              <div
                className={`text-xs flex-1 ${
                  isCompleted
                    ? `text-${completedColor}-600 dark:text-${completedColor}-400`
                    : `text-${pendingColor}-600 dark:text-${pendingColor}-400`
                }`}
              >
                <span className="font-medium">{toolCall.toolName}</span>
                {toolDetails && (
                  <>
                    <span className="mx-1">:</span>
                    <span className="text-gray-600 dark:text-gray-400">{toolDetails}</span>
                  </>
                )}
                <span className="ml-1">{isCompleted ? '✓' : '...'}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
