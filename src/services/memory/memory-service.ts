import { appDataDir, join } from '@tauri-apps/api/path';
import {
  exists,
  mkdir,
  readDir,
  readTextFile,
  remove,
  rename,
  writeTextFile,
} from '@tauri-apps/plugin-fs';
import { logger } from '@/lib/logger';

export const MEMORY_WORKSPACE_INDEX_FILE_NAME = 'MEMORY.md';
export const MEMORY_WORKSPACE_DIRECTORY_NAME = 'memory';
export const GLOBAL_MEMORY_WORKSPACE_NAME = 'global';
export const PROJECT_MEMORY_WORKSPACE_NAME = 'projects';
export const MEMORY_INDEX_INJECTION_LINE_LIMIT = 200;

export type MemoryScope = 'global' | 'project';
export type MemoryDocumentKind = 'index' | 'topic';
export type MemoryWorkspaceIdentityKind = 'git' | 'path';

export interface MemoryWorkspaceIdentity {
  kind: MemoryWorkspaceIdentityKind;
  key: string;
  sourcePath: string;
}

export interface MemoryWorkspace {
  scope: MemoryScope;
  path: string | null;
  indexPath: string | null;
  exists: boolean;
  identity: MemoryWorkspaceIdentity | null;
}

export interface MemoryDocument {
  scope: MemoryScope;
  path: string | null;
  content: string;
  exists: boolean;
  kind: MemoryDocumentKind;
  fileName: string | null;
  workspacePath?: string | null;
  sourceType?: 'global_index' | 'project_index' | 'topic_file';
}

export interface MemorySnapshot {
  global: MemoryDocument;
  project: MemoryDocument;
}

export interface MemorySearchResult {
  scope: MemoryScope;
  path: string | null;
  snippet: string;
  score: number;
  backend: 'text';
  lineNumber: number;
  kind: MemoryDocumentKind;
  fileName: string | null;
}

export interface MemoryReadOptions {
  workspaceRoot?: string;
  taskId?: string;
}

export interface MemorySearchOptions extends MemoryReadOptions {
  scopes?: MemoryScope[];
  maxResults?: number;
}

export interface MemoryTopicWriteOptions extends MemoryReadOptions {
  createIfMissing?: boolean;
}

export interface MemoryWorkspaceAudit {
  overInjectionLimit: boolean;
  injectedLineCount: number;
  totalLineCount: number;
  topicFiles: string[];
  indexedTopicFiles: string[];
  unindexedTopicFiles: string[];
  missingTopicFiles: string[];
}

type SafeReadTextFileResult = {
  content: string | null;
  exists: boolean;
};

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/g, '\n');
}

function trimTrailingWhitespace(value: string): string {
  return value.replace(/[ \t]+$/gm, '').trim();
}

