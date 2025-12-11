// src/components/chat-box.tsx
import type { ChatStatus } from 'ai';
import { LoaderCircle, Square } from 'lucide-react';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { toast } from 'sonner';
import { useShallow } from 'zustand/react/shallow';
import { useMessages } from '@/hooks/use-task';
import { useTasks } from '@/hooks/use-tasks';
import { logger } from '@/lib/logger';
import { generateId } from '@/lib/utils';
import { getLocale, type SupportedLocale } from '@/locales';
import { agentRegistry } from '@/services/agents/agent-registry';
import { commandExecutor } from '@/services/commands/command-executor';
import { databaseService } from '@/services/database-service';
import { executionService } from '@/services/execution-service';
import { messageService } from '@/services/message-service';
import { previewSystemPrompt } from '@/services/prompt/preview';
import { getValidatedWorkspaceRoot } from '@/services/workspace-root-service';
import { useExecutionStore } from '@/stores/execution-store';
import { modelService } from '@/stores/provider-store';
import { settingsManager, useSettingsStore } from '@/stores/settings-store';
import { useTaskStore } from '@/stores/task-store';
import type { MessageAttachment, UIMessage } from '@/types/agent';
import type { Command, CommandContext, CommandResult } from '@/types/command';
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from './ai-elements/conversation';
import { ChatInput, type ChatInputRef } from './chat/chat-input';
import { FileChangesSummary } from './chat/file-changes-summary';
import { MessageList } from './chat/message-list';
import { Button } from './ui/button';

interface ChatBoxProps {
  onMessageSent?: (message: string) => void;
  onResponseReceived?: (response: string) => void;
  onError?: (error: string) => void;
  conversationId?: string;
  onConversationStart?: (conversationId: string, title: string) => void;
  selectedFile?: string | null;
  fileContent?: string | null;
  repositoryPath?: string;
  onDiffApplied?: () => void;
  showModeSelection?: boolean;
  onAddFileToChat?: (filePath: string, fileContent: string) => Promise<void>;
  onFileSelect?: (filePath: string) => void;
}

export interface ChatBoxRef {
  addFileToChat: (filePath: string, fileContent: string) => Promise<void>;
  appendToInput: (text: string) => void;
}

