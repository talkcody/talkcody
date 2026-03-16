import { appDataDir, join } from '@tauri-apps/api/path';
import { exists, readTextFile } from '@tauri-apps/plugin-fs';
import { getMemoryScopeConfig, MEMORY_WORKSPACE_DIRECTORY_NAME } from './memory-scope-config';
import type {
  MemoryContext,
  MemoryScope,
  MemoryWorkspace,
  MemoryWorkspaceIdentity,
} from './memory-types';

function normalizeFsPath(value: string): string {
  const normalized = value.replace(/\\/g, '/').trim();
  if (!normalized) {
    return normalized;
  }

  const withoutTrailing = normalized.replace(/\/+$/g, '');
  if (/^[A-Za-z]:$/.test(withoutTrailing)) {
    return `${withoutTrailing}/`;
  }

  return withoutTrailing || '/';
}

function splitPathSegments(value: string): string[] {
  return normalizeFsPath(value)
    .split('/')
    .filter((segment) => segment.length > 0);
}

function isAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:\//.test(value) || value.startsWith('/');
}

function joinPathSegments(basePath: string, ...segments: string[]): string {
  const base = normalizeFsPath(basePath);
  const prefix = /^[A-Za-z]:\/$/.test(base) ? base.slice(0, 2) : base.startsWith('/') ? '/' : '';
  const parts = [
    ...splitPathSegments(base),
    ...segments.flatMap((segment) => splitPathSegments(segment)),
  ];
  const resolved: string[] = [];

  for (const part of parts) {
    if (!part || part === '.') {
      continue;
    }
    if (part === '..') {
      if (resolved.length > 0) {
        resolved.pop();
      }
      continue;
    }
    resolved.push(part);
  }

  if (prefix === '/') {
    return `/${resolved.join('/')}` || '/';
  }

  if (prefix) {
    return resolved.length > 0 ? `${prefix}/${resolved.join('/')}` : `${prefix}/`;
  }

  return resolved.join('/');
}

function resolvePathFrom(basePath: string, targetPath: string): string {
  if (isAbsolutePath(targetPath)) {
    return normalizeFsPath(targetPath);
  }

  return joinPathSegments(basePath, targetPath);
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}

async function tryReadTextFile(filePath: string): Promise<string | null> {
  try {
    return await readTextFile(filePath);
  } catch {
    return null;
  }
}

export class MemoryWorkspaceResolver {
  async resolve(context: MemoryContext): Promise<MemoryWorkspace> {
    return context.scope === 'global'
      ? await this.resolveGlobalWorkspace()
      : await this.resolveProjectWorkspace(context.workspaceRoot);
  }

  async resolveByScope(scope: MemoryScope, workspaceRoot?: string): Promise<MemoryWorkspace> {
    return await this.resolve({ scope, workspaceRoot });
  }

  private async resolveGlobalWorkspace(): Promise<MemoryWorkspace> {
    const config = getMemoryScopeConfig('global');
    const appDir = await appDataDir();
    const path = await join(appDir, MEMORY_WORKSPACE_DIRECTORY_NAME, config.workspaceDirectoryName);
    const indexPath = await join(path, config.indexFileName);

    return {
      scope: 'global',
      path,
      indexPath,
      exists: await exists(path),
      identity: {
        kind: 'path',
        key: config.workspaceDirectoryName,
        sourcePath: path,
      },
    };
  }

  private async resolveProjectWorkspace(workspaceRoot?: string): Promise<MemoryWorkspace> {
    const identity = await this.resolveProjectWorkspaceIdentity(workspaceRoot);
    if (!identity) {
      return {
        scope: 'project',
        path: null,
        indexPath: null,
        exists: false,
        identity: null,
      };
    }

    const config = getMemoryScopeConfig('project');
    const appDir = await appDataDir();
    const path = await join(
      appDir,
      MEMORY_WORKSPACE_DIRECTORY_NAME,
      config.workspaceDirectoryName,
      identity.key
    );
    const indexPath = await join(path, config.indexFileName);

    return {
      scope: 'project',
      path,
      indexPath,
      exists: await exists(path),
      identity,
    };
  }

  private async resolveProjectWorkspaceIdentity(
    workspaceRoot?: string
  ): Promise<MemoryWorkspaceIdentity | null> {
    if (!workspaceRoot) {
      return null;
    }

    const normalizedRoot = normalizeFsPath(workspaceRoot);
    const dotGitPath = await join(normalizedRoot, '.git');
    if (!(await exists(dotGitPath))) {
      return {
        kind: 'path',
        key: `path-${hashString(normalizedRoot)}`,
        sourcePath: normalizedRoot,
      };
    }

    const dotGitContent = await tryReadTextFile(dotGitPath);
    const gitDirMatch = dotGitContent ? /^gitdir:\s*(.+)$/im.exec(dotGitContent.trim()) : null;

    if (gitDirMatch?.[1]) {
      const gitDir = resolvePathFrom(normalizedRoot, gitDirMatch[1].trim());
      const commonDir = await this.resolveGitCommonDirectory(gitDir);
      return {
        kind: 'git',
        key: `git-${hashString(commonDir)}`,
        sourcePath: commonDir,
      };
    }

    const commonDir = await this.resolveGitCommonDirectory(dotGitPath);
    return {
      kind: 'git',
      key: `git-${hashString(commonDir)}`,
      sourcePath: commonDir,
    };
  }

  private async resolveGitCommonDirectory(gitDirPath: string): Promise<string> {
    const normalizedGitDir = normalizeFsPath(gitDirPath);
    const commonDirPath = await join(normalizedGitDir, 'commondir');
    const commonDirContent = await tryReadTextFile(commonDirPath);
    const commonDirValue = commonDirContent?.trim();

    if (commonDirValue) {
      return resolvePathFrom(normalizedGitDir, commonDirValue);
    }

    return normalizeFsPath(normalizedGitDir.replace(/\/worktrees\/[^/]+$/, ''));
  }
}

export const memoryWorkspaceResolver = new MemoryWorkspaceResolver();
