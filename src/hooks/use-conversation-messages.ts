// src/hooks/use-conversation-messages.ts
// Hook for message operations within a conversation

import { useCallback, useState } from 'react';
import { logger } from '@/lib/logger';
import { mapStoredMessagesToUI, mapStoredToSimpleUIMessage } from '@/lib/message-mapper';
import { databaseService } from '@/services/database-service';
import { useConversationUsageStore } from '@/stores/conversation-usage-store';
import { settingsManager } from '@/stores/settings-store';
import type { MessageAttachment, UIMessage } from '@/types/agent';

export interface UseConversationMessagesReturn {
  error: string | null;

  // Message operations
  loadMessages: (conversationId: string, positionIndex: number) => Promise<UIMessage[]>;
  getConversationHistory: (conversationId: string) => Promise<UIMessage[]>;
  saveMessage: (
    conversationId: string,
    role: 'user' | 'assistant' | 'tool',
    content: string,
    positionIndex: number,
    assistantId?: string,
    attachments?: MessageAttachment[],
    messageId?: string
  ) => Promise<string>;
  updateMessage: (messageId: string, content: string) => Promise<void>;
  saveAttachment: (messageId: string, attachment: MessageAttachment) => Promise<void>;
  getLatestUserMessageContent: () => Promise<string | null>;
  updateConversationUsage: (
    conversationId: string,
    cost: number,
    inputToken: number,
    outputToken: number
  ) => Promise<void>;

  // State setters
  setError: (error: string | null) => void;
}

export function useConversationMessages(): UseConversationMessagesReturn {
  const [error, setError] = useState<string | null>(null);

  const loadMessages = useCallback(
    async (conversationId: string, positionIndex: number): Promise<UIMessage[]> => {
      try {
        setError(null);
        const storedMessages = await databaseService.getMessagesForPosition(
          conversationId,
          positionIndex
        );
        return mapStoredMessagesToUI(storedMessages);
      } catch (err) {
        logger.error('Failed to load messages:', err);
        setError('Failed to load conversation history');
        return [];
      }
    },
    []
  );

  const getConversationHistory = useCallback(
    async (conversationId: string): Promise<UIMessage[]> => {
      try {
        setError(null);
        const storedMessages = await databaseService.getMessages(conversationId);
        return storedMessages.map(mapStoredToSimpleUIMessage);
      } catch (err) {
        logger.error('Failed to get conversation history:', err);
        setError('Failed to get conversation history');
        return [];
      }
    },
    []
  );

  const saveMessage = useCallback(
    async (
      conversationId: string,
      role: 'user' | 'assistant' | 'tool',
      content: string,
      positionIndex: number,
      assistantId?: string,
      attachments?: MessageAttachment[],
      messageId?: string
    ) => {
      try {
        setError(null);
        return await databaseService.saveMessage(
          conversationId,
          role,
          content,
          positionIndex,
          assistantId,
          attachments,
          messageId
        );
      } catch (err) {
        logger.error('Failed to save message:', err);
        setError('Failed to save message');
        throw err;
      }
    },
    []
  );

  const updateMessage = useCallback(async (messageId: string, content: string) => {
    try {
      setError(null);
      return await databaseService.updateMessage(messageId, content);
    } catch (err) {
      logger.error('Failed to update message:', err);
      setError('Failed to update message');
      throw err;
    }
  }, []);

  const saveAttachment = useCallback(
    async (messageId: string, attachment: MessageAttachment) => {
      try {
        setError(null);
        await databaseService.saveAttachment(messageId, attachment);
      } catch (err) {
        logger.error('Failed to save attachment:', err);
        setError('Failed to save attachment');
        throw err;
      }
    },
    []
  );

  const getLatestUserMessageContent = useCallback(async (): Promise<string | null> => {
    try {
      const conversationId = settingsManager.getCurrentConversationId();
      logger.info('getLatestUserMessageContent', conversationId);
      const content = await databaseService.getLatestUserMessageContent(conversationId);
      setError(null);
      return content;
    } catch (err) {
      logger.error('Failed to get latest user message content:', err);
      setError('Failed to get latest user message content');
      return null;
    }
  }, []);

  const updateConversationUsage = useCallback(
    async (conversationId: string, cost: number, inputToken: number, outputToken: number) => {
      try {
        setError(null);
        await databaseService.updateConversationUsage(
          conversationId,
          cost,
          inputToken,
          outputToken
        );
        // Update store for real-time UI update
        useConversationUsageStore.getState().addUsage(cost, inputToken, outputToken);
      } catch (err) {
        logger.error('Failed to update conversation usage:', err);
        setError('Failed to update conversation usage');
      }
    },
    []
  );

  return {
    error,
    loadMessages,
    getConversationHistory,
    saveMessage,
    updateMessage,
    saveAttachment,
    getLatestUserMessageContent,
    updateConversationUsage,
    setError,
  };
}
