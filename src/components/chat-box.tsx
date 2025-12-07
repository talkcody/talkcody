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
import { useConversations } from '@/hooks/use-conversations';
import { useMessages } from '@/hooks/use-messages';
import { logger } from '@/lib/logger';
import { generateId } from '@/lib/utils';
import { getLocale, type SupportedLocale } from '@/locales';
import { agentRegistry } from '@/services/agents/agent-registry';
import { llmService } from '@/services/agents/llm-service';
import { commandExecutor } from '@/services/commands/command-executor';
import { ConversationManager } from '@/services/conversation-manager';
import type {
  Conversation as ConversationType,
  StoredToolContent,
} from '@/services/database/types';
import { databaseService } from '@/services/database-service';
import { modelService } from '@/services/model-service';
import { notificationService } from '@/services/notification-service';
import { previewSystemPrompt } from '@/services/prompt/preview';
import { getValidatedWorkspaceRoot } from '@/services/workspace-root-service';
import { useAgentExecutionStore } from '@/stores/agent-execution-store';
import { settingsManager, useSettingsStore } from '@/stores/settings-store';
import type { MessageAttachment, ToolMessageContent, UIMessage } from '@/types/agent';
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
    const [isLoading, setIsLoading] = useState(false);
    const [status, setStatus] = useState<ChatStatus>('ready');
    const [serverStatus, setServerStatus] = useState<string>('');
    const chatInputRef = useRef<ChatInputRef>(null);
    const [_conversation, setConversation] = useState<ConversationType | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const activeConversationIdRef = useRef<string | undefined>(undefined);
    const { startExecution, stopExecution } = useAgentExecutionStore();
    const language = useSettingsStore((state) => state.language);
    const t = useMemo(() => getLocale((language || 'en') as SupportedLocale), [language]);

    // Handle tool messages - add them to the messages list
    const handleToolMessage = (message: UIMessage) => {
      const isCallAgent = message.toolName === 'callAgent';
      // Check if this is a nested tool message
      if (message.parentToolCallId) {
        // This is a nested tool message - update the parent tool's nestedTools array
        logger.info(
          `[ChatBox-Receive] 🔗 Nested tool message - will update parent${isCallAgent ? ' [CALL-AGENT]' : ''}`,
          {
            nestedMessageId: message.id,
            nestedMessageRole: message.role,
            nestedMessageToolName: message.toolName,
            parentToolCallId: message.parentToolCallId,
            willAddToMessages: false,
          }
        );
        updateMessageWithNestedTool(message.parentToolCallId, message);
        logger.info(
          '[ChatBox-Receive] ✅ Parent updated with nested tool, NOT adding to messages array'
        );
        return; // Don't add nested messages as separate messages
      }

      // Regular tool message handling
      if (message.role === 'tool') {
        // Add tool result message to the messages list
        addMessage(
          message.role,
          message.content,
          false,
          undefined,
          undefined,
          message.id,
          message.toolCallId,
          message.toolName,
          message.nestedTools,
          message.renderDoingUI
        );
        logger.info(
          `[ChatBox-Receive] ✅ Tool message added${isCallAgent ? ' [CALL-AGENT]' : ''}`,
          { renderDoingUI: message.renderDoingUI }
        );

        // Persist tool messages to database (only for top-level tools)
        if (activeConversationIdRef.current && message.toolCallId && message.toolName) {
          const toolContent = Array.isArray(message.content) ? message.content[0] : null;

          if (!toolContent) {
            return;
          }

          // Handle tool-call messages (save input for later restoration)
          if (toolContent.type === 'tool-call') {
            const storedContent: StoredToolContent = {
              type: 'tool-call',
              toolCallId: (toolContent as ToolMessageContent).toolCallId,
              toolName: (toolContent as ToolMessageContent).toolName,
              input: (toolContent as ToolMessageContent).input as
                | Record<string, unknown>
                | undefined,
            };

            saveMessage(
              activeConversationIdRef.current,
              'tool',
              JSON.stringify(storedContent),
              0,
              undefined,
              undefined,
              message.id
            ).catch((error) => {
              logger.error('Failed to save tool-call message:', error);
            });
            return;
          }

          // Handle tool-result messages
          if (toolContent.type !== 'tool-result') {
            return;
          }

          const input = (toolContent as ToolMessageContent)?.input || {};
          const output = (toolContent as ToolMessageContent)?.output;
          const isError =
            output &&
            typeof output === 'object' &&
            (('error' in output && !!(output as { error?: unknown }).error) ||
              ('status' in output && (output as { status?: string }).status === 'error'));

          const storedContent: StoredToolContent = {
            type: 'tool-result',
            toolCallId: message.toolCallId,
            toolName: message.toolName,
            input: input as Record<string, unknown>,
            output: output,
            status: isError ? 'error' : 'success',
            errorMessage:
              isError && output && typeof output === 'object' && 'error' in output
                ? String((output as { error?: unknown }).error)
                : undefined,
          };

          saveMessage(
            activeConversationIdRef.current,
            'tool',
            JSON.stringify(storedContent),
            0,
            undefined,
            undefined,
            message.id
          ).catch((error) => {
            logger.error('Failed to save tool message:', error);
          });
        }
      } else if (message.role === 'assistant' && Array.isArray(message.content)) {
        // Handle assistant messages with array content (text/reasoning)
        // Note: tool-call messages are handled in the role='tool' branch above
        addMessage(
          message.role,
          message.content,
          false,
          undefined,
          undefined,
          message.id,
          message.toolCallId,
          message.toolName,
          message.nestedTools
        );
      } else {
        // Regular message - only add if role is supported by addMessage
        if (message.role !== 'system') {
          logger.info('[ChatBox-Receive] 📥 Adding other message type', {
            role: message.role,
            toolName: message.toolName,
          });
          addMessage(
            message.role,
            message.content,
            false,
            undefined,
            undefined,
            message.id,
            message.toolCallId,
            message.toolName,
            message.nestedTools
          );
          logger.info('[ChatBox-Receive] ✅ Other message type added');
        } else {
          logger.info('[ChatBox-Receive] ⚠️ Skipping system message');
        }
      }
    };

    const {
      messages,
      addMessage,
      updateMessageById,
      clearMessages,
      setMessagesFromHistory,
      stopStreaming,
      deleteMessage,
      deleteMessagesFromIndex,
      findMessageIndex,
      addAttachmentToMessage,
      updateMessageWithNestedTool,
    } = useMessages();

    const {
      currentConversationId,
      setError,
      loadConversation,
      createConversation,
      saveMessage,
      updateMessage,
      saveAttachment,
      clearConversation,
      getConversationDetails,
    } = useConversations(conversationId, onConversationStart);

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

    useEffect(() => {
      const handleConversationLoad = async () => {
        if (conversationId && conversationId !== currentConversationId && !isLoading) {
          await loadConversation(conversationId, 0, setMessagesFromHistory);
          const conv = await getConversationDetails(conversationId);
          setConversation(conv);
        } else if (!conversationId && currentConversationId) {
          clearMessages();
          clearConversation();
          setConversation(null);
        }
      };

      handleConversationLoad();
    }, [
      conversationId,
      currentConversationId,
      isLoading,
      clearConversation,
      clearMessages,
      getConversationDetails,
      loadConversation,
      setMessagesFromHistory,
    ]);

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

      setIsLoading(true);
      setStatus('streaming');
      setError(null);
      startExecution(conversationId);

      onMessageSent?.(userMessage);

      let activeConversationId = conversationId;
      let isNewConversation = false;

      if (!activeConversationId) {
        try {
          activeConversationId = await createConversation(userMessage);
          isNewConversation = true;
        } catch (error) {
          logger.error('Failed to create conversation:', error);
          setIsLoading(false);
          setStatus('ready');
          stopExecution();
          return;
        }
      }

      if (!activeConversationId) {
        logger.error('No conversation ID available');
        setIsLoading(false);
        setStatus('ready');
        stopExecution();
        return;
      }

      // Store conversation ID in ref for handleToolMessage to access
      activeConversationIdRef.current = activeConversationId;

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

        addMessage('user', userMessage, false, agentId, attachments);
        await saveMessage(activeConversationId, 'user', userMessage, 0, agentId, attachments);
      }

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

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

          let streamedContent = '';
          let assistantMessageId = '';

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

          logger.info('Using system prompt:', systemPrompt);
          const tools = agent?.tools ?? {};
          logger.info('Using tools:', Object.keys(tools));

          // Handle assistant message start - create new message for each iteration
          const handleAssistantMessageStart = async () => {
            // Finalize the previous message in both UI and database before creating a new one
            if (assistantMessageId && streamedContent) {
              // First, update UI to finalize the previous message (set isStreaming: false)
              // This is CRITICAL to prevent the first message from "disappearing" in the UI
              updateMessageById(assistantMessageId, streamedContent, false);

              // Then, save to database
              if (activeConversationId) {
                try {
                  await updateMessage(assistantMessageId, streamedContent);
                  logger.info('Saved previous assistant message before starting new iteration');
                } catch (error) {
                  logger.error('Failed to save previous assistant message:', error);
                }
              }
            }

            // Reset streamedContent when starting a new assistant message to prevent accumulation
            streamedContent = '';
            // Create new assistant message for this iteration
            assistantMessageId = addMessage('assistant', '', true, agentId);

            // Save initial message to database immediately with the same ID
            if (activeConversationId) {
              try {
                await saveMessage(
                  activeConversationId,
                  'assistant',
                  '',
                  0,
                  agentId,
                  undefined,
                  assistantMessageId
                );
              } catch (error) {
                logger.error('Failed to save initial assistant message:', error);
              }
            }
          };

          await llmService.runAgentLoop(
            {
              messages: conversationHistory,
              model,
              systemPrompt,
              tools,
              isThink: true,
              suppressReasoning: false,
              agentId,
            },
            {
              onChunk: (chunk: string) => {
                if (abortController.signal.aborted) return;
                streamedContent += chunk;
                updateMessageById(assistantMessageId, streamedContent, true);
              },
              onComplete: async (fullText: string) => {
                if (abortController.signal.aborted) return;
                // Use streamedContent instead of fullText to avoid duplication across iterations
                // streamedContent contains only the content for the current message
                // fullText accumulates content across all iterations which causes reasoning duplication
                updateMessageById(assistantMessageId, streamedContent, false);
                onResponseReceived?.(fullText);

                // Update the message content in database (message was already saved in handleAssistantMessageStart)
                // Note: We must update even if streamedContent is empty to persist the final state
                if (activeConversationId && assistantMessageId) {
                  try {
                    await updateMessage(assistantMessageId, streamedContent);
                  } catch (error) {
                    logger.error('Failed to update assistant message:', error);
                  }
                }

                // Generate AI title for new conversations after first assistant message is saved
                // This avoids database conflicts by ensuring all message persistence is complete
                if (isNewConversation && activeConversationId) {
                  ConversationManager.generateAndUpdateTitle(
                    activeConversationId,
                    userMessage
                  ).catch((error) => {
                    logger.error('Background title generation failed:', error);
                  });
                }

                // Set loading to false when response is complete
                setIsLoading(false);
                setStatus('ready');
                setServerStatus('');
                stopExecution();

                // Send notification if window is not focused
                await notificationService.notifyAgentComplete();
              },
              onError: (error: Error) => {
                logger.error('streamResponse error', error);
                if (abortController.signal.aborted) return;
                const errorMessage =
                  error.message || 'Sorry, I encountered some issues. Please try again later.';
                setError(errorMessage);

                // Show error message via serverStatus in the loading indicator area
                // This ensures error appears at the bottom of the conversation, not before user's next message
                setServerStatus(`Error: ${errorMessage}`);

                onError?.(errorMessage);
                // Keep isLoading true so the error status is visible
                // setIsLoading and status will be reset in onComplete or when user sends next message
              },
              onStatus: (status: string) => {
                if (abortController.signal.aborted) return;
                setServerStatus(status);
              },
              onToolMessage: handleToolMessage,
              onAssistantMessageStart: handleAssistantMessageStart,
              onAttachment: async (attachment) => {
                if (abortController.signal.aborted) return;
                // Add attachment to the current assistant message
                if (assistantMessageId) {
                  // 1. Update UI
                  addAttachmentToMessage(assistantMessageId, attachment);

                  // 2. Persist to database
                  if (activeConversationId) {
                    try {
                      await saveAttachment(assistantMessageId, attachment);
                      logger.info('Saved attachment to database', {
                        messageId: assistantMessageId,
                        attachmentId: attachment.id,
                        type: attachment.type,
                      });
                    } catch (error) {
                      logger.error('Failed to save attachment to database:', error);
                    }
                  }
                }
              },
            },
            abortController,
            activeConversationId // Pass conversation ID for logging
          );

          if (activeConversationId) {
            // Then fetch the updated conversation data and update state
            const updatedConv = await getConversationDetails(activeConversationId);
            if (updatedConv) {
              logger.info('Updated conversation cost:', updatedConv.cost);
              setConversation(updatedConv);
            }
          }
      } catch (error) {
        if (abortController.signal.aborted) return;
        const errorMessage =
          error instanceof Error
            ? error.message
            : 'Sorry, I encountered some issues. Please try again later.';
        setError(errorMessage);

        // Note: Error message display is handled by the onError callback passed to llmService
        // to avoid duplicate error messages in the chatbox

        onError?.(errorMessage);
      } finally {
        setIsLoading(false);
        setStatus('ready');
        stopExecution();
        abortControllerRef.current = null;
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
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
        stopStreaming();
      }

      setIsLoading(false);
      setStatus('ready');
      setServerStatus('');
      stopExecution();
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

            {isLoading && (
              <div
                className={`mx-auto my-6 flex w-1/2 items-center justify-center text-md ${
                  serverStatus.startsWith('Error:')
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-blue-800 dark:text-blue-200'
                }`}
              >
                {!serverStatus.startsWith('Error:') && (
                  <LoaderCircle className="mr-2 size-5 animate-spin" />
                )}
                <div>{serverStatus}</div>
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
