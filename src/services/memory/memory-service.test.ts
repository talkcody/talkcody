import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fileState, directoryState } = vi.hoisted(() => ({
  fileState: new Map<string, string>(),
  directoryState: new Set<string>(),
}));

const { unreadablePaths } = vi.hoisted(() => ({
  unreadablePaths: new Set<string>(),
}));

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '') || '/';
}

function parentDirectory(filePath: string): string {
  const normalized = normalizePath(filePath);
  const segments = normalized.split('/');
  segments.pop();
  return segments.join('/') || '/';
}

function collectReadDirEntries(dirPath: string): Array<{ name: string; isDirectory: boolean }> {
  const normalizedDir = normalizePath(dirPath);
  const childEntries = new Map<string, { name: string; isDirectory: boolean }>();

  for (const directoryPath of directoryState) {
    if (normalizePath(directoryPath) === normalizedDir) {
      continue;
    }
    if (parentDirectory(directoryPath) !== normalizedDir) {
      continue;
    }

    const name = normalizePath(directoryPath).split('/').at(-1);
    if (name) {
      childEntries.set(name, { name, isDirectory: true });
    }
  }

  for (const filePath of fileState.keys()) {
    if (parentDirectory(filePath) !== normalizedDir) {
      continue;
    }

    const name = normalizePath(filePath).split('/').at(-1);
    if (name) {
      childEntries.set(name, { name, isDirectory: false });
    }
  }

  return [...childEntries.values()];
}

function markParentDirectories(filePath: string) {
  let current = parentDirectory(filePath);
  while (current && !directoryState.has(current)) {
    directoryState.add(current);
    const next = parentDirectory(current);
    if (next === current) {
      break;
    }
    current = next;
  }
}

vi.mock('@tauri-apps/api/path', () => ({
  appDataDir: vi.fn().mockResolvedValue('/test/app-data'),
  join: vi.fn().mockImplementation(async (...paths: string[]) => normalizePath(paths.join('/'))),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn(async (filePath: string) => {
    const normalized = normalizePath(filePath);
    return (
      unreadablePaths.has(normalized) ||
      fileState.has(normalized) ||
      directoryState.has(normalized)
    );
  }),
  mkdir: vi.fn(async (dirPath: string) => {
    markParentDirectories(dirPath);
    directoryState.add(normalizePath(dirPath));
  }),
  readDir: vi.fn(async (dirPath: string) => collectReadDirEntries(dirPath)),
  readTextFile: vi.fn(async (filePath: string) => {
    const normalized = normalizePath(filePath);
    if (unreadablePaths.has(normalized)) {
      throw new Error(`Unreadable file: ${normalized}`);
    }
    const value = fileState.get(normalized);
    if (value === undefined) {
      throw new Error(`Missing file: ${normalized}`);
    }
    return value;
  }),
  remove: vi.fn(async (filePath: string) => {
    fileState.delete(normalizePath(filePath));
  }),
  rename: vi.fn(async (oldPath: string, newPath: string) => {
    const normalizedOld = normalizePath(oldPath);
    const normalizedNew = normalizePath(newPath);
    const value = fileState.get(normalizedOld);
    if (value === undefined) {
      throw new Error(`Missing file: ${normalizedOld}`);
    }
    fileState.delete(normalizedOld);
    fileState.set(normalizedNew, value);
    markParentDirectories(normalizedNew);
  }),
  writeTextFile: vi.fn(async (filePath: string, value: string) => {
    const normalized = normalizePath(filePath);
    markParentDirectories(normalized);
    fileState.set(normalized, value);
  }),
}));

import {
  MEMORY_INDEX_INJECTION_LINE_LIMIT,
  memoryService,
} from './memory-service';

