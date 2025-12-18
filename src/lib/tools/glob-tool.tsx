import { invoke } from '@tauri-apps/api/core';
import { isAbsolute, join } from '@tauri-apps/api/path';
import { z } from 'zod';
import { GlobDoing } from '@/components/tools/glob-doing';
import { GlobResult } from '@/components/tools/glob-result';
import { createTool } from '@/lib/create-tool';
import { logger } from '@/lib/logger';
import { getEffectiveWorkspaceRoot } from '@/services/workspace-root-service';

const inputSchema = z.strictObject({
  pattern: z.string().describe('The glob pattern to match files against'),
  path: z
    .string()
    .optional()
    .describe('The directory to search in. Defaults to the current working directory.'),
});

export const TOOL_NAME_FOR_PROMPT = 'GlobTool';

export const DESCRIPTION = `- Fast file pattern matching tool that works with any codebase size
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time
- Use this tool when you need to find files by name patterns`;

interface GlobResultType {
  path: string;
  is_directory: boolean;
  modified_time: number;
}

export const globTool = createTool({
  name: 'glob',
  description: DESCRIPTION,
  inputSchema,
  canConcurrent: true,
  execute: async ({ pattern, path }, context) => {
    try {
      let searchPath = path;
      let cachedProjectRoot: string | null = null;
      const resolveProjectRoot = async () => {
        if (cachedProjectRoot === null) {
          cachedProjectRoot = await getEffectiveWorkspaceRoot(context?.taskId);
        }
        return cachedProjectRoot;
      };
      // If no path provided, use current working directory
      if (!searchPath) {
        const projectRoot = await resolveProjectRoot();
        if (!projectRoot) {
          return 'Error: Project root path not set. Please set a project root path first.';
        }
        searchPath = projectRoot;
      } else if (!(await isAbsolute(searchPath))) {
        // Convert relative path to absolute
        const projectRoot = await resolveProjectRoot();
        if (!projectRoot) {
          return 'Error: Project root path not set. Please set a project root path first.';
        }
        searchPath = await join(projectRoot, searchPath);
      }
      logger.info(`Searching files with pattern "${pattern}" in path: ${searchPath}`);

      const results: GlobResultType[] = await invoke('search_files_by_glob', {
        pattern,
        path: searchPath,
      });

      // Format results for display
      if (results.length === 0) {
        return `No files found matching pattern "${pattern}" in ${searchPath}`;
      }

      const formattedResults = results
        .map((result) => {
          const relativePath = result.path.replace(`${searchPath}/`, '');
          const timestamp = new Date(result.modified_time * 1000).toISOString().split('T')[0];
          return `${relativePath} (${timestamp})${result.is_directory ? ' [DIR]' : ''}`;
        })
        .join('\n');

      return `Found ${results.length} file(s) matching "${pattern}":\n\n${formattedResults}`;
    } catch (error) {
      logger.error('Error searching files with glob pattern:', error);
      return (
        'Error: Failed to search files with glob pattern' +
        (error instanceof Error ? `: ${error.message}` : '')
      );
    }
  },
  renderToolDoing: ({ pattern, path }) => <GlobDoing pattern={pattern} path={path} />,
  renderToolResult: (result) => <GlobResult result={result} />,
});
