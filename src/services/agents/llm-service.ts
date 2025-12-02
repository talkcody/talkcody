// src/services/agents/llm-service.ts
import { type AssistantModelMessage, stepCountIs, streamText, type ToolModelMessage } from 'ai';
import { createErrorContext, extractAndFormatError } from '@/lib/error-utils';
import { convertMessages } from '@/lib/llm-utils';
import { logger } from '@/lib/logger';
import { MessageTransform } from '@/lib/message-transform';
import { GEMINI_25_FLASH_LITE } from '@/lib/models';
import { getToolSync } from '@/lib/tools';
import { modelService } from '@/services/model-service';
import { getValidatedWorkspaceRoot } from '@/services/workspace-root-service';
import { useConversationUsageStore } from '@/stores/conversation-usage-store';
import { usePlanModeStore } from '@/stores/plan-mode-store';
import type {
  AgentLoopOptions,
  AgentLoopState,
  CompressionConfig,
  UIMessage,
} from '../../types/agent';
import { aiPricingService } from '../ai-pricing-service';
import { aiProviderService } from '../ai-provider-service';
import { MessageCompactor } from '../message-compactor';
import { ErrorHandler } from './error-handler';
import { MessageFilter } from './message-filter';
import { StreamProcessor } from './stream-processor';
import { ToolExecutor } from './tool-executor';

export class LLMService {
  private readonly messageCompactor: MessageCompactor;
  private readonly messageFilter: MessageFilter;
  private readonly streamProcessor: StreamProcessor;
  private readonly toolExecutor: ToolExecutor;
  private readonly errorHandler: ErrorHandler;

  private defaultCompressionConfig: CompressionConfig = {
    enabled: true,
    preserveRecentMessages: 6,
    compressionModel: GEMINI_25_FLASH_LITE,
    compressionThreshold: 0.9,
  };

  constructor() {
    this.messageCompactor = new MessageCompactor(this);
    this.messageFilter = new MessageFilter();
    this.streamProcessor = new StreamProcessor();
    this.toolExecutor = new ToolExecutor();
    this.errorHandler = new ErrorHandler();
  }

