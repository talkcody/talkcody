import { dirname, homeDir, join, normalize } from '@tauri-apps/api/path';
import { exists, readDir, readTextFile } from '@tauri-apps/plugin-fs';
import { logger } from '@/lib/logger';
import type { CustomToolDefinition } from '@/types/custom-tool';
import {
  compileCustomTool,
  createCustomToolModuleUrl,
  registerCustomToolModuleResolver,
  resolveCustomToolDefinition,
} from './custom-tool-compiler';

export type CustomToolSource = 'custom' | 'workspace' | 'user';

export interface CustomToolLoadResult {
  name: string;
  filePath: string;
  status: 'loaded' | 'error';
  source: CustomToolSource;
  error?: string;
  tool?: CustomToolDefinition;
}

export interface CustomToolLoadSummary {
  tools: CustomToolLoadResult[];
}

export interface CustomToolLoadOptions {
  workspaceRoot?: string | null;
  customDirectory?: string | null;
}

const CUSTOM_TOOLS_RELATIVE_DIR = '.talkcody/tools';

function hasCustomToolExtension(fileName: string): boolean {
  return /.*[-_]tool\.tsx?$/i.test(fileName);
}

function getToolNameFromFile(fileName: string): string {
  return fileName.replace(/\.(tsx|ts)$/i, '');
}

async function buildDirectories(
  options: CustomToolLoadOptions
): Promise<Array<{ path: string; source: CustomToolSource }>> {
  const { workspaceRoot, customDirectory } = options;
  const directories: Array<{ path: string; source: CustomToolSource }> = [];
  const seen = new Set<string>();

  const addDir = async (
    pathValue: string | Promise<string | null> | null | undefined,
    source: CustomToolSource
  ) => {
    if (!pathValue) return;
    try {
      const resolvedPath = await pathValue;
      if (!resolvedPath) return;
      const resolved = await normalize(resolvedPath);
      if (seen.has(resolved)) return;
      seen.add(resolved);
      directories.push({ path: resolved, source });
    } catch (error) {
      logger.warn('[CustomToolLoader] Failed to normalize custom tools directory', {
        source,
        error,
      });
    }
  };

  if (customDirectory) {
    // When custom directory is set, use it directly without appending .talkcody/tools
    await addDir(customDirectory, 'custom');
    return directories;
  }

  if (workspaceRoot) {
    await addDir(join(workspaceRoot, CUSTOM_TOOLS_RELATIVE_DIR), 'workspace');
  }

  try {
    const userHome = await homeDir();
    if (userHome) {
      await addDir(join(userHome, CUSTOM_TOOLS_RELATIVE_DIR), 'user');
    }
  } catch (error) {
    logger.warn('[CustomToolLoader] Failed to resolve user home for custom tools', error);
  }

  return directories;
}

export async function loadCustomTools(
  options: CustomToolLoadOptions
): Promise<CustomToolLoadSummary> {
  const directories = await buildDirectories(options);

  if (directories.length === 0) {
    logger.warn('[CustomToolLoader] No directories to scan for custom tools');
    return { tools: [] };
  }

  const results: CustomToolLoadResult[] = [];
  await registerCustomToolModuleResolver();

  for (const { path: dirPath, source } of directories) {
    try {
      if (!(await exists(dirPath))) {
        logger.warn('[CustomToolLoader] Directory not found', { dirPath });
        results.push({
          name: dirPath,
          filePath: dirPath,
          source,
          status: 'error',
          error: 'Directory not found',
        });
        continue;
      }

      const entries = await readDir(dirPath);

      for (const entry of entries) {
        if (!entry.isFile) continue;
        if (entry.name.endsWith('.d.ts')) continue;
        if (!hasCustomToolExtension(entry.name)) continue;
        const filePath = await join(dirPath, entry.name);
        const toolName = getToolNameFromFile(entry.name);

        try {
          const sourceCode = await readTextFile(filePath);
          const compiled = await compileCustomTool(sourceCode, { filename: entry.name });
          const fileDir = await dirname(filePath);
          const moduleUrl = await createCustomToolModuleUrl(compiled, entry.name, fileDir);
          const definition = await resolveCustomToolDefinition(moduleUrl);

          if (!definition || typeof definition !== 'object') {
            throw new Error('Invalid tool export');
          }

          if (!definition.name || typeof definition.name !== 'string') {
            definition.name = toolName;
          }

          results.push({
            name: definition.name,
            filePath,
            source,
            status: 'loaded',
            tool: definition,
          });
        } catch (error) {
          logger.error('[CustomToolLoader] Failed to load custom tool', {
            filePath,
            error,
          });
          results.push({
            name: toolName,
            filePath,
            source,
            status: 'error',
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } catch (error) {
      logger.error('[CustomToolLoader] Failed to scan custom tools directory', {
        directory: dirPath,
        error,
      });
      results.push({
        name: dirPath,
        filePath: dirPath,
        source,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { tools: results };
}
