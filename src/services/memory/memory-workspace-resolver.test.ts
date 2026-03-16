import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fileState, directoryState } = vi.hoisted(() => ({
  fileState: new Map<string, string>(),
  directoryState: new Set<string>(),
}));

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '') || '/';
}

vi.mock('@tauri-apps/api/path', () => ({
  appDataDir: vi.fn().mockResolvedValue('/test/app-data'),
  join: vi.fn().mockImplementation(async (...paths: string[]) => normalizePath(paths.join('/'))),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn(async (filePath: string) => {
    const normalized = normalizePath(filePath);
    return fileState.has(normalized) || directoryState.has(normalized);
  }),
  readTextFile: vi.fn(async (filePath: string) => {
    const normalized = normalizePath(filePath);
    const value = fileState.get(normalized);
    if (value === undefined) {
      throw new Error(`Missing file: ${normalized}`);
    }
    return value;
  }),
}));

import { MemoryWorkspaceResolver } from './memory-workspace-resolver';

describe('MemoryWorkspaceResolver', () => {
  const resolver = new MemoryWorkspaceResolver();

  beforeEach(() => {
    fileState.clear();
    directoryState.clear();
    vi.clearAllMocks();
  });

  it('resolves the global workspace under app data', async () => {
    const workspace = await resolver.resolve({ scope: 'global' });

    expect(workspace.path).toBe('/test/app-data/memory/global');
    expect(workspace.indexPath).toBe('/test/app-data/memory/global/MEMORY.md');
    expect(workspace.identity).toEqual({
      kind: 'path',
      key: 'global',
      sourcePath: '/test/app-data/memory/global',
    });
  });

  it('falls back to path identity when no git metadata exists', async () => {
    const workspace = await resolver.resolve({
      scope: 'project',
      workspaceRoot: '/repo',
    });

    expect(workspace.path).toMatch(/^\/test\/app-data\/memory\/projects\/path-[0-9a-f]{8}$/);
    expect(workspace.indexPath).toMatch(/MEMORY\.md$/);
    expect(workspace.identity?.kind).toBe('path');
    expect(workspace.identity?.sourcePath).toBe('/repo');
  });

  it('shares one workspace identity between a main checkout and its linked worktree', async () => {
    directoryState.add('/repos/source/.git');
    fileState.set('/repo-feature/.git', 'gitdir: /repos/source/.git/worktrees/feature\n');
    fileState.set('/repos/source/.git/worktrees/feature/commondir', '../..\n');

    const mainWorkspace = await resolver.resolve({
      scope: 'project',
      workspaceRoot: '/repos/source',
    });
    const worktreeWorkspace = await resolver.resolve({
      scope: 'project',
      workspaceRoot: '/repo-feature',
    });

    expect(mainWorkspace.identity?.kind).toBe('git');
    expect(worktreeWorkspace.identity?.kind).toBe('git');
    expect(mainWorkspace.identity?.key).toBe(worktreeWorkspace.identity?.key);
    expect(mainWorkspace.indexPath).toBe(worktreeWorkspace.indexPath);
  });

  it('returns an unavailable project workspace when root is missing', async () => {
    const workspace = await resolver.resolve({ scope: 'project' });

    expect(workspace.path).toBeNull();
    expect(workspace.indexPath).toBeNull();
    expect(workspace.identity).toBeNull();
  });
});
