// src/services/agents/llm-service.ts
import {
  type AssistantModelMessage,
  type ModelMessage,
  smoothStream,
  stepCountIs,
  streamText,
  type ToolModelMessage,
  type ToolSet,
} from 'ai';
import {
  createErrorContext,
  extractAndFormatError,
  isContextLengthExceededError,
} from '@/lib/error-utils';
import { convertMessages } from '@/lib/llm-utils';
import { logger } from '@/lib/logger';
import { convertToAnthropicFormat } from '@/lib/message-convert';
import { MessageTransform } from '@/lib/message-transform';
import { validateAnthropicMessages } from '@/lib/message-validate';
import { UsageTokenUtils } from '@/lib/usage-token-utils';
import { generateId } from '@/lib/utils';
import { getLocale, type SupportedLocale } from '@/locales';
import { getContextLength } from '@/providers/config/model-config';
import { parseModelIdentifier } from '@/providers/core/provider-utils';
import { modelTypeService } from '@/providers/models/model-type-service';
import { autoCodeReviewService } from '@/services/auto-code-review-service';
import { databaseService } from '@/services/database-service';
import { hookService } from '@/services/hooks/hook-service';
import { hookStateService } from '@/services/hooks/hook-state-service';
import { messageService } from '@/services/message-service';
import { getEffectiveWorkspaceRoot } from '@/services/workspace-root-service';
import { useSettingsStore } from '@/stores/settings-store';
import { useTaskStore } from '@/stores/task-store';
import { ModelType } from '@/types/model-types';
import type {
  AgentLoopOptions,
  AgentLoopState,
  CompressionConfig,
  MessageAttachment,
  UIMessage,
} from '../../types/agent';
import { aiPricingService } from '../ai/ai-pricing-service';

/**
 * Callbacks for agent loop
 * NOTE: Persistence is now handled by ExecutionService
 */
export interface AgentLoopCallbacks {
  /** Called when text streaming starts */
  onAssistantMessageStart?: () => void;
  /** Called for each text chunk during streaming */
  onChunk: (chunk: string) => void;
  /** Called when the agent loop completes successfully */
  onComplete?: (fullText: string) => void;
  /** Called when an error occurs */
  onError?: (error: Error) => void;
  /** Called when status changes (e.g., "Thinking...", "Executing tool...") */
  onStatus?: (status: string) => void;
  /** Called when a tool message is generated */
  onToolMessage?: (message: UIMessage) => void;
  /** Called when an attachment is generated (e.g., images) */
  onAttachment?: (attachment: MessageAttachment) => void;
}

import { useProviderStore } from '@/providers/stores/provider-store';
import { ContextCompactor } from '../context/context-compactor';
import { fileService } from '../file-service';
import { taskFileService } from '../task-file-service';
import { ErrorHandler } from './error-handler';
import { StreamProcessor } from './stream-processor';
import { ToolExecutor } from './tool-executor';

export class LLMService {
  private readonly messageCompactor: ContextCompactor;
  private readonly toolExecutor: ToolExecutor;
  private readonly errorHandler: ErrorHandler;
  /** Task ID for this LLM service instance (used for parallel task execution) */
  private readonly taskId: string;
  /** File name for compacted messages storage */
  private static readonly COMPACTED_MESSAGES_FILE = 'compacted-messages.json';

  private getDefaultCompressionConfig(): CompressionConfig {
    return {
      enabled: true,
      preserveRecentMessages: 6,
      compressionModel: modelTypeService.resolveModelTypeSync(ModelType.MESSAGE_COMPACTION),
      compressionThreshold: 0.8,
    };
  }

  /**
   * Check if an error is a retryable streaming error from OpenRouter
   * OpenRouter sometimes loses the 'id' field in tool call streaming deltas
   */
  private isRetryableStreamingError(error: unknown): boolean {
    if (error && typeof error === 'object') {
      const err = error as { name?: string; message?: string };
      return (
        err.name === 'AI_InvalidResponseDataError' &&
        (err.message?.includes("Expected 'id' to be a string") ?? false)
      );
    }
    return false;
  }

  /**
   * Create a new LLMService instance.
   * @param taskId Optional task ID for parallel task execution. Each task should have its own instance.
   */
  constructor(taskId: string) {
    this.taskId = taskId;
    this.messageCompactor = new ContextCompactor();
    this.toolExecutor = new ToolExecutor();
    this.errorHandler = new ErrorHandler();
  }

  /** Get the task ID for this instance */
  getTaskId(): string | undefined {
    return this.taskId;
  }

