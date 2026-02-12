// src/components/chat-box.tsx

import { dirname } from '@tauri-apps/api/path';
import { LoaderCircle, Square } from 'lucide-react';
import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useExecutionState } from '@/hooks/use-execution-state';
import { useMessages } from '@/hooks/use-task';
import { useTasks } from '@/hooks/use-tasks';
import { logger } from '@/lib/logger';
import { generateId } from '@/lib/utils';
import { getLocale, type SupportedLocale } from '@/locales';
import { parseModelIdentifier } from '@/providers/core/provider-utils';
import { modelService } from '@/providers/stores/provider-store';
import { agentRegistry } from '@/services/agents/agent-registry';
import { aiPromptEnhancementService } from '@/services/ai/ai-prompt-enhancement-service';
import { commandExecutor } from '@/services/commands/command-executor';
import { commandRegistry } from '@/services/commands/command-registry';
import { databaseService } from '@/services/database-service';
import { executionService } from '@/services/execution-service';
import { hookService } from '@/services/hooks/hook-service';
import type { ChatStatus } from '@/services/llm/ui';
import { messageService } from '@/services/message-service';
import { previewSystemPrompt } from '@/services/prompt/preview';
import { getEffectiveWorkspaceRoot } from '@/services/workspace-root-service';
import { useAuthStore } from '@/stores/auth-store';
import { settingsManager, useSettingsStore } from '@/stores/settings-store';
import { useWorktreeStore } from '@/stores/worktree-store';
import type { MessageAttachment, UIMessage } from '@/types/agent';
import type { Command, CommandContext, CommandResult } from '@/types/command';
import { Task, TaskContent, TaskScrollButton } from './ai-elements/task';
import { ChatInput, type ChatInputRef } from './chat/chat-input';
import { FileChangesSummary } from './chat/file-changes-summary';
import { MessageList } from './chat/message-list';
import { TalkCodyFreeLoginDialog } from './talkcody-free-login-dialog';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';