describe('memoryService', () => {
  beforeEach(() => {
    fileState.clear();
    directoryState.clear();
    unreadablePaths.clear();
    vi.clearAllMocks();
  });

  it('writes global memory into the standalone global MEMORY.md index', async () => {
    const document = await memoryService.writeGlobal('User prefers concise answers');

    expect(document.path).toBe('/test/app-data/memory/global/MEMORY.md');
    expect(document.kind).toBe('index');
    expect(document.content).toBe('User prefers concise answers');
    expect(fileState.get('/test/app-data/memory/global/MEMORY.md')).toBe(
      'User prefers concise answers\n'
    );
  });

  it('writes project memory into a standalone project MEMORY.md index', async () => {
    const document = await memoryService.writeProjectMemoryDocument('/repo', '# Memory Index\n');

    expect(document.kind).toBe('index');
    expect(document.path).toMatch(/^\/test\/app-data\/memory\/projects\/path-[0-9a-f]{8}\/MEMORY\.md$/);
    expect(fileState.get(document.path ?? '')).toBe('# Memory Index\n');
  });

  it('preserves MEMORY.md content as written, including repeated topic routes', async () => {
    const document = await memoryService.writeGlobal([
      '# Memory Index',
      '',
      '## Topics',
      '- user.md: 用户个人信息与长期偏好',
      '- work-preferences.md: 用户的工作偏好与回答风格偏好；当需要调整回答风格时读取。',
      '- user.md: 用户个人信息与长期偏好，包括姓名、职业、人格类型（如 MBTI）；当需要个性化沟通风格时读取。',
    ].join('\n'));

    expect(document.content).toBe([
      '# Memory Index',
      '',
      '## Topics',
      '- user.md: 用户个人信息与长期偏好',
      '- work-preferences.md: 用户的工作偏好与回答风格偏好；当需要调整回答风格时读取。',
      '- user.md: 用户个人信息与长期偏好，包括姓名、职业、人格类型（如 MBTI）；当需要个性化沟通风格时读取。',
    ].join('\n'));
    expect(document.content.match(/user\.md/g)).toHaveLength(2);
  });

  it('appends MEMORY.md content without storage-layer deduplication', async () => {
    await memoryService.writeGlobal([
      '# Memory Index',
      '',
      '## Topics',
      '- user.md: 用户个人信息与长期偏好',
    ].join('\n'));

    const document = await memoryService.appendGlobal(
      '- user.md: 用户个人信息与长期偏好，包括姓名；当需要身份信息时读取。'
    );

    expect(document.content.match(/user\.md/g)).toHaveLength(2);
    expect(document.content).toContain('包括姓名；当需要身份信息时读取');
  });

  it('shares project memory across worktrees that resolve to the same git common directory', async () => {
    fileState.set('/repo-main/.git', 'gitdir: /repos/source/.git/worktrees/main\n');
    fileState.set('/repo-feature/.git', 'gitdir: /repos/source/.git/worktrees/feature\n');

    const written = await memoryService.writeProjectMemoryDocument(
      '/repo-main',
      '# Memory Index\n- See architecture.md'
    );
    const loaded = await memoryService.getProjectMemoryDocument('/repo-feature');

    expect(loaded.path).toBe(written.path);
    expect(loaded.content).toContain('architecture.md');
  });

  it('shares project memory between a main checkout and its linked worktree', async () => {
    directoryState.add('/repos/source/.git');
    fileState.set('/repo-feature/.git', 'gitdir: /repos/source/.git/worktrees/feature\n');

    const written = await memoryService.writeProjectMemoryDocument(
      '/repos/source',
      '# Memory Index\n- See architecture.md'
    );
    const loaded = await memoryService.getProjectMemoryDocument('/repo-feature');

    expect(loaded.path).toBe(written.path);
    expect(loaded.content).toContain('architecture.md');
  });

  it('supports topic-file writes, reads, renames, deletes, and listing', async () => {
    await memoryService.writeProjectMemoryDocument('/repo', '# Memory Index\n- architecture.md');
    const written = await memoryService.writeTopicDocument(
      'project',
      'architecture.md',
      '## Architecture\n\n- Rust backend',
      { workspaceRoot: '/repo' }
    );

    expect(written.kind).toBe('topic');
    expect(written.path).toMatch(/architecture\.md$/);

    const listed = await memoryService.listTopicDocuments('project', { workspaceRoot: '/repo' });
    expect(listed.map((document) => document.fileName)).toEqual(['architecture.md']);

    await memoryService.renameTopicDocument(
      'project',
      'architecture.md',
      'system-architecture.md',
      { workspaceRoot: '/repo' }
    );

    const renamedPath = (written.path ?? '').replace('architecture.md', 'system-architecture.md');
    expect(fileState.has(renamedPath)).toBe(true);

    await memoryService.deleteTopicDocument('project', 'system-architecture.md', {
      workspaceRoot: '/repo',
    });

    const remaining = await memoryService.listTopicDocuments('project', { workspaceRoot: '/repo' });
    expect(remaining).toEqual([]);
  });

  it('rejects non-markdown or out-of-workspace topic file names', async () => {
    await expect(
      memoryService.writeTopicDocument('global', '../secrets.txt', 'Should fail')
    ).rejects.toThrow('Topic file name must not contain path separators');

    await expect(
      memoryService.writeTopicDocument('global', 'nested/topic.md', 'Should fail')
    ).rejects.toThrow('Topic file name must not contain path separators');
  });

  it('rejects case-insensitive MEMORY.md topic names for writes and renames', async () => {
    await expect(
      memoryService.writeTopicDocument('global', 'memory.md', 'Should fail')
    ).rejects.toThrow('Topic file name cannot be MEMORY.md');

    await memoryService.writeTopicDocument('global', 'architecture.md', '## Architecture');

    await expect(
      memoryService.renameTopicDocument('global', 'architecture.md', 'Memory.md')
    ).rejects.toThrow('Topic file name cannot be MEMORY.md');
  });

  it('limits injected document content to the first 200 lines of MEMORY.md', async () => {
    const fullContent = Array.from({ length: MEMORY_INDEX_INJECTION_LINE_LIMIT + 25 }, (_, index) =>
      `- line ${index + 1}`
    ).join('\n');
    await memoryService.writeGlobal(fullContent);

    const injected = await memoryService.getInjectedDocument('global');

    expect(injected.content.split('\n')).toHaveLength(MEMORY_INDEX_INJECTION_LINE_LIMIT);
    expect(injected.content).toContain('- line 200');
    expect(injected.content).not.toContain('- line 201');
  });

  it('reports audit signals for missing and unindexed topic files', async () => {
    await memoryService.writeGlobal('# Memory Index\n- architecture.md\n- missing.md');
    await memoryService.writeTopicDocument('global', 'architecture.md', '## Architecture');
    await memoryService.writeTopicDocument('global', 'extra.md', '## Extra');

    const audit = await memoryService.getWorkspaceAudit('global');

    expect(audit.indexedTopicFiles).toEqual(['architecture.md', 'missing.md']);
    expect(audit.unindexedTopicFiles).toEqual(['extra.md']);
    expect(audit.missingTopicFiles).toEqual(['missing.md']);
  });

  it('searches across index and topic files for both scopes', async () => {
    await memoryService.writeGlobal('# Memory Index\n- preferences.md\n- bun');
    await memoryService.writeTopicDocument('global', 'preferences.md', '## Preferences\n\n- Use bun');
    await memoryService.writeProjectMemoryDocument('/repo', '# Memory Index\n- commands.md');
    await memoryService.writeTopicDocument('project', 'commands.md', '## Commands\n\n- bun run build', {
      workspaceRoot: '/repo',
    });

    const results = await memoryService.search('bun', {
      workspaceRoot: '/repo',
      maxResults: 10,
    });

    expect(results.some((result) => result.scope === 'global' && result.kind === 'index')).toBe(
      true
    );
    expect(results.some((result) => result.scope === 'global' && result.kind === 'topic')).toBe(
      true
    );
    expect(results.some((result) => result.scope === 'project' && result.kind === 'topic')).toBe(
      true
    );
  });
});
