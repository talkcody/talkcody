// src/services/agents/tool-executor.ts
import type { ToolSet } from 'ai';
import { createErrorContext, extractAndFormatError } from '@/lib/error-utils';
import { logger } from '@/lib/logger';
import { getToolMetadata } from '@/lib/tools';
import type { Tracer } from '@/lib/tracer';
import { decodeObjectHtmlEntities, generateId } from '@/lib/utils';
import type { AgentLoopState, UIMessage } from '@/types/agent';
import {
  type ExecutionGroup,
  type ExecutionStage,
  ToolDependencyAnalyzer,
} from './tool-dependency-analyzer';
import { isValidToolName, normalizeToolName } from './tool-name-normalizer';

export interface ToolCallInfo {
  toolCallId: string;
  toolName: string;
  input: unknown;
}

export interface ToolExecutionOptions {
  tools: ToolSet;
  loopState: AgentLoopState;
  model: string;
  abortController?: AbortController;
  onToolMessage?: (message: UIMessage) => void;
  tracer?: Tracer;
}

type CallAgentArgs = Record<string, unknown> & {
  _abortController?: AbortController;
  _toolCallId?: string;
  _onNestedToolMessage?: (message: UIMessage) => void;
};

/**
 * ToolExecutor handles tool execution and grouping
 */
export class ToolExecutor {
  private readonly dependencyAnalyzer: ToolDependencyAnalyzer;

  constructor() {
    this.dependencyAnalyzer = new ToolDependencyAnalyzer();
  }

