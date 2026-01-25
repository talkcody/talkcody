import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomToolDefinition } from '@/types/custom-tool';
import type { CustomToolPackageInfo } from '@/types/custom-tool-package';

const fsState = {
  existing: new Set<string>(),
  files: new Map<string, string>(),
};

const executeMock = vi.fn(async () => ({ stdout: '', stderr: '', code: 0 }));

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn(async (path: string) => fsState.existing.has(path)),
  mkdir: vi.fn(async (path: string) => {
    fsState.existing.add(path);
  }),
  readTextFile: vi.fn(async (path: string) => fsState.files.get(path) ?? ''),
  remove: vi.fn(async (path: string) => {
    fsState.existing.delete(path);
    fsState.files.delete(path);
  }),
  writeTextFile: vi.fn(async (path: string, content: string) => {
    fsState.files.set(path, content);
    fsState.existing.add(path);
  }),
}));

vi.mock('@tauri-apps/api/path', () => ({
  join: vi.fn((...parts: string[]) => parts.filter(Boolean).join('/')),
}));

vi.mock('@tauri-apps/plugin-shell', () => ({
  Command: {
    create: vi.fn(() => ({ execute: executeMock })),
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

const definition: CustomToolDefinition = {
  name: 'mysql-query',
  description: 'mock tool',
  inputSchema: { parse: (value: unknown) => value } as never,
  execute: vi.fn(async () => 'ok'),
  renderToolDoing: vi.fn(() => null),
  renderToolResult: vi.fn(() => null),
  canConcurrent: false,
};

const packageInfo: CustomToolPackageInfo = {
  rootDir: '/tools/mysql-query',
  entryPath: '/tools/mysql-query/tool.tsx',
  packageJsonPath: '/tools/mysql-query/package.json',
  lockfilePath: '/tools/mysql-query/bun.lockb',
  lockfileType: 'bun',
};

describe('custom-tool-bun-runner', () => {
  beforeEach(() => {
    fsState.existing.clear();
    fsState.files.clear();
    executeMock.mockReset();
  });

  it('writes runner script with safe newline handling and regex filters', async () => {
    const { executePackagedToolWithBun } = await import('./custom-tool-bun-runner');

    executeMock.mockResolvedValueOnce({ stdout: '{"ok":true,"result":"ok"}', stderr: '', code: 0 });

    await executePackagedToolWithBun(definition, packageInfo, { sql: 'select 1' });

    const runner = fsState.files.get('/tools/mysql-query/.talkcody-bun-runner.mjs') ?? '';
    expect(runner).toContain("\\n");
    expect(runner).toContain('new RegExp(');
    expect(runner).toContain("'^@/lib/custom-tool-sdk$'");
    expect(runner).toContain("'^@/lib/tauri-fetch$'");
    expect(runner).toContain("'^@/'");
  });

  it('rewrites runner script if content differs from template', async () => {
    const { executePackagedToolWithBun } = await import('./custom-tool-bun-runner');

    fsState.existing.add('/tools/mysql-query/.talkcody-bun-runner.mjs');
    fsState.files.set('/tools/mysql-query/.talkcody-bun-runner.mjs', 'stale');
    executeMock.mockResolvedValueOnce({ stdout: '{"ok":true,"result":"ok"}', stderr: '', code: 0 });

    await executePackagedToolWithBun(definition, packageInfo, { sql: 'select 1' });

    const runner = fsState.files.get('/tools/mysql-query/.talkcody-bun-runner.mjs') ?? '';
    expect(runner).not.toBe('stale');
    expect(runner).toContain('talkcody-alias');
  });

  it('propagates bun runner errors when stdout is empty', async () => {
    const { executePackagedToolWithBun } = await import('./custom-tool-bun-runner');

    executeMock.mockResolvedValueOnce({ stdout: '', stderr: 'boom', code: 1 });

    await expect(
      executePackagedToolWithBun(definition, packageInfo, { sql: 'select 1' })
    ).rejects.toThrow('Empty output from bun runner');
  });
});
