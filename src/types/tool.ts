import type { ReactElement } from 'react';
import type { z } from 'zod';

// Tool input/output types
export type ToolInput = Record<string, unknown>;
export type ToolOutput = unknown;

// Context passed to tool execute function
export interface ToolExecuteContext {
  taskId: string;
}

// Context passed to tool rendering functions (subset of execute context)
export interface ToolRenderContext {
  taskId?: string;
}

export interface ToolWithUI<
  TInput extends ToolInput = ToolInput,
  TOutput extends ToolOutput = ToolOutput,
> {
  name: string;
  description: string;
  inputSchema: z.ZodSchema<TInput>;
  execute: (params: TInput, context: ToolExecuteContext) => Promise<TOutput>;
  renderToolDoing: (params: TInput, context?: ToolRenderContext) => ReactElement;
  renderToolResult: (result: TOutput, params: TInput) => ReactElement;
  canConcurrent: boolean;
  /** Whether to hide this tool from the UI tool selector */
  hidden?: boolean;
  /** Whether this tool is in beta/preview */
  isBeta?: boolean;
  /** Optional custom label for the beta badge */
  badgeLabel?: string;
}
