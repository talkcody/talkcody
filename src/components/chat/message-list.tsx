// src/components/chat/message-list.tsx
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { MessageItem } from '@/components/chat/message-item';
import { CardContent } from '@/components/ui/card';
import type { UIMessage } from '@/types/agent';

interface MessageListProps {
  messages: UIMessage[];
  onRegenerate?: (messageId: string) => void;
  onDelete?: (messageId: string) => void;
  repositoryPath?: string;
  onDiffApplied?: () => void;
}

interface DerivedMessages {
  filteredMessages: UIMessage[];
  lastAssistantIdsInTurn: Set<string>;
}

const hasActualContent = (content: string): boolean => {
  const cleaned = content.replace(/^[>\s]+/gm, '').trim();
  return cleaned.length > 0;
};

const isEmptyMessage = (message: UIMessage): boolean => {
  if (typeof message.content === 'string') {
    return !hasActualContent(message.content);
  }
  if (Array.isArray(message.content)) {
    return message.content.length === 0;
  }
  return false;
};

const computeDerivedMessages = (messages: UIMessage[]): DerivedMessages => {
  const filteredMessages: UIMessage[] = [];
  const completedToolCalls = new Set<string>();

  for (const message of messages) {
    if (message.role === 'tool' && Array.isArray(message.content)) {
      for (const item of message.content) {
        if (item.type === 'tool-result' && item.toolCallId) {
          completedToolCalls.add(item.toolCallId);
        }
      }
    }
  }

  for (const message of messages) {
    if (isEmptyMessage(message)) {
      continue;
    }

    if (message.role === 'tool' && Array.isArray(message.content)) {
      const hasCompletedToolCall = message.content.some(
        (item: { type: string; toolCallId?: string }) =>
          item.type === 'tool-call' && item.toolCallId && completedToolCalls.has(item.toolCallId)
      );

      if (hasCompletedToolCall) {
        continue;
      }
    }

    filteredMessages.push(message);
  }

  const lastAssistantIdsInTurn = new Set<string>();

  for (let i = filteredMessages.length - 1; i >= 0; i--) {
    const msg = filteredMessages[i];
    if (!msg) continue;
    if (
      msg.role === 'assistant' &&
      typeof msg.content === 'string' &&
      hasActualContent(msg.content)
    ) {
      lastAssistantIdsInTurn.add(msg.id);
      while (i > 0) {
        const prevMsg = filteredMessages[i - 1];
        if (!prevMsg || prevMsg.role === 'user') break;
        i--;
      }
    }
  }

  return { filteredMessages, lastAssistantIdsInTurn };
};

export function MessageList({
  messages,
  onRegenerate,
  onDelete,
  repositoryPath: _repositoryPath,
  onDiffApplied: _onDiffApplied,
}: MessageListProps) {
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const lastMessageIdRef = useRef<string | null>(null);
  const lastMessageLengthRef = useRef<number>(0);
  const rafScrollRef = useRef<number | null>(null);

  const getScrollContainer = useCallback(() => {
    return scrollAreaRef.current?.querySelector(
      '[data-radix-scroll-area-viewport]'
    ) as HTMLDivElement | null;
  }, []);

  const scrollToBottom = useCallback(() => {
    const scrollContainer = getScrollContainer();
    if (!scrollContainer) return;
    scrollContainer.scrollTop = scrollContainer.scrollHeight;
  }, [getScrollContainer]);

  const isNearBottom = useCallback(() => {
    const scrollContainer = getScrollContainer();
    if (!scrollContainer) return false;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
    return scrollHeight - (scrollTop + clientHeight) < 120;
  }, [getScrollContainer]);

  const { filteredMessages, lastAssistantIdsInTurn } = useMemo(
    () => computeDerivedMessages(messages),
    [messages]
  );

  useEffect(() => {
    const lastMessage = filteredMessages[filteredMessages.length - 1];
    const lastId = lastMessage?.id ?? null;
    const lastLength =
      lastMessage && typeof lastMessage.content === 'string' ? lastMessage.content.length : 0;

    const isNewMessage = lastId !== lastMessageIdRef.current && lastId !== null;
    const isStreamingUpdate = lastId === lastMessageIdRef.current && lastLength > 0;
    const lengthChanged = lastLength !== lastMessageLengthRef.current;

    if ((isNewMessage || (isStreamingUpdate && lengthChanged)) && isNearBottom()) {
      if (rafScrollRef.current !== null) {
        cancelAnimationFrame(rafScrollRef.current);
      }
      rafScrollRef.current = requestAnimationFrame(() => {
        scrollToBottom();
      });
    }

    lastMessageIdRef.current = lastId;
    lastMessageLengthRef.current = lastLength;
  }, [filteredMessages, isNearBottom, scrollToBottom]);

  return (
    <CardContent className="flex min-h-0 w-full min-w-0 flex-1 flex-col p-4">
      <div className="h-full" ref={scrollAreaRef}>
        {filteredMessages.map((message, _index) => (
          <MessageItem
            key={message.id}
            message={message}
            isLastAssistantInTurn={lastAssistantIdsInTurn.has(message.id)}
            onDelete={onDelete}
            onRegenerate={onRegenerate}
          />
        ))}
      </div>
    </CardContent>
  );
}
