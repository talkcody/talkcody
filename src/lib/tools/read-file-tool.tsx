import { exists, readTextFile } from '@tauri-apps/plugin-fs';
import { z } from 'zod';
import { GenericToolDoing } from '@/components/tools/generic-tool-doing';
import { GenericToolResult } from '@/components/tools/generic-tool-result';
import { createTool } from '@/lib/create-tool';
import { logger } from '@/lib/logger';

import { repositoryService } from '@/services/repository-service';
import { normalizeFilePath } from '@/services/repository-utils';
import { getEffectiveWorkspaceRoot } from '@/services/workspace-root-service';

interface LineExtractionResult {
  success: boolean;
  content: string | null;
  message: string;
}

function extractLines(
  fullContent: string,
  file_path: string,
  start_line?: number,
  line_count?: number
): LineExtractionResult {
  const MAX_LINES = 1000;

  // Split content into lines for line-based operations
  const lines = fullContent.split('\n');
  const totalLines = lines.length;

  // If no line parameters are specified, handle with max lines limit
  if (start_line === undefined && line_count === undefined) {
    if (totalLines > MAX_LINES) {
      const truncatedLines = lines.slice(0, MAX_LINES);
      const truncatedContent = truncatedLines.join('\n');
      return {
        success: true,
        content: truncatedContent,
        message: `Successfully read file: ${file_path} (TRUNCATED: showing first ${MAX_LINES} of ${totalLines} total lines)`,
      };
    } else {
      return {
        success: true,
        content: fullContent,
        message: `Successfully read ${totalLines} lines from file: ${file_path}`,
      };
    }
  }

  // Validate start_line parameter
  if (start_line !== undefined && (start_line < 1 || start_line > totalLines)) {
    return {
      success: false,
      content: null,
      message: `Invalid start_line: ${start_line}. File has ${totalLines} lines (valid range: 1-${totalLines})`,
    };
  }

  // Calculate the actual start index (convert from 1-indexed to 0-indexed)
  const startIndex = start_line ? start_line - 1 : 0;

  // Calculate end index based on line_count and MAX_LINES limit
  let endIndex: number;
  if (line_count !== undefined) {
    endIndex = Math.min(startIndex + line_count, totalLines);
  } else {
    endIndex = totalLines;
  }

  // Apply MAX_LINES limit if no explicit line_count is specified
  if (line_count === undefined && endIndex - startIndex > MAX_LINES) {
    endIndex = startIndex + MAX_LINES;
  }

  // Extract the requested lines
  const extractedLines = lines.slice(startIndex, endIndex);
  const extractedContent = extractedLines.join('\n');

  // Create descriptive message
  const actualLinesRead = extractedLines.length;
  const startLineNumber = startIndex + 1;
  const endLineNumber = startIndex + actualLinesRead;

  let message: string;
  if (start_line !== undefined && line_count !== undefined) {
    message = `Successfully read ${actualLinesRead} lines (${startLineNumber}-${endLineNumber}) from file: ${file_path}`;
  } else if (start_line !== undefined) {
    if (actualLinesRead < totalLines - startIndex + 1) {
      message = `Successfully read ${actualLinesRead} lines (${startLineNumber}-${endLineNumber}) from file: ${file_path} (TRUNCATED: limited to ${MAX_LINES} lines, file has ${totalLines} total lines)`;
    } else {
      message = `Successfully read lines ${startLineNumber}-${endLineNumber} from file: ${file_path}`;
    }
  } else {
    if (actualLinesRead < totalLines) {
      message = `Successfully read first ${actualLinesRead} lines from file: ${file_path} (TRUNCATED: limited to ${MAX_LINES} lines, file has ${totalLines} total lines)`;
    } else {
      message = `Successfully read first ${actualLinesRead} lines from file: ${file_path}`;
    }
  }

  return {
    success: true,
    content: extractedContent,
    message,
  };
}

export const readFile = createTool({
  name: 'readFile',
  description: `Use this tool to read the contents of an existing file.
This tool will return the complete file content as a string by default.
You can optionally specify a starting line and number of lines to read a specific portion of the file.`,
  inputSchema: z.object({
    file_path: z
      .string()
      .describe(
        'The file path to read. Use absolute path for workspace files, or $RESOURCE/... prefix for bundled resources like PPT style guides. The $RESOURCE prefix MUST be used exactly as-is, do not convert to absolute path.'
      ),
    start_line: z
      .number()
      .min(1)
      .optional()
      .describe(
        'Starting line number (1-indexed). If specified, only reads from this line onwards'
      ),
    line_count: z
      .number()
      .min(100)
      .optional()
      .describe('Number of lines to read from start_line. If not specified, reads to end of file'),
  }),
  canConcurrent: true,
  execute: async ({ file_path, start_line, line_count, filePath, path }, context) => {
    try {
      const resolvedPath = file_path ?? filePath ?? path;
      if (!resolvedPath) {
        logger.warn('readFile called without file_path', {
          taskId: context.taskId,
        });
        return {
          success: false,
          file_path: resolvedPath,
          content: null,
          message: 'Missing required file_path parameter.',
        };
      }

      const rootPath = await getEffectiveWorkspaceRoot(context.taskId);
      if (!rootPath) {
        return {
          success: false,
          file_path: resolvedPath,
          content: null,
          message: 'Project root path is not set.',
        };
      }

      file_path = await normalizeFilePath(rootPath, resolvedPath);

      // Check if file exists before attempting to read it
      const fileExists = await exists(file_path);
      if (!fileExists) {
        return {
          success: false,
          file_path,
          content: null,
          message: `File not found: ${file_path}`,
        };
      }

      const fullContent = await repositoryService.readFileWithCache(file_path);
      const result = extractLines(fullContent, file_path, start_line, line_count);
      // logger.info(`readFile: Reading file at path: ${file_path}`);
      return {
        success: result.success,
        file_path,
        content: result.content,
        message: result.message,
      };
    } catch (error) {
      logger.error('Error reading file:', error);
      return {
        success: false,
        file_path,
        content: null,
        message: `Failed to read file: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  },
  renderToolDoing: ({ file_path }) => <GenericToolDoing operation="read" filePath={file_path} />,
  renderToolResult: (result) => (
    <GenericToolResult success={result?.success ?? false} message={result?.message} />
  ),
});
