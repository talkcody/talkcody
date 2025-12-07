// src/hooks/use-conversations.ts
// Composite hook that combines conversation list, messages, and edit functionality
// This maintains backward compatibility while the underlying logic is split into focused hooks

import { useCallback } from 'react';
import type { Conversation } from '@/services/database-service';
import type { MessageAttachment, UIMessage } from '@/types/agent';
import { useConversationEdit } from './use-conversation-edit';
import { useConversationList } from './use-conversation-list';
import { useConversationMessages } from './use-conversation-messages';

export interface UseConversationsReturn {
  // State management
  conversations: Conversation[];
  currentConversationId: string | undefined;
  loading: boolean;
  error: string | null;

  // Edit state
  editingId: string | null;
  editingTitle: string;

  // Conversation CRUD
  createConversation: (userMessage: string, projectId?: string) => Promise<string>;
  loadConversations: (projectId?: string) => Promise<void>;
  loadConversation: (
    conversationId: string,
    positionIndex: number,
    setMessages: (messages: UIMessage[]) => void
  ) => Promise<void>;
  getConversationHistory: (conversationId: string) => Promise<UIMessage[]>;
  getConversationDetails: (conversationId: string) => Promise<Conversation | null>;
  deleteConversation: (conversationId: string, e?: React.MouseEvent) => Promise<void>;
  updateConversationTitle: (conversationId: string, title: string) => Promise<void>;

  // Message operations
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

  // Navigation and state management
  selectConversation: (conversationId: string) => Promise<void>;
  startNewChat: () => void;
  clearConversation: () => void;
  setCurrentConversationId: (conversationId: string | undefined) => void;

  // Edit operations
  startEditing: (conversation: Conversation, e?: React.MouseEvent) => void;
  finishEditing: () => Promise<void>;
  cancelEditing: () => void;
  setEditingTitle: (title: string) => void;

  // State setters
  setError: (error: string | null) => void;
}

/**
 * Composite hook for managing conversations
 * Combines useConversationList, useConversationMessages, and useConversationEdit
 * for backward compatibility with existing code
 */
export function useConversations(
  initialConversationId?: string,
  onConversationStart?: (conversationId: string, title: string) => void
): UseConversationsReturn {
  // Use the split hooks
  const list = useConversationList(initialConversationId, onConversationStart);
  const messages = useConversationMessages();
  const edit = useConversationEdit();

  // Combine errors - prefer list error, then messages error, then edit error
  const error = list.error || messages.error || edit.error;

  // Wrapper for loadConversation that uses messages hook and updates list state
  const loadConversation = useCallback(
    async (
      conversationId: string,
      positionIndex: number,
      setMessages: (messages: UIMessage[]) => void
    ) => {
      const loadedMessages = await messages.loadMessages(conversationId, positionIndex);
      setMessages(loadedMessages);
      list.setCurrentConversationId(conversationId);
    },
    [messages, list]
  );

  // Wrapper for finishEditing that reloads conversations after success
  const finishEditing = useCallback(async () => {
    await edit.finishEditing(list.loadConversations);
  }, [edit, list.loadConversations]);

  // Combined setError that clears all errors
  const setError = useCallback(
    (newError: string | null) => {
      list.setError(newError);
      messages.setError(newError);
      edit.setError(newError);
    },
    [list, messages, edit]
  );

  return {
    // State from list hook
    conversations: list.conversations,
    currentConversationId: list.currentConversationId,
    loading: list.loading,
    error,

    // Edit state from edit hook
    editingId: edit.editingId,
    editingTitle: edit.editingTitle,

    // Conversation CRUD from list hook
    createConversation: list.createConversation,
    loadConversations: list.loadConversations,
    loadConversation,
    getConversationHistory: messages.getConversationHistory,
    getConversationDetails: list.getConversationDetails,
    deleteConversation: list.deleteConversation,
    updateConversationTitle: list.updateConversationTitle,

    // Message Operations from messages hook
    saveMessage: messages.saveMessage,
    updateMessage: messages.updateMessage,
    saveAttachment: messages.saveAttachment,
    getLatestUserMessageContent: messages.getLatestUserMessageContent,
    updateConversationUsage: messages.updateConversationUsage,

    // Navigation and State Management from list hook
    selectConversation: list.selectConversation,
    startNewChat: list.startNewChat,
    clearConversation: list.clearConversation,
    setCurrentConversationId: list.setCurrentConversationId,

    // Edit Operations from edit hook
    startEditing: edit.startEditing,
    finishEditing,
    cancelEditing: edit.cancelEditing,
    setEditingTitle: edit.setEditingTitle,

    // State setters
    setError,
  };
}

// Re-export the individual hooks for direct use
export { useConversationEdit } from './use-conversation-edit';
export { useConversationList } from './use-conversation-list';
export { useConversationMessages } from './use-conversation-messages';
