import { basename, dirname, homeDir, join, normalize } from '@tauri-apps/api/path';
import { exists, readDir, readTextFile } from '@tauri-apps/plugin-fs';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import type { CustomToolDefinition } from '@/types/custom-tool';
import type { CustomToolPackageInfo } from '@/types/custom-tool-package';
import {
  compileCustomTool,
  createCustomToolModuleUrl,
  registerCustomToolModuleResolver,
  resolveCustomToolDefinition,
} from './custom-tool-compiler';
import { ensureToolDependencies, resolvePackagedTool } from './custom-tool-packager';
import { parseToolInputSchema } from './custom-tool-schema-parser';

export type CustomToolSource = 'custom' | 'workspace' | 'user';

export interface CustomToolLoadResult {
  name: string;
  filePath: string;
  status: 'loaded' | 'error';
  source: CustomToolSource;
  error?: string;
  tool?: CustomToolDefinition;
  packageInfo?: CustomToolPackageInfo;
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

type CustomToolUIConfig = {
  ui?: {
    Doing?: CustomToolDefinition['renderToolDoing'];
    Result?: CustomToolDefinition['renderToolResult'];
  };
};

function applyToolUI(definition: CustomToolDefinition & CustomToolUIConfig): void {
  const ui = definition.ui;
  if (!ui || typeof ui !== 'object') return;

  if (!definition.renderToolDoing && typeof ui.Doing === 'function') {
    definition.renderToolDoing = ui.Doing as CustomToolDefinition['renderToolDoing'];
  }

  if (!definition.renderToolResult && typeof ui.Result === 'function') {
    definition.renderToolResult = ui.Result as CustomToolDefinition['renderToolResult'];
  }
}

function getEntryBoolean(entry: unknown, key: 'isDirectory' | 'isFile'): boolean | undefined {
  const value = (entry as Record<string, unknown>)[key];
  if (typeof value === 'function') {
    return (value as () => boolean)();
  }
  if (typeof value === 'boolean') {
    return value;
  }
  return undefined;
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
      const fileEntries: typeof entries = [];
      const dirEntries: typeof entries = [];

      for (const entry of entries) {
        const entryDirectory = getEntryBoolean(entry, 'isDirectory');
        const entryFile = getEntryBoolean(entry, 'isFile');
        const isDirectory =
          entryDirectory === true || (entryDirectory === undefined && entryFile === false);
        if (isDirectory) {
          dirEntries.push(entry);
          continue;
        }
        if (entryFile === true) {
          fileEntries.push(entry);
        }
      }

      for (const entry of fileEntries) {
        if (entry.name.endsWith('.d.ts')) continue;
        if (!hasCustomToolExtension(entry.name)) continue;
        const filePath = await join(dirPath, entry.name);
        const toolName = getToolNameFromFile(entry.name);

        await loadSingleFileTool(results, filePath, toolName, entry.name, source);
      }

      for (const entry of dirEntries) {
        await loadPackagedTool(results, dirPath, entry.name, source);
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

async function loadSingleFileTool(
  results: CustomToolLoadResult[],
  filePath: string,
  toolName: string,
  fileName: string,
  source: CustomToolSource
): Promise<void> {
  try {
    const sourceCode = await readTextFile(filePath);
    const compiled = await compileCustomTool(sourceCode, { filename: fileName });
    const fileDir = await dirname(filePath);
    const moduleUrl = await createCustomToolModuleUrl(compiled, fileName, fileDir);
    const definition = await resolveCustomToolDefinition(moduleUrl);

    if (!definition || typeof definition !== 'object') {
      throw new Error('Invalid tool export');
    }

    if (!definition.name || typeof definition.name !== 'string') {
      definition.name = toolName;
    }

    applyToolUI(definition as CustomToolDefinition & CustomToolUIConfig);

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

async function loadPackagedTool(
  results: CustomToolLoadResult[],
  dirPath: string,
  entryName: string,
  source: CustomToolSource
): Promise<void> {
  const toolRoot = await join(dirPath, entryName);
  const resolved = await resolvePackagedTool(toolRoot);
  if (!resolved.ok) {
    results.push({
      name: entryName,
      filePath: toolRoot,
      source,
      status: 'error',
      error: resolved.error,
    });
    return;
  }

  const packageInfo = resolved.info;
  const toolName = packageInfo.packageName || entryName;

  try {
    const installResult = await ensureToolDependencies(packageInfo);
    if (!installResult.ok) {
      results.push({
        name: toolName,
        filePath: packageInfo.entryPath,
        source,
        status: 'error',
        error: installResult.error || 'Failed to install dependencies',
        packageInfo,
      });
      return;
    }

    const parsedSchema = await parseToolInputSchema(packageInfo.entryPath);
    const fallbackSchema = parsedSchema ?? z.object({}).passthrough();

    const sourceCode = await readTextFile(packageInfo.entryPath);
    const entryFileName = await basename(packageInfo.entryPath);
    const fileDir = await dirname(packageInfo.entryPath);
    const compiled = await compileCustomTool(sourceCode, { filename: entryFileName });
    const moduleUrl = await createCustomToolModuleUrl(compiled, entryFileName, fileDir);
    const definition = await resolveCustomToolDefinition(moduleUrl);

    if (!definition || typeof definition !== 'object') {
      throw new Error('Invalid tool export');
    }

    if (!definition.name || typeof definition.name !== 'string') {
      definition.name = toolName;
    }

    if (!definition.inputSchema) {
      definition.inputSchema = fallbackSchema;
    }

    applyToolUI(definition as CustomToolDefinition & CustomToolUIConfig);

    // Packaged tools execute via bun, so override execute but keep other fields.
    definition.execute = async () => {
      throw new Error('Packaged tools must execute via bun');
    };

    logger.info('[CustomToolLoader] Loaded packaged tool', {
      toolRoot,
      packageInfo,
      definition,
    });

    results.push({
      name: definition.name,
      filePath: packageInfo.entryPath,
      source,
      status: 'loaded',
      tool: definition,
      packageInfo,
    });
  } catch (error) {
    logger.error('[CustomToolLoader] Failed to load packaged tool', {
      toolRoot,
      error,
    });
    results.push({
      name: toolName,
      filePath: packageInfo.entryPath,
      source,
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
      packageInfo,
    });
  }
}
