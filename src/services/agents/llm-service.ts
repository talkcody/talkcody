// src/services/agents/llm-service.ts

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
import { toOpenAIToolDefinition } from '@/lib/tool-schema';
import { createLlmTraceContext } from '@/lib/trace-utils';
import { UsageTokenUtils } from '@/lib/usage-token-utils';
import { generateId } from '@/lib/utils';
import { getLocale, type SupportedLocale } from '@/locales';
import { getContextLength } from '@/providers/config/model-config';
import { parseModelIdentifier } from '@/providers/core/provider-utils';
import { modelTypeService } from '@/providers/models/model-type-service';
import { LLMStreamParams } from '@/services/agents/llm-stream-params';
import { lastReviewedChangeTimestamp } from '@/services/auto-code-review-service';
import { databaseService } from '@/services/database-service';
import { hookService } from '@/services/hooks/hook-service';
import { hookStateService } from '@/services/hooks/hook-state-service';
import { llmClient, type StreamTextResult } from '@/services/llm/llm-client';
import type {
  ContentPart,
  Message as LlmMessage,
  StreamEvent as LlmStreamEvent,
  Message as ModelMessage,
} from '@/services/llm/types';
import { getEffectiveWorkspaceRoot } from '@/services/workspace-root-service';
import { useSettingsStore } from '@/stores/settings-store';
import { useTaskStore } from '@/stores/task-store';
import type { ToolSummary } from '@/types/completion-hooks';
import { ModelType } from '@/types/model-types';
import type {
  AgentLoopOptions,
  AgentLoopState,
  CompressionConfig,
  MessageAttachment,
  UIMessage,
} from '../../types/agent';
import { aiPricingService } from '../ai/ai-pricing-service';
import { completionHookPipeline } from './llm-completion-hooks';

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
import { taskFileService } from '../task-file-service';
import { ErrorHandler } from './error-handler';
import { StreamProcessor, type StreamProcessorState } from './stream-processor';
import { ToolExecutor } from './tool-executor';

const MAX_STREAM_RETRIES = 3;
const STREAM_RETRY_BACKOFF_MS = [1000, 2000, 3000] as const;
const RETRYABLE_NETWORK_HINTS = [
  'load failed',
  'network',
  'timeout',
  'timed out',
  'connection reset',
  'connection refused',
  'upstream connect error',
  'disconnect/reset',
  'reset before headers',
  'fetch failed',
  'econnreset',
  'econnrefused',
  'enotfound',
  'eai_again',
] as const;

type StreamRetryCategory = 'openrouter-stream' | 'network' | 'server';

type StreamRetryDecision = {
  retryable: boolean;
  category?: StreamRetryCategory;
  reason: string;
  status?: number;
  hasVisibleOutput: boolean;
};

class RetryableStreamError extends Error {
  readonly decision: StreamRetryDecision;

  constructor(decision: StreamRetryDecision) {
    super(decision.reason);
    this.name = 'RetryableStreamError';
    this.decision = decision;
  }
}

function getTranslations() {
  const language = (useSettingsStore.getState().language || 'en') as SupportedLocale;
  return getLocale(language);
}

export class LLMService {
  private readonly messageCompactor: ContextCompactor;
  private readonly toolExecutor: ToolExecutor;
  private readonly errorHandler: ErrorHandler;
  /** Task ID for this LLM service instance (used for parallel task execution) */
  private readonly taskId: string;
  /** File name for compacted messages storage */
  private static readonly COMPACTED_MESSAGES_FILE = 'compacted-messages.json';
  /** Tool summaries collected during iteration for completion hooks */
  private toolSummaries: ToolSummary[] = [];

  private getDefaultCompressionConfig(): CompressionConfig {
    return {
      enabled: true,
      preserveRecentMessages: 6,
      compressionModel: modelTypeService.resolveModelTypeSync(ModelType.MESSAGE_COMPACTION),
      compressionThreshold: 0.8,
    };
  }

  private hasVisibleStreamOutput(state: StreamProcessorState): boolean {
    return (
      state.hasReceivedText || state.reasoningBlocks.some((block) => block.text.trim().length > 0)
    );
  }