function isMarkdownBlock(value: string): boolean {
  return /\n/.test(value) || /^(#|>|\*|-|\d+\.|```|\|)/.test(value.trim());
}

function formatAppendContent(value: string): string {
  const trimmed = trimTrailingWhitespace(normalizeLineEndings(value));
  if (!trimmed) {
    return '';
  }

  if (isMarkdownBlock(trimmed)) {
    return trimmed;
  }

  return `- ${trimmed.replace(/\s+/g, ' ')}`;
}

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
  const prefix = /^[A-Za-z]:\/$/.test(base)
    ? base.slice(0, 2)
    : base.startsWith('/')
      ? '/'
      : '';
  const parts = [...splitPathSegments(base), ...segments.flatMap((segment) => splitPathSegments(segment))];
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

function getFileName(filePath: string | null): string | null {
  if (!filePath) {
    return null;
  }

  const normalized = normalizeFsPath(filePath);
  const segments = normalized.split('/').filter(Boolean);
  const fileName = segments[segments.length - 1];
  return fileName ?? null;
}

function ensureTopicFileName(fileName: string): string {
  const trimmed = fileName.trim();
  if (!trimmed) {
    throw new Error('Topic file name is required');
  }

  if (trimmed === MEMORY_WORKSPACE_INDEX_FILE_NAME) {
    throw new Error('Topic file name cannot be MEMORY.md');
  }

  if (trimmed.includes('/') || trimmed.includes('\\')) {
    throw new Error('Topic file name must not contain path separators');
  }

  if (!/\.md$/i.test(trimmed)) {
    throw new Error('Topic files must use the .md extension');
  }

  if (trimmed.includes('..')) {
    throw new Error('Topic file name must not contain parent directory segments');
  }

  return trimmed;
}

function getInjectedLineSlice(content: string, maxLines = MEMORY_INDEX_INJECTION_LINE_LIMIT): string {
  const lines = normalizeLineEndings(content).split('\n');
  return lines.slice(0, maxLines).join('\n').trimEnd();
}

function countLines(content: string): number {
  if (!content) {
    return 0;
  }

  return normalizeLineEndings(content).split('\n').length;
}

function extractIndexedTopicFiles(content: string): string[] {
  const matches = normalizeLineEndings(content).match(/\b([A-Za-z0-9._-]+\.md)\b/g) ?? [];
  return [...new Set(matches.filter((match) => match !== MEMORY_WORKSPACE_INDEX_FILE_NAME))].sort();
}

async function safeReadTextFile(filePath: string): Promise<SafeReadTextFileResult> {
  const fileExists = await exists(filePath);
  if (!fileExists) {
    return {
      content: null,
      exists: false,
    };
  }

  try {
    return {
      content: await readTextFile(filePath),
      exists: true,
    };
  } catch (error) {
    logger.warn('[MemoryService] Failed to read file', { filePath, error });
    return {
      content: null,
      exists: true,
    };
  }
}

async function readTextFileForMerge(filePath: string): Promise<string> {
  const { content, exists: fileExists } = await safeReadTextFile(filePath);
  if (content !== null) {
    return content;
  }

  if (fileExists) {
    throw new Error(`Failed to read existing memory file: ${filePath}`);
  }

  return '';
}

async function ensureDirectory(directoryPath: string): Promise<void> {
  if (!(await exists(directoryPath))) {
    await mkdir(directoryPath, { recursive: true });
  }
}

async function ensureParentDirectory(filePath: string): Promise<void> {
  const normalized = normalizeFsPath(filePath);
  const segments = normalized.split('/');
  segments.pop();
  const directoryPath = segments.join('/');
  if (directoryPath) {
    await ensureDirectory(directoryPath);
  }
}

async function resolveGlobalWorkspace(): Promise<MemoryWorkspace> {
  const appDir = await appDataDir();
  const path = await join(appDir, MEMORY_WORKSPACE_DIRECTORY_NAME, GLOBAL_MEMORY_WORKSPACE_NAME);
  const indexPath = await join(path, MEMORY_WORKSPACE_INDEX_FILE_NAME);

  return {
    scope: 'global',
    path,
    indexPath,
    exists: await exists(path),
    identity: {
      kind: 'path',
      key: GLOBAL_MEMORY_WORKSPACE_NAME,
      sourcePath: path,
    },
  };
}

async function resolveProjectWorkspaceIdentity(
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

  try {
    const dotGitContent = (await readTextFile(dotGitPath)).trim();
    const gitDirMatch = /^gitdir:\s*(.+)$/im.exec(dotGitContent);
    if (!gitDirMatch) {
      return {
        kind: 'git',
        key: `git-${hashString(normalizedRoot)}`,
        sourcePath: normalizedRoot,
      };
    }

    const gitDirValue = gitDirMatch[1];
    if (!gitDirValue) {
      return {
        kind: 'git',
        key: `git-${hashString(normalizedRoot)}`,
        sourcePath: normalizedRoot,
      };
    }

    const gitDir = resolvePathFrom(normalizedRoot, gitDirValue.trim());
    const gitDirSegments = splitPathSegments(gitDir);
    const worktreesIndex = gitDirSegments.lastIndexOf('worktrees');
    const commonDir =
      worktreesIndex > 0
        ? joinPathSegments('/', ...gitDirSegments.slice(0, worktreesIndex))
        : gitDir;

    return {
      kind: 'git',
      key: `git-${hashString(commonDir)}`,
      sourcePath: normalizeFsPath(commonDir),
    };
  } catch {
    return {
      kind: 'git',
      key: `git-${hashString(normalizedRoot)}`,
      sourcePath: normalizedRoot,
    };
  }
}

async function resolveProjectWorkspace(workspaceRoot?: string): Promise<MemoryWorkspace> {
  const identity = await resolveProjectWorkspaceIdentity(workspaceRoot);
  if (!identity) {
    return {
      scope: 'project',
      path: null,
      indexPath: null,
      exists: false,
      identity: null,
    };
  }

  const appDir = await appDataDir();
  const path = await join(
    appDir,
    MEMORY_WORKSPACE_DIRECTORY_NAME,
    PROJECT_MEMORY_WORKSPACE_NAME,
    identity.key
  );
  const indexPath = await join(path, MEMORY_WORKSPACE_INDEX_FILE_NAME);

  return {
    scope: 'project',
    path,
    indexPath,
    exists: await exists(path),
    identity,
  };
}

function createDocument(
  scope: MemoryScope,
  kind: MemoryDocumentKind,
  path: string | null,
  content: string,
  fileExists: boolean,
  workspacePath: string | null,
  sourceType: 'global_index' | 'project_index' | 'topic_file'
): MemoryDocument {
  return {
    scope,
    kind,
    path,
    content: normalizeLineEndings(content),
    exists: fileExists,
    fileName: getFileName(path),
    workspacePath,
    sourceType,
  };
}

class MemoryService {
  async getGlobalWorkspace(): Promise<MemoryWorkspace> {
    return await resolveGlobalWorkspace();
  }

  async getProjectWorkspace(workspaceRoot?: string): Promise<MemoryWorkspace> {
    return await resolveProjectWorkspace(workspaceRoot);
  }

  async getGlobalDocument(): Promise<MemoryDocument> {
    const workspace = await this.getGlobalWorkspace();
    const { content, exists: fileExists } = await safeReadTextFile(workspace.indexPath ?? '');

    return createDocument(
      'global',
      'index',
      workspace.indexPath,
      content ?? '',
      fileExists,
      workspace.path,
      'global_index'
    );
  }

  async getProjectMemoryDocument(workspaceRoot?: string): Promise<MemoryDocument> {
    const workspace = await this.getProjectWorkspace(workspaceRoot);
    if (!workspace.indexPath) {
      return createDocument('project', 'index', null, '', false, null, 'project_index');
    }

    const { content, exists: fileExists } = await safeReadTextFile(workspace.indexPath);
    return createDocument(
      'project',
      'index',
      workspace.indexPath,
      content ?? '',
      fileExists,
      workspace.path,
      'project_index'
    );
  }

  async getProjectDocument(workspaceRoot?: string): Promise<MemoryDocument> {
    return this.getProjectMemoryDocument(workspaceRoot);
  }

  async getSnapshot(options: MemoryReadOptions = {}): Promise<MemorySnapshot> {
    const [global, project] = await Promise.all([
      this.getGlobalDocument(),
      this.getProjectMemoryDocument(options.workspaceRoot),
    ]);

    return { global, project };
  }

  async read(
    scope: MemoryScope | 'all',
    options: MemoryReadOptions = {}
  ): Promise<MemoryDocument[]> {
    const snapshot = await this.getSnapshot(options);
    if (scope === 'all') {
      return [snapshot.global, snapshot.project];
    }

    if (scope === 'global') {
      return [snapshot.global];
    }

    return [snapshot.project];
  }

  async getInjectedDocument(
    scope: MemoryScope,
    options: MemoryReadOptions = {},
    maxLines = MEMORY_INDEX_INJECTION_LINE_LIMIT
  ): Promise<MemoryDocument> {
    const document =
      scope === 'global'
        ? await this.getGlobalDocument()
        : await this.getProjectMemoryDocument(options.workspaceRoot);

    return {
      ...document,
      content: getInjectedLineSlice(document.content, maxLines),
    };
  }

  async listTopicDocuments(
    scope: MemoryScope,
    options: MemoryReadOptions = {}
  ): Promise<MemoryDocument[]> {
    const workspace =
      scope === 'global'
        ? await this.getGlobalWorkspace()
        : await this.getProjectWorkspace(options.workspaceRoot);
    if (!workspace.path || !(await exists(workspace.path))) {
      return [];
    }

    const entries = await readDir(workspace.path);
    const topicEntries = entries
      .filter((entry) => Boolean(entry.name) && !entry.isDirectory)
      .filter((entry) => entry.name !== MEMORY_WORKSPACE_INDEX_FILE_NAME)
      .filter((entry) => entry.name?.toLowerCase().endsWith('.md'))
      .sort((left, right) => left.name.localeCompare(right.name));

    return await Promise.all(
      topicEntries.map(async (entry) => {
        const path = await join(workspace.path as string, entry.name);
        const { content, exists: fileExists } = await safeReadTextFile(path);
        return createDocument(
          scope,
          'topic',
          path,
          content ?? '',
          fileExists,
          workspace.path,
          'topic_file'
        );
      })
    );
  }

  async getTopicDocument(
    scope: MemoryScope,
    fileName: string,
    options: MemoryReadOptions = {}
  ): Promise<MemoryDocument> {
    const topicFileName = ensureTopicFileName(fileName);
    const workspace =
      scope === 'global'
        ? await this.getGlobalWorkspace()
        : await this.getProjectWorkspace(options.workspaceRoot);

    if (!workspace.path) {
      return createDocument(scope, 'topic', null, '', false, null, 'topic_file');
    }

    const path = await join(workspace.path, topicFileName);
    const { content, exists: fileExists } = await safeReadTextFile(path);
    return createDocument(scope, 'topic', path, content ?? '', fileExists, workspace.path, 'topic_file');
  }

  async writeGlobal(content: string): Promise<MemoryDocument> {
    const workspace = await this.getGlobalWorkspace();
    if (!workspace.indexPath || !workspace.path) {
      throw new Error('Global memory workspace is unavailable');
    }

    await ensureDirectory(workspace.path);
    const normalized = trimTrailingWhitespace(normalizeLineEndings(content));
    await writeTextFile(workspace.indexPath, normalized ? `${normalized}\n` : '');
    return createDocument(
      'global',
      'index',
      workspace.indexPath,
      normalized,
      true,
      workspace.path,
      'global_index'
    );
  }

  async appendGlobal(content: string): Promise<MemoryDocument> {
    const document = await this.getGlobalDocument();
    const appendContent = formatAppendContent(content);
    const nextContent = document.content
      ? `${document.content.trimEnd()}\n${appendContent}`.trim()
      : appendContent;
    return await this.writeGlobal(nextContent);
  }

  async writeProjectMemoryDocument(
    workspaceRoot: string,
    content: string
  ): Promise<MemoryDocument> {
    const workspace = await this.getProjectWorkspace(workspaceRoot);
    if (!workspace.indexPath || !workspace.path) {
      throw new Error('Project memory is unavailable because the workspace root is missing');
    }

    await ensureDirectory(workspace.path);
    const normalized = trimTrailingWhitespace(normalizeLineEndings(content));
    await writeTextFile(workspace.indexPath, normalized ? `${normalized}\n` : '');
    return createDocument(
      'project',
      'index',
      workspace.indexPath,
      normalized,
      true,
      workspace.path,
      'project_index'
    );
  }

  async appendProjectMemoryDocument(
    workspaceRoot: string,
    content: string
  ): Promise<MemoryDocument> {
    const document = await this.getProjectMemoryDocument(workspaceRoot);
    const appendContent = formatAppendContent(content);
    const nextContent = document.content
      ? `${document.content.trimEnd()}\n${appendContent}`.trim()
      : appendContent;
    return await this.writeProjectMemoryDocument(workspaceRoot, nextContent);
  }

  async writeTopicDocument(
    scope: MemoryScope,
    fileName: string,
    content: string,
    options: MemoryTopicWriteOptions = {}
  ): Promise<MemoryDocument> {
    const topicFileName = ensureTopicFileName(fileName);
    const workspace =
      scope === 'global'
        ? await this.getGlobalWorkspace()
        : await this.getProjectWorkspace(options.workspaceRoot);

    if (!workspace.path) {
      throw new Error('Memory workspace is unavailable because the workspace root is missing');
    }

    const path = await join(workspace.path, topicFileName);
    const normalized = trimTrailingWhitespace(normalizeLineEndings(content));
    await ensureDirectory(workspace.path);
    await writeTextFile(path, normalized ? `${normalized}\n` : '');
    return createDocument(scope, 'topic', path, normalized, true, workspace.path, 'topic_file');
  }

  async appendTopicDocument(
    scope: MemoryScope,
    fileName: string,
    content: string,
    options: MemoryTopicWriteOptions = {}
  ): Promise<MemoryDocument> {
    const topicFileName = ensureTopicFileName(fileName);
    const workspace =
      scope === 'global'
        ? await this.getGlobalWorkspace()
        : await this.getProjectWorkspace(options.workspaceRoot);

    if (!workspace.path) {
      throw new Error('Memory workspace is unavailable because the workspace root is missing');
    }

    const path = await join(workspace.path, topicFileName);
    const currentContent = await readTextFileForMerge(path);
    const appendContent = formatAppendContent(content);
    const nextContent = currentContent
      ? `${currentContent.trimEnd()}\n${appendContent}`.trim()
      : appendContent;

    return await this.writeTopicDocument(scope, topicFileName, nextContent, options);
  }

  async renameTopicDocument(
    scope: MemoryScope,
    fileName: string,
    nextFileName: string,
    options: MemoryReadOptions = {}
  ): Promise<MemoryDocument> {
    const currentName = ensureTopicFileName(fileName);
    const updatedName = ensureTopicFileName(nextFileName);
    const workspace =
      scope === 'global'
        ? await this.getGlobalWorkspace()
        : await this.getProjectWorkspace(options.workspaceRoot);

    if (!workspace.path) {
      throw new Error('Memory workspace is unavailable because the workspace root is missing');
    }

    const currentPath = await join(workspace.path, currentName);
    const nextPath = await join(workspace.path, updatedName);
    await rename(currentPath, nextPath);
    return await this.getTopicDocument(scope, updatedName, options);
  }

  async deleteTopicDocument(
    scope: MemoryScope,
    fileName: string,
    options: MemoryReadOptions = {}
  ): Promise<void> {
    const topicFileName = ensureTopicFileName(fileName);
    const workspace =
      scope === 'global'
        ? await this.getGlobalWorkspace()
        : await this.getProjectWorkspace(options.workspaceRoot);

    if (!workspace.path) {
      throw new Error('Memory workspace is unavailable because the workspace root is missing');
    }

    const path = await join(workspace.path, topicFileName);
    if (await exists(path)) {
      await remove(path);
    }
  }

  async getWorkspaceAudit(
    scope: MemoryScope,
    options: MemoryReadOptions = {}
  ): Promise<MemoryWorkspaceAudit> {
    const indexDocument =
      scope === 'global'
        ? await this.getGlobalDocument()
        : await this.getProjectMemoryDocument(options.workspaceRoot);
    const topics = await this.listTopicDocuments(scope, options);
    const indexedTopicFiles = extractIndexedTopicFiles(indexDocument.content);
    const topicFiles = topics.map((document) => document.fileName ?? '').filter(Boolean).sort();
    const indexedSet = new Set(indexedTopicFiles);
    const topicSet = new Set(topicFiles);

    return {
      overInjectionLimit: countLines(indexDocument.content) > MEMORY_INDEX_INJECTION_LINE_LIMIT,
      injectedLineCount: countLines(getInjectedLineSlice(indexDocument.content)),
      totalLineCount: countLines(indexDocument.content),
      topicFiles,
      indexedTopicFiles,
      unindexedTopicFiles: topicFiles.filter((fileName) => !indexedSet.has(fileName)),
      missingTopicFiles: indexedTopicFiles.filter((fileName) => !topicSet.has(fileName)),
    };
  }

  async search(query: string, options: MemorySearchOptions = {}): Promise<MemorySearchResult[]> {
    const trimmedQuery = query.trim().toLowerCase();
    if (!trimmedQuery) {
      return [];
    }

    const scopes: MemoryScope[] =
      options.scopes && options.scopes.length > 0 ? options.scopes : ['global', 'project'];
    const resultSets = await Promise.all(
      scopes.map(async (scope) => {
        const indexDocument =
          scope === 'global'
            ? await this.getGlobalDocument()
            : await this.getProjectMemoryDocument(options.workspaceRoot);
        const topics = await this.listTopicDocuments(scope, options);
        return [indexDocument, ...topics];
      })
    );

    const documents = resultSets.flat();
    const results: MemorySearchResult[] = [];

    for (const document of documents) {
      if (!document.content) {
        continue;
      }

      const lines = normalizeLineEndings(document.content).split('\n');
      lines.forEach((line, index) => {
        const haystack = line.toLowerCase();
        if (!haystack.includes(trimmedQuery)) {
          return;
        }

        let score = 1;
        if (haystack === trimmedQuery) score += 3;
        if (haystack.startsWith(trimmedQuery)) score += 2;
        if (/^#+\s+/.test(line.trim())) score += 2;
        if (/^[-*]\s+/.test(line.trim())) score += 1;
        if (document.kind === 'index') score += 1;

        results.push({
          scope: document.scope,
          path: document.path,
          snippet: line.trim(),
          score,
          backend: 'text',
          lineNumber: index + 1,
          kind: document.kind,
          fileName: document.fileName,
        });
      });
    }

    return results
      .sort((left, right) => right.score - left.score)
      .slice(0, options.maxResults ?? 10);
  }
}

export const memoryService = new MemoryService();