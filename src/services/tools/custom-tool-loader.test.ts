import { describe, expect, it, beforeEach, vi } from 'vitest';
import { z } from 'zod';
import { createMockTauriPath } from '@/test/mocks/tauri-path';
import type { CustomToolDefinition } from '@/types/custom-tool';
import { loadCustomTools } from './custom-tool-loader';
import { loadCustomToolsForRegistry } from './custom-tool-service';

const definitionQueue: CustomToolDefinition[] = [];

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@tauri-apps/api/path', () => {
  return createMockTauriPath({ homeDir: '/home' });
});

const fsState = {
  existing: new Set<string>(),
  dirEntries: new Map<string, Array<{ name: string; isFile: boolean; isDirectory?: boolean }>>(),
  files: new Map<string, string>(),
};

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn((path: string) => Promise.resolve(fsState.existing.has(path))),
  readDir: vi.fn((dir: string) => Promise.resolve(fsState.dirEntries.get(dir) ?? [])),
  readTextFile: vi.fn((filePath: string) => Promise.resolve(fsState.files.get(filePath) ?? '')),
}));

vi.mock('./custom-tool-packager', () => ({
  resolvePackagedTool: vi.fn(async () => ({ ok: false, error: 'not packaged' })),
  ensureToolDependencies: vi.fn(async () => ({ ok: true })),
}));

vi.mock('./custom-tool-schema-parser', () => ({
  parseToolInputSchema: vi.fn(async () => null),
}));

vi.mock('./custom-tool-compiler', () => {
  let moduleCounter = 0;
  return {
    compileCustomTool: vi.fn(async (_source: string, options: { filename: string }) => ({
      code: options.filename,
    })),
    createCustomToolModuleUrl: vi.fn(async (_compiled: unknown, filename: string) => {
      const url = `module://${filename}-${moduleCounter++}`;
      return url;
    }),
    resolveCustomToolDefinition: vi.fn(async () => {
      const next = definitionQueue.shift();
      if (!next) {
        throw new Error('No custom tool definition queued');
      }
      return next;
    }),
    registerCustomToolModuleResolver: vi.fn(async () => {}),
  };
});

function createDefinition(name: string): CustomToolDefinition {
  return {
    name,
    description: `${name} tool`,
    inputSchema: z.object({}),
    execute: vi.fn(async () => `run-${name}`),
    renderToolDoing: vi.fn(() => null),
    renderToolResult: vi.fn(() => null),
    canConcurrent: false,
  };
}

function registerDirectory(dirPath: string, files: string[]) {
  fsState.existing.add(dirPath);
  fsState.dirEntries.set(
    dirPath,
    files.map((file) => ({ name: file, isFile: true }))
  );
  for (const file of files) {
    const fullPath = `${dirPath}/${file}`;
    fsState.files.set(fullPath, `export default ${file}`);
  }
}

function registerDirectoryWithPackages(
  dirPath: string,
  files: string[],
  directories: string[]
) {
  fsState.existing.add(dirPath);
  fsState.dirEntries.set(dirPath, [
    ...directories.map((dir) => ({ name: dir, isDirectory: true, isFile: false })),
    ...files.map((file) => ({ name: file, isFile: true, isDirectory: false })),
  ]);

  for (const file of files) {
    const fullPath = `${dirPath}/${file}`;
    fsState.files.set(fullPath, `export default ${file}`);
  }
}