interface ChatBoxProps {
  onMessageSent?: (message: string) => void;
  onResponseReceived?: (response: string) => void;
  onError?: (error: string) => void;
  taskId?: string;
  onTaskStart?: (taskId: string, title: string) => void;
  selectedFile?: string | null;
  fileContent?: string | null;
  repositoryPath?: string;
  onDiffApplied?: () => void;
  showModeSelection?: boolean;
  onAddFileToChat?: (filePath: string, fileContent: string) => Promise<void>;
  onFileSelect?: (filePath: string) => void;
  checkForConflicts?: () => Promise<boolean>;
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
      taskId,
      onTaskStart,
      selectedFile,
      fileContent,
      repositoryPath,
      onDiffApplied,
      onFileSelect: _onFileSelect,
      onAddFileToChat: _onAddFileToChat,
      checkForConflicts,
    },
    ref
  ) => {
    const [input, setInput] = useState('');
    const [showTalkCodyFreeLoginDialog, setShowTalkCodyFreeLoginDialog] = useState(false);
    const [isCompactionDialogOpen, setIsCompactionDialogOpen] = useState(false);
    const [isCompacting, setIsCompacting] = useState(false);
    const [compactionStats, setCompactionStats] = useState<{
      originalMessageCount: number | null;
      compressedMessageCount: number | null;
      reductionPercent: number | null;
      compressionRatio: number | null;
    } | null>(null);
    const chatInputRef = useRef<ChatInputRef>(null);
    const language = useSettingsStore((state) => state.language);
    const t = useMemo(() => getLocale((language || 'en') as SupportedLocale), [language]);

    // Use optimized hook for execution state - only subscribes to changes for this specific task
    const { isLoading, serverStatus, error } = useExecutionState(taskId);
    const status: ChatStatus = isLoading ? 'streaming' : 'ready';

    // useTasks first to get currentTaskId
    const { currentTaskId, setError, createTask } = useTasks(onTaskStart);

    // useMessages with taskId for per-task message caching
    const { messages, stopStreaming, deleteMessage, deleteMessagesFromIndex, findMessageIndex } =
      useMessages(currentTaskId);

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

    // Note: State sync effect removed - isLoading and serverStatus now derived from store
    // Note: Streaming content sync effect removed - executionService handles message updates

    const processMessage = async (
      userMessage: string,
      attachments: MessageAttachment[] | undefined,
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

      // Check if using TalkCody provider and user is not authenticated
      const { providerId } = parseModelIdentifier(model);
      if (providerId === 'talkcody') {
        const { isAuthenticated } = useAuthStore.getState();
        if (!isAuthenticated) {
          setShowTalkCodyFreeLoginDialog(true);
          return;
        }
      }

      // Note: isLoading state is now derived from store - startExecution will set it
      setError(null);

      onMessageSent?.(userMessage);

      let activeTaskId = taskId;
      let isNewTask = false;

      if (!activeTaskId) {
        try {
          activeTaskId = await createTask(userMessage);
          isNewTask = true;
        } catch (error) {
          logger.error('Failed to create task:', error);
          // Note: No need to reset loading state - nothing was started
          return;
        }
      }

      if (!activeTaskId) {
        logger.error('No task ID available');
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

        logger.info('Adding user message to task:', activeTaskId, userMessage);
        await messageService.addUserMessage(activeTaskId, userMessage, {
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

        // Acquire worktree for existing tasks before building system prompt
        // (New tasks are handled in taskService.createTask)
        if (!isNewTask && activeTaskId) {
          const runningTaskIds = executionService
            .getRunningTaskIds()
            .filter((id) => id !== activeTaskId);
          if (runningTaskIds.length > 0) {
            try {
              await useWorktreeStore.getState().acquireForTask(activeTaskId, runningTaskIds);
              logger.info('[ChatBox] Acquired worktree for existing task', {
                taskId: activeTaskId,
              });
            } catch (error) {
              logger.warn('[ChatBox] Failed to acquire worktree:', error);
            }
          }
        }

        // If dynamic prompt is enabled for this agent, compose it with providers
        if (agent?.dynamicPrompt?.enabled) {
          try {
            const root = await getEffectiveWorkspaceRoot(activeTaskId);
            const currentWorkingDirectory = selectedFile ? await dirname(selectedFile) : undefined;
            // logger.info('[ChatBox] Building system prompt with workspaceRoot', {
            //   activeTaskId,
            //   isNewTask,
            //   workspaceRoot: root,
            // });
            const { finalSystemPrompt } = await previewSystemPrompt({
              agent: agent,
              workspaceRoot: root,
              taskId: activeTaskId,
              currentWorkingDirectory,
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
            taskId: activeTaskId,
            messages: conversationHistory,
            model,
            systemPrompt,
            tools,
            agentId,
            isNewTask: isNewTask,
            userMessage,
          },
          {
            onComplete: async (result) => {
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
      } catch (error) {
        // executionService handles abort internally, so errors here are real errors
        const errorMessage =
          error instanceof Error
            ? error.message
            : 'Sorry, I encountered some issues. Please try again later.';
        setError(errorMessage);

        // Note: Error message display is handled by the onError callback passed to executionService
        // to avoid duplicate error messages in the chatbox

        onError?.(errorMessage);
      } finally {
        // Stop task execution if still running (e.g., on error)
        // executionService handles its own cleanup
        if (activeTaskId && executionService.isRunning(activeTaskId)) {
          executionService.stopExecution(activeTaskId);
        }
      }
    };

    const handleRegenerate = async (messageId: string) => {
      if (isLoading) return;

      // Check for worktree conflicts before regenerating
      if (checkForConflicts) {
        const hasConflict = await checkForConflicts();
        if (hasConflict) {
          return;
        }
      }

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
      if (currentTaskId) {
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
        true,
        baseHistory
      );
    };

    const handleDeleteMessage = async (messageId: string) => {
      if (isLoading) return;

      // Delete from database
      if (currentTaskId) {
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

      const activeTaskId = currentTaskId || taskId;
      if (activeTaskId) {
        const hookSummary = await hookService.runUserPromptSubmit(activeTaskId, userMessage);
        hookService.applyHookSummary(hookSummary);
        if (hookSummary.blocked || hookSummary.continue === false) {
          const reason = hookSummary.blockReason || hookSummary.stopReason;
          toast.error(reason || t.Settings.hooks.blockedPrompt);
          return;
        }
      }

      if (userMessage.startsWith('/')) {
        try {
          await commandRegistry.initialize();
        } catch (error) {
          logger.warn('Failed to initialize command registry:', error);
        }
      }

      if (/^\/compact(\s|$)/.test(userMessage)) {
        const parsedCommand = commandExecutor.parseCommand('/compact');
        if (parsedCommand.command) {
          setIsCompactionDialogOpen(true);
          setIsCompacting(true);
          setCompactionStats(null);
          await executeCommand(parsedCommand.command, parsedCommand.rawArgs);
          return;
        }
      }

      // Check if the message is a command (starts with '/')
      if (userMessage.startsWith('/')) {
        const parsedCommand = commandExecutor.parseCommand(userMessage);
        if (parsedCommand.isValid && parsedCommand.command) {
          // Execute command directly without going through processMessage
          await executeCommand(parsedCommand.command, parsedCommand.rawArgs);
          return;
        }
      }

      // If not a command, process as a normal message
      await processMessage(userMessage, attachments);
    };

    // Handle sending a message programmatically (e.g., from code review button)
    // biome-ignore lint/correctness/useExhaustiveDependencies: processMessage is intentionally omitted - it changes on every render but we want stable closure behavior
    const handleSendMessage = useCallback(
      async (message: string) => {
        if (!message.trim() || isLoading) return;
        await processMessage(message, undefined);
      },
      [isLoading, currentTaskId]
    );

    const stopGeneration = () => {
      // Use taskId prop to stop the currently displayed task
      if (taskId) {
        stopStreaming();
        // executionService handles abort controller and store updates
        if (executionService.isRunning(taskId)) {
          executionService.stopExecution(taskId);
        }
      }
    };

    // Execute a command with the given arguments
    const executeCommand = async (command: Command, rawArgs: string) => {
      try {
        // Build command context
        const context: CommandContext = {
          taskId: currentTaskId,
          repositoryPath,
          selectedFile: selectedFile || undefined,
          fileContent: fileContent || undefined,
          sendMessage: async (message: string) => {
            await processMessage(message, undefined);
          },
          createNewTask: async () => {
            if (onTaskStart) {
              onTaskStart('', '');
            }
          },
        };

        // Execute the command directly (already parsed)
        // Build args object: use _raw for raw string args, or empty object if no args expected
        const args: Record<string, unknown> = rawArgs ? { _raw: rawArgs } : {};
        const result: CommandResult = await command.executor(args, context);

        if (result.data && typeof result.data === 'object') {
          const payload = result.data as {
            type?: string;
            stats?: {
              originalMessageCount?: number;
              compressedMessageCount?: number;
              reductionPercent?: number;
              compressionRatio?: number;
            };
          };

          if (payload.type === 'compaction') {
            setIsCompactionDialogOpen(true);
            setIsCompacting(false);
            setCompactionStats({
              originalMessageCount: payload.stats?.originalMessageCount ?? null,
              compressedMessageCount: payload.stats?.compressedMessageCount ?? null,
              reductionPercent: payload.stats?.reductionPercent ?? null,
              compressionRatio: payload.stats?.compressionRatio ?? null,
            });
          }
        }

        // Handle the result
        if (result.success) {
          if (result.message && command.name !== 'compact') {
            toast.success(result.message);
          }

          // If command wants to continue processing (send message to AI)
          if (result.continueProcessing && result.aiMessage) {
            // Use command's preferred agent if specified
            await processMessage(
              result.aiMessage,
              undefined,
              false,
              undefined,
              command.preferredAgentId
            );
          }
        } else {
          // Show error
          if (result.error) {
            if (command.name === 'compact') {
              setIsCompacting(false);
              setIsCompactionDialogOpen(true);
            }
            toast.error(result.error);
          }
        }
      } catch (error) {
        logger.error('Command execution failed:', error);
        toast.error(`Command execution failed: ${error}`);
        setIsCompacting(false);
        setIsCompactionDialogOpen(false);
      }
    };

    // Handle prompt enhancement
    const handleEnhancePrompt = useCallback(
      async (payload: {
        originalPrompt: string;
        enableContextExtraction: boolean;
        model?: string;
      }): Promise<string> => {
        const conversationMessages = messages.map((msg) => ({
          role: msg.role,
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
        }));

        const result = await aiPromptEnhancementService.enhancePrompt({
          originalPrompt: payload.originalPrompt,
          projectPath: repositoryPath,
          conversationMessages,
          enableContextExtraction: payload.enableContextExtraction,
          model: payload.model,
        });

        return result.enhancedPrompt;
      },
      [messages, repositoryPath]
    );

    return (
      <div className="flex h-full w-full min-w-0 flex-col">
        <Dialog open={isCompactionDialogOpen} onOpenChange={setIsCompactionDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{t.Chat.compaction.dialogTitle}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              {isCompacting ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <LoaderCircle className="size-4 animate-spin" />
                  <span>{t.Chat.compaction.compacting}</span>
                </div>
              ) : (
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">
                      {t.Chat.compaction.stats.originalMessages}
                    </span>
                    <span>{compactionStats?.originalMessageCount ?? '-'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">
                      {t.Chat.compaction.stats.compactedMessages}
                    </span>
                    <span>{compactionStats?.compressedMessageCount ?? '-'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">
                      {t.Chat.compaction.stats.reductionPercent}
                    </span>
                    <span>
                      {compactionStats?.reductionPercent !== null &&
                      compactionStats?.reductionPercent !== undefined
                        ? `${compactionStats.reductionPercent}%`
                        : '-'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">
                      {t.Chat.compaction.stats.compressionRatio}
                    </span>
                    <span>
                      {compactionStats?.compressionRatio !== null &&
                      compactionStats?.compressionRatio !== undefined
                        ? compactionStats.compressionRatio.toFixed(2)
                        : '-'}
                    </span>
                  </div>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsCompactionDialogOpen(false)}
                disabled={isCompacting}
              >
                {t.Common.close}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Task className="flex min-h-0 w-full flex-1 flex-col">
          <TaskContent className="w-full min-w-0">
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
          </TaskContent>
          <TaskScrollButton />
        </Task>

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

        {currentTaskId && (
          <FileChangesSummary taskId={currentTaskId} onSendMessage={handleSendMessage} />
        )}

        <ChatInput
          ref={chatInputRef}
          fileContent={fileContent}
          input={input}
          isLoading={isLoading}
          onEnhancePrompt={handleEnhancePrompt}
          onInputChange={handleInputChange}
          onSubmit={handleSubmit}
          repositoryPath={repositoryPath}
          selectedFile={selectedFile}
          status={status}
          taskId={currentTaskId}
        />

        <TalkCodyFreeLoginDialog
          open={showTalkCodyFreeLoginDialog}
          onClose={() => setShowTalkCodyFreeLoginDialog(false)}
        />
      </div>
    );
  }
);

ChatBox.displayName = 'ChatBox';
