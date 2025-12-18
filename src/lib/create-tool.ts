import type { ReactElement } from 'react';
import type { z } from 'zod';
import { timedMethod } from '@/lib/timer';
import type { ToolExecuteContext, ToolRenderContext, ToolWithUI } from '@/types/tool';

interface CreateToolOptions {
  name: string;
  description: string;
  inputSchema: z.ZodSchema;
  execute: (params: any, context: ToolExecuteContext) => Promise<any>;
  renderToolDoing: (params: any, context?: ToolRenderContext) => ReactElement;
  renderToolResult: (result: any, params: any) => ReactElement;
  canConcurrent: boolean;
  hidden?: boolean;
  isBeta?: boolean;
  badgeLabel?: string;
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
    isBeta,
    badgeLabel,
  } = options;

  const executeDescriptor: TypedPropertyDescriptor<CreateToolOptions['execute']> = {
    value: execute,
  };

  const decoratedDescriptor =
    timedMethod(`${name}.execute`)(options, 'execute', executeDescriptor) ?? executeDescriptor;

  const timedExecute = decoratedDescriptor.value ?? execute;

  const tool: ToolWithUI = {
    name,
    description,
    inputSchema: inputSchema as any,
    execute: timedExecute,
    renderToolDoing,
    renderToolResult,
    canConcurrent,
  };

  if (hidden) {
    tool.hidden = hidden;
  }

  if (isBeta) {
    tool.isBeta = true;
  }

  if (badgeLabel) {
    tool.badgeLabel = badgeLabel;
  }

  return tool;
}