describe('custom-tool-loader multi-directory support', () => {
  beforeEach(() => {
    fsState.existing.clear();
    fsState.dirEntries.clear();
    fsState.files.clear();
    definitionQueue.length = 0;
  });

  it('loads and deduplicates tools with priority workspace > user', async () => {
    const workspaceDir = '/workspace/.talkcody/tools';
    const userDir = '/home/.talkcody/tools';

    registerDirectory(workspaceDir, ['shared-tool.ts', 'ws-only-tool.ts']);
    registerDirectory(userDir, ['shared-tool.ts', 'home-tool.ts']);

    const sharedWorkspace: CustomToolDefinition = {
      name: 'shared',
      description: 'workspace',
      inputSchema: z.object({}),
      execute: vi.fn(async () => 'workspace'),
      renderToolDoing: vi.fn(() => null),
      renderToolResult: vi.fn(() => null),
      canConcurrent: false,
    };
    const sharedUser: CustomToolDefinition = {
      name: 'shared',
      description: 'user',
      inputSchema: z.object({}),
      execute: vi.fn(async () => 'user'),
      renderToolDoing: vi.fn(() => null),
      renderToolResult: vi.fn(() => null),
      canConcurrent: false,
    };

    definitionQueue.push(sharedWorkspace);
    definitionQueue.push(createDefinition('ws-only'));
    definitionQueue.push(sharedUser);
    definitionQueue.push(createDefinition('home'));

    const result = await loadCustomToolsForRegistry({
      workspaceRoot: '/workspace',
    });

    const names = result.definitions.map((d) => d.name);
    expect(names).toContain('shared');
    expect(names).toContain('ws-only');
    expect(names).toContain('home');
    expect(names.filter((name) => name === 'shared')).toHaveLength(1);

    const sharedDefinition = result.definitions.find((d) => d.name === 'shared');
    expect(sharedDefinition?.description).toBe('workspace');
    expect(result.errors).toHaveLength(0);
  });

  it('reports directory errors but continues scanning other locations', async () => {
    const result = await loadCustomTools({ workspaceRoot: '/missing' });

    expect(result.tools.every((tool) => tool.status === 'error' || tool.status === 'loaded')).toBe(true);
    expect(result.tools.some((tool) => tool.status === 'error')).toBe(true);
  });

  it('loads only from custom directory when configured', async () => {
    const customDir = '/my/tools';
    const userDir = '/home/.talkcody/tools';

    registerDirectory(customDir, ['custom-tool.ts']);
    registerDirectory(userDir, ['user-tool.ts']);

    definitionQueue.push(createDefinition('custom-tool'));

    const summary = await loadCustomTools({ customDirectory: customDir });
    const loadedNames = summary.tools
      .filter((tool) => tool.status === 'loaded')
      .map((tool) => tool.name)
      .sort();

    expect(loadedNames).toEqual(['custom-tool']);
    expect(summary.tools.every((tool) => tool.source)).toBe(true);
  });

  it('maps ui.Doing/ui.Result onto renderToolDoing/renderToolResult', async () => {
    const workspaceDir = '/workspace/.talkcody/tools';

    registerDirectory(workspaceDir, ['ui-tool.tsx']);

    const uiDoing = vi.fn(() => null);
    const uiResult = vi.fn(() => null);

    const definition = {
      name: 'ui-tool',
      description: 'ui tool',
      inputSchema: z.object({}),
      execute: vi.fn(async () => 'ok'),
      canConcurrent: false,
      ui: {
        Doing: uiDoing,
        Result: uiResult,
      },
    } as CustomToolDefinition & {
      ui: { Doing: () => null; Result: () => null };
    };

    definitionQueue.push(definition as CustomToolDefinition);

    const summary = await loadCustomTools({ workspaceRoot: '/workspace' });
    const loaded = summary.tools.find((tool) => tool.name === 'ui-tool');

    expect(loaded?.status).toBe('loaded');
    expect(loaded?.tool?.renderToolDoing).toBe(uiDoing);
    expect(loaded?.tool?.renderToolResult).toBe(uiResult);
  });

  it('loads packaged tool directories alongside single files', async () => {
    const workspaceDir = '/workspace/.talkcody/tools';

    registerDirectoryWithPackages(workspaceDir, ['single-tool.ts'], ['packaged-tool']);

    const { resolvePackagedTool, ensureToolDependencies } = await import('./custom-tool-packager');
    const { parseToolInputSchema } = await import('./custom-tool-schema-parser');

    vi.mocked(resolvePackagedTool).mockReset();
    vi.mocked(ensureToolDependencies).mockReset();
    vi.mocked(parseToolInputSchema).mockReset();

    vi.mocked(resolvePackagedTool).mockResolvedValueOnce({
      ok: true,
      info: {
        rootDir: `${workspaceDir}/packaged-tool`,
        entryPath: `${workspaceDir}/packaged-tool/tool.tsx`,
        packageJsonPath: `${workspaceDir}/packaged-tool/package.json`,
        lockfilePath: `${workspaceDir}/packaged-tool/bun.lockb`,
        lockfileType: 'bun',
        packageName: 'packaged-tool',
      },
    });

    vi.mocked(parseToolInputSchema).mockResolvedValueOnce(
      z.object({
        sql: z.string().min(1),
      })
    );
    vi.mocked(ensureToolDependencies).mockResolvedValueOnce({ ok: true });

    const packagedDefinition: CustomToolDefinition = {
      name: 'packaged-tool',
      description: 'packaged tool',
      inputSchema: z.object({ sql: z.string().min(1) }),
      execute: vi.fn(async () => 'run-packaged'),
      renderToolDoing: vi.fn(() => null),
      renderToolResult: vi.fn(() => null),
      canConcurrent: true,
      hidden: true,
      showResultUIAlways: true,
      permissions: ['net'],
    };

    definitionQueue.push(createDefinition('single-tool'));
    definitionQueue.push(packagedDefinition);

    const summary = await loadCustomTools({ workspaceRoot: '/workspace' });
    const loaded = summary.tools.filter((tool) => tool.status === 'loaded');
    const loadedNames = loaded.map((tool) => tool.name).sort();

    expect(loadedNames).toEqual(['packaged-tool', 'single-tool']);
    const packaged = loaded.find((tool) => tool.name === 'packaged-tool');
    expect(packaged?.tool?.inputSchema.safeParse({ sql: 'select 1' }).success).toBe(true);
    expect(packaged?.tool?.hidden).toBe(true);
    expect(packaged?.tool?.showResultUIAlways).toBe(true);
    expect(packaged?.tool?.permissions).toEqual(['net']);

    await expect(packaged?.tool?.execute({} as never, {
      taskId: 'task',
      toolId: 'packaged-tool',
    })).rejects.toThrow('Packaged tools must execute via bun');
  });

  it('uses talkcody.toolEntry override for packaged tool entry', async () => {
    const workspaceDir = '/workspace/.talkcody/tools';

    registerDirectoryWithPackages(workspaceDir, [], ['tool-with-entry']);

    const { resolvePackagedTool, ensureToolDependencies } = await import('./custom-tool-packager');
    vi.mocked(resolvePackagedTool).mockReset();
    vi.mocked(ensureToolDependencies).mockReset();

    vi.mocked(resolvePackagedTool).mockResolvedValueOnce({
      ok: true,
      info: {
        rootDir: `${workspaceDir}/tool-with-entry`,
        entryPath: `${workspaceDir}/tool-with-entry/custom-entry.tsx`,
        packageJsonPath: `${workspaceDir}/tool-with-entry/package.json`,
        lockfilePath: `${workspaceDir}/tool-with-entry/bun.lockb`,
        lockfileType: 'bun',
        packageName: 'tool-with-entry',
      },
    });
    vi.mocked(ensureToolDependencies).mockResolvedValueOnce({ ok: true });
    fsState.files.set(
      `${workspaceDir}/tool-with-entry/custom-entry.tsx`,
      'export default custom-entry'
    );

    definitionQueue.push(createDefinition('tool-with-entry'));

    const summary = await loadCustomTools({ workspaceRoot: '/workspace' });
    const loaded = summary.tools.filter((tool) => tool.status === 'loaded');

    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.filePath).toBe(`${workspaceDir}/tool-with-entry/custom-entry.tsx`);
  });

  it('reports packaged tool install failures as load errors', async () => {
    const workspaceDir = '/workspace/.talkcody/tools';

    registerDirectoryWithPackages(workspaceDir, [], ['failing-tool']);

    const { resolvePackagedTool, ensureToolDependencies } = await import('./custom-tool-packager');
    vi.mocked(resolvePackagedTool).mockReset();
    vi.mocked(ensureToolDependencies).mockReset();

    vi.mocked(resolvePackagedTool).mockResolvedValueOnce({
      ok: true,
      info: {
        rootDir: `${workspaceDir}/failing-tool`,
        entryPath: `${workspaceDir}/failing-tool/tool.tsx`,
        packageJsonPath: `${workspaceDir}/failing-tool/package.json`,
        lockfilePath: `${workspaceDir}/failing-tool/bun.lockb`,
        lockfileType: 'bun',
        packageName: 'failing-tool',
      },
    });
    vi.mocked(ensureToolDependencies).mockResolvedValueOnce({
      ok: false,
      error: 'Install failed',
    });

    const summary = await loadCustomTools({ workspaceRoot: '/workspace' });
    const failed = summary.tools.find((tool) => tool.status === 'error');

    expect(failed?.name).toBe('failing-tool');
    expect(failed?.error).toBe('Install failed');
  });

  it('uses custom directory directly without appending .talkcody/tools', async () => {
    const customDir = '/my/custom/tools';

    registerDirectory(customDir, ['my-custom-tool.ts']);
    definitionQueue.push(createDefinition('my-custom-tool'));

    const summary = await loadCustomTools({ customDirectory: customDir });
    const loadedNames = summary.tools
      .filter((tool) => tool.status === 'loaded')
      .map((tool) => tool.name)
      .sort();

    expect(loadedNames).toEqual(['my-custom-tool']);
    expect(summary.tools.every((tool) => tool.source === 'custom')).toBe(true);
  });
});
