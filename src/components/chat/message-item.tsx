// src/components/chat/message-item.tsx

import { Check, CopyIcon, RefreshCcwIcon, Trash2 } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { FilePreview } from '@/components/chat/file-preview';
import { ToolErrorBoundary } from '@/components/tools/tool-error-boundary';
import { ToolErrorFallback } from '@/components/tools/tool-error-fallback';
import { UnifiedToolResult } from '@/components/tools/unified-tool-result';
import { logger } from '@/lib/logger';
import { getToolUIRenderers } from '@/lib/tool-adapter';
import type { StoredToolCall, StoredToolContent } from '@/types';
import type { ToolMessageContent, UIMessage } from '@/types/agent';
import type { OutputFormatType } from '@/types/output-format';
import { Action, Actions } from '../ai-elements/actions';
import MyMarkdown from './my-markdown';
import { WebContentRenderer } from './web-content-renderer';

/**
 * Check if a tool content item is a stored/historical tool-call message
 */
function isStoredToolCall(item: ToolMessageContent | StoredToolContent): item is StoredToolCall {
  return 'type' in item && item.type === 'tool-call' && !('output' in item) && !('input' in item);
}

export interface MessageItemProps {
  message: UIMessage;
  isLastAssistantInTurn?: boolean;
  onRegenerate?: (messageId: string) => void;
  onDelete?: (messageId: string) => void;
}