export const ChatBox = forwardRef<ChatBoxRef, ChatBoxProps>(
  (
    {
      onMessageSent,
      onResponseReceived,
      onError,
      conversationId,
      onConversationStart,
      selectedFile,
      fileContent,
      repositoryPath,
      onDiffApplied,
      onFileSelect: _onFileSelect,
      onAddFileToChat: _onAddFileToChat,
    },
    ref
  ) => {
    const [input, setInput] = useState('');
    const chatInputRef = useRef<ChatInputRef>(null);
    // Ref to track the currently displayed conversationId (from props) for background task UI isolation
    const displayedConversationIdRef = useRef<string | undefined>(conversationId);
    const language = useSettingsStore((state) => state.language);
    const t = useMemo(() => getLocale((language || 'en') as SupportedLocale), [language]);

    // Derive loading state from TaskExecutionStore (instead of local state)
    // This ensures correct state when switching between conversations
    // Using useShallow to combine subscriptions and reduce re-renders
    const { isLoading, serverStatus, error } = useExecutionStore(
      useShallow((state) => {
        if (!conversationId) return { isLoading: false, serverStatus: '', error: undefined };
        const execution = state.getExecution(conversationId);
        return {
          isLoading: state.isTaskRunning(conversationId),
          serverStatus: execution?.serverStatus ?? '',
          error: execution?.error,
        };
      })
    );
    const status: ChatStatus = isLoading ? 'streaming' : 'ready';

    // useConversations first to get currentConversationId
    const {
      currentConversationId,
      setCurrentConversationId,
      setError,
      loadTask,
      createConversation,
      getConversationDetails,
    } = useTasks(onConversationStart);

    // useMessages with conversationId for per-conversation message caching
    const { messages, stopStreaming, deleteMessage, deleteMessagesFromIndex, findMessageIndex } =
      useMessages(currentConversationId);

    // Handle input changes
    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInput(e.target.value);
    };

    // Handle external addFileToChat calls and delegate to ChatInput
    const handleExternalAddFileToChat = useCallback(
      async (filePath: string, fileContent: string) => {
        if (chatInputRef.current) {
          await chatInputRef.current.addFileToChat(filePath, fileContent);
        }
      },
      []
    );

    // Expose addFileToChat and appendToInput methods through ref
    useImperativeHandle(
      ref,
      () => ({
        addFileToChat: handleExternalAddFileToChat,
        appendToInput: (text: string) => {
          if (chatInputRef.current) {
            chatInputRef.current.appendToInput(text);
          }
        },
      }),
      [handleExternalAddFileToChat]
    );

    // Command registry is now initialized in InitializationManager during app startup

    // Sync conversationId prop to ref for background task UI isolation
    // This ensures isCurrentlyDisplayed() checks always use the latest prop value
    useEffect(() => {
      displayedConversationIdRef.current = conversationId;
    }, [conversationId]);

    useEffect(() => {
      const handleConversationLoad = async () => {
        logger.info('[ChatBox] Loading conversation:', conversationId, currentConversationId);
        if (conversationId && conversationId !== currentConversationId) {
          const taskStore = useTaskStore.getState();

          // Check if messages exist in memory
          const hasMessagesInMemory = taskStore.getMessages(conversationId).length > 0;

          if (hasMessagesInMemory) {
            // Messages exist in memory, don't reload from DB to avoid overwriting
            // This preserves user messages that were just added but not yet persisted
            logger.info('[ChatBox] Skipping DB load - messages exist in memory', {
              conversationId,
            });
            // Still need to update currentConversationId for UI to switch
            setCurrentConversationId(conversationId);
          } else {
            // No messages in memory, fetch from database
            // Note: loadTask already calls taskStore.setMessages via taskService.loadMessages
            await loadTask(conversationId);
          }
        }
      };

      handleConversationLoad();
    }, [conversationId, currentConversationId, loadTask, setCurrentConversationId]);

    // Note: State sync effect removed - isLoading and serverStatus now derived from store
    // Note: Streaming content sync effect removed - executionService handles message updates

    const processMessage = async (
      userMessage: string,
      attachments: MessageAttachment[] | undefined,
      conversationId: string | undefined,
      skipUserMessage = false,
      baseHistory?: UIMessage[],
      overrideAgentId?: string
    ) => {
      if (!userMessage.trim() || isLoading) return;

      // Use override agent if provided (for commands), otherwise use user's selected agent
      const agentId = overrideAgentId || (await settingsManager.getAgentId());
      // Get agent with MCP tools resolved
      let agent = await agentRegistry.getWithResolvedTools(agentId);
      if (!agent) {
        logger.warn(
          `Agent with ID "${agentId}" not found, falling back to default 'planner' agent`
        );
        agent = await agentRegistry.getWithResolvedTools('planner');
      }
      const model = await modelService.getCurrentModel();
      logger.info(`Using model "${model}" for message processing`);

      // Note: isLoading state is now derived from store - startExecution will set it
      setError(null);

      onMessageSent?.(userMessage);

      let activeConversationId = conversationId;
      let isNewConversation = false;

      if (!activeConversationId) {
        try {
          activeConversationId = await createConversation(userMessage);
          isNewConversation = true;
        } catch (error) {
          logger.error('Failed to create conversation:', error);
          // Note: No need to reset loading state - nothing was started
          return;
        }
      }

      if (!activeConversationId) {
        logger.error('No conversation ID available');
        return;
      }

      // Add user message with attachments only if not skipping
      let userChatMessage: UIMessage;
      if (skipUserMessage) {
        // For regeneration, create the message object from existing data
        userChatMessage = {
          id: generateId(),
          role: 'user',
          content: userMessage,
          timestamp: new Date(),
          assistantId: agentId,
          attachments,
        };
      } else {
        userChatMessage = {
          id: generateId(),
          role: 'user',
          content: userMessage,
          timestamp: new Date(),
          assistantId: agentId,
          attachments,
        };

        logger.info('Adding user message to conversation:', activeConversationId, userMessage);
        await messageService.addUserMessage(activeConversationId, userMessage, {
          attachments,
          agentId,
        });
      }

      try {
        // Generate text response
        const sourceMessages = baseHistory ?? messages;
        const conversationHistory: UIMessage[] = sourceMessages.map((msg) => ({
          id: msg.id,
          role: msg.role,
          content: msg.content,
          timestamp: msg.timestamp,
          assistantId: msg.assistantId,
          attachments: msg.attachments || [],
        }));

        // When regenerating, we already include the triggering user message
        if (!skipUserMessage) {
          conversationHistory.push(userChatMessage);
        }
        logger.info('conversationHistory length', conversationHistory.length);

        let systemPrompt = agent
          ? typeof agent.systemPrompt === 'function'
            ? await Promise.resolve(agent.systemPrompt())
            : agent.systemPrompt
          : undefined;

        // If dynamic prompt is enabled for this agent, compose it with providers
        if (agent?.dynamicPrompt?.enabled) {
          try {
            const root = await getValidatedWorkspaceRoot();
            const { finalSystemPrompt } = await previewSystemPrompt({
              agent: agent,
              workspaceRoot: root,
            });
            systemPrompt = finalSystemPrompt;
          } catch (e) {
            logger.warn('Failed to compose dynamic system prompt, falling back to static:', e);
          }
        }

        const tools = agent?.tools ?? {};

        // Use executionService for proper message persistence
        await executionService.startExecution(
          {
            taskId: activeConversationId,
            messages: conversationHistory,
            model,
            systemPrompt,
            tools,
            agentId,
            isNewTask: isNewConversation,
            userMessage,
          },
          {
            onComplete: (result) => {
              onResponseReceived?.(result.fullText);
            },
            onError: (error) => {
              const errorMessage =
                error.message || 'Sorry, I encountered some issues. Please try again later.';
              setError(errorMessage);
              onError?.(errorMessage);
            },
          }
        );

        if (activeConversationId) {
          // Fetch the updated conversation data for cost logging
          const updatedConv = await getConversationDetails(activeConversationId);
          if (updatedConv) {
            logger.info('Updated conversation cost:', updatedConv.cost);
          }
        }
      } catch (error) {
        // executionService handles abort internally, so errors here are real errors
        const errorMessage =
          error instanceof Error
            ? error.message
            : 'Sorry, I encountered some issues. Please try again later.';
        setError(errorMessage);

        // Note: Error message display is handled by the onError callback passed to llmService
        // to avoid duplicate error messages in the chatbox

        onError?.(errorMessage);
      } finally {
        // Stop task execution if still running (e.g., on error)
        // executionService handles its own cleanup
        if (activeConversationId && executionService.isRunning(activeConversationId)) {
          executionService.stopExecution(activeConversationId);
        }
      }
    };

    const handleRegenerate = async (messageId: string) => {
      if (isLoading) return;

      const messageIndex = findMessageIndex(messageId);
      if (messageIndex === -1) return;

      const targetMessage = messages[messageIndex];
      if (!targetMessage) return;

      // Stop any ongoing generation
      stopGeneration();

      // For assistant message, find the previous user message to regenerate from
      let userMessage: UIMessage | null = null;
      let regenerateFromIndex = messageIndex;
      let baseHistory: UIMessage[] = [];

      if (targetMessage.role === 'assistant') {
        // Find the previous user message
        for (let i = messageIndex - 1; i >= 0; i--) {
          const msg = messages[i];
          if (msg?.role === 'user') {
            userMessage = msg;
            regenerateFromIndex = messageIndex; // Only delete the assistant message
            break;
          }
        }
      } else {
        // For user message, regenerate from next message (assistant response)
        userMessage = targetMessage;
        regenerateFromIndex = messageIndex + 1; // Delete from next message onwards
      }

      if (!userMessage) return;

      // Build base history up to the point we regenerate from
      baseHistory = messages.slice(0, regenerateFromIndex);

      // Delete messages from the regenerate index onwards (UI first for immediate feedback)
      deleteMessagesFromIndex(regenerateFromIndex);

      // Kick off database deletions in the background (non-blocking)
      if (currentConversationId) {
        const messagesToDelete = messages.slice(regenerateFromIndex);
        (async () => {
          for (const msg of messagesToDelete) {
            try {
              logger.info('Deleting message from database:', msg.id, msg.role);
              await databaseService.deleteMessage(msg.id);
            } catch (error) {
              logger.error(`Failed to delete message ${msg.id} from database:`, error);
            }
          }
        })();
      }

      // Regenerate the response with the curated base history and without re-adding user message
      await processMessage(
        typeof userMessage.content === 'string'
          ? userMessage.content
          : JSON.stringify(userMessage.content),
        userMessage.attachments,
        currentConversationId,
        true,
        baseHistory
      );
    };

    const handleDeleteMessage = async (messageId: string) => {
      if (isLoading) return;

      // Delete from database
      if (currentConversationId) {
        try {
          logger.info('Deleting message from database:', messageId);
          await databaseService.deleteMessage(messageId);
        } catch (error) {
          logger.error('Failed to delete message from database:', error);
          return;
        }
      }

      // Delete from UI
      deleteMessage(messageId);
    };

    const handleSubmit = async (e: React.FormEvent, attachments?: MessageAttachment[]) => {
      e.preventDefault();

      if (!input.trim() || isLoading) return;

      const userMessage = input.trim();
      setInput('');

      await processMessage(userMessage, attachments, currentConversationId);
    };

    const stopGeneration = () => {
      // Use conversationId prop to stop the currently displayed conversation
      const taskId = conversationId;
      if (taskId) {
        stopStreaming();
        // executionService handles abort controller and store updates
        if (executionService.isRunning(taskId)) {
          executionService.stopExecution(taskId);
        }
      }
    };

    // Handle command execution
    const handleCommandExecute = async (command: Command, rawArgs: string) => {
      try {
        // Build command context
        const context: CommandContext = {
          conversationId: currentConversationId,
          repositoryPath,
          selectedFile: selectedFile || undefined,
          fileContent: fileContent || undefined,
          sendMessage: async (message: string) => {
            await processMessage(message, undefined, currentConversationId);
          },
          createNewConversation: async () => {
            if (onConversationStart) {
              onConversationStart('', '');
            }
          },
          showNotification: (message: string, type = 'info') => {
            toast[type](message);
          },
        };

        // Execute the command
        const result: CommandResult = await commandExecutor.executeFromInput(
          `/${command.name} ${rawArgs}`.trim(),
          context
        );

        // Handle the result
        if (result.success) {
          if (result.message) {
            toast.success(result.message);
          }

          // If command wants to continue processing (send message to AI)
          if (result.continueProcessing && result.aiMessage) {
            // Use command's preferred agent if specified
            await processMessage(
              result.aiMessage,
              undefined,
              currentConversationId,
              false,
              undefined,
              command.preferredAgentId
            );
          }
        } else {
          // Show error
          if (result.error) {
            toast.error(result.error);
          }
        }
      } catch (error) {
        logger.error('Command execution failed:', error);
        toast.error(`Command execution failed: ${error}`);
      }
    };

    return (
      <div className="flex h-full w-full min-w-0 flex-col">
        <Conversation className="flex min-h-0 w-full flex-1 flex-col">
          <ConversationContent className="w-full min-w-0">
            <MessageList
              messages={messages}
              onDelete={handleDeleteMessage}
              onDiffApplied={onDiffApplied}
              onRegenerate={handleRegenerate}
              repositoryPath={repositoryPath}
            />

            {(isLoading || error) && (
              <div
                className={`mx-auto my-6 flex w-1/2 items-center justify-center text-md ${
                  error || serverStatus.startsWith('Error:')
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-blue-800 dark:text-blue-200'
                }`}
              >
                {!error && !serverStatus.startsWith('Error:') && (
                  <LoaderCircle className="mr-2 size-5 animate-spin" />
                )}
                <div>{error || serverStatus}</div>
              </div>
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        {isLoading && (
          <div className="flex justify-center py-3">
            <Button
              className="flex items-center gap-2 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600 dark:hover:border-red-800 dark:hover:bg-red-950 dark:hover:text-red-400"
              onClick={stopGeneration}
              size="sm"
              variant="outline"
            >
              <Square className="size-3" />
              {t.Chat.stop}
            </Button>
          </div>
        )}

        {currentConversationId && <FileChangesSummary conversationId={currentConversationId} />}

        <ChatInput
          ref={chatInputRef}
          fileContent={fileContent}
          input={input}
          isLoading={isLoading}
          onInputChange={handleInputChange}
          onSubmit={handleSubmit}
          onCommandExecute={handleCommandExecute}
          repositoryPath={repositoryPath}
          selectedFile={selectedFile}
          status={status}
          conversationId={currentConversationId}
        />
      </div>
    );
  }
);

ChatBox.displayName = 'ChatBox';
