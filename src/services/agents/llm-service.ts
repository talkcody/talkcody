// src/services/agents/llm-service.ts
import {
  type AssistantModelMessage,
  smoothStream,
  stepCountIs,
  streamText,
  type ToolModelMessage,
  type ToolSet,
} from 'ai';
import { createErrorContext, extractAndFormatError } from '@/lib/error-utils';
import { convertMessages } from '@/lib/llm-utils';
import { logger } from '@/lib/logger';
import { convertToAnthropicFormat } from '@/lib/message-convert';
import { MessageTransform } from '@/lib/message-transform';
import { validateAnthropicMessages } from '@/lib/message-validate';
import { getContextLength } from '@/lib/models';
import { getToolSync } from '@/lib/tools';
import { generateId } from '@/lib/utils';
import { getLocale, type SupportedLocale } from '@/locales';
import { modelTypeService } from '@/services/model-type-service';
import { getEffectiveWorkspaceRoot } from '@/services/workspace-root-service';
import { usePlanModeStore } from '@/stores/plan-mode-store';
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
import { aiPricingService } from '../ai-pricing-service';

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

import { useProviderStore } from '@/stores/provider-store';
import { fileService } from '../file-service';
import { MessageCompactor } from '../message-compactor';
import { ErrorHandler } from './error-handler';
import { StreamProcessor } from './stream-processor';
import { ToolExecutor } from './tool-executor';

export class LLMService {
  private readonly messageCompactor: MessageCompactor;
  private readonly toolExecutor: ToolExecutor;
  private readonly errorHandler: ErrorHandler;
  /** Task ID for this LLM service instance (used for parallel task execution) */
  private readonly taskId: string;

