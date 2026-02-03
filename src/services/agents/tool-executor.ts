// src/services/agents/tool-executor.ts
import { createErrorContext, extractAndFormatError } from '@/lib/error-utils';
import { logger } from '@/lib/logger';
import { getToolMetadata } from '@/lib/tools';
import type { Tracer } from '@/lib/tracer';
import { decodeObjectHtmlEntities, generateId } from '@/lib/utils';
import { databaseService } from '@/services/database-service';
import { hookService } from '@/services/hooks/hook-service';
import type { AgentLoopState, AgentToolSet, UIMessage } from '@/types/agent';
import type { ToolExecuteContext, ToolInput, ToolOutput, ToolWithUI } from '@/types/tool';
import type { AgentExecutionGroup, AgentExecutionStage } from './agent-dependency-analyzer';
import {
  DependencyAnalyzer,
  isAgentExecutionPlan,
  type UnifiedExecutionPlan,
} from './dependency-analyzer';
import type { ExecutionGroup, ExecutionStage } from './tool-dependency-analyzer';
import { isValidToolName, normalizeToolName } from './tool-name-normalizer';

export interface ToolCallInfo {
  toolCallId: string;
  toolName: string;
  input: unknown;
  providerMetadata?: Record<string, unknown>;
}

export interface ToolExecutionOptions {
  tools: AgentToolSet;
  loopState: AgentLoopState;
  model: string;
  taskId: string;
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
  private readonly dependencyAnalyzer: DependencyAnalyzer;

  constructor() {
    this.dependencyAnalyzer = new DependencyAnalyzer();
  }

  /** Maximum recursion depth for JSON parsing to prevent stack overflow from malicious input */
  private static readonly MAX_JSON_PARSE_DEPTH = 10;

  /**
   * Parse nested JSON strings in object fields
   * Handles cases where LLM returns arrays/objects as JSON strings
   * @param obj The object to parse
   * @param depth Current recursion depth (used internally to prevent stack overflow)
   */
  private parseNestedJsonStrings(obj: unknown, depth = 0): unknown {
    // Prevent stack overflow from deeply nested or malicious input
    if (depth > ToolExecutor.MAX_JSON_PARSE_DEPTH) {
      logger.warn('[ToolExecutor] Max JSON parse depth exceeded, returning object as-is', {
        maxDepth: ToolExecutor.MAX_JSON_PARSE_DEPTH,
        currentDepth: depth,
      });
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.parseNestedJsonStrings(item, depth + 1));
    }

    if (typeof obj !== 'object' || obj === null) {
      return obj;
    }