  /**
   * Load compacted messages from file.
   * Returns null if no compacted file exists or file is invalid.
   */
  private async loadCompactedMessages(): Promise<{
    messages: ModelMessage[];
    lastRequestTokens: number;
    sourceUIMessageCount: number;
  } | null> {
    if (!this.taskId || this.taskId === 'nested') {
      return null;
    }

    try {
      const json = await taskFileService.readFile(
        'context',
        this.taskId,
        LLMService.COMPACTED_MESSAGES_FILE
      );
      if (!json) {
        return null;
      }

      // Parse JSON with separate try-catch to distinguish parse errors from other errors
      let data: unknown;
      try {
        data = JSON.parse(json);
      } catch (parseError) {
        logger.warn('Failed to parse compacted messages JSON', parseError);
        return null;
      }

      // Validate data structure
      if (
        typeof data !== 'object' ||
        data === null ||
        !('messages' in data) ||
        !Array.isArray(data.messages) ||
        data.messages.length === 0
      ) {
        return null;
      }

      const dataRecord = data as Record<string, unknown>;

      // Validate sourceUIMessageCount
      const sourceUIMessageCount =
        typeof dataRecord.sourceUIMessageCount === 'number' ? dataRecord.sourceUIMessageCount : -1;
      if (sourceUIMessageCount < 0) {
        logger.warn('Invalid sourceUIMessageCount in compacted messages', {
          taskId: this.taskId,
        });
        return null;
      }

      return {
        messages: data.messages as ModelMessage[],
        lastRequestTokens:
          typeof dataRecord.lastRequestTokens === 'number' ? dataRecord.lastRequestTokens : 0,
        sourceUIMessageCount,
      };
    } catch (error) {
      logger.warn('Failed to load compacted messages', error);
      return null;
    }
  }

  /**
   * Save compacted messages to file.
   * Only called when message compression is actually triggered.
   */
  private async saveCompactedMessages(
    messages: ModelMessage[],
    sourceUIMessageCount: number,
    lastRequestTokens: number
  ): Promise<void> {
    if (!this.taskId || this.taskId === 'nested') {
      return;
    }

    // Validate inputs
    if (!Array.isArray(messages) || messages.length === 0) {
      return;
    }

    if (typeof sourceUIMessageCount !== 'number' || sourceUIMessageCount < 0) {
      logger.warn('Invalid sourceUIMessageCount for save', {
        sourceUIMessageCount,
      });
      return;
    }

    if (typeof lastRequestTokens !== 'number' || lastRequestTokens < 0) {
      logger.warn('Invalid lastRequestTokens for save', {
        lastRequestTokens,
      });
      return;
    }

    const data = {
      messages,
      sourceUIMessageCount,
      lastRequestTokens: typeof lastRequestTokens === 'number' ? lastRequestTokens : 0,
      updatedAt: Date.now(),
    };

    try {
      await taskFileService.writeFile(
        'context',
        this.taskId,
        LLMService.COMPACTED_MESSAGES_FILE,
        JSON.stringify(data)
      );
      logger.info('Saved compacted messages to file', {
        taskId: this.taskId,
        modelMessageCount: messages.length,
        sourceUIMessageCount,
        lastRequestTokens,
      });
    } catch (error) {
      logger.warn('Failed to save compacted messages', error);
    }
  }

  private getTranslations() {
    const language = (useSettingsStore.getState().language || 'en') as SupportedLocale;
    return getLocale(language);
  }

  private async runAutoCompaction(
    loopState: AgentLoopState,
    compressionConfig: CompressionConfig,
    systemPrompt: string,
    _model: string,
    isSubagent: boolean,
    abortController?: AbortController,
    onStatus?: (status: string) => void
  ): Promise<boolean> {
    const t = this.getTranslations();
    onStatus?.(t.LLMService.status.contextTooLongCompacting);

    const compressionResult = await this.messageCompactor.compactMessages(
      {
        messages: loopState.messages,
        config: compressionConfig,
        systemPrompt,
      },
      loopState.lastRequestTokens,
      abortController
    );

    if (!compressionResult.compressedSummary && compressionResult.sections.length === 0) {
      return false;
    }

    const compressedMessages = this.messageCompactor.createCompressedMessages(compressionResult);
    const validation = this.messageCompactor.validateCompressedMessages(compressedMessages);

    const finalMessages =
      validation.valid || !validation.fixedMessages ? compressedMessages : validation.fixedMessages;

    loopState.messages = convertToAnthropicFormat(finalMessages, {
      autoFix: true,
      trimAssistantWhitespace: true,
    });
    loopState.lastRequestTokens = 0;

    onStatus?.(t.LLMService.status.compressed(compressionResult.compressionRatio.toFixed(2)));

    if (this.taskId && !isSubagent) {
      const currentUIMessageCount = useTaskStore.getState().getMessages(this.taskId).length;

      this.saveCompactedMessages(
        loopState.messages,
        currentUIMessageCount,
        loopState.lastRequestTokens
      ).catch((err) => {
        logger.warn('Failed to save compacted messages', err);
      });
    }

    return true;
  }