  private getDefaultCompressionConfig(): CompressionConfig {
    return {
      enabled: true,
      preserveRecentMessages: 6,
      compressionModel: modelTypeService.resolveModelTypeSync(ModelType.MESSAGE_COMPACTION),
      compressionThreshold: 0.9,
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
    this.messageCompactor = new MessageCompactor(this);
    this.toolExecutor = new ToolExecutor();
    this.errorHandler = new ErrorHandler();
  }

  /** Get the task ID for this instance */
  getTaskId(): string | undefined {
    return this.taskId;
  }

  private getTranslations() {
    const language = (useSettingsStore.getState().language || 'en') as SupportedLocale;
    return getLocale(language);
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

        const isImageGenerator = agentId === 'image-generator';

        // Merge compression config with defaults
        const compressionConfig: CompressionConfig = {
          ...this.getDefaultCompressionConfig(),
          ...compression,
        };

        logger.info('Starting agent loop with model', {
          model,
          maxIterations: options.maxIterations,
          taskId: this.taskId,
          inputMessageCount: inputMessages.length,
          agentId: agentId || 'default',
        });
        const t = this.getTranslations();
        onStatus?.(t.LLMService.status.initializing);

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

        // Convert initial messages to model format
        const modelMessages = await convertMessages(inputMessages, {
          rootPath,
          systemPrompt,
          model,
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

        // Create a new StreamProcessor instance for each agent loop
        // This ensures nested agent calls (e.g., callAgent) don't interfere with parent agent's state
        // Previously, using a shared instance caused tool call ID mismatches when nested agents reset the processor
        const streamProcessor = new StreamProcessor();

        while (!loopState.isComplete && loopState.currentIteration < maxIterations) {
          // Check for abort signal
          if (abortController?.signal.aborted) {
            logger.info('Agent loop aborted by user');
            return;
          }

          loopState.currentIteration++;

          const filteredTools = { ...tools };
          let isPlanModeEnabled = false;
          if (!isImageGenerator) {
            // Dynamically filter tools based on current plan mode state
            // This allows tools to change when plan mode is toggled during the loop
            // (e.g., when user approves a plan, plan mode becomes false and writeFile/editFile become available)
            isPlanModeEnabled = usePlanModeStore.getState().isPlanModeEnabled;
            if (!isPlanModeEnabled) {
              // In normal mode: remove plan-specific tools
              delete filteredTools.exitPlanMode;
              delete filteredTools.askUserQuestions;
              logger.info('[Normal Mode] Removed exitPlanMode and askUserQuestions', {
                iteration: loopState.currentIteration,
              });
            }

            // By default, remove executeSkillScript (only add when needed)
            delete filteredTools.executeSkillScript;

            // Dynamically add executeSkillScript if skills with scripts have been loaded
            if (loopState.hasSkillScripts) {
              filteredTools.executeSkillScript =
                tools.executeSkillScript || getToolSync('executeSkillScript');
              logger.info('[Dynamic Tool] Added executeSkillScript for skill script execution', {
                iteration: loopState.currentIteration,
              });
            }
          }

          const availableTools = Object.keys(filteredTools);

          logger.info(`Agent loop Step ${loopState.currentIteration}`, {
            iteration: loopState.currentIteration,
            messageCount: loopState.messages.length,
            isPlanModeEnabled,
            availableTools,
          });
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
          logger.info('Calling streamText', {
            model,
            agentId,
            provider: providerModel.provider,
            messageCount: loopState.messages.length,
            iteration: loopState.currentIteration,
            timestamp: new Date().toISOString(),
          });

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

          while (streamRetryCount <= MAX_STREAM_RETRIES) {
            try {
              // Reset stream processor state before each attempt
              if (streamRetryCount > 0) {
                streamProcessor.resetState();
                logger.info(`Stream retry attempt ${streamRetryCount}/${MAX_STREAM_RETRIES}`, {
                  iteration: loopState.currentIteration,
                });
              }

              // Only enable thinking when isThink is true and not image generator
              const providerOptions =
                isImageGenerator || !isThink
                  ? undefined
                  : {
                      google: {
                        thinkingConfig: {
                          thinkingBudget: 8192,
                          includeThoughts: true,
                        },
                      },
                      anthropic: {
                        thinking: { type: 'enabled', budgetTokens: 12_000 },
                      },
                      openai: {
                        reasoningEffort: 'medium',
                      },
                    };

              streamResult = streamText({
                model: providerModel,
                messages: loopState.messages,
                stopWhen: stepCountIs(1),
                experimental_transform: smoothStream({
                  delayInMs: 30, // optional: defaults to 10ms
                  chunking: 'line', // optional: defaults to 'word'
                }),
                providerOptions,
                onFinish: async ({ finishReason, usage, steps, totalUsage, response, request }) => {
                  const requestDuration = Date.now() - requestStartTime;

                  if (totalUsage?.totalTokens) {
                    loopState.lastRequestTokens = totalUsage.totalTokens;
                  }

                  // Update task usage for UI display
                  if (usage && this.taskId && !isSubagent) {
                    const inputTokens = usage.inputTokens || 0;
                    const outputTokens = usage.outputTokens || 0;
                    const cost = aiPricingService.calculateCost(model, {
                      inputTokens,
                      outputTokens,
                    });
                    useTaskStore
                      .getState()
                      .updateTaskUsage(this.taskId, cost, inputTokens, outputTokens);

                    // Calculate and update context usage percentage
                    if (loopState.lastRequestTokens > 0) {
                      const maxContextTokens = getContextLength(model);
                      const contextUsage = Math.min(
                        100,
                        (loopState.lastRequestTokens / maxContextTokens) * 100
                      );
                      useTaskStore.getState().setContextUsage(this.taskId, contextUsage);
                    }
                  }

                  // Filter out file content with large base64Data from steps to avoid huge logs
                  const filteredSteps = steps?.map((step) => {
                    if (!step.content || !Array.isArray(step.content)) {
                      return step;
                    }
                    const hasFileContent = step.content.some(
                      (item: { type?: string }) => item.type === 'file'
                    );
                    if (hasFileContent) {
                      return {
                        ...step,
                        content: step.content.map((item: { type?: string }) =>
                          item.type === 'file'
                            ? { type: 'file', omitted: 'base64Data omitted for logging' }
                            : item
                        ),
                      };
                    }
                    return step;
                  });

                  logger.info('onFinish', {
                    finishReason,
                    requestDuration,
                    totalUsage: totalUsage,
                    usage: usage,
                    lastRequestTokens: loopState.lastRequestTokens,
                    steps: filteredSteps,
                    request: request
                      ? {
                          body: request.body,
                        }
                      : undefined,
                    response: response
                      ? {
                          headers: response.headers,
                          messages: response.messages,
                        }
                      : undefined,
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
                      streamCallbacks
                    );
                    break;
                  case 'reasoning-delta':
                    if (delta.text) {
                      streamProcessor.processReasoningDelta(
                        (delta as { id: string }).id || 'default',
                        delta.text,
                        streamContext,
                        streamCallbacks
                      );
                    }
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
          const providerMetadata = await streamResult.providerMetadata;

          logger.info('Finish reason', { finishReason: loopState.lastFinishReason });
          logger.info('Provider metadata', { providerMetadata });

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

            // Check if get-skill tool returned skills with scripts
            for (const { toolCall, result } of results) {
              if (
                toolCall.toolName === 'getSkill' &&
                result &&
                typeof result === 'object' &&
                'has_scripts' in result &&
                result.has_scripts === true
              ) {
                loopState.hasSkillScripts = true;
                const skillResult = result as {
                  skill_name?: string;
                  script_count?: number;
                  has_scripts: boolean;
                };
                logger.info(
                  '[Dynamic Tool] Detected skill with scripts, will add executeSkillScript',
                  {
                    skill_name: skillResult.skill_name,
                    script_count: skillResult.script_count,
                  }
                );
                break; // Only need to set the flag once
              }
            }

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
            const transformed = MessageTransform.transformAssistantContent(assistantContent, model);

            const assistantMessage: AssistantModelMessage = {
              role: 'assistant',
              content: [...transformed.content, ...toolCallParts],
              ...(transformed.providerOptions && { providerOptions: transformed.providerOptions }),
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

        logger.info('Agent loop completed', {
          totalIterations: loopState.currentIteration,
          finalFinishReason: loopState.lastFinishReason,
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