  // Manual agent loop with streamText
  async runAgentLoop(
    options: AgentLoopOptions,
    callbacks: {
      onChunk: (chunk: string) => void;
      onComplete?: (fullText: string) => void;
      onError?: (error: Error) => void;
      onStatus?: (status: string) => void;
      onToolMessage?: (message: UIMessage) => void;
      onAssistantMessageStart?: () => void;
    },
    abortController?: AbortController,
    conversationId?: string
  ): Promise<void> {
    // biome-ignore lint/suspicious/noAsyncPromiseExecutor: Complex agent loop requires async Promise executor
    return new Promise<void>(async (resolve, reject) => {
      const { onChunk, onComplete, onError, onStatus, onToolMessage, onAssistantMessageStart } =
        callbacks;

      logger.info('Starting agent loop', {
        model: options.model,
        isThink: options.isThink,
        maxIterations: options.maxIterations,
        conversationId: conversationId || 'nested',
      });

      try {
        const {
          messages: inputMessages,
          model,
          systemPrompt = '',
          tools = {},
          suppressReasoning = false,
          maxIterations = 200,
          compression,
        } = options;

        // Merge compression config with defaults
        const compressionConfig: CompressionConfig = {
          ...this.defaultCompressionConfig,
          ...compression,
        };

        logger.info('Starting manual agent loop with model', {
          model,
          inputMessageCount: inputMessages.length,
        });
        logger.info('systemPrompt', { systemPrompt });
        onStatus?.('Initializing manual agent loop');

        // Clear file changes from previous agent loop for this conversation
        if (conversationId && conversationId !== 'nested') {
          const { useFileChangesStore } = await import('@/stores/file-changes-store');
          useFileChangesStore.getState().clearConversation(conversationId);
        }

        const isAvailable = modelService.isModelAvailableSync(model);
        if (!isAvailable) {
          const errorContext = createErrorContext(model, {
            phase: 'model-initialization',
          });
          logger.error(`Model not available: ${model}`, undefined, {
            ...errorContext,
            availableModels: modelService.getAvailableModels?.() || [],
          });
          throw new Error(
            `No available provider for model: ${model}. Please configure API keys in settings. Provider: ${errorContext.provider || 'unknown'}`
          );
        }
        const providerModel = aiProviderService.getProviderModel(model);

        const rootPath = await getValidatedWorkspaceRoot();

        // Initialize agent loop state
        const loopState: AgentLoopState = {
          messages: [],
          currentIteration: 0,
          isComplete: false,
          lastFinishReason: undefined,
          lastRequestTokens: undefined,
        };

        // Convert initial messages to model format
        const modelMessages = await convertMessages(inputMessages, {
          rootPath,
          systemPrompt,
        });
        loopState.messages = modelMessages;

        // Reset stream processor for new agent loop to ensure clean state
        // This prevents content from previous conversations leaking into new ones
        this.streamProcessor.fullReset();

        // Manual agent loop
        while (!loopState.isComplete && loopState.currentIteration < maxIterations) {
          // Check for abort signal
          if (abortController?.signal.aborted) {
            logger.info('Manual agent loop aborted by user');
            return;
          }

          loopState.currentIteration++;

          // Dynamically filter tools based on current plan mode state
          // This allows tools to change when plan mode is toggled during the loop
          // (e.g., when user approves a plan, plan mode becomes false and writeFile/editFile become available)
          const isPlanModeEnabled = usePlanModeStore.getState().isPlanModeEnabled;
          const filteredTools = { ...tools };

          if (isPlanModeEnabled) {
            // In plan mode: remove file modification tools
            delete filteredTools.writeFile;
            delete filteredTools.editFile;
            logger.info('[Plan Mode] Removed writeFile and editFile tools', {
              iteration: loopState.currentIteration,
            });
          } else {
            // In normal mode: remove plan-specific tools
            delete filteredTools.exitPlanModeTool;
            delete filteredTools.askUserQuestionsTool;
            logger.info('[Normal Mode] Removed exitPlanModeTool and askUserQuestionsTool', {
              iteration: loopState.currentIteration,
            });
          }

          // By default, remove executeSkillScriptTool (only add when needed)
          delete filteredTools.executeSkillScriptTool;

          // Dynamically add executeSkillScriptTool if skills with scripts have been loaded
          if (loopState.hasSkillScripts) {
            filteredTools.executeSkillScriptTool =
              tools.executeSkillScriptTool || getToolSync('executeSkillScriptTool');
            logger.info('[Dynamic Tool] Added executeSkillScriptTool for skill script execution', {
              iteration: loopState.currentIteration,
            });
          }

          const availableTools = Object.keys(filteredTools);

          logger.info(`Agent loop Step ${loopState.currentIteration}`, {
            iteration: loopState.currentIteration,
            messageCount: loopState.messages.length,
            isPlanModeEnabled,
            availableTools,
          });
          onStatus?.(`Step ${loopState.currentIteration}`);

          // Reset stream processor state for new iteration
          // Use resetState() instead of resetCurrentStepText() to ensure isAnswering flag is also reset
          // This is critical for multi-iteration scenarios (e.g., text -> tool call -> text)
          this.streamProcessor.resetState();

          loopState.messages = this.messageFilter.filterMessages(loopState.messages);

          // Check if message compression is needed
          if (
            this.messageCompactor.shouldCompress(
              loopState.messages,
              compressionConfig,
              loopState.lastRequestTokens
            )
          ) {
            try {
              onStatus?.('Compacting message history...');
              logger.info('Starting message compression', {
                messageCount: loopState.messages.length,
                iteration: loopState.currentIteration,
                config: compressionConfig,
              });

              const compressionResult = await this.messageCompactor.compactMessages(
                {
                  messages: loopState.messages,
                  config: compressionConfig,
                  systemPrompt,
                },
                abortController
              );

              // Replace message history with compressed version
              loopState.messages =
                this.messageCompactor.createCompressedMessages(compressionResult);

              logger.info('Message compression completed', {
                originalCount: compressionResult.originalMessageCount,
                compressedCount: compressionResult.compressedMessageCount,
                ratio: compressionResult.compressionRatio,
              });

              onStatus?.(
                `Message history compressed (${compressionResult.compressionRatio.toFixed(2)}x reduction)`
              );
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
              onStatus?.('Message compression failed, continuing...');
              // Continue with original messages if compression fails
            }
          }

          // Log request context before calling streamText
          const requestStartTime = Date.now();
          logger.info('Calling streamText', {
            model,
            provider: providerModel.provider,
            messageCount: loopState.messages.length,
            iteration: loopState.currentIteration,
            timestamp: new Date().toISOString(),
          });

          // Create tool definitions WITHOUT execute methods for AI SDK
          // This prevents AI SDK from auto-executing tools, which would bypass ToolExecutor
          // ToolExecutor will manually execute tools using the filtered tools object
          const toolsForAI = Object.fromEntries(
            Object.entries(filteredTools).map(([name, toolDef]) => {
              if (toolDef && typeof toolDef === 'object' && 'execute' in toolDef) {
                // Remove execute method from tool definition
                const { execute: _execute, ...toolDefWithoutExecute } = toolDef as any;
                return [name, toolDefWithoutExecute];
              }
              return [name, toolDef];
            })
          );

          logger.info('request message', loopState.messages);

          const streamResult = streamText({
            model: providerModel,
            messages: loopState.messages,
            stopWhen: stepCountIs(1),
            providerOptions: {
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
                reasoningEffort: 'low',
              },
            },
            experimental_telemetry: {
              isEnabled: true,
              recordInputs: true,
              recordOutputs: true,
            },
            onFinish: async ({ finishReason, usage, steps, totalUsage, response, request }) => {
              const requestDuration = Date.now() - requestStartTime;

              // Update token tracking for compression decision on next iteration
              if (totalUsage?.totalTokens) {
                loopState.lastRequestTokens = totalUsage.totalTokens;
              }

              // Update conversation usage for UI display
              if (usage && conversationId && conversationId !== 'nested') {
                const inputTokens = usage.inputTokens || 0;
                const outputTokens = usage.outputTokens || 0;
                const cost = aiPricingService.calculateCost(model, {
                  inputTokens,
                  outputTokens,
                });
                useConversationUsageStore.getState().addUsage(cost, inputTokens, outputTokens);
              }

              logger.info('onFinish', {
                finishReason,
                requestDuration,
                totalUsage: totalUsage,
                usage: usage,
                steps: steps,
                lastRequestTokens: loopState.lastRequestTokens,
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
            tools: toolsForAI, // Use tool definitions WITHOUT execute methods
            abortSignal: abortController?.signal,
            includeRawChunks: true,
          });

          const streamCallbacks = { onChunk, onStatus, onAssistantMessageStart };
          const streamContext = { suppressReasoning };

          // Process current step stream
          for await (const delta of streamResult.fullStream) {
            // Check for abort signal during streaming
            if (abortController?.signal.aborted) {
              logger.info('Manual agent loop aborted during streaming');
              return;
            }

            switch (delta.type) {
              case 'text-start':
                this.streamProcessor.processTextStart(streamCallbacks);
                break;
              case 'text-delta':
                if (delta.text) {
                  this.streamProcessor.processTextDelta(delta.text, streamCallbacks);
                }
                break;
              case 'tool-call':
                this.streamProcessor.processToolCall(
                  {
                    toolCallId: delta.toolCallId,
                    toolName: delta.toolName,
                    input: delta.input,
                  },
                  streamCallbacks
                );
                break;
              case 'reasoning-start':
                this.streamProcessor.processReasoningStart(
                  (delta as { id: string }).id,
                  streamCallbacks
                );
                break;
              case 'reasoning-delta':
                if (delta.text) {
                  this.streamProcessor.processReasoningDelta(
                    (delta as { id: string }).id || 'default',
                    delta.text,
                    streamContext,
                    streamCallbacks
                  );
                }
                break;
              case 'reasoning-end':
                this.streamProcessor.processReasoningEnd(
                  (delta as { id: string }).id,
                  streamCallbacks
                );
                break;
              case 'raw': {
                // Store raw chunks for post-analysis debugging
                if (!loopState.rawChunks) {
                  loopState.rawChunks = [];
                }
                loopState.rawChunks.push(delta.rawValue);
                break;
              }
              case 'error': {
                this.streamProcessor.markError();

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

                // Check for too many consecutive errors
                const consecutiveErrors = this.streamProcessor.getConsecutiveToolErrors();
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

          // Get processed data from stream processor
          const toolCalls = this.streamProcessor.getToolCalls();
          const hasError = this.streamProcessor.hasError();

          // Process tool calls manually
          // Check if we should finish the loop
          if (hasError) {
            // If there was an error, continue to next iteration
            logger.info('Error occurred, continuing to next iteration');
            continue;
          }

          loopState.lastFinishReason = await streamResult.finishReason;
          const providerMetadata = await streamResult.providerMetadata;
          const response = await streamResult.response;

          logger.info('Finish reason', { finishReason: loopState.lastFinishReason });
          logger.info('Provider metadata', { providerMetadata });

          // Handle "unknown" finish reason by prompting continuation
          if (loopState.lastFinishReason === 'unknown' && toolCalls.length === 0) {
            // Enhanced logging for unknown finish reason
            logger.error('Unknown finish reason detected', {
              provider: providerModel.provider,
              model: model,
              providerMetadata,
              responseMessages: response?.messages,
              toolCallsCount: toolCalls.length,
              iteration: loopState.currentIteration,
            });
            // // Implement retry logic with continuation
            // const maxUnknownRetries = 2;
            // loopState.unknownFinishReasonCount = (loopState.unknownFinishReasonCount || 0) + 1;

            // if (loopState.unknownFinishReasonCount <= maxUnknownRetries) {
            //   logger.info(
            //     `Attempting retry for unknown finish reason (${loopState.unknownFinishReasonCount}/${maxUnknownRetries})`
            //   );

            //   // Add a user message to prompt the LLM to continue
            //   const continuationMessage: ModelMessage = {
            //     role: 'user',
            //     content: 'Please continue your response.',
            //   };
            //   loopState.messages.push(continuationMessage);
            //   continue;
            // }

            // Max retries reached
            logger.error('Max unknown finish reason retries reached', {
              retries: loopState.unknownFinishReasonCount,
              provider: providerModel.provider,
              model: model,
            });
            throw new Error(`LLM finished with unknown reason and no tool calls`);
          }

          if (toolCalls.length > 0) {
            // Check for abort signal before execution
            if (abortController?.signal.aborted) {
              logger.info('Manual agent loop aborted before tool execution');
              return;
            }

            const toolExecutionOptions = {
              tools: filteredTools,
              loopState,
              model,
              abortController,
              onToolMessage,
            };

            const results = await this.toolExecutor.executeWithSmartConcurrency(
              toolCalls,
              toolExecutionOptions,
              onStatus
            );

            // Check if get-skill tool returned skills with scripts
            for (const { toolCall, result } of results) {
              if (
                toolCall.toolName === 'getSkillTool' &&
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
                  '[Dynamic Tool] Detected skill with scripts, will add executeSkillScriptTool',
                  {
                    skill_name: skillResult.skill_name,
                    script_count: skillResult.script_count,
                  }
                );
                break; // Only need to set the flag once
              }
            }

            // Build combined assistant message with text/reasoning AND tool calls
            const assistantContent = this.streamProcessor.getAssistantContent();
            const toolCallParts = toolCalls.map((tc) => ({
              type: 'tool-call' as const,
              toolCallId: tc.toolCallId,
              toolName: tc.toolName,
              input: tc.input,
            }));

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
                  value: typeof result === 'string' ? result : JSON.stringify(result),
                },
              })),
            };
            loopState.messages.push(toolResultMessage);
          } else {
            // No tool calls - only add assistant message if there's text/reasoning content
            const assistantContent = this.streamProcessor.getAssistantContent();
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

        logger.info('Manual agent loop completed', {
          totalIterations: loopState.currentIteration,
          finalFinishReason: loopState.lastFinishReason,
        });
        const fullText = this.streamProcessor.getFullText();
        onComplete?.(fullText);
        resolve();
      } catch (error) {
        // Log the raw error object before processing
        logger.error('Raw error caught in main loop:', error);

        // Log error properties for debugging
        if (error && typeof error === 'object') {
          const errorObj = error as any;

          // Serialize error properties to avoid [object Object]
          const serializedError: Record<string, any> = {
            name: errorObj.name,
            message: errorObj.message,
            stack: errorObj.stack,
            // Include enhanced fetch context if available
            context: errorObj.context,
          };

          // Recursively serialize cause chain
          if (errorObj.cause) {
            const causeChain = [];
            let currentCause = errorObj.cause;
            let depth = 0;
            const maxDepth = 5;

            while (currentCause && depth < maxDepth) {
              causeChain.push({
                name: currentCause?.name || 'Unknown',
                message: currentCause?.message || String(currentCause),
                stack: currentCause?.stack,
                context: currentCause?.context,
              });
              currentCause = currentCause.cause;
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

export const llmService = new LLMService();