    // Fields known to be arrays/objects that LLM may return as stringified JSON
    // Only parse these specific fields, NOT content fields like 'content', 'old_string', 'new_string'
    const PARSE_JSON_FIELDS = [
      'edits', // editFile
      'file_types', // codeSearch
      'targets', // callAgent
      'todos', // todoWrite
      'questions', // askUserQuestions
      'options', // askUserQuestions (nested)
      'args', // executeSkillScript
      'environment', // executeSkillScript
    ];

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (typeof value === 'string') {
        // Only parse fields in the allow list to avoid corrupting content fields
        if (PARSE_JSON_FIELDS.includes(key)) {
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
        } else {
          result[key] = value;
        }
      } else if (typeof value === 'object' && value !== null) {
        result[key] = this.parseNestedJsonStrings(value, depth + 1);
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
   * Check if tool is a ToolWithUI (has UI rendering capabilities)
   */
  private isToolWithUI(tool: unknown): tool is ToolWithUI {
    return (
      typeof tool === 'object' &&
      tool !== null &&
      'renderToolDoing' in tool &&
      'renderToolResult' in tool
    );
  }

  /**
   * Execute a tool with appropriate context handling
   * ToolWithUI tools receive context, other tools do not
   */
  private async executeTool(
    tool: { execute: (args: unknown) => Promise<unknown> },
    args: unknown,
    context: ToolExecuteContext
  ): Promise<unknown> {
    if (this.isToolWithUI(tool)) {
      // ToolWithUI tools support context parameter
      return tool.execute(args as ToolInput, context);
    }
    // Standard tools (e.g., vercel ai tools) don't support context
    return tool.execute(args);
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
    const plan = await this.dependencyAnalyzer.analyzeDependencies(toolCalls, options.tools);
    // Execute all stages sequentially
    const allResults: Array<{ toolCall: ToolCallInfo; result: unknown }> = [];

    const stages = this.getStages(plan);
    for (const stage of stages) {
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
   * Get stages from unified execution plan
   */
  private getStages(plan: UnifiedExecutionPlan): (ExecutionStage | AgentExecutionStage)[] {
    if (isAgentExecutionPlan(plan)) {
      return plan.stages;
    }
    return plan.stages;
  }

  /**
   * Execute a single stage (which may contain multiple groups)
   */
  private async executeStage(
    stage: ExecutionStage | AgentExecutionStage,
    options: ToolExecutionOptions,
    onStatus?: (status: string) => void
  ): Promise<Array<{ toolCall: ToolCallInfo; result: unknown }>> {
    const results: Array<{ toolCall: ToolCallInfo; result: unknown }> = [];

    // Execute all groups in this stage sequentially
    for (const group of stage.groups) {
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
    const spanId = generateId();
    const stepNumber = loopState.currentIteration > 0 ? loopState.currentIteration : 1;

    const traceId = options.taskId;
    const normalizedSpanToolName = isValidToolName(toolCall.toolName)
      ? toolCall.toolName
      : normalizeToolName(toolCall.toolName) || toolCall.toolName;
    const spanName = `Step${stepNumber}-tool-${normalizedSpanToolName}`;

    databaseService
      .startSpan({
        spanId,
        traceId,
        parentSpanId: null,
        name: spanName,
        startedAt: toolStartTime,
        attributes: {
          toolCallId: toolCall.toolCallId,
          toolName: normalizedSpanToolName,
          stepNumber,
        },
      })
      .catch((error) => {
        logger.warn('[ToolExecutor] Failed to start tool span', {
          toolCallId: toolCall.toolCallId,
          toolName: normalizedSpanToolName,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      });

    try {
      // Validate and normalize tool name to prevent API errors
      // Some AI models may return tool names with invalid characters (e.g., "bash Tool" instead of "bash")
      // NOTE: We use a local variable instead of mutating toolCall to avoid race conditions in concurrent execution
      const originalToolName = toolCall.toolName;
      let normalizedToolName = originalToolName;

      if (!isValidToolName(originalToolName)) {
        logger.warn('[ToolExecutor] Invalid tool name detected, attempting normalization', {
          originalToolName,
          toolCallId: toolCall.toolCallId,
        });

        const normalized = normalizeToolName(originalToolName);

        if (normalized) {
          normalizedToolName = normalized;
          // logger.info('[ToolExecutor] Successfully normalized tool name', {
          //   originalToolName,
          //   normalizedToolName,
          //   toolCallId: toolCall.toolCallId,
          // });
        } else {
          // If normalization fails, let it proceed with original name
          // The tool-not-found handler will provide better error messages
          logger.error('[ToolExecutor] Failed to normalize invalid tool name', {
            originalToolName,
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

        const preToolSummary = await hookService.runPreToolUse(
          options.taskId,
          toolCall.toolName,
          toolArgs as ToolInput,
          toolCall.toolCallId
        );
        hookService.applyHookSummary(preToolSummary);
        if (preToolSummary.updatedInput) {
          toolArgs = preToolSummary.updatedInput;
        }
        if (preToolSummary.permissionDecision === 'deny' || preToolSummary.blocked) {
          const reason = preToolSummary.permissionDecisionReason || preToolSummary.blockReason;
          return {
            success: false,
            error: reason || 'Tool execution blocked by hook.',
            hookBlocked: true,
          };
        }

        const isCallAgentTool = toolCall.toolName === 'callAgent';

        // Pass special parameters to callAgent tools
        if (isCallAgentTool) {
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
                input: toolArgs as ToolInput,
              },
            ],
            timestamp: new Date(),
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
            nestedTools: [],
            // Add metadata flag so UI knows whether to render
            renderDoingUI: toolMetadata.renderDoingUI,
            // Pass taskId for tools that need execution context (e.g., exitPlanMode)
            taskId: options.taskId,
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

        const toolResult = await this.executeTool(tool, toolArgs, {
          taskId: options.taskId,
          toolId: toolCall.toolCallId,
        });

        const postToolSummary = await hookService.runPostToolUse(
          options.taskId,
          toolCall.toolName,
          toolArgs as ToolInput,
          toolResult as ToolOutput,
          toolCall.toolCallId
        );
        hookService.applyHookSummary(postToolSummary);

        const toolEndedAt = Date.now();
        databaseService.endSpan(spanId, toolEndedAt).catch((error) => {
          logger.warn('[ToolExecutor] Failed to end tool span', {
            toolCallId: toolCall.toolCallId,
            spanId,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        });

        // Create tool-result message after execution
        if (onToolMessage) {
          const toolResultMessage: UIMessage = {
            id: `${toolCall.toolCallId}-result`, // Use consistent ID based on toolCallId
            role: 'tool',
            content: [
              {
                type: 'tool-result',
                toolCallId: toolCall.toolCallId,
                toolName: toolCall.toolName,
                input: toolArgs as ToolInput,
                output: toolResult,
              },
            ],
            timestamp: new Date(),
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
            taskId: options.taskId,
          };
          onToolMessage(toolResultMessage);
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

      const toolEndedAt = Date.now();
      databaseService.endSpan(spanId, toolEndedAt).catch((endError) => {
        logger.warn('[ToolExecutor] Failed to end tool span after error', {
          toolCallId: toolCall.toolCallId,
          spanId,
          error: endError instanceof Error ? endError.message : 'Unknown error',
        });
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
    group: ExecutionGroup | AgentExecutionGroup,
    options: ToolExecutionOptions,
    onStatus?: (status: string) => void
  ): Promise<Array<{ toolCall: ToolCallInfo; result: unknown }>> {
    // Extract tools from either ExecutionGroup or AgentExecutionGroup
    const tools = this.getToolsFromGroup(group);
    const maxConcurrency = this.getMaxConcurrencyFromGroup(group);

    if (group.concurrent && tools.length > 1) {
      return this.executeConcurrentTools(tools, options, onStatus, maxConcurrency);
    } else {
      return this.executeSequentialTools(tools, options, onStatus);
    }
  }

  /**
   * Extract tools from either ExecutionGroup or AgentExecutionGroup
   */
  private getToolsFromGroup(group: ExecutionGroup | AgentExecutionGroup): ToolCallInfo[] {
    if ('tools' in group) {
      return group.tools;
    } else {
      return group.agentCalls;
    }
  }

  /**
   * Extract maxConcurrency from either ExecutionGroup or AgentExecutionGroup
   */
  private getMaxConcurrencyFromGroup(
    group: ExecutionGroup | AgentExecutionGroup
  ): number | undefined {
    if ('tools' in group) {
      return group.maxConcurrency;
    } else {
      return group.maxConcurrency;
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
    // logger.info(`Executing ${toolCalls.length} tools sequentially`, {
    //   toolCallIds: toolCalls.map((tool) => tool.toolCallId),
    //   toolNames: toolCalls.map((tool) => tool.toolName),
    // });

    const results: Array<{ toolCall: ToolCallInfo; result: unknown }> = [];

    for (const toolCall of toolCalls) {
      // Check for abort signal
      if (options.abortController?.signal.aborted) {
        logger.info('Tool execution aborted during sequential execution');
        break;
      }

      const { getToolLabel } = await import('@/lib/tools');
      const toolLabel = getToolLabel(toolCall.toolName);
      onStatus?.(`Processing tool ${toolLabel}`);
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
    tools: AgentToolSet,
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