  /**
   * Parse nested JSON strings in object fields
   * Handles cases where LLM returns arrays/objects as JSON strings
   */
  private parseNestedJsonStrings(obj: unknown): unknown {
    if (Array.isArray(obj)) {
      return obj.map((item) => this.parseNestedJsonStrings(item));
    }

    if (typeof obj !== 'object' || obj === null) {
      return obj;
    }

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (typeof value === 'string') {
        // Check if the string looks like a JSON array or object
        const trimmed = value.trim();
        if (
          (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
          (trimmed.startsWith('{') && trimmed.endsWith('}'))
        ) {
          try {
            result[key] = JSON.parse(value);
            logger.info(`[ToolExecutor] Parsed JSON string for field '${key}'`, {
              original: value,
              parsed: result[key],
            });
          } catch (_error) {
            // If parsing fails, keep as string
            result[key] = value;
          }
        } else {
          result[key] = value;
        }
      } else if (typeof value === 'object' && value !== null) {
        result[key] = this.parseNestedJsonStrings(value);
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  private isExecutableTool(
    tool: unknown
  ): tool is { execute: (args: unknown) => Promise<unknown> } {
    return (
      typeof tool === 'object' &&
      tool !== null &&
      typeof (tool as { execute?: unknown }).execute === 'function'
    );
  }

  /**
   * Execute tool calls with smart concurrency analysis
   * This method automatically analyzes dependencies and maximizes parallelism
   */
  async executeWithSmartConcurrency(
    toolCalls: ToolCallInfo[],
    options: ToolExecutionOptions,
    onStatus?: (status: string) => void
  ): Promise<Array<{ toolCall: ToolCallInfo; result: unknown }>> {
    // Generate execution plan using dependency analyzer
    const plan = this.dependencyAnalyzer.analyzeDependencies(toolCalls, options.tools);

    logger.info('Executing with smart concurrency', {
      totalTools: plan.summary.totalTools,
      totalStages: plan.summary.totalStages,
      totalGroups: plan.summary.totalGroups,
      concurrentGroups: plan.summary.concurrentGroups,
    });

    // Execute all stages sequentially
    const allResults: Array<{ toolCall: ToolCallInfo; result: unknown }> = [];

    for (const stage of plan.stages) {
      onStatus?.(`${stage.description}`);

      const stageResults = await this.executeStage(stage, options, onStatus);
      allResults.push(...stageResults);

      // Check for abort signal between stages
      if (options.abortController?.signal.aborted) {
        logger.info('Smart concurrency execution aborted between stages');
        break;
      }
    }

    return allResults;
  }

  /**
   * Execute a single stage (which may contain multiple groups)
   */
  private async executeStage(
    stage: ExecutionStage,
    options: ToolExecutionOptions,
    onStatus?: (status: string) => void
  ): Promise<Array<{ toolCall: ToolCallInfo; result: unknown }>> {
    logger.info(`Executing stage: ${stage.name}`, {
      description: stage.description,
      groupCount: stage.groups.length,
    });

    const results: Array<{ toolCall: ToolCallInfo; result: unknown }> = [];

    // Execute all groups in this stage sequentially
    for (const group of stage.groups) {
      logger.info(`Executing group: ${group.id}`, {
        concurrent: group.concurrent,
        toolCount: group.tools.length,
        toolNames: group.tools.map((tool) => tool.toolName),
        toolCallIds: group.tools.map((tool) => tool.toolCallId),
        maxConcurrency: group.maxConcurrency,
        reason: group.reason,
        targetFiles: group.targetFiles,
      });

      const groupResults = await this.executeToolGroup(group, options, onStatus);

      results.push(...groupResults);

      // Check for abort signal between groups
      if (options.abortController?.signal.aborted) {
        logger.info('Stage execution aborted between groups');
        break;
      }
    }

    return results;
  }

  /**
   * Execute a single tool call
   */
  async executeToolCall(toolCall: ToolCallInfo, options: ToolExecutionOptions): Promise<unknown> {
    const { tools, loopState, model, abortController, onToolMessage } = options;

    const toolStartTime = Date.now();

    logger.info('Starting tool execution', {
      toolName: toolCall.toolName,
      toolCallId: toolCall.toolCallId,
    });

    try {
      // Validate and normalize tool name to prevent API errors
      // Some AI models may return tool names with invalid characters (e.g., "bash Tool" instead of "bash")
      let normalizedToolName = toolCall.toolName;

      if (!isValidToolName(toolCall.toolName)) {
        logger.warn('[ToolExecutor] Invalid tool name detected, attempting normalization', {
          originalToolName: toolCall.toolName,
          toolCallId: toolCall.toolCallId,
        });

        const normalized = normalizeToolName(toolCall.toolName);

        if (normalized) {
          normalizedToolName = normalized;
          // Update the toolCall object with normalized name
          toolCall.toolName = normalizedToolName;
          logger.info('[ToolExecutor] Successfully normalized tool name', {
            originalToolName: toolCall.toolName,
            normalizedToolName,
            toolCallId: toolCall.toolCallId,
          });
        } else {
          // If normalization fails, let it proceed with original name
          // The tool-not-found handler will provide better error messages
          logger.error('[ToolExecutor] Failed to normalize invalid tool name', {
            originalToolName: toolCall.toolName,
            toolCallId: toolCall.toolCallId,
          });
        }
      }

      const tool = tools[normalizedToolName];
      if (this.isExecutableTool(tool)) {
        // Decode HTML entities in tool arguments to fix encoding issues from LLM output
        const decodedInput = decodeObjectHtmlEntities(toolCall.input);

        // If decodedInput is a JSON string, parse it to object
        let parsedInput: unknown = decodedInput;
        if (typeof decodedInput === 'string') {
          try {
            parsedInput = JSON.parse(decodedInput);
          } catch (error) {
            // If parsing fails, keep it as string (might be intentional string parameter)
            logger.warn('[ToolExecutor] Failed to parse input as JSON, keeping as string', {
              toolName: toolCall.toolName,
              error: error instanceof Error ? error.message : 'Unknown error',
            });
            parsedInput = decodedInput;
          }
        } else if (typeof decodedInput === 'object' && decodedInput !== null) {
          // Parse stringified arrays/objects within the object fields
          parsedInput = this.parseNestedJsonStrings(decodedInput);
        }

        // Prepare tool arguments - create a mutable copy to allow adding properties
        // Ensure toolArgs is at least an empty object to prevent undefined from breaking parameter destructuring
        let toolArgs: unknown =
          typeof parsedInput === 'object' && parsedInput !== null
            ? { ...(parsedInput as Record<string, unknown>) }
            : parsedInput !== undefined
              ? { value: parsedInput }
              : {};

        // Pass special parameters to callAgent tool
        if (toolCall.toolName === 'callAgent') {
          const callAgentArgs: CallAgentArgs =
            typeof toolArgs === 'object' && toolArgs !== null ? (toolArgs as CallAgentArgs) : {};
          if (abortController) {
            callAgentArgs._abortController = abortController;
          }
          // Pass toolCallId so callAgent can use it as the execution ID
          callAgentArgs._toolCallId = toolCall.toolCallId;
          if (onToolMessage) {
            callAgentArgs._onNestedToolMessage = (message: UIMessage) => {
              onToolMessage({
                ...message,
                parentToolCallId: toolCall.toolCallId,
              });
            };
          }
          toolArgs = callAgentArgs;
        }

        // Get tool metadata to check if we should render the "doing" UI
        const toolMetadata = getToolMetadata(toolCall.toolName);

        // Always send tool-call message for persistence, regardless of renderDoingUI
        // The UI can decide whether to render based on the metadata
        if (onToolMessage) {
          const toolCallMessage: UIMessage = {
            id: toolCall.toolCallId,
            role: 'tool',
            content: [
              {
                type: 'tool-call',
                toolCallId: toolCall.toolCallId,
                toolName: toolCall.toolName,
                input: toolArgs,
              },
            ],
            timestamp: new Date(),
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
            nestedTools: [],
            // Add metadata flag so UI knows whether to render
            renderDoingUI: toolMetadata.renderDoingUI,
          };

          onToolMessage(toolCallMessage);
        } else {
          logger.warn(
            '[ToolExecutor-Send] ⚠️ onToolMessage callback is undefined, skipping tool-call message',
            {
              toolName: toolCall.toolName,
              toolCallId: toolCall.toolCallId,
            }
          );
        }

        const toolResult = await tool.execute(toolArgs);
        const toolDuration = Date.now() - toolStartTime;

        logger.info('Tool execution completed', {
          toolName: toolCall.toolName,
          toolCallId: toolCall.toolCallId,
          args: toolArgs,
          duration: toolDuration,
          success: true,
        });

        // Create tool-result message after execution
        if (onToolMessage) {
          const toolResultMessage: UIMessage = {
            id: `tool-${toolCall.toolName}-${generateId(6)}`, // Use unique ID with tool name prefix
            role: 'tool',
            content: [
              {
                type: 'tool-result',
                toolCallId: toolCall.toolCallId,
                toolName: toolCall.toolName,
                input: toolArgs,
                output: toolResult,
              },
            ],
            timestamp: new Date(),
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
          };
          onToolMessage(toolResultMessage);
          logger.info('[ToolExecutor] ✅ Tool-result message sent successfully');
        } else {
          logger.warn(
            '[ToolExecutor] ⚠️ onToolMessage callback is undefined, skipping tool-result message'
          );
        }

        return toolResult;
      } else {
        // Tool not found
        const toolDuration = Date.now() - toolStartTime;
        logger.error('Tool not found', undefined, {
          toolName: toolCall.toolName,
          toolCallId: toolCall.toolCallId,
          duration: toolDuration,
        });

        const result = this.handleToolNotFound(toolCall, tools, model, loopState);

        return result;
      }
    } catch (error) {
      const toolDuration = Date.now() - toolStartTime;
      logger.error('Tool execution failed', error, {
        toolName: toolCall.toolName,
        toolCallId: toolCall.toolCallId,
        duration: toolDuration,
      });

      const result = this.handleToolExecutionError(error, toolCall, model, loopState);
      return result;
    }
  }

  /**
   * Execute a group of tool calls (concurrent or sequential)
   * Used internally by executeStage for executing groups
   */
  private async executeToolGroup(
    group: ExecutionGroup,
    options: ToolExecutionOptions,
    onStatus?: (status: string) => void
  ): Promise<Array<{ toolCall: ToolCallInfo; result: unknown }>> {
    if (group.concurrent && group.tools.length > 1) {
      return this.executeConcurrentTools(group.tools, options, onStatus, group.maxConcurrency);
    } else {
      return this.executeSequentialTools(group.tools, options, onStatus);
    }
  }

  /**
   * Execute tools concurrently
   */
  private async executeConcurrentTools(
    toolCalls: ToolCallInfo[],
    options: ToolExecutionOptions,
    onStatus?: (status: string) => void,
    maxConcurrency?: number
  ): Promise<Array<{ toolCall: ToolCallInfo; result: unknown }>> {
    const effectiveLimit =
      typeof maxConcurrency === 'number' && maxConcurrency > 0
        ? Math.min(maxConcurrency, toolCalls.length)
        : toolCalls.length;

    logger.info(`Executing ${toolCalls.length} tools concurrently`, {
      toolCallIds: toolCalls.map((tool) => tool.toolCallId),
      toolNames: toolCalls.map((tool) => tool.toolName),
      maxConcurrency: effectiveLimit,
    });

    const results: Array<{ toolCall: ToolCallInfo; result: unknown }> = [];

    for (let i = 0; i < toolCalls.length; i += effectiveLimit) {
      // Check for abort signal before starting each batch
      if (options.abortController?.signal.aborted) {
        logger.info('Tool execution aborted before concurrent batch');
        break;
      }

      const batch = toolCalls.slice(i, i + effectiveLimit);
      const batchResults = await Promise.all(
        batch.map(async (toolCall) => ({
          toolCall,
          result: await this.executeToolCall(toolCall, options),
        }))
      );
      results.push(...batchResults);

      if (toolCalls.length > effectiveLimit) {
        const processedCount = Math.min(i + effectiveLimit, toolCalls.length);
        onStatus?.(
          `Processing ${batch.length} tools concurrently (${processedCount}/${toolCalls.length})`
        );
      } else {
        onStatus?.(`Processing ${batch.length} tools concurrently`);
      }
    }

    return results;
  }

  /**
   * Execute tools sequentially
   */
  private async executeSequentialTools(
    toolCalls: ToolCallInfo[],
    options: ToolExecutionOptions,
    onStatus?: (status: string) => void
  ): Promise<Array<{ toolCall: ToolCallInfo; result: unknown }>> {
    logger.info(`Executing ${toolCalls.length} tools sequentially`, {
      toolCallIds: toolCalls.map((tool) => tool.toolCallId),
      toolNames: toolCalls.map((tool) => tool.toolName),
    });

    const results: Array<{ toolCall: ToolCallInfo; result: unknown }> = [];

    for (const toolCall of toolCalls) {
      // Check for abort signal
      if (options.abortController?.signal.aborted) {
        logger.info('Tool execution aborted during sequential execution');
        break;
      }

      onStatus?.(`Processing tool ${toolCall.toolName}`);
      const result = await this.executeToolCall(toolCall, options);
      results.push({ toolCall, result });
    }

    return results;
  }

  /**
   * Handle tool not found error
   */
  private handleToolNotFound(
    toolCall: ToolCallInfo,
    tools: ToolSet,
    model: string,
    loopState: AgentLoopState
  ): unknown {
    const availableTools = Object.keys(tools);
    const errorMessage = `Tool '${toolCall.toolName}' not found or does not have execute method. Available tools: ${availableTools.join(', ')}`;

    const errorContext = createErrorContext(model, {
      iteration: loopState.currentIteration,
      messageCount: loopState.messages.length,
      phase: 'tool-validation',
      toolName: toolCall.toolName,
      toolInput: toolCall.input,
    });

    logger.error(`Tool not found: ${errorMessage}`, {
      ...errorContext,
      availableTools,
      requestedTool: toolCall.toolName,
      toolInput: toolCall.input,
    });

    return {
      success: false,
      error: errorMessage,
      availableTools,
      requestedTool: toolCall.toolName,
      errorType: 'tool-not-found',
    };
  }

  /**
   * Handle tool execution error
   */
  private handleToolExecutionError(
    error: unknown,
    toolCall: ToolCallInfo,
    model: string,
    loopState: AgentLoopState
  ): unknown {
    const errorContext = createErrorContext(model, {
      iteration: loopState.currentIteration,
      messageCount: loopState.messages.length,
      phase: 'tool-execution',
      toolName: toolCall.toolName,
      toolInput: toolCall.input,
    });

    const { errorDetails, formattedError } = extractAndFormatError(error, errorContext);

    logger.error(`Error executing tool ${toolCall.toolName}:`, formattedError);

    return {
      success: false,
      error: `Tool execution failed: ${errorDetails.message}`,
      toolName: toolCall.toolName,
      errorDetails: {
        name: errorDetails.name,
        message: errorDetails.message,
        status: errorDetails.status,
        code: errorDetails.code,
        timestamp: errorDetails.timestamp,
      },
    };
  }
}
