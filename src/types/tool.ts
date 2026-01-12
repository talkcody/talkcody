import type { ReactElement } from 'react';
import type { z } from 'zod';

export type ToolInput = Record<string, unknown>;
export type ToolOutput = unknown;

export interface ToolExecuteContext {
  taskId: string;
  toolId: string;
}

export interface ToolRenderContext {
  taskId?: string;
  toolName?: string;
}

/**
 * Placeholder type for MCP tools that need to be resolved at runtime.
 * These are stored in tool configurations and resolved by multiMCPAdapter.
 */
export interface MCPToolPlaceholder {
  _isMCPTool: true;
  _mcpToolName: string;
}

export interface ToolWithUI<
  TInput extends ToolInput = ToolInput,
  TOutput extends ToolOutput = ToolOutput,
> {
  name: string;
  description: string;
  inputSchema: z.ZodSchema<TInput>;
  execute: (params: TInput, context: ToolExecuteContext) => Promise<TOutput>;
  renderToolDoing: (params: TInput, context?: ToolRenderContext) => ReactElement | null;
  renderToolResult: (
    result: TOutput,
    params: TInput,
    context?: ToolRenderContext
  ) => ReactElement | null;
  canConcurrent: boolean;
  /** Whether to hide this tool from the UI tool selector */
  hidden?: boolean;
  /** Whether to always show the tool result UI expanded by default */
  showResultUIAlways?: boolean;
}

/**
 * Union type for tool entries that can be either a regular tool or an MCP placeholder.
 */
export type ToolEntry = ToolWithUI | MCPToolPlaceholder;
