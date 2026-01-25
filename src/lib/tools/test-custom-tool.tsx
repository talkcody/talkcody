import { dirname, normalize } from '@tauri-apps/api/path';
import { exists, readTextFile } from '@tauri-apps/plugin-fs';
import { isValidElement } from 'react';
import { z } from 'zod';
import { GenericToolResult } from '@/components/tools/generic-tool-result';
import { createTool } from '@/lib/create-tool';
import { logger } from '@/lib/logger';
import {
  compileCustomTool,
  createCustomToolModuleUrl,
  registerCustomToolModuleResolver,
  resolveCustomToolDefinition,
} from '@/services/tools/custom-tool-compiler';
import type { CustomToolDefinition } from '@/types/custom-tool';
import type { ToolExecuteContext, ToolRenderContext } from '@/types/tool';

const inputSchema = z.object({
  file_path: z.string().describe('Absolute path to the custom tool file'),
  params: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Execution params for the custom tool'),
});

type ValidationStage = 'compile' | 'resolve' | 'execute' | 'render_doing' | 'render_result';

type ValidationResult = {
  success: boolean;
  file_path: string;
  tool_name?: string;
  stage?: ValidationStage;
  message: string;
  error?: string;
};

function getFileName(filePath: string): string {
  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] || filePath;
}

function isRenderable(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isRenderable);
  }
  return isValidElement(value);
}

function buildError(
  stage: ValidationStage,
  filePath: string,
  error: unknown,
  toolName?: string
): ValidationResult {
  const message = `Custom tool validation failed at ${stage}.`;
  const detail = error instanceof Error ? error.message : String(error);
  return {
    success: false,
    file_path: filePath,
    tool_name: toolName,
    stage,
    message,
    error: detail,
  };
}

function parseToolParams(
  schema: CustomToolDefinition['inputSchema'],
  params: Record<string, unknown>
): { success: true; data: Record<string, unknown> } | { success: false; error: string } {
  if (!schema || typeof schema !== 'object' || !('safeParse' in schema)) {
    return { success: true, data: params };
  }

  const result = schema.safeParse(params);
  if (result.success) {
    return { success: true, data: result.data ?? {} };
  }

  // Handle ZodError: issues is an array of ZodIssue objects
  const parsedError = result.error as { issues?: Array<{ message: string }> };
  const errorMessages = parsedError.issues?.map((e) => e.message) ?? [];
  const errorMessage = errorMessages.length > 0 ? errorMessages.join(', ') : 'Invalid parameters';
  return { success: false, error: errorMessage };
}

export const testCustomTool = createTool({
  name: 'test_custom_tool',
  description: 'Validate a custom tool file (compile, execute, render)',
  inputSchema,
  canConcurrent: false,
  hidden: true,
  execute: async ({ file_path, params = {} }, context: ToolExecuteContext) => {
    const normalizedPath = await normalize(file_path);

    try {
      const fileExists = await exists(normalizedPath);
      if (!fileExists) {
        return buildError('compile', normalizedPath, `File not found: ${normalizedPath}`);
      }

      const source = await readTextFile(normalizedPath);
      const fileName = getFileName(normalizedPath);
      const fileDir = await dirname(normalizedPath);

      const compiled = await compileCustomTool(source, { filename: fileName });
      await registerCustomToolModuleResolver(fileDir);
      const moduleUrl = await createCustomToolModuleUrl(compiled, fileName, fileDir);
      const definition = await resolveCustomToolDefinition(moduleUrl);

      if (!definition || typeof definition !== 'object') {
        return buildError('resolve', normalizedPath, 'Invalid custom tool definition');
      }

      const toolName = definition.name || fileName;
      const parsedParams = parseToolParams(definition.inputSchema, params);
      if (!parsedParams.success) {
        return buildError('execute', normalizedPath, parsedParams.error, toolName);
      }

      let executeResult: unknown;
      try {
        executeResult = await definition.execute(parsedParams.data, context);
      } catch (error) {
        return buildError('execute', normalizedPath, error, toolName);
      }

      const renderContext: ToolRenderContext = { toolName, taskId: context.taskId };

      if (definition.renderToolDoing) {
        try {
          const doingResult = definition.renderToolDoing(parsedParams.data, renderContext);
          if (!isRenderable(doingResult)) {
            return buildError(
              'render_doing',
              normalizedPath,
              'renderToolDoing returned invalid value',
              toolName
            );
          }
        } catch (error) {
          return buildError('render_doing', normalizedPath, error, toolName);
        }
      }

      if (definition.renderToolResult) {
        try {
          const resultOutput = definition.renderToolResult(
            executeResult,
            parsedParams.data,
            renderContext
          );
          if (!isRenderable(resultOutput)) {
            return buildError(
              'render_result',
              normalizedPath,
              'renderToolResult returned invalid value',
              toolName
            );
          }
        } catch (error) {
          return buildError('render_result', normalizedPath, error, toolName);
        }
      }

      return {
        success: true,
        file_path: normalizedPath,
        tool_name: toolName,
        message: 'Custom tool validated successfully',
      };
    } catch (error) {
      logger.error('[test_custom_tool] Validation failed', error);
      return buildError('compile', normalizedPath, error);
    }
  },
  renderToolDoing: ({ file_path }) => (
    <div className="text-sm text-muted-foreground">Validating custom tool... ({file_path})</div>
  ),
  renderToolResult: (result: ValidationResult) => (
    <GenericToolResult
      success={result?.success ?? false}
      message={result?.message}
      error={result?.error}
    />
  ),
});