  private isAbortError(error: unknown): boolean {
    if (
      typeof DOMException !== 'undefined' &&
      error instanceof DOMException &&
      error.name === 'AbortError'
    ) {
      return true;
    }

    if (error instanceof Error && error.name === 'AbortError') {
      return true;
    }

    return false;
  }

  private extractHttpStatusFromMessage(message: string): number | undefined {
    const match = message.match(/http(?:\s+error)?\s+(\d{3})/i);
    if (!match) {
      return undefined;
    }

    const parsed = Number.parseInt(match[1] ?? '', 10);
    return Number.isNaN(parsed) ? undefined : parsed;
  }

  private classifyStreamRetry(
    error: unknown,
    model: string,
    iteration: number,
    hasVisibleOutput: boolean
  ): StreamRetryDecision {
    const errorContext = createErrorContext(model, {
      iteration,
      phase: 'stream-retry',
    });
    const { errorDetails } = extractAndFormatError(error, errorContext);
    const message = errorDetails.message.toLowerCase();

    if (this.isAbortError(error)) {
      return {
        retryable: false,
        reason: errorDetails.message,
        hasVisibleOutput,
      };
    }

    if (
      errorDetails.name === 'AI_InvalidResponseDataError' &&
      errorDetails.message.includes("Expected 'id' to be a string")
    ) {
      return {
        retryable: !hasVisibleOutput,
        category: 'openrouter-stream',
        reason: errorDetails.message,
        hasVisibleOutput,
      };
    }

    const status =
      typeof errorDetails.status === 'number'
        ? errorDetails.status
        : this.extractHttpStatusFromMessage(errorDetails.message);

    if (typeof status === 'number') {
      if (status >= 500) {
        return {
          retryable: !hasVisibleOutput,
          category: 'server',
          reason: `HTTP ${status}: ${errorDetails.message}`,
          status,
          hasVisibleOutput,
        };
      }

      return {
        retryable: false,
        reason: `HTTP ${status}: ${errorDetails.message}`,
        status,
        hasVisibleOutput,
      };
    }

    const isNetworkError = RETRYABLE_NETWORK_HINTS.some((hint) => message.includes(hint));
    if (isNetworkError) {
      return {
        retryable: !hasVisibleOutput,
        category: 'network',
        reason: errorDetails.message,
        hasVisibleOutput,
      };
    }

    return {
      retryable: false,
      reason: errorDetails.message,
      hasVisibleOutput,
    };
  }

