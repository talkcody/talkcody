import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveCustomToolModule } from './import-map';

const fsState = {
  existing: new Set<string>(),
  files: new Map<string, string>(),
};

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn((path: string) => Promise.resolve(fsState.existing.has(path))),
  readTextFile: vi.fn((path: string) => Promise.resolve(fsState.files.get(path) ?? '')),
}));

vi.mock('@tauri-apps/api/path', () => ({
  join: vi.fn((...parts: string[]) => parts.filter(Boolean).join('/')),
  dirname: vi.fn((path: string) => path.split('/').slice(0, -1).join('/') || '/'),
  basename: vi.fn((path: string) => path.split('/').pop() || ''),
  normalize: vi.fn((path: string) => path.replace(/\/\.\//g, '/').replace(/\/+/g, '/')),
}));

vi.mock('@/services/tools/custom-tool-compiler', () => ({
  compileCustomTool: vi.fn(async (_source: string, options: { filename: string }) => ({
    code: `compiled:${options.filename}`,
  })),
  createCustomToolModuleUrl: vi.fn(async (_compiled: unknown, filename: string) => `module://${filename}`),
  resolveCustomToolDefinition: vi.fn(async () => ({ name: 'mock-tool' })),
}));

vi.mock('@/services/tools/custom-tool-packager', () => ({
  resolveToolRoot: vi.fn(async (baseDir?: string) => {
    // Simply return the base directory if it has a package.json
    // This simulates a packaged tool with dependencies
    if (!baseDir) return undefined;
    if (baseDir.includes('mysql-query')) {
      return baseDir;
    }
    if (baseDir.includes('tools')) {
      return baseDir;
    }
    return undefined;
  }),
  resolveNodeModuleEntry: vi.fn(async (modulePath: string) => {
    console.log('[mock] resolveNodeModuleEntry called', { modulePath });
    // Only return paths that actually exist in our test setup
    if (modulePath.includes('mysql2') && fsState.existing.has(`${modulePath}/index.js`)) {
      return `${modulePath}/index.js`;
    }
    return null;
  }),
  resolveNodeModuleSubpathEntry: vi.fn(async (modulePath: string, subpath: string) => {
    console.log('[mock] resolveNodeModuleSubpathEntry called', { modulePath, subpath });
    
    // Handle mysql2/promise
    if (modulePath.includes('mysql2') && subpath === './promise') {
      return `${modulePath}/promise.js`;
    }
    
    // Handle mysql2/connection
    if (modulePath.includes('mysql2') && subpath === './connection') {
      return `${modulePath}/connection.js`;
    }
    
    return null;
  }),
}));

describe('import map - packaged tool with dependencies', () => {
  beforeEach(() => {
    fsState.existing.clear();
    fsState.files.clear();
    vi.clearAllMocks();
  });

  it('stubs package.json dependencies from packaged tool', async () => {
    const toolRoot = '/Users/kks/mygit/talkcody/.talkcody/tools/mysql-query';
    const entryPath = `${toolRoot}/tool.tsx`;

    // Set up the file system state
    fsState.existing.add(entryPath);
    fsState.files.set(entryPath, 'export default { name: "mysql-query" }');

    // Set up package.json
    fsState.existing.add(`${toolRoot}/package.json`);
    fsState.existing.add(`${toolRoot}/bun.lockb`);
    fsState.files.set(
      `${toolRoot}/package.json`,
      JSON.stringify({
        name: 'mysql-query',
        version: '1.0.0',
        dependencies: {
          mysql2: '^3.16.1',
        },
      })
    );

    // Set up node_modules
    fsState.existing.add(`${toolRoot}/node_modules`);
    fsState.existing.add(`${toolRoot}/node_modules/mysql2`);
    fsState.existing.add(`${toolRoot}/node_modules/mysql2/package.json`);
    fsState.existing.add(`${toolRoot}/node_modules/mysql2/index.js`);
    fsState.existing.add(`${toolRoot}/node_modules/mysql2/promise.js`);

    // Set up mysql2 package.json with exports
    fsState.files.set(
      `${toolRoot}/node_modules/mysql2/package.json`,
      JSON.stringify({
        name: 'mysql2',
        version: '3.16.1',
        main: 'index.js',
        exports: {
          '.': './index.js',
          './promise': './promise.js',
        },
      })
    );
    fsState.files.set(`${toolRoot}/node_modules/mysql2/index.js`, 'export default {}');
    fsState.files.set(`${toolRoot}/node_modules/mysql2/promise.js`, 'export default {}');

    // Packaged tool dependencies should be stubbed in the WebView.
    const resolvedBare = await resolveCustomToolModule('mysql2', toolRoot);
    expect(typeof resolvedBare).toBe('function');

    const resolvedSubpath = await resolveCustomToolModule('mysql2/promise', toolRoot);
    expect(typeof resolvedSubpath).toBe('function');

    const { resolveNodeModuleSubpathEntry } = await import('@/services/tools/custom-tool-packager');
    expect(resolveNodeModuleSubpathEntry).not.toHaveBeenCalled();
  });

  it('stubs dependencies from tool entry file directory', async () => {
    const toolRoot = '/tools/mysql-query';
    const entryDir = toolRoot; // Entry file is at root of tool

    fsState.existing.add(`${toolRoot}/package.json`);
    fsState.existing.add(`${toolRoot}/bun.lockb`);

    // Set up node_modules
    fsState.existing.add(`${toolRoot}/node_modules/mysql2`);
    fsState.existing.add(`${toolRoot}/node_modules/mysql2/index.js`);
    fsState.existing.add(`${toolRoot}/node_modules/mysql2/package.json`);
    fsState.existing.add(`${toolRoot}/node_modules/mysql2/promise.js`);
    fsState.files.set(`${toolRoot}/node_modules/mysql2/index.js`, 'export default {}');

    fsState.files.set(
      `${toolRoot}/node_modules/mysql2/package.json`,
      JSON.stringify({
        name: 'mysql2',
        exports: {
          '.': './index.js',
          './promise': './promise.js',
        },
      })
    );
    fsState.files.set(`${toolRoot}/node_modules/mysql2/promise.js`, 'export default {}');

    const resolved = await resolveCustomToolModule('mysql2/promise', entryDir);
    expect(typeof resolved).toBe('function');
  });
});
