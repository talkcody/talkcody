// docs/components/share/share-message-item.tsx
// Message item component for shared conversations

'use client';

import { Bot, Check, ChevronDown, ChevronRight, User, Wrench, X } from 'lucide-react';
import { memo, useState, type ReactNode } from 'react';
import type { ShareMessage, ShareToolContent } from '@/types/share';
import {
  isCodeSearchOutput,
  isEditFileOutput,
  isReadFileOutput,
  isTodoWriteOutput,
  isWriteFileOutput,
} from '@/types/share-tools';
import { ShareMarkdown } from './share-markdown';
import { ShareCodeSearchResult } from './tools/share-code-search-result';
import { ShareEditFileResult } from './tools/share-edit-file-result';
import { ShareReadFileResult } from './tools/share-read-file-result';
import { ShareTodoWriteResult } from './tools/share-todo-write-result';
import { ShareWriteFileResult } from './tools/share-write-file-result';

interface ShareMessageItemProps {
  message: ShareMessage;
}

function ShareMessageItemComponent({ message }: ShareMessageItemProps): ReactNode {
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({});

  const isUser = message.role === 'user';
  const isTool = message.role === 'tool';

  const toggleToolExpansion = (toolCallId: string): void => {
    setExpandedTools((prev) => ({
      ...prev,
      [toolCallId]: !prev[toolCallId],
    }));
  };

  // Format timestamp
  const formatTime = (timestamp: number): string => {
    return new Date(timestamp).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Render tool output with specialized components
  const renderToolOutput = (item: ShareToolContent): ReactNode => {
    const { toolName, output } = item;

    // Use specialized renderers based on tool type
    if (toolName === 'readFile' && isReadFileOutput(output)) {
      return <ShareReadFileResult output={output} />;
    }

    if (toolName === 'writeFile' && isWriteFileOutput(output)) {
      return <ShareWriteFileResult output={output} />;
    }

    if (toolName === 'editFile' && isEditFileOutput(output)) {
      return <ShareEditFileResult output={output} />;
    }

    if (toolName === 'todoWrite' && isTodoWriteOutput(output)) {
      return <ShareTodoWriteResult output={output} />;
    }

    if (toolName === 'codeSearch' && isCodeSearchOutput(output)) {
      return <ShareCodeSearchResult output={output} />;
    }

    // Fallback to generic output display
    return (
      <div className="p-4">
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words text-sm text-gray-700 dark:text-gray-300">
          {typeof output === 'string' ? output : JSON.stringify(output, null, 2)}
        </pre>
      </div>
    );
  };

  // Render tool content
  const renderToolContent = (content: ShareToolContent[]): ReactNode => {
    // Only show tool results, not tool calls
    const results = content.filter((item) => item.type === 'tool-result');

    return results.map((item): ReactNode => {
      const isExpanded = Boolean(expandedTools[item.toolCallId]);
      const summaryText: string = item.summary ?? '';

      // Detect error status from output
      const isError = (() => {
        if (!item.output || typeof item.output !== 'object') {
          return false;
        }
        const outputObj = item.output as Record<string, unknown>;
        // For bash tool: use 'success' field
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
      })();

      return (
        <div
          key={item.toolCallId}
          className="my-2 overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
        >
          {/* Tool header */}
          <button
            onClick={() => toggleToolExpansion(item.toolCallId)}
            className="flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-700"
            type="button"
          >
            {/* Success/Error icon */}
            {isError ? (
              <X className="h-4 w-4 text-red-500" />
            ) : (
              <Check className="h-4 w-4 text-green-500" />
            )}
            <span className="font-medium text-gray-900 dark:text-gray-100">
              {String(item.toolName)}
            </span>
            {summaryText.length > 0 ? (
              <span className="font-mono text-xs text-gray-500 dark:text-gray-400 flex-1 overflow-hidden text-ellipsis">
                {summaryText}
              </span>
            ) : null}
            {/* Chevron icon on the right */}
            {isExpanded ? (
              <ChevronDown className="h-4 w-4 text-gray-500 flex-shrink-0" />
            ) : (
              <ChevronRight className="h-4 w-4 text-gray-500 flex-shrink-0" />
            )}
          </button>

          {/* Tool details (expanded) */}
          {isExpanded && item.output ? (
            <div className="border-t border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900">
              {renderToolOutput(item)}
            </div>
          ) : null}
        </div>
      );
    });
  };

  // Avatar background class
  const avatarBgClass = isUser
    ? 'bg-blue-600 text-white'
    : isTool
      ? 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
      : 'bg-emerald-600 text-white';

  // Avatar icon or image
  const AvatarIcon = isUser ? User : isTool ? Wrench : null;
  const showLogoImage = !isUser && !isTool;

  // Message content
  const messageContent: ReactNode = typeof message.content === 'string' ? (
    isUser ? (
      <div className="relative my-2 flex w-full items-start rounded-xl border border-gray-700 bg-muted/50 p-4 transition-colors hover:bg-muted/80">
        <h2
          className={'whitespace-pre-wrap break-words font-normal text-foreground text-sm'}
          dir="auto"
        >
          {message.content}
        </h2>
      </div>
    ) : (
      <ShareMarkdown content={message.content} />
    )
  ) : (
    renderToolContent(message.content)
  );

  // Attachments
  const attachments: ReactNode = message.attachments && message.attachments.length > 0 ? (
    <div className="mt-3 flex flex-wrap gap-2">
      {message.attachments.map((att) => (
        <div
          key={att.id}
          className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"
        >
          {att.type === 'image' && att.preview ? (
            <img
              src={att.preview}
              alt={att.filename}
              className="h-16 w-16 rounded object-cover"
            />
          ) : (
            <>
              <span className="text-gray-400">📎</span>
              <span className="text-gray-700 dark:text-gray-300">
                {att.filename}
              </span>
            </>
          )}
        </div>
      ))}
    </div>
  ) : null;

  // Nested tools
  const nestedTools: ReactNode = message.nestedTools && message.nestedTools.length > 0 ? (
    <div className="mt-3 space-y-2 border-l-2 border-gray-200 pl-4 dark:border-gray-700">
      {message.nestedTools.map((nestedMsg) => (
        <ShareMessageItemComponent key={nestedMsg.id} message={nestedMsg} />
      ))}
    </div>
  ) : null;

  return (
    <div
      className={`flex gap-4 px-4 py-5 ${
        isUser ? 'bg-gray-50 dark:bg-gray-800/50' : 'bg-white dark:bg-gray-900'
      }`}
    >

      {/* Content */}
      <div className="min-w-0 flex-1 space-y-2">
        {/* Role and timestamp */}
        <div className="flex items-center gap-2">
          <div
            className={`flex h-6 w-6 items-center justify-center rounded-full ${avatarBgClass}`}
          >
            {showLogoImage ? (
              <img src="/logo.svg" alt="TalkCody" className="h-4 w-4 dark:invert" />
            ) : (
              AvatarIcon && <AvatarIcon className="h-4 w-4" />
            )}
          </div>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {formatTime(message.timestamp)}
          </span>
        </div>

        {/* Message content */}
        <div className="text-gray-800 dark:text-gray-200">
          {messageContent}
        </div>

        {/* Attachments */}
        {attachments}

        {/* Nested tools */}
        {nestedTools}
      </div>
    </div>
  );
}

export const ShareMessageItem = memo(ShareMessageItemComponent);
