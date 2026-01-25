import { describe, expect, it, beforeEach, vi } from 'vitest';
import { createMockTauriPath } from '@/test/mocks/tauri-path';
import { __getInternalModuleLoaderKeys, resolveCustomToolModule } from './import-map';

const TEST_FILE_PATTERNS = [/\.test\./, /\/src\/test\//];

const fsState = {
  existing: new Set<string>(),
  files: new Map<string, string>(),
};

vi.mock('@tauri-apps/api/path', () => {
  const mockNormalize = (path: string) => {
    // Simple normalization: remove /./ and collapse multiple slashes
    let normalized = path.replace(/\/\.\//g, '/');
    normalized = normalized.replace(/\/\/+/g, '/');
    return normalized;
  };
  return {
    normalize: vi.fn().mockImplementation(mockNormalize),
    appDataDir: vi.fn().mockResolvedValue('/test/app-data'),
    homeDir: vi.fn().mockResolvedValue('/test/home'),
    join: vi.fn().mockImplementation((...paths: string[]) => paths.filter(Boolean).join('/')),
    dirname: vi.fn().mockImplementation((path: string) => {
      const parts = path.split('/');
      parts.pop();
      return parts.join('/') || '/';
    }),
    basename: vi.fn().mockImplementation((path: string) => {
      const parts = path.split('/');
      return parts.pop() || '';
    }),
    isAbsolute: vi.fn().mockImplementation((path: string) => path.startsWith('/')),
  };
});

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn((path: string) => Promise.resolve(fsState.existing.has(path))),
  readTextFile: vi.fn((path: string) => Promise.resolve(fsState.files.get(path) ?? '')),
}));

vi.mock('@/services/tools/custom-tool-compiler', () => ({
  compileCustomTool: vi.fn(async (_source: string, options: { filename: string }) => ({
    code: `compiled:${options.filename}`,
  })),
  createCustomToolModuleUrl: vi.fn(async (_compiled: unknown, filename: string) => `module://${filename}`),
  resolveCustomToolDefinition: vi.fn(async () => ({ name: 'mock-tool' })),
}));

vi.mock('@/services/tools/custom-tool-packager', () => ({
  resolveToolRoot: vi.fn(async (baseDir?: string) => (baseDir ? '/tools/pkg' : undefined)),
  resolveNodeModuleEntry: vi.fn(async (modulePath: string) => {
    // Return index.js for the module path
    if (modulePath.includes('node_modules')) {
      return `${modulePath}/index.js`;
    }
    return '/tools/pkg/node_modules/foo/index.js';
  }),
  resolveNodeModuleSubpathEntry: vi.fn(async (modulePath: string, subpath: string) => {
    console.log('[mock] resolveNodeModuleSubpathEntry called', modulePath, subpath);
    if (subpath === './promise' && modulePath.includes('mysql2')) {
      return `${modulePath}/promise.js`;
    }
    if (subpath === './connection' && modulePath.includes('mysql2')) {
      return `${modulePath}/connection.js`;
    }
    if (subpath && modulePath.includes('foo')) {
      return `${modulePath}/${subpath.replace(/^\.\//, '')}.js`;
    }
    if (subpath && modulePath.includes('@scope/name')) {
      return `${modulePath}/${subpath.replace(/^\.\//, '')}.js`;
    }
    return null;
  }),
}));

describe('custom tool import map', () => {
  const loaderKeys = __getInternalModuleLoaderKeys();

  beforeEach(() => {
    fsState.existing.clear();
    fsState.files.clear();
    vi.clearAllMocks();
  });

  it('excludes test files from module registry', () => {
    TEST_FILE_PATTERNS.forEach((pattern) => {
      expect(loaderKeys.some((key) => pattern.test(key))).toBe(false);
    });
  });

  it('still includes regular source files', () => {
    expect(loaderKeys).toContain('/src/lib/utils/debounce.ts');
  });

  it('resolves relative imports without extensions', async () => {
    const baseDir = '/tools';
    const filePath = '/tools/analysis-utils.ts';
    fsState.existing.add(filePath);
    fsState.files.set(filePath, 'export default {}');

    const resolved = await resolveCustomToolModule('./analysis-utils', baseDir);
    expect(resolved).toEqual({ name: 'mock-tool' });
  });

  it('resolves directory imports to index files', async () => {
    const baseDir = '/tools';
    const filePath = '/tools/helpers/index.ts';
    fsState.existing.add(filePath);
    fsState.files.set(filePath, 'export default {}');

    const resolved = await resolveCustomToolModule('./helpers', baseDir);
    expect(resolved).toEqual({ name: 'mock-tool' });
  });

  it('resolves bare imports from tool node_modules', async () => {
    const baseDir = '/tools/pkg';
    fsState.existing.add('/tools/pkg/node_modules/foo');
    fsState.existing.add('/tools/pkg/node_modules/foo/index.js');
    fsState.files.set('/tools/pkg/node_modules/foo/index.js', 'export default {}');

    const resolved = await resolveCustomToolModule('foo', baseDir);
    expect(resolved).toEqual({ name: 'mock-tool' });
  });

  it('provides events builtin for Node-style modules', async () => {
    const resolved = await resolveCustomToolModule('events');
    expect(typeof resolved).toBe('function');
    const moduleRef = resolved as { EventEmitter?: unknown };
    expect(moduleRef.EventEmitter).toBe(resolved);
  });

  it('resolves scoped packages with subpaths', async () => {
    const baseDir = '/tools/pkg';
    fsState.existing.add('/tools/pkg/node_modules/@scope/name');
    fsState.existing.add('/tools/pkg/node_modules/@scope/name/subpath.js');
    fsState.files.set('/tools/pkg/node_modules/@scope/name/subpath.js', 'export default {}');

    const resolved = await resolveCustomToolModule('@scope/name/subpath', baseDir);
    expect(resolved).toEqual({ name: 'mock-tool' });
  });

  it('resolves export subpaths from packages', async () => {
    const baseDir = '/tools/pkg';
    fsState.existing.add('/tools/pkg/node_modules/mysql2');
    fsState.existing.add('/tools/pkg/node_modules/mysql2/promise.js');
    fsState.files.set('/tools/pkg/node_modules/mysql2/promise.js', 'export default {}');

    const resolved = await resolveCustomToolModule('mysql2/promise', baseDir);
    expect(resolved).toEqual({ name: 'mock-tool' });
  });

  it('resolves node_modules subpath imports from packaged tool subdirectory', async () => {
    const baseDir = '/tools/pkg/subdir';
    fsState.existing.add('/tools/pkg/node_modules/mysql2');
    fsState.existing.add('/tools/pkg/node_modules/mysql2/connection.js');
    fsState.files.set('/tools/pkg/node_modules/mysql2/connection.js', 'export default {}');

    const resolved = await resolveCustomToolModule('mysql2/connection', baseDir);
    expect(resolved).toEqual({ name: 'mock-tool' });
    
    // Verify resolveNodeModuleSubpathEntry was called with correct arguments
    const { resolveNodeModuleSubpathEntry } = await import('@/services/tools/custom-tool-packager');
    expect(resolveNodeModuleSubpathEntry).toHaveBeenCalledWith(
      '/tools/pkg/node_modules/mysql2',
      './connection'
    );
  });
});
