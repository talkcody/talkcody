import { invoke } from '@tauri-apps/api/core';
import { isAbsolute, join } from '@tauri-apps/api/path';
import { z } from 'zod';
import { ListFilesDoing } from '@/components/tools/list-files-doing';
import { ListFilesResult } from '@/components/tools/list-files-result';
import { createTool } from '@/lib/create-tool';
import { logger } from '@/lib/logger';
import { getEffectiveWorkspaceRoot } from '@/services/workspace-root-service';

export const listFiles = createTool({
  name: 'listFiles',
  description: `Use this tool to list files and directories in a specified directory.

This tool will return a concise string format showing directories and files grouped by their parent directory. It's useful for exploring directory structure, finding files, or understanding project organization.

The directory path must be absolute.`,
  inputSchema: z.object({
    directory_path: z.string().describe('The absolute path to the directory you want to list'),
    max_depth: z.number().optional().describe('Maximum depth for recursive listing (default: 3)'),
  }),
  canConcurrent: true,
  execute: async ({ directory_path, max_depth = 3 }, context) => {
    try {
      logger.info('listFiles: Executing with parameters:', { directory_path, max_depth });
      let absolutePath = directory_path;
      if (!(await isAbsolute(directory_path))) {
        const projectRoot = await getEffectiveWorkspaceRoot(context?.taskId);
        if (!projectRoot) {
          return 'Error: Project root path not set. Please set a project root path first.';
        }
        absolutePath = await join(projectRoot, directory_path);
      }
      logger.info(`Listing files in directory: ${absolutePath} with max depth: ${max_depth}`);

      const result: string = await invoke('list_project_files', {
        directoryPath: absolutePath,
        recursive: true,
        maxDepth: max_depth,
      });
      return result;
    } catch (error) {
      logger.error('Error listing directory via Rust:', error);
      return (
        'Error: Failed to list directory contents' +
        (error instanceof Error ? `: ${error.message}` : '')
      );
    }
  },
  renderToolDoing: ({ directory_path, max_depth }) => (
    <ListFilesDoing path={directory_path} depth={max_depth} />
  ),
  renderToolResult: (result = {}) => <ListFilesResult result={result} />,
});