  private buildRetryExhaustedError(
    decision: StreamRetryDecision,
    t: ReturnType<typeof getTranslations>
  ): Error {
    const category =
      decision.category === 'server'
        ? t.LLMService.errors.retryCategoryServer
        : t.LLMService.errors.retryCategoryNetwork;

    return new Error(
      t.LLMService.errors.streamRetryExhausted(MAX_STREAM_RETRIES, category, decision.reason)
    );
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
   * Capture tool result for completion hook evaluation
   */
  private captureToolResult(toolName: string, result: unknown, toolCallId: string): void {
    const summary: ToolSummary = {
      toolName,
      toolCallId,
    };

    // Extract structured data from bash tool results
    if (toolName === 'bash' && result && typeof result === 'object') {
      const bashResult = result as {
        command?: string;
        success?: boolean;
        output?: string;
        error?: string;
      };
      summary.command = bashResult.command;
      summary.success = bashResult.success;
      summary.output = bashResult.output;
      summary.error = bashResult.error;
    } else if (result && typeof result === 'object' && 'error' in result) {
      summary.error = String((result as { error?: string }).error);
    }

    this.toolSummaries.push(summary);
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
    const t = getTranslations();
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
    // Use taskId as trace ID for the entire agent loop
    // This ensures all LLM calls in the same agent loop are grouped under one trace
    const traceId = this.taskId;
    // Note: parentSpanId is intentionally omitted until we create a real root span.
    // Passing a non-existent parentSpanId causes FK failures on spans.
    logger.info('[LLMService] Starting agent loop with trace', {
      traceId,
      taskId: this.taskId,
    });

    // biome-ignore lint/suspicious/noAsyncPromiseExecutor: Complex agent loop requires async Promise executor
    return new Promise<void>(async (resolve, reject) => {
      const { onChunk, onComplete, onError, onStatus, onToolMessage, onAssistantMessageStart } =
        callbacks;

      const rejectOnAbort = (message: string) => {
        logger.info(message);
        const abortError = new DOMException('Aborted', 'AbortError');
        onError?.(abortError);
        reject(abortError);
      };

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
          freshContext = false,
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
        const t = getTranslations();
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
        providerStore.getProviderModel(model);

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
        if (!freshContext && inputMessages.length > compressionConfig.preserveRecentMessages) {
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
        let ralphIteration = 0; // Track Ralph loop iterations separately from agent steps

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
            rejectOnAbort('Agent loop aborted by user');
            return;
          }

          loopState.currentIteration++;

          // Reset tool summaries at the start of each iteration to ensure
          // completion hooks only see results from the current iteration
          this.toolSummaries = [];

          const filteredTools = { ...tools };
          onStatus?.(t.LLMService.status.step(loopState.currentIteration));

          // Reset stream processor state for new iteration
          // Use resetState() instead of resetCurrentStepText() to ensure isAnswering flag is also reset
          // This is critical for multi-iteration scenarios (e.g., text -> tool call -> text)
          streamProcessor.resetState();

          // Check and perform message compression if needed
          try {
            if (!freshContext) {
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
                  t.LLMService.status.compressed(
                    compressionResult.result.compressionRatio.toFixed(2)
                  )
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

          // Create tool definitions without execute methods
          // This prevents auto-executing tools, which would bypass ToolExecutor
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
          );

          // Retry loop for transient network/provider failures.
          // 3 retries means 1 initial attempt + up to 3 additional attempts.
          let streamRetryCount = 0;
          let streamResult: StreamTextResult | null = null;
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

              const { providerOptions, temperature, topP, topK } = LLMStreamParams.build({
                modelIdentifier: model,
                reasoningEffort,
                enableReasoningOptions: isThink,
              });

              const llmMessages: LlmMessage[] = loopState.messages.map((msg) => {
                if (msg.role === 'tool' && Array.isArray(msg.content)) {
                  return {
                    role: 'tool',
                    content: (msg.content as Array<{ type: string }>).map((part) => {
                      if (part.type === 'tool-result') {
                        return {
                          type: 'tool-result',
                          toolCallId: (part as unknown as { toolCallId: string }).toolCallId,
                          toolName: (part as unknown as { toolName: string }).toolName,
                          output: (part as unknown as { output: unknown }).output,
                        };
                      }
                      return part as unknown as LlmMessage['content'][number];
                    }),
                    providerOptions: (msg as { providerOptions?: Record<string, unknown> })
                      .providerOptions,
                  } as LlmMessage;
                }

                if (msg.role === 'assistant' && Array.isArray(msg.content)) {
                  return {
                    role: 'assistant',
                    content: (msg.content as Array<{ type: string }>).map((part) => {
                      if (part.type === 'tool-call') {
                        return {
                          type: 'tool-call',
                          toolCallId: (part as unknown as { toolCallId: string }).toolCallId,
                          toolName: (part as unknown as { toolName: string }).toolName,
                          input: (part as unknown as { input: unknown }).input,
                        };
                      }
                      return part as unknown as LlmMessage['content'][number];
                    }),
                    providerOptions: (msg as { providerOptions?: Record<string, unknown> })
                      .providerOptions,
                  } as LlmMessage;
                }

                return {
                  role: msg.role as LlmMessage['role'],
                  content: msg.content as LlmMessage['content'],
                  providerOptions: (msg as { providerOptions?: Record<string, unknown> })
                    .providerOptions,
                } as LlmMessage;
              });

              const tools = Object.entries(toolsForAI).map(([name, tool]) => {
                const toolDef = tool as { description?: string; inputSchema?: unknown };
                return toOpenAIToolDefinition(name, toolDef.description, toolDef.inputSchema, {
                  modelIdentifier: model,
                });
              });

              const traceEnabled = useSettingsStore.getState().getTraceEnabled?.() ?? true;
              const traceContext = traceEnabled
                ? createLlmTraceContext(traceId, model, loopState.currentIteration)
                : null;

              streamResult = await llmClient.streamText(
                {
                  model,
                  messages: llmMessages,
                  tools: tools.length > 0 ? tools : undefined,
                  temperature,
                  maxTokens: 15000,
                  topP,
                  topK,
                  providerOptions: providerOptions ?? undefined,
                  traceContext,
                },
                abortController?.signal
              );

              const streamCallbacks = { onChunk, onStatus, onAssistantMessageStart };
              const streamContext = { suppressReasoning };

              // Process current step stream
              for await (const delta of streamResult.events) {
                if (abortController?.signal.aborted) {
                  rejectOnAbort('Agent loop aborted during streaming');
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
                        input: delta.input,
                        providerMetadata: delta.providerMetadata ?? undefined,
                      },
                      streamCallbacks
                    );
                    break;
                  case 'reasoning-start':
                    streamProcessor.processReasoningStart(
                      delta.id,
                      delta.providerMetadata ?? undefined,
                      streamCallbacks
                    );
                    break;
                  case 'reasoning-delta':
                    streamProcessor.processReasoningDelta(
                      delta.id || 'default',
                      delta.text || '',
                      delta.providerMetadata ?? undefined,
                      streamContext,
                      streamCallbacks
                    );
                    break;
                  case 'reasoning-end':
                    streamProcessor.processReasoningEnd(delta.id, streamCallbacks);
                    break;
                  case 'usage': {
                    const requestDuration = Date.now() - requestStartTime;
                    const normalizedUsage = UsageTokenUtils.normalizeUsageTokens(
                      {
                        inputTokens: delta.input_tokens,
                        outputTokens: delta.output_tokens,
                        cachedInputTokens: delta.cached_input_tokens ?? undefined,
                        cacheCreationInputTokens: delta.cache_creation_input_tokens ?? undefined,
                        totalTokens: delta.total_tokens ?? undefined,
                      },
                      undefined
                    );

                    if (normalizedUsage?.totalTokens) {
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
                      const {
                        inputTokens,
                        outputTokens,
                        cachedInputTokens,
                        cacheCreationInputTokens,
                      } = normalizedUsage;
                      const cost = await aiPricingService.calculateCost(model, {
                        inputTokens,
                        outputTokens,
                        cachedInputTokens,
                        cacheCreationInputTokens,
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
                        const taskStore = useTaskStore.getState();
                        taskStore.updateTask(this.taskId, {
                          last_request_input_token: inputTokens,
                        });
                        taskStore.updateTaskUsage(this.taskId, {
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
                      finishReason: delta.total_tokens ? 'stop' : 'unknown',
                      requestDuration,
                      totalUsage: delta.total_tokens,
                      lastRequestTokens: loopState.lastRequestTokens,
                      request: 'llm_stream_text',
                    });
                    break;
                  }
                  case 'done':
                    loopState.lastFinishReason = delta.finish_reason ?? undefined;
                    break;
                  case 'raw': {
                    if (!loopState.rawChunks) {
                      loopState.rawChunks = [];
                    }
                    loopState.rawChunks.push(delta.raw_value);
                    break;
                  }
                  case 'error': {
                    streamProcessor.markError();

                    const errorObj = new Error(delta.message);
                    if (delta.name) {
                      errorObj.name = delta.name;
                    }

                    if (isContextLengthExceededError(errorObj)) {
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

                    const visibleOutput = this.hasVisibleStreamOutput(streamProcessor.getState());
                    const retryDecision = this.classifyStreamRetry(
                      errorObj,
                      model,
                      loopState.currentIteration,
                      visibleOutput
                    );

                    if (retryDecision.retryable) {
                      throw new RetryableStreamError(retryDecision);
                    }

                    const errorHandlerOptions = {
                      model,
                      tools: filteredTools,
                      loopState,
                      onError,
                    };

                    const errorResult = this.errorHandler.handleStreamError(
                      errorObj,
                      errorHandlerOptions
                    );

                    if (errorResult.shouldStop) {
                      const error =
                        errorResult.error || new Error('Unknown error occurred during streaming');
                      onError?.(error);
                      reject(error);
                      return;
                    }

                    if (errorResult.error) {
                      onError?.(errorResult.error);
                    }

                    const consecutiveErrors = streamProcessor.getConsecutiveToolErrors();
                    // Add guidance message when too many consecutive errors occur, but continue the loop
                    this.errorHandler.addConsecutiveErrorGuidance(
                      consecutiveErrors,
                      errorHandlerOptions
                    );

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

              const visibleOutput = this.hasVisibleStreamOutput(streamProcessor.getState());
              const retryDecision =
                streamError instanceof RetryableStreamError
                  ? streamError.decision
                  : this.classifyStreamRetry(
                      streamError,
                      model,
                      loopState.currentIteration,
                      visibleOutput
                    );

              if (retryDecision.retryable && streamRetryCount < MAX_STREAM_RETRIES) {
                streamRetryCount++;
                const sleepMs = STREAM_RETRY_BACKOFF_MS[streamRetryCount - 1] ?? 3000;

                logger.warn(
                  `[LLMService] Retryable stream failure (${retryDecision.category || 'unknown'}) ` +
                    `retry ${streamRetryCount}/${MAX_STREAM_RETRIES}`,
                  {
                    iteration: loopState.currentIteration,
                    reason: retryDecision.reason,
                    status: retryDecision.status,
                    hasVisibleOutput: retryDecision.hasVisibleOutput,
                  }
                );

                await new Promise((resolve) => setTimeout(resolve, sleepMs));
                continue;
              }

              if (retryDecision.retryable) {
                throw this.buildRetryExhaustedError(retryDecision, t);
              }

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

          if (!loopState.lastFinishReason) {
            loopState.lastFinishReason = 'stop';
          }
          // Handle "unknown" finish reason by retrying without modifying messages
          if (loopState.lastFinishReason === 'other' && toolCalls.length === 0) {
            const maxUnknownRetries = 3;
            loopState.unknownFinishReasonCount = (loopState.unknownFinishReasonCount || 0) + 1;

            logger.warn('Unknown finish reason detected', {
              provider: providerId ?? 'unknown',
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
              provider: providerId ?? 'unknown',
              model: model,
            });
            throw new Error(t.LLMService.errors.unknownFinishReason);
          }

          if (abortController?.signal.aborted) {
            rejectOnAbort('Agent loop aborted before completion hooks');
            return;
          }

          // Run completion hook pipeline on successful finish (no tool calls)
          const shouldRunCompletionHooks =
            this.taskId &&
            toolCalls.length === 0 &&
            !isSubagent &&
            (!agentId || agentId === 'planner');

          if (shouldRunCompletionHooks) {
            const fullText = streamProcessor.getFullText();

            // Increment Ralph iteration counter (separate from agent step counter)
            ralphIteration++;

            // Build completion context
            const completionContext = {
              taskId: this.taskId,
              fullText,
              toolSummaries: this.toolSummaries,
              loopState,
              iteration: ralphIteration,
              startTime: totalStartTime,
              userMessage: inputMessages.find((m) => m.role === 'user')?.content as
                | string
                | undefined,
              systemPrompt,
            };

            // Run completion hook pipeline
            const result = await completionHookPipeline.run(completionContext);

            if (result.action === 'continue') {
              const continuationMode = result.continuationMode || 'replace';
              let shouldContinueLoop = false;
              let continuationSource: 'replace' | 'task-store' | 'next-messages' | 'none' = 'none';

              logger.info('[LLMService] Completion hook requested continuation', {
                taskId: this.taskId,
                iteration: loopState.currentIteration,
                continuationMode,
                nextMessageCount: result.nextMessages?.length || 0,
              });

              if (continuationMode === 'append') {
                if (this.taskId && this.taskId !== 'nested') {
                  const latestTaskMessages = useTaskStore.getState().getMessages(this.taskId);
                  if (latestTaskMessages.length > 0) {
                    const rebuiltMessages = await convertMessages(latestTaskMessages, {
                      rootPath,
                      systemPrompt,
                      model,
                      providerId: providerId ?? undefined,
                    });

                    loopState.messages = convertToAnthropicFormat(rebuiltMessages, {
                      autoFix: true,
                      trimAssistantWhitespace: true,
                    });
                    shouldContinueLoop = true;
                    continuationSource = 'task-store';
                  }
                }

                if (!shouldContinueLoop && result.nextMessages && result.nextMessages.length > 0) {
                  const appendedMessages = await convertMessages(result.nextMessages, {
                    rootPath,
                    systemPrompt: undefined,
                    model,
                    providerId: providerId ?? undefined,
                  });

                  loopState.messages = convertToAnthropicFormat(
                    [...loopState.messages, ...appendedMessages],
                    {
                      autoFix: true,
                      trimAssistantWhitespace: true,
                    }
                  );
                  shouldContinueLoop = true;
                  continuationSource = 'next-messages';
                }
              } else if (result.nextMessages) {
                const newModelMessages = await convertMessages(result.nextMessages, {
                  rootPath,
                  systemPrompt,
                  model,
                  providerId: providerId ?? undefined,
                });

                loopState.messages = convertToAnthropicFormat(newModelMessages, {
                  autoFix: true,
                  trimAssistantWhitespace: true,
                });
                shouldContinueLoop = true;
                continuationSource = 'replace';
              }

              if (!shouldContinueLoop) {
                logger.warn(
                  '[LLMService] Completion continue request ignored due to empty context',
                  {
                    taskId: this.taskId,
                    continuationMode,
                  }
                );
              } else {
                logger.info('[LLMService] Applying completion continuation context', {
                  taskId: this.taskId,
                  continuationMode,
                  continuationSource,
                  messageCount: loopState.messages.length,
                });

                // Reset loop state for next iteration
                loopState.lastRequestTokens = 0;
                loopState.unknownFinishReasonCount = 0;
                loopState.lastFinishReason = undefined;
                loopState.isComplete = false;

                // Reset tool summaries for next iteration
                this.toolSummaries = [];

                // Reset stream processor for fresh iteration
                streamProcessor.fullReset();

                // Continue the loop with updated context
                continue;
              }
            }

            if (result.action === 'stop') {
              // Hook requested stop
              logger.info('[LLMService] Completion hook requested stop', {
                taskId: this.taskId,
                stopReason: result.stopReason,
                stopMessage: result.stopMessage,
              });

              // Continue to final completion
            }
          }

          if (toolCalls.length > 0) {
            // Check for abort signal before execution
            if (abortController?.signal.aborted) {
              rejectOnAbort('Agent loop aborted before tool execution');
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

            // Execute tools with result capture callback
            const results = await this.toolExecutor.executeWithSmartConcurrency(
              toolCalls,
              toolExecutionOptions,
              onStatus,
              // Capture tool results for completion hooks
              (toolName, result, toolCallId) => {
                this.captureToolResult(toolName, result, toolCallId);
              }
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
              const part: ContentPart = {
                type: 'tool-call' as const,
                toolCallId: tc.toolCallId,
                toolName: tc.toolName,
                input,
              };
              // Include providerMetadata if present (for Gemini 3 models with thoughtSignature)
              if (tc.providerMetadata) {
                part.providerMetadata = tc.providerMetadata;
              }
              return part;
            });

            const combinedAssistantContent: ContentPart[] = [...assistantContent, ...toolCallParts];

            // Apply provider-specific transformation (e.g., DeepSeek reasoning_content)
            const { providerId: pid } = parseModelIdentifier(model);
            const { transformedContent } = MessageTransform.transform(
              loopState.messages,
              model,
              pid ?? undefined,
              combinedAssistantContent
            );

            const assistantMessage: ModelMessage = {
              role: 'assistant',
              content: transformedContent?.content ?? combinedAssistantContent,
              ...(transformedContent?.providerOptions && {
                providerOptions: transformedContent.providerOptions,
              }),
            };
            loopState.messages.push(assistantMessage);

            const toolResultMessage: ModelMessage = {
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
              const assistantMessage: ModelMessage = {
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
        if (this.taskId && this.taskId !== 'nested') {
          lastReviewedChangeTimestamp.delete(this.taskId);
        }
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

        if (this.taskId && this.taskId !== 'nested') {
          lastReviewedChangeTimestamp.delete(this.taskId);
        }

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