function MessageItemComponent({
  message,
  isLastAssistantInTurn,
  onRegenerate,
  onDelete,
}: MessageItemProps) {
  const [hasCopied, setHasCopied] = useState(false);

  useEffect(() => {
    if (hasCopied) {
      const timer = setTimeout(() => {
        setHasCopied(false);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [hasCopied]);

  const handleCopy = useCallback(() => {
    const content =
      typeof message.content === 'string'
        ? message.content
        : JSON.stringify(message.content, null, 2);
    navigator.clipboard.writeText(content);
    setHasCopied(true);
  }, [message.content]);

  const handleRegenerate = useCallback(() => {
    if (onRegenerate) {
      onRegenerate(message.id);
    }
  }, [onRegenerate, message.id]);

  const handleDelete = useCallback(() => {
    if (onDelete) {
      onDelete(message.id);
    }
  }, [onDelete, message.id]);

  // Render tool message content
  const toolMessageNodes = useMemo(() => {
    if (message.role !== 'tool' || !Array.isArray(message.content)) {
      return null;
    }

    const content = message.content;
    return content.map((item, _index) => {
      // Handle historical/stored tool-call messages (from DB)
      if (isStoredToolCall(item)) {
        const uniqueKey = `${item.toolCallId}-${item.type}-stored-call`;
        return (
          <div
            key={uniqueKey}
            className="w-full border rounded-md bg-card text-card-foreground shadow-sm my-0.5"
          >
            <div className="flex items-center w-full p-2">
              <div className="mr-2 flex-shrink-0">
                <Check className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="font-medium mr-2 flex-shrink-0">{item.toolName}</div>
              <div className="text-muted-foreground flex-1 font-mono text-xs">Tool called</div>
            </div>
          </div>
        );
      }

      const isCallAgent = item.toolName === 'callAgent';
      const toolRenderers = getToolUIRenderers(item.toolName);
      // Generate unique key using toolCallId and type
      const uniqueKey = `${item.toolCallId}-${item.type}`;

      if (!toolRenderers) {
        const unifiedInput =
          item.input || (item.output as { _input?: Record<string, unknown> })?._input || {};

        return (
          <div key={uniqueKey} className="w-full">
            {item.type === 'tool-call' ? (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900 w-full overflow-hidden">
                <div className="font-medium text-gray-800 dark:text-gray-200">
                  Calling Tool: {item.toolName}
                </div>
                {item.input && (
                  <div className="mt-2 text-sm text-gray-600 dark:text-gray-400 break-words">
                    Input: {JSON.stringify(item.input, null, 2)}
                  </div>
                )}
              </div>
            ) : (
              <UnifiedToolResult
                toolName={item.toolName}
                input={unifiedInput}
                output={item.output}
                taskId={message.taskId}
                toolCallId={item.toolCallId}
              >
                {item.output ? (
                  <div className="text-sm text-gray-600 dark:text-gray-400">
                    <pre className="overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words max-h-60">
                      Output:{' '}
                      {
                        (() => {
                          try {
                            return JSON.stringify(item.output, null, 2);
                          } catch {
                            return String(item.output);
                          }
                        })() as React.ReactNode
                      }
                    </pre>
                  </div>
                ) : (
                  <div className="text-sm text-gray-500 italic">No output</div>
                )}
              </UnifiedToolResult>
            )}
          </div>
        );
      }

      // Use the tool's UI components with error boundary protection
      if (item.type === 'tool-call' && message.renderDoingUI) {
        try {
          // Filter nested tools to only include those that belong to this specific tool call
          const filteredNestedTools = (message.nestedTools || []).filter((nestedMsg) => {
            // Check if this nested message's parentToolCallId matches the current tool call
            const matches = nestedMsg.parentToolCallId === item.toolCallId;
            return matches;
          });

          // Pass nestedTools and toolCallId to the doing component
          const inputWithExtras = {
            ...item.input,
            nestedTools: filteredNestedTools,
            _toolCallId: item.toolCallId,
          };

          // Pass context with taskId for tools that need execution context (e.g., exitPlanMode)
          const doingComponent = toolRenderers.renderToolDoing(inputWithExtras, {
            taskId: message.taskId,
          });

          return (
            <ToolErrorBoundary key={uniqueKey} toolName={item.toolName}>
              {doingComponent}
            </ToolErrorBoundary>
          );
        } catch (error) {
          logger.error(
            `[MessageItem-Render] ❌ Error rendering tool-call${isCallAgent ? ' [CALL-AGENT]' : ''}`,
            {
              toolName: item.toolName,
              toolCallId: item.toolCallId,
              error: error instanceof Error ? error.message : String(error),
            }
          );
          return (
            <ToolErrorBoundary
              key={uniqueKey}
              toolName={item.toolName}
              fallback={
                <ToolErrorFallback
                  toolName={item.toolName}
                  errorType="call"
                  error={error instanceof Error ? error : new Error('Unknown error')}
                  input={item.input}
                />
              }
            >
              <div className="animate-pulse">
                <ToolErrorFallback
                  toolName={item.toolName}
                  errorType="call"
                  error={error instanceof Error ? error : new Error('Unknown error')}
                  input={item.input}
                />
              </div>
            </ToolErrorBoundary>
          );
        }
      } else if (item.type === 'tool-result') {
        const input =
          item.input ||
          (item.output as { _input?: Record<string, unknown> })?._input ||
          ({} as Record<string, unknown>); // Get input from either location, fallback to empty object

        try {
          const resultComponent = toolRenderers.renderToolResult(item.output, input);

          // Special case: imageGeneration displays directly without UnifiedToolResult wrapper
          if (item.toolName === 'imageGeneration') {
            return (
              <ToolErrorBoundary key={uniqueKey} toolName={item.toolName}>
                {resultComponent}
              </ToolErrorBoundary>
            );
          }

          return (
            <ToolErrorBoundary key={uniqueKey} toolName={item.toolName}>
              <UnifiedToolResult
                toolName={item.toolName}
                input={input}
                output={item.output}
                taskId={message.taskId}
                toolCallId={item.toolCallId}
              >
                {resultComponent}
              </UnifiedToolResult>
            </ToolErrorBoundary>
          );
        } catch (error) {
          logger.error(
            `[MessageItem-Render] ❌ Error rendering tool-result${isCallAgent ? ' [CALL-AGENT]' : ''}`,
            {
              toolName: item.toolName,
              toolCallId: item.toolCallId,
              error: error instanceof Error ? error.message : String(error),
            }
          );
          return (
            <ToolErrorBoundary
              key={uniqueKey}
              toolName={item.toolName}
              fallback={
                <ToolErrorFallback
                  toolName={item.toolName}
                  errorType="result"
                  error={error instanceof Error ? error : new Error('Unknown error')}
                  output={item.output}
                  input={input as Record<string, unknown>}
                />
              }
            >
              <ToolErrorFallback
                toolName={item.toolName}
                errorType="result"
                error={error instanceof Error ? error : new Error('Unknown error')}
                output={item.output}
                input={input as Record<string, unknown>}
              />
            </ToolErrorBoundary>
          );
        }
      }

      return null;
    });
  }, [message, message.content, message.role, message.renderDoingUI]);

  const outputFormat = (message.outputFormat || 'markdown') as OutputFormatType;
  const assistantContentClass =
    outputFormat === 'web'
      ? 'w-full max-w-none'
      : 'prose prose-neutral dark:prose-invert w-full max-w-none';
  const assistantText = typeof message.content === 'string' ? message.content : '';
  const mermaidContent = assistantText.trim().startsWith('```mermaid')
    ? assistantText
    : `\n\n\`\`\`mermaid\n${assistantText}\n\`\`\`\n\n`;

  const assistantContent =
    outputFormat === 'web' ? (
      <WebContentRenderer content={assistantText} />
    ) : outputFormat === 'mermaid' ? (
      <MyMarkdown content={mermaidContent} />
    ) : (
      <MyMarkdown content={assistantText} />
    );

  return (
    <div className={'flex w-full min-w-0 gap-1'}>
      <div className={'w-full min-w-0 rounded-lg'}>
        <div className="relative w-full min-w-0 break-words">
          {message.role === 'user' && typeof message.content === 'string' && (
            <div className="relative my-2 flex w-full items-start rounded-xl border border-border bg-muted/50 p-4 transition-colors hover:bg-muted/80">
              <h2
                className={'whitespace-pre-wrap break-words font-normal text-foreground text-sm'}
                dir="auto"
              >
                {message.content}
              </h2>
            </div>
          )}
          {message.role === 'assistant' && typeof message.content === 'string' && (
            <div className={assistantContentClass}>{assistantContent}</div>
          )}
          {message.role === 'tool' && Array.isArray(message.content) && (
            <div className="w-full min-w-0">{toolMessageNodes}</div>
          )}
        </div>

        {message.attachments && message.attachments.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {message.attachments.map((attachment) => (
              <FilePreview attachment={attachment} key={attachment.id} showRemove={false} />
            ))}
          </div>
        )}

        {!message.isStreaming &&
          message.role !== 'tool' &&
          typeof message.content === 'string' &&
          (message.role === 'user' || isLastAssistantInTurn) && (
            <Actions className="mt-2">
              <Action label={hasCopied ? 'Copied' : 'Copy'} onClick={handleCopy}>
                {hasCopied ? (
                  <Check className="size-4 text-green-500" />
                ) : (
                  <CopyIcon className="size-4" />
                )}
              </Action>
              <Action label="Retry" onClick={handleRegenerate}>
                <RefreshCcwIcon className="size-4" />
              </Action>
              <Action label="Delete" onClick={handleDelete}>
                <Trash2 className="size-4" />
              </Action>
            </Actions>
          )}
      </div>
    </div>
  );
}

// Memoized component to prevent unnecessary re-renders during streaming
// - Streaming messages: only re-render when content length changes
// - Completed messages: re-render only when relevant fields change
export const MessageItem = memo(MessageItemComponent, (prevProps, nextProps) => {
  const prevMessage = prevProps.message;
  const nextMessage = nextProps.message;

  if (prevMessage.id !== nextMessage.id) {
    return false;
  }

  if (prevMessage.isStreaming || nextMessage.isStreaming) {
    const prevLen = typeof prevMessage.content === 'string' ? prevMessage.content.length : 0;
    const nextLen = typeof nextMessage.content === 'string' ? nextMessage.content.length : 0;
    return (
      prevLen === nextLen &&
      prevMessage.renderDoingUI === nextMessage.renderDoingUI &&
      prevMessage.outputFormat === nextMessage.outputFormat
    );
  }

  if (prevProps.isLastAssistantInTurn !== nextProps.isLastAssistantInTurn) {
    return false;
  }

  if (prevMessage.renderDoingUI !== nextMessage.renderDoingUI) {
    return false;
  }

  if (prevMessage.role !== nextMessage.role) {
    return false;
  }

  if (prevMessage.attachments?.length !== nextMessage.attachments?.length) {
    return false;
  }

  if (prevMessage.outputFormat !== nextMessage.outputFormat) {
    return false;
  }

  const prevLen = typeof prevMessage.content === 'string' ? prevMessage.content.length : 0;
  const nextLen = typeof nextMessage.content === 'string' ? nextMessage.content.length : 0;

  return prevLen === nextLen;
});
