import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomToolPackageInfo } from '@/types/custom-tool-package';
import {
  ensureToolDependencies,
  resolvePackagedTool,
} from './custom-tool-packager';

const fsState = {
  existing: new Set<string>(),
  files: new Map<string, string>(),
  stats: new Map<string, { mtime: number }>(),
};

const execMock = vi.fn(async () => ({ code: 0, stdout: '', stderr: '' }));

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn((path: string) => Promise.resolve(fsState.existing.has(path))),
  readTextFile: vi.fn((path: string) => Promise.resolve(fsState.files.get(path) ?? '')),
  writeTextFile: vi.fn(async (path: string, content: string) => {
    fsState.files.set(path, content);
  }),
  stat: vi.fn(async (path: string) => {
    return { mtime: new Date(fsState.stats.get(path)?.mtime ?? Date.now()) };
  }),
}));

vi.mock('@tauri-apps/api/path', () => ({
  join: vi.fn((...parts: string[]) => parts.filter(Boolean).join('/')),
  dirname: vi.fn((path: string) => path.split('/').slice(0, -1).join('/') || '/'),
  normalize: vi.fn((path: string) => path.replace(/\/\.\//g, '/').replace(/\/\/+/g, '/')),
}));

vi.mock('@tauri-apps/plugin-shell', () => ({
  Command: {
    create: vi.fn(() => ({ execute: execMock })),
  },
}));

describe('custom-tool-packager', () => {
  beforeEach(() => {
    fsState.existing.clear();
    fsState.files.clear();
    fsState.stats.clear();
    execMock.mockClear();
  });

  it('rejects package.json with scripts', async () => {
    const root = '/tools/pkg';
    fsState.existing.add(`${root}/package.json`);
    fsState.files.set(
      `${root}/package.json`,
      JSON.stringify({ dependencies: { zod: '1.0.0' }, scripts: { postinstall: 'echo 1' } })
    );
    fsState.existing.add(`${root}/tool.tsx`);
    fsState.existing.add(`${root}/bun.lockb`);

    const result = await resolvePackagedTool(root);
    expect(result.ok).toBe(false);
  });

  it('requires dependencies only (rejects devDependencies)', async () => {
    const root = '/tools/pkg';
    fsState.existing.add(`${root}/package.json`);
    fsState.files.set(
      `${root}/package.json`,
      JSON.stringify({ dependencies: { zod: '1.0.0' }, devDependencies: { vitest: '1.0.0' } })
    );
    fsState.existing.add(`${root}/tool.tsx`);
    fsState.existing.add(`${root}/bun.lockb`);

    const result = await resolvePackagedTool(root);
    expect(result.ok).toBe(false);
  });

  it('requires a lockfile', async () => {
    const root = '/tools/pkg';
    fsState.existing.add(`${root}/package.json`);
    fsState.files.set(`${root}/package.json`, JSON.stringify({ dependencies: { zod: '1.0.0' } }));
    fsState.existing.add(`${root}/tool.tsx`);

    const result = await resolvePackagedTool(root);
    expect(result.ok).toBe(false);
  });

  it('prefers bun lockfile when both exist', async () => {
    const root = '/tools/pkg';
    fsState.existing.add(`${root}/package.json`);
    fsState.files.set(`${root}/package.json`, JSON.stringify({ dependencies: { zod: '1.0.0' } }));
    fsState.existing.add(`${root}/tool.tsx`);
    fsState.existing.add(`${root}/bun.lockb`);
    fsState.existing.add(`${root}/package-lock.json`);

    const result = await resolvePackagedTool(root);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.info.lockfileType).toBe('bun');
      expect(result.info.lockfilePath).toBe('/tools/pkg/bun.lockb');
    }
  });

  it('runs install with scripts ignored', async () => {
    const info: CustomToolPackageInfo = {
      rootDir: '/tools/pkg',
      entryPath: '/tools/pkg/tool.tsx',
      packageJsonPath: '/tools/pkg/package.json',
      lockfilePath: '/tools/pkg/bun.lockb',
      lockfileType: 'bun',
    };

    fsState.existing.add('/tools/pkg/.talkcody-install.json');
    fsState.files.set('/tools/pkg/.talkcody-install.json', JSON.stringify({
      lockfilePath: info.lockfilePath,
      lockfileMtimeMs: 1,
    }));
    fsState.stats.set(info.lockfilePath, { mtime: 2 });

    const result = await ensureToolDependencies(info);
    expect(result.ok).toBe(true);
    expect(execMock).toHaveBeenCalled();
  });

  it('resolves conditional exports for subpath entries (mysql2/promise)', async () => {
    const root = '/tools/pkg/node_modules/mysql2';
    fsState.existing.add(`${root}/package.json`);
    fsState.files.set(
      `${root}/package.json`,
      JSON.stringify({
        name: 'mysql2',
        exports: {
          '.': './index.js',
          './promise': {
            import: './promise.js',
            require: './promise.js',
          },
        },
      })
    );
    fsState.existing.add(`${root}/promise.js`);

    const { resolveNodeModuleSubpathEntry } = await import('./custom-tool-packager');
    const resolved = await resolveNodeModuleSubpathEntry(root, './promise');
    expect(resolved).toBe('/tools/pkg/node_modules/mysql2/promise.js');
  });
});
