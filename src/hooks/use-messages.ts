// src/hooks/use-messages.ts
import { useCallback, useState } from 'react';
import { logger } from '@/lib/logger';
import { generateId } from '@/lib/utils';
import type { MessageAttachment, UIMessage } from '@/types/agent';

export function useMessages() {
  const [messages, setMessages] = useState<UIMessage[]>([]);

  const addMessage = useCallback(
    (
      role: 'user' | 'assistant' | 'tool',
      content: string | any,
      isStreaming = false,
      assistantId?: string,
      attachments?: MessageAttachment[],
      id?: string,
      toolCallId?: string,
      toolName?: string,
      nestedTools?: UIMessage[],
      renderDoingUI?: boolean
    ) => {
      const newMessage: UIMessage = {
        id: id || generateId(),
        role,
        content,
        timestamp: new Date(),
        isStreaming,
        assistantId,
        attachments,
        toolCallId,
        toolName,
        nestedTools,
        renderDoingUI,
      };
      setMessages((prev) => [...prev, newMessage]);
      return newMessage.id;
    },
    []
  );

  const updateMessageById = useCallback(
    (
      messageId: string,
      content: string,
      isStreaming = false,
      attachments?: MessageAttachment[]
    ) => {
      setMessages((prev) => {
        return prev.map((msg) =>
          msg.id === messageId
            ? {
                ...msg,
                content,
                isStreaming,
                ...(attachments && { attachments }),
              }
            : msg
        );
      });
    },
    []
  );

  const deleteMessage = useCallback((messageId: string) => {
    setMessages((prev) => prev.filter((msg) => msg.id !== messageId));
  }, []);

  const editMessage = useCallback((messageId: string, newContent: string) => {
    setMessages((prev) =>
      prev.map((msg) => (msg.id === messageId ? { ...msg, content: newContent } : msg))
    );
  }, []);

  const deleteMessagesFromIndex = useCallback((index: number) => {
    setMessages((prev) => prev.slice(0, index));
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  const stopStreaming = useCallback(() => {
    setMessages((prev) =>
      prev.map((msg) => (msg.isStreaming ? { ...msg, isStreaming: false } : msg))
    );
  }, []);

  const setMessagesFromHistory = useCallback((historyMessages: UIMessage[]) => {
    setMessages(historyMessages);
  }, []);

  const findMessageIndex = useCallback(
    (messageId: string) => {
      return messages.findIndex((msg) => msg.id === messageId);
    },
    [messages]
  );

  const getLastUserMessage = useCallback(() => {
    const userMessages = messages.filter((msg) => msg.role === 'user');
    return userMessages.length > 0 ? userMessages[userMessages.length - 1] : null;
  }, [messages]);

  // Add an attachment to a message
  const addAttachmentToMessage = useCallback((messageId: string, attachment: MessageAttachment) => {
    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === messageId
          ? {
              ...msg,
              attachments: [...(msg.attachments || []), attachment],
            }
          : msg
      )
    );
  }, []);

  // Update nested tool messages for a parent tool
  const updateMessageWithNestedTool = useCallback(
    (parentToolCallId: string, nestedMessage: UIMessage) => {
      logger.info('[useMessages] updateMessageWithNestedTool called:', {
        parentToolCallId,
        nestedMessageId: nestedMessage.id,
        nestedMessageRole: nestedMessage.role,
        nestedMessageType: Array.isArray(nestedMessage.content)
          ? nestedMessage.content.map((c: any) => c.type).join(',')
          : 'string',
      });

      setMessages((prev) => {
        logger.info(
          '[useMessages] Current messages in state:',
          prev.map((m) => ({
            id: m.id,
            toolCallId: m.toolCallId,
            role: m.role,
            hasNestedTools: !!m.nestedTools,
            nestedToolsCount: m.nestedTools?.length || 0,
          }))
        );

        let foundParent = false;

        const updated = prev.map((msg) => {
          // Find the parent tool's tool-call message
          if (msg.toolCallId === parentToolCallId && msg.role === 'assistant') {
            foundParent = true;
            logger.info('[useMessages] ✅ FOUND parent message:', {
              messageId: msg.id,
              toolCallId: msg.toolCallId,
              currentNestedToolsCount: msg.nestedTools?.length || 0,
            });

            // Add or update nestedTools array
            const existingNestedTools = msg.nestedTools || [];

            // Check if this nested message already exists (by id)
            const existingIndex = existingNestedTools.findIndex((t) => t.id === nestedMessage.id);

            let updatedNestedTools: UIMessage[];
            if (existingIndex >= 0) {
              // Update existing nested message
              updatedNestedTools = [...existingNestedTools];
              updatedNestedTools[existingIndex] = nestedMessage;
              logger.info('[useMessages] Updated existing nested tool at index:', existingIndex);
            } else {
              // Add new nested message
              updatedNestedTools = [...existingNestedTools, nestedMessage];
              logger.info(
                '[useMessages] Added new nested tool, total count:',
                updatedNestedTools.length
              );
            }

            return {
              ...msg,
              nestedTools: updatedNestedTools,
            };
          }
          return msg;
        });

        if (!foundParent) {
          logger.warn('[useMessages] ⚠️ Parent message NOT FOUND for toolCallId:', parentToolCallId);
        }

        return updated;
      });
    },
    []
  );

  return {
    messages,
    addMessage,
    updateMessageById,
    deleteMessage,
    editMessage,
    deleteMessagesFromIndex,
    clearMessages,
    stopStreaming,
    setMessagesFromHistory,
    findMessageIndex,
    getLastUserMessage,
    addAttachmentToMessage,
    updateMessageWithNestedTool,
  };
}
