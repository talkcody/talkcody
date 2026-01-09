import type { z } from 'zod';
import type { ToolInput, ToolOutput, ToolRenderContext, ToolWithUI } from './tool';

export type CustomToolPermission = 'fs' | 'net' | 'command';

export type CustomToolUIContext = ToolRenderContext;

export type CustomToolUI<
  TInput extends ToolInput = ToolInput,
  TOutput extends ToolOutput = ToolOutput,
> = Pick<ToolWithUI<TInput, TOutput>, 'renderToolDoing' | 'renderToolResult'>;

export type CustomToolDefinition<
  TInput extends ToolInput = ToolInput,
  TOutput extends ToolOutput = ToolOutput,
> = ToolWithUI<TInput, TOutput> & {
  permissions?: CustomToolPermission[];
  args?: z.ZodSchema<TInput>;
};

export interface CustomToolExport {
  default: CustomToolDefinition;
}
