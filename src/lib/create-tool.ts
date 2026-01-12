/* biome-ignore lint/suspicious/noExplicitAny: Tool parameters are dynamic based on input schema */
import type { ReactElement } from 'react';
import type { z } from 'zod';
import { timedMethod } from '@/lib/timer';
import type { ToolExecuteContext, ToolRenderContext, ToolWithUI } from '@/types/tool';

interface CreateToolOptions {
  name: string;
  description: string;
  inputSchema: z.ZodSchema;
  /* biome-ignore lint/suspicious/noExplicitAny: Tool parameters are dynamic based on input schema */
  execute: (params: any, context: ToolExecuteContext) => Promise<any>;
  /* biome-ignore lint/suspicious/noExplicitAny: Tool parameters are dynamic based on input schema */
  renderToolDoing: (params: any, context?: ToolRenderContext) => ReactElement | null;
  /* biome-ignore lint/suspicious/noExplicitAny: Tool parameters are dynamic based on input schema */
  renderToolResult: (result: any, params: any, context?: ToolRenderContext) => ReactElement | null;
  canConcurrent: boolean;
  hidden?: boolean;
  /** Whether to always show the tool result UI expanded by default */
  showResultUIAlways?: boolean;
}

export function createTool(options: CreateToolOptions): ToolWithUI {
  const {
    name,
    description,
    inputSchema,
    execute,
    renderToolDoing,
    renderToolResult,
    canConcurrent,
    hidden,
    showResultUIAlways,
  } = options;

  const executeDescriptor: TypedPropertyDescriptor<CreateToolOptions['execute']> = {
    value: execute,
  };

  const decoratedDescriptor =
    timedMethod(`${name}.execute`)(options, 'execute', executeDescriptor) ?? executeDescriptor;

  const timedExecute = decoratedDescriptor.value ?? execute;

  /* biome-ignore lint/suspicious/noExplicitAny: Tool types are dynamically defined */
  const tool: ToolWithUI = {
    name,
    description,
    /* biome-ignore lint/suspicious/noExplicitAny: Tool types are dynamically defined */
    inputSchema: inputSchema as any,
    execute: timedExecute,
    renderToolDoing,
    renderToolResult,
    canConcurrent,
  };

  if (hidden) {
    tool.hidden = hidden;
  }

  if (showResultUIAlways !== undefined) {
    tool.showResultUIAlways = showResultUIAlways;
  }

  return tool;
}
