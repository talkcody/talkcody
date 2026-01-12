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
  dirEntries: new Map<string, Array<{ name: string; isFile: boolean }>>(),
  files: new Map<string, string>(),
};

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn((path: string) => Promise.resolve(fsState.existing.has(path))),
  readDir: vi.fn((dir: string) => Promise.resolve(fsState.dirEntries.get(dir) ?? [])),
  readTextFile: vi.fn((filePath: string) => Promise.resolve(fsState.files.get(filePath) ?? '')),
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