  /**
   * Run the agent loop with the given options and callbacks.
   * @param options Agent loop configuration
   * @param callbacks Event callbacks for streaming, completion, errors, etc.
   * @param abortController Optional controller to abort the loop
   * @param taskId Task ID for this execution. Priority: this parameter > constructor taskId.
   *               Use 'nested' for nested agent calls to skip task-level operations.
   */
  async runAgentLoop(
    options: AgentLoopOptions,
    callbacks: AgentLoopCallbacks,
    abortController?: AbortController
  ): Promise<void> {
    // biome-ignore lint/suspicious/noAsyncPromiseExecutor: Complex agent loop requires async Promise executor
    return new Promise<void>(async (resolve, reject) => {
      const {
        onChunk,
        onComplete,
        onError,
        onStatus,
        onToolMessage,
        onAssistantMessageStart,
        onAttachment,
      } = callbacks;

      try {
        const {
          messages: inputMessages,
          model,
          systemPrompt = '',
          tools = {},
          isThink = true,
          isSubagent = false,
          suppressReasoning = false,
          maxIterations = 500,
          compression,
          agentId,
        } = options;

        // Merge compression config with defaults
        const compressionConfig: CompressionConfig = {
          ...this.getDefaultCompressionConfig(),
          ...compression,
        };

        const totalStartTime = Date.now();
        const reasoningEffort = useSettingsStore.getState().getReasoningEffort();

        logger.info('Starting agent loop with model', {
          model,
          maxIterations: options.maxIterations,
          taskId: this.taskId,
          inputMessageCount: inputMessages.length,
          agentId: agentId || 'default',
          reasoningEffort,
        });
        const t = this.getTranslations();
        onStatus?.(t.LLMService.status.initializing);

        // Update task with the model being used if it's a main task
        if (this.taskId && !isSubagent) {
          useTaskStore.getState().updateTask(this.taskId, { model });
        }

        const providerStore = useProviderStore.getState();
        const isAvailable = providerStore.isModelAvailable(model);
        if (!isAvailable) {
          const errorContext = createErrorContext(model, {
            phase: 'model-initialization',
          });
          logger.error(`Model not available: ${model}`, undefined, {
            ...errorContext,
            availableModels: providerStore.availableModels || [],
          });
          throw new Error(
            t.LLMService.errors.noProvider(model, errorContext.provider || 'unknown')
          );
        }
        const providerModel = providerStore.getProviderModel(model);

        const rootPath = await getEffectiveWorkspaceRoot(this.taskId);

        // Initialize agent loop state
        const loopState: AgentLoopState = {
          messages: [],
          currentIteration: 0,
          isComplete: false,
          lastFinishReason: undefined,
          lastRequestTokens: 0,
        };

        // Lazy load: only try to load compacted messages if we have enough messages
        // to potentially benefit from caching
        let compacted = null;
        if (inputMessages.length > compressionConfig.preserveRecentMessages) {
          compacted = await this.loadCompactedMessages();
        }
        const { providerId } = parseModelIdentifier(model);

        if (compacted) {
          // Check inputMessages count vs sourceUIMessageCount
          if (inputMessages.length > compacted.sourceUIMessageCount) {
            // Have new UI messages (more than when compacted)
            logger.info('Found new input messages after compaction', {
              sourceUIMessageCount: compacted.sourceUIMessageCount,
              currentInputCount: inputMessages.length,
              newMessageCount: inputMessages.length - compacted.sourceUIMessageCount,
            });

            // Process only new messages starting from sourceUIMessageCount
            const newMessages = inputMessages.slice(compacted.sourceUIMessageCount);
            const newModelMessages = await convertMessages(newMessages, {
              rootPath,
              systemPrompt: undefined, // Don't add system message again, compacted.messages already has it
              model,
              providerId: providerId ?? undefined,
            });

            const validationResult = validateAnthropicMessages(newModelMessages);
            if (!validationResult.valid) {
              logger.warn('[LLMService] New message validation issues:', {
                issues: validationResult.issues,
              });
            }

            loopState.messages = [
              ...compacted.messages,
              ...convertToAnthropicFormat(newModelMessages, {
                autoFix: true,
                trimAssistantWhitespace: true,
              }),
            ];
            loopState.lastRequestTokens = compacted.lastRequestTokens;
          } else if (inputMessages.length === compacted.sourceUIMessageCount) {
            // UI message count same, use compacted directly
            logger.info('No new input messages, using compacted directly', {
              sourceUIMessageCount: compacted.sourceUIMessageCount,
              currentInputCount: inputMessages.length,
            });
            loopState.messages = compacted.messages;
            loopState.lastRequestTokens = compacted.lastRequestTokens;
          } else {
            // inputMessages count decreased (user may have deleted messages), reprocess all
            logger.warn('Input message count decreased, reprocessing all', {
              sourceUIMessageCount: compacted.sourceUIMessageCount,
              currentInputCount: inputMessages.length,
            });
            const modelMessages = await convertMessages(inputMessages, {
              rootPath,
              systemPrompt,
              model,
              providerId: providerId ?? undefined,
            });

            const validationResult = validateAnthropicMessages(modelMessages);
            if (!validationResult.valid) {
              logger.warn('[LLMService] Message validation issues:', {
                issues: validationResult.issues,
              });
            }

            loopState.messages = convertToAnthropicFormat(modelMessages, {
              autoFix: true,
              trimAssistantWhitespace: true,
            });
          }
        } else {
          // No compacted messages - convert all input messages
          const modelMessages = await convertMessages(inputMessages, {
            rootPath,
            systemPrompt,
            model,
            providerId: providerId ?? undefined,
          });

          // Validate and convert to Anthropic-compliant format
          const validationResult = validateAnthropicMessages(modelMessages);
          if (!validationResult.valid) {
            logger.warn('[LLMService] Initial message validation issues:', {
              issues: validationResult.issues,
            });
          }
          loopState.messages = convertToAnthropicFormat(modelMessages, {
            autoFix: true,
            trimAssistantWhitespace: true,
          });
        }

        // Create a new StreamProcessor instance for each agent loop
        // This ensures nested agent calls (e.g., callAgent) don't interfere with parent agent's state
        // Previously, using a shared instance caused tool call ID mismatches when nested agents reset the processor
        const streamProcessor = new StreamProcessor();

        let didRunSessionStart = false;
        let autoCompactionAttempts = 0;

        while (!loopState.isComplete && loopState.currentIteration < maxIterations) {
          if (this.taskId && !isSubagent && !didRunSessionStart) {
            const sessionStartSummary = await hookService.runSessionStart(this.taskId, 'startup');
            hookService.applyHookSummary(sessionStartSummary);
            didRunSessionStart = true;
          }

          if (this.taskId && !isSubagent) {
            const extraContext = hookStateService.consumeAdditionalContext();
            if (extraContext.length > 0) {
              loopState.messages.push({
                role: 'system',
                content: extraContext.join('\n'),
                providerOptions: {
                  anthropic: { cacheControl: { type: 'ephemeral' } },
                },
              });
            }
          }
          // Check for abort signal
          if (abortController?.signal.aborted) {
            logger.info('Agent loop aborted by user');
            return;
          }

          loopState.currentIteration++;

          const filteredTools = { ...tools };
          onStatus?.(t.LLMService.status.step(loopState.currentIteration));

          // Reset stream processor state for new iteration
          // Use resetState() instead of resetCurrentStepText() to ensure isAnswering flag is also reset
          // This is critical for multi-iteration scenarios (e.g., text -> tool call -> text)
          streamProcessor.resetState();

          // Check and perform message compression if needed
          try {
            const compressionResult = await this.messageCompactor.performCompressionIfNeeded(
              loopState.messages,
              compressionConfig,
              loopState.lastRequestTokens,
              model,
              systemPrompt,
              abortController,
              onStatus
            );

            if (compressionResult) {
              // Apply Anthropic format conversion to compressed messages
              loopState.messages = convertToAnthropicFormat(compressionResult.messages, {
                autoFix: true,
                trimAssistantWhitespace: true,
              });
              onStatus?.(
                t.LLMService.status.compressed(compressionResult.result.compressionRatio.toFixed(2))
              );

              // Save compacted messages to file (only when compression is triggered)
              if (this.taskId && !isSubagent) {
                // Query taskStore for current UI message count
                const currentUIMessageCount = useTaskStore
                  .getState()
                  .getMessages(this.taskId).length;

                this.saveCompactedMessages(
                  loopState.messages,
                  currentUIMessageCount,
                  loopState.lastRequestTokens
                ).catch((err) => {
                  logger.warn('Failed to save compacted messages', err);
                });
              }
            }
          } catch (error) {
            // Extract and format error using utility
            const errorContext = createErrorContext(model, {
              iteration: loopState.currentIteration,
              messageCount: loopState.messages.length,
              phase: 'message-compression',
            });
            const { formattedError } = extractAndFormatError(error, errorContext);

            logger.warn('Message compression failed, continuing without compression', {
              formattedError,
            });
            onStatus?.(t.LLMService.status.compressionFailed);
            // Continue with original messages if compression fails
          }

          // Log request context before calling streamText
          const requestStartTime = Date.now();

          // Create tool definitions WITHOUT execute methods for AI SDK
          // This prevents AI SDK from auto-executing tools, which would bypass ToolExecutor
          // ToolExecutor will manually execute tools using the filtered tools object
          const toolsForAI: Record<string, unknown> = Object.fromEntries(
            Object.entries(filteredTools).map(([name, toolDef]) => {
              if (toolDef && typeof toolDef === 'object' && 'execute' in toolDef) {
                // Remove execute method from tool definition
                // Cast through unknown to avoid type issues with ToolWithUI
                const toolDefAny = toolDef as unknown as Record<string, unknown>;
                const { execute: _execute, ...toolDefWithoutExecute } = toolDefAny;
                return [name, toolDefWithoutExecute];
              }
              return [name, toolDef];
            })
          ) as unknown as ToolSet;

          // Retry loop for handling intermittent OpenRouter streaming errors
          const MAX_STREAM_RETRIES = 3;
          let streamRetryCount = 0;
          let streamResult: ReturnType<typeof streamText> | null = null;
          let shouldAutoCompact = false;

          while (streamRetryCount <= MAX_STREAM_RETRIES) {
            try {
              // Reset stream processor state before each attempt
              if (streamRetryCount > 0) {
                streamProcessor.resetState();
                logger.info(`Stream retry attempt ${streamRetryCount}/${MAX_STREAM_RETRIES}`, {
                  iteration: loopState.currentIteration,
                });
              }

              const enableReasoningOptions = isThink;
              const providerOptionsMap: Record<string, unknown> = {};

              const normalizedReasoningEffort = (() => {
                const { modelKey } = parseModelIdentifier(model);
                const supportsXhigh =
                  modelKey === 'gpt-5.2-codex' || modelKey === 'gpt-5.1-codex-max';
                if (!supportsXhigh && reasoningEffort === 'xhigh') {
                  return 'high';
                }
                return reasoningEffort;
              })();

              if (enableReasoningOptions) {
                providerOptionsMap.google = {
                  thinkingConfig: {
                    thinkingBudget: 8192,
                    includeThoughts: true,
                  },
                };
                providerOptionsMap.anthropic = {
                  thinking: { type: 'enabled', budgetTokens: 12_000 },
                };

                providerOptionsMap.openai = {
                  reasoningEffort: normalizedReasoningEffort,
                };
                providerOptionsMap.openrouter = {
                  effort: normalizedReasoningEffort,
                };
              }

              // biome-ignore lint/suspicious/noExplicitAny: providerOptions type varies by provider
              const providerOptions: any =
                Object.keys(providerOptionsMap).length > 0 ? providerOptionsMap : undefined;

              streamResult = streamText({
                model: providerModel,
                messages: loopState.messages,
                stopWhen: stepCountIs(1),
                experimental_transform: smoothStream({
                  delayInMs: 100, // optional: defaults to 10ms
                  chunking: 'line', // optional: defaults to 'word'
                }),
                maxOutputTokens: 15000,
                providerOptions,
                onFinish: async ({ finishReason, usage, totalUsage, request }) => {
                  const requestDuration = Date.now() - requestStartTime;
                  const normalizedUsage = UsageTokenUtils.normalizeUsageTokens(usage, totalUsage);

                  if (normalizedUsage?.totalTokens) {
                    // Check if token count increased significantly
                    if (loopState.lastRequestTokens > 0) {
                      const tokenIncrease =
                        normalizedUsage.totalTokens - loopState.lastRequestTokens;
                      if (tokenIncrease > 10000) {
                        logger.warn('Token count increased significantly', {
                          currentTokens: normalizedUsage.totalTokens,
                          previousTokens: loopState.lastRequestTokens,
                          increase: tokenIncrease,
                          iteration: loopState.currentIteration,
                        });
                      }
                    }
                    loopState.lastRequestTokens = normalizedUsage.totalTokens;
                  }

                  if (normalizedUsage) {
                    const { inputTokens, outputTokens } = normalizedUsage;
                    const cost = aiPricingService.calculateCost(model, {
                      inputTokens,
                      outputTokens,
                    });

                    let contextUsage: number | undefined;
                    if (loopState.lastRequestTokens > 0) {
                      const maxContextTokens = getContextLength(model);
                      contextUsage = Math.min(
                        100,
                        (loopState.lastRequestTokens / maxContextTokens) * 100
                      );
                    }

                    if (this.taskId && !isSubagent) {
                      useTaskStore.getState().updateTaskUsage(this.taskId, {
                        costDelta: cost,
                        inputTokensDelta: inputTokens,
                        outputTokensDelta: outputTokens,
                        requestCountDelta: 1,
                        contextUsage,
                      });
                    }

                    databaseService
                      .insertApiUsageEvent({
                        id: generateId(),
                        conversationId:
                          this.taskId && this.taskId !== 'nested' ? this.taskId : null,
                        model,
                        providerId: providerId ?? null,
                        inputTokens,
                        outputTokens,
                        cost,
                        createdAt: Date.now(),
                      })
                      .catch((error) => {
                        logger.warn('[LLMService] Failed to insert usage event', error);
                      });
                  }

                  logger.info('onFinish', {
                    finishReason,
                    requestDuration,
                    totalUsage: totalUsage,
                    lastRequestTokens: loopState.lastRequestTokens,
                    request,
                  });
                },
                tools: toolsForAI as ToolSet, // Use tool definitions WITHOUT execute methods
                abortSignal: abortController?.signal,
                includeRawChunks: true,
              });

              const streamCallbacks = { onChunk, onStatus, onAssistantMessageStart };
              const streamContext = { suppressReasoning };

              // Process current step stream
              for await (const delta of streamResult.fullStream) {
                // Check for abort signal during streaming
                if (abortController?.signal.aborted) {
                  logger.info('Agent loop aborted during streaming');
                  return;
                }

                switch (delta.type) {
                  case 'text-start':
                    streamProcessor.processTextStart(streamCallbacks);
                    break;
                  case 'text-delta':
                    if (delta.text) {
                      streamProcessor.processTextDelta(delta.text, streamCallbacks);
                    }
                    break;
                  case 'tool-call':
                    streamProcessor.processToolCall(
                      {
                        toolCallId: delta.toolCallId,
                        toolName: delta.toolName,
                        input:
                          (delta as { input?: unknown; args?: unknown }).input ??
                          (delta as { input?: unknown; args?: unknown }).args,
                      },
                      streamCallbacks
                    );
                    break;
                  case 'reasoning-start':
                    streamProcessor.processReasoningStart(
                      (delta as { id: string }).id,
                      (delta as { providerMetadata?: Record<string, unknown> }).providerMetadata,
                      streamCallbacks
                    );
                    break;
                  case 'reasoning-delta':
                    // Always process reasoning-delta even if text is empty
                    // because signature is delivered via providerMetadata with empty text
                    streamProcessor.processReasoningDelta(
                      (delta as { id: string }).id || 'default',
                      delta.text || '',
                      (delta as { providerMetadata?: Record<string, unknown> }).providerMetadata,
                      streamContext,
                      streamCallbacks
                    );
                    break;
                  case 'reasoning-end':
                    streamProcessor.processReasoningEnd(
                      (delta as { id: string }).id,
                      streamCallbacks
                    );
                    break;
                  case 'file': {
                    // Handle generated files (e.g., images from image generation models)
                    const file = (delta as { file: { uint8Array: Uint8Array; mediaType: string } })
                      .file;
                    if (file && onAttachment) {
                      try {
                        // Generate filename based on media type
                        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                        const extension = file.mediaType?.split('/')[1] || 'png';
                        const filename = `gen-${timestamp}.${extension}`;

                        // Save file to disk
                        const savedFilePath = await fileService.saveGeneratedImage(
                          file.uint8Array,
                          filename
                        );

                        // Create MessageAttachment
                        const attachment: MessageAttachment = {
                          id: generateId(),
                          type: file.mediaType?.startsWith('image/') ? 'image' : 'file',
                          filename,
                          content: '',
                          filePath: savedFilePath,
                          mimeType: file.mediaType || 'application/octet-stream',
                          size: file.uint8Array.length,
                        };

                        logger.info('Generated file saved as attachment', {
                          filename,
                          mediaType: file.mediaType,
                          size: file.uint8Array.length,
                        });

                        onAttachment(attachment);
                      } catch (error) {
                        logger.error('Failed to save generated file:', error);
                      }
                    }
                    break;
                  }
                  case 'raw': {
                    // Store raw chunks for post-analysis debugging
                    if (!loopState.rawChunks) {
                      loopState.rawChunks = [];
                    }
                    loopState.rawChunks.push(delta.rawValue);
                    break;
                  }
                  case 'error': {
                    streamProcessor.markError();

                    if (isContextLengthExceededError(delta.error)) {
                      const MAX_AUTO_COMPACTIONS = 1;
                      if (autoCompactionAttempts < MAX_AUTO_COMPACTIONS) {
                        autoCompactionAttempts++;
                        shouldAutoCompact = true;
                        break;
                      }

                      const errorMessage = t.LLMService.errors.contextTooLongCompactionFailed;
                      const error = new Error(errorMessage);
                      onError?.(error);
                      reject(error);
                      return;
                    }

                    const errorHandlerOptions = {
                      model,
                      tools: filteredTools,
                      loopState,
                      onError,
                    };

                    const errorResult = this.errorHandler.handleStreamError(
                      delta.error,
                      errorHandlerOptions
                    );

                    if (errorResult.shouldStop) {
                      // Call onError callback before rejecting to notify the caller
                      const error =
                        errorResult.error || new Error('Unknown error occurred during streaming');
                      onError?.(error);
                      reject(error);
                      return;
                    }

                    // For recoverable errors, notify UI immediately via onError callback
                    // This ensures error message is displayed at the correct position in the chat
                    // If we only add to loopState.messages, error will appear before the user's next message
                    if (errorResult.error) {
                      onError?.(errorResult.error);
                    }

                    // Check for too many consecutive errors
                    const consecutiveErrors = streamProcessor.getConsecutiveToolErrors();
                    if (
                      this.errorHandler.shouldStopOnConsecutiveErrors(
                        consecutiveErrors,
                        errorHandlerOptions
                      )
                    ) {
                      // Continue to next iteration after adding guidance message
                    }

                    // Break out of the current stream and continue to next iteration
                    break;
                  }
                }
              }

              // Stream processing succeeded, exit retry loop
              break;
            } catch (streamError) {
              if (isContextLengthExceededError(streamError)) {
                const MAX_AUTO_COMPACTIONS = 1;
                if (autoCompactionAttempts < MAX_AUTO_COMPACTIONS) {
                  autoCompactionAttempts++;
                  shouldAutoCompact = true;
                  break;
                }

                throw new Error(t.LLMService.errors.contextTooLongCompactionFailed);
              }

              // Check if this is a retryable OpenRouter streaming error
              if (
                this.isRetryableStreamingError(streamError) &&
                streamRetryCount < MAX_STREAM_RETRIES
              ) {
                streamRetryCount++;
                logger.warn(
                  `Retryable streaming error detected, will retry (${streamRetryCount}/${MAX_STREAM_RETRIES})`,
                  {
                    errorName: (streamError as Error)?.name,
                    errorMessage: (streamError as Error)?.message,
                    iteration: loopState.currentIteration,
                  }
                );
                continue; // Retry the stream
              }
              // Non-retryable error or max retries exceeded, re-throw
              throw streamError;
            }
          } // End of streamRetryLoop

          // This should never happen as the loop exits via break on success or throw on error
          if (!streamResult) {
            throw new Error(t.LLMService.errors.streamResultNull);
          }

          if (shouldAutoCompact) {
            const wasCompacted = await this.runAutoCompaction(
              loopState,
              compressionConfig,
              systemPrompt,
              model,
              isSubagent,
              abortController,
              onStatus
            );

            if (!wasCompacted) {
              throw new Error(t.LLMService.errors.contextTooLongCompactionFailed);
            }

            // Retry the same iteration with compacted messages.
            continue;
          }

          // Get processed data from stream processor
          const toolCalls = streamProcessor.getToolCalls();
          const hasError = streamProcessor.hasError();

          // Process tool calls manually
          // Check if we should finish the loop
          if (hasError) {
            // If there was an error, continue to next iteration
            logger.info('Error occurred, continuing to next iteration');
            continue;
          }

          loopState.lastFinishReason = await streamResult.finishReason;
          // Handle "unknown" finish reason by retrying without modifying messages
          if (loopState.lastFinishReason === 'unknown' && toolCalls.length === 0) {
            const maxUnknownRetries = 3;
            loopState.unknownFinishReasonCount = (loopState.unknownFinishReasonCount || 0) + 1;

            logger.warn('Unknown finish reason detected', {
              provider: providerModel.provider,
              model: model,
              retryCount: loopState.unknownFinishReasonCount,
              maxRetries: maxUnknownRetries,
              iteration: loopState.currentIteration,
            });

            if (loopState.unknownFinishReasonCount <= maxUnknownRetries) {
              const sleepSeconds = loopState.unknownFinishReasonCount; // 1s, 2s, 3s
              logger.info(
                `Retrying for unknown finish reason (${loopState.unknownFinishReasonCount}/${maxUnknownRetries}), sleeping ${sleepSeconds}s`
              );
              await new Promise((resolve) => setTimeout(resolve, sleepSeconds * 1000));
              // Retry without modifying loopState.messages
              continue;
            }

            // Max retries reached
            logger.error('Max unknown finish reason retries reached', {
              retries: loopState.unknownFinishReasonCount,
              provider: providerModel.provider,
              model: model,
            });
            throw new Error(t.LLMService.errors.unknownFinishReason);
          }

          const shouldRunStopHook =
            this.taskId &&
            toolCalls.length === 0 &&
            !isSubagent &&
            (!agentId || agentId === 'planner');

          if (shouldRunStopHook) {
            const stopSummary = await hookService.runStop(this.taskId);
            hookService.applyHookSummary(stopSummary);

            if (stopSummary.blocked) {
              const reason = stopSummary.blockReason || stopSummary.stopReason;
              if (reason) {
                await messageService.addUserMessage(this.taskId, reason);
                loopState.messages.push({
                  role: 'user',
                  content: reason,
                });
              }
              hookStateService.setStopHookActive(true);
              continue;
            } else {
              const reviewText = await autoCodeReviewService.run(this.taskId);
              if (reviewText) {
                await messageService.addUserMessage(this.taskId, reviewText);
                loopState.messages.push({
                  role: 'user',
                  content: reviewText,
                });
                continue;
              }
            }
          }

          if (toolCalls.length > 0) {
            // Check for abort signal before execution
            if (abortController?.signal.aborted) {
              logger.info('Agent loop aborted before tool execution');
              return;
            }

            const toolExecutionOptions = {
              tools: filteredTools,
              loopState,
              model,
              abortController,
              onToolMessage,
              taskId: this.taskId,
            };

            const results = await this.toolExecutor.executeWithSmartConcurrency(
              toolCalls,
              toolExecutionOptions,
              onStatus
            );

            // Build combined assistant message with text/reasoning AND tool calls
            const assistantContent = streamProcessor.getAssistantContent();
            const toolCallParts = toolCalls.map((tc) => {
              // Defensive: ensure input is object format (some providers return JSON string)
              let input = tc.input;
              if (typeof input === 'string') {
                try {
                  input = JSON.parse(input);
                } catch {
                  // If parsing fails, wrap as object to satisfy API requirements
                  input = { value: input };
                }
              }
              return {
                type: 'tool-call' as const,
                toolCallId: tc.toolCallId,
                toolName: tc.toolName,
                input,
              };
            });

            // Apply provider-specific transformation (e.g., DeepSeek reasoning_content)
            const { providerId: pid } = parseModelIdentifier(model);
            const { transformedContent } = MessageTransform.transform(
              loopState.messages,
              model,
              pid ?? undefined,
              assistantContent
            );

            const assistantMessage: AssistantModelMessage = {
              role: 'assistant',
              content: [...(transformedContent?.content ?? assistantContent), ...toolCallParts],
              ...(transformedContent?.providerOptions && {
                providerOptions: transformedContent.providerOptions,
              }),
            };
            loopState.messages.push(assistantMessage);

            const toolResultMessage: ToolModelMessage = {
              role: 'tool',
              content: results.map(({ toolCall, result }) => ({
                type: 'tool-result' as const,
                toolCallId: toolCall.toolCallId,
                toolName: toolCall.toolName,
                output: {
                  type: 'text' as const,
                  value: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
                },
              })),
            };
            loopState.messages.push(toolResultMessage);
          } else {
            // No tool calls - only add assistant message if there's text/reasoning content
            const assistantContent = streamProcessor.getAssistantContent();
            if (assistantContent.length > 0) {
              const assistantMessage: AssistantModelMessage = {
                role: 'assistant',
                content: assistantContent,
              };
              loopState.messages.push(assistantMessage);
            }

            loopState.isComplete = true;
            break;
          }
        }

        const totalDuration = Date.now() - totalStartTime;
        logger.info('Agent loop completed', {
          totalIterations: loopState.currentIteration,
          finalFinishReason: loopState.lastFinishReason,
          totalDurationMs: totalDuration,
          totalDurationSeconds: (totalDuration / 1000).toFixed(2),
          fullTextLength: streamProcessor.getFullText().length,
        });
        const fullText = streamProcessor.getFullText();
        onComplete?.(fullText);
        resolve();
      } catch (error) {
        // Log the raw error object before processing
        logger.error('Raw error caught in main loop:', error);

        // Log error properties for debugging
        if (error && typeof error === 'object') {
          const errorObj = error as Record<string, unknown>;

          // Serialize error properties to avoid [object Object]
          const serializedError: Record<string, unknown> = {
            name: errorObj.name,
            message: errorObj.message,
            stack: errorObj.stack,
            // Include enhanced fetch context if available
            context: errorObj.context,
          };

          // Recursively serialize cause chain
          if (errorObj.cause) {
            const causeChain: Array<Record<string, unknown>> = [];
            let currentCause: unknown = errorObj.cause;
            let depth = 0;
            const maxDepth = 5;

            while (currentCause && depth < maxDepth) {
              const causeObj = currentCause as {
                name?: string;
                message?: string;
                stack?: string;
                context?: unknown;
                cause?: unknown;
              };
              causeChain.push({
                name: causeObj.name || 'Unknown',
                message: causeObj.message || String(currentCause),
                stack: causeObj.stack,
                context: causeObj.context,
              });
              currentCause = causeObj.cause;
              depth++;
            }

            if (causeChain.length > 0) {
              serializedError.causeChain = causeChain;
            }
          }

          logger.error('Error properties:', JSON.stringify(serializedError, null, 2));
        }

        const loopError = this.errorHandler.handleMainLoopError(error, options.model, onError);

        logger.error('Agent loop error', error, {
          phase: 'main-loop',
          model: options.model,
        });

        reject(loopError);
      }
    });
  }
}

/**
 * Create a new LLMService instance for a specific task.
 * Use this for parallel task execution where each task needs isolated state.
 * @param taskId The unique task ID (equivalent to conversationId)
 */
export function createLLMService(taskId: string): LLMService {
  return new LLMService(taskId);
}
