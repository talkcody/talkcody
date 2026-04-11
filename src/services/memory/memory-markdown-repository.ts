import { join } from '@tauri-apps/api/path';
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
import { getMemoryDocumentSourceType } from './memory-scope-config';
import type {
  MemoryContext,
  MemoryDocument,
  MemoryDocumentKind,
  MemoryScope,
  MemoryWorkspace,
} from './memory-types';
import { type MemoryWorkspaceResolver, memoryWorkspaceResolver } from './memory-workspace-resolver';

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

function getFileName(filePath: string | null): string | null {
  if (!filePath) {
    return null;
  }

  const segments = filePath.replace(/\\/g, '/').split('/').filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] || null : null;
}

export function ensureTopicFileName(fileName: string): string {
  const trimmed = fileName.trim();
  if (!trimmed) {
    throw new Error('Topic file name is required');
  }

  if (trimmed.toLowerCase() === 'memory.md') {
    throw new Error('Topic file name cannot be MEMORY.md');
  }

  if (trimmed.includes('/') || trimmed.includes('\\')) {
    throw new Error('Topic file name must not contain path separators');
  }

  if (trimmed.includes('..')) {
    throw new Error('Topic file name must not contain parent directory segments');
  }

  if (!/\.md$/i.test(trimmed)) {
    throw new Error('Topic files must use the .md extension');
  }

  return trimmed;
}

type SafeReadTextFileResult = {
  content: string | null;
  exists: boolean;
};

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
    logger.warn('[MemoryMarkdownRepository] Failed to read file', {
      filePath,
      error,
    });
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

function createDocument(
  workspace: MemoryWorkspace,
  kind: MemoryDocumentKind,
  path: string | null,
  content: string,
  fileExists: boolean
): MemoryDocument {
  return {
    scope: workspace.scope,
    kind,
    path,
    content: normalizeLineEndings(content),
    exists: fileExists,
    fileName: getFileName(path),
    workspacePath: workspace.path,
    sourceType: getMemoryDocumentSourceType(workspace.scope, kind),
  };
}

export class MemoryMarkdownRepository {
  constructor(
    private readonly workspaceResolver: MemoryWorkspaceResolver = memoryWorkspaceResolver
  ) {}

  async getWorkspace(context: MemoryContext): Promise<MemoryWorkspace> {
    return await this.workspaceResolver.resolve(context);
  }

  async getIndex(context: MemoryContext): Promise<MemoryDocument> {
    const workspace = await this.getWorkspace(context);
    if (!workspace.indexPath) {
      return createDocument(workspace, 'index', null, '', false);
    }

    const { content, exists: fileExists } = await safeReadTextFile(workspace.indexPath);
    return createDocument(workspace, 'index', workspace.indexPath, content ?? '', fileExists);
  }

  async saveIndex(context: MemoryContext, content: string): Promise<MemoryDocument> {
    const workspace = await this.getWorkspace(context);
    if (!workspace.indexPath || !workspace.path) {
      throw new Error(
        context.scope === 'global'
          ? 'Global memory workspace is unavailable'
          : 'Project memory is unavailable because the workspace root is missing'
      );
    }

    await ensureDirectory(workspace.path);
    const normalized = trimTrailingWhitespace(normalizeLineEndings(content));
    await writeTextFile(workspace.indexPath, normalized ? `${normalized}\n` : '');
    return createDocument(workspace, 'index', workspace.indexPath, normalized, true);
  }

  async appendIndex(context: MemoryContext, content: string): Promise<MemoryDocument> {
    const document = await this.getIndex(context);
    const appendContent = formatAppendContent(content);
    const nextContent = document.content
      ? `${document.content.trimEnd()}\n${appendContent}`.trim()
      : appendContent;

    return await this.saveIndex(context, nextContent);
  }

  async listTopics(context: MemoryContext): Promise<MemoryDocument[]> {
    const workspace = await this.getWorkspace(context);
    if (!workspace.path || !(await exists(workspace.path))) {
      return [];
    }

    const entries = await readDir(workspace.path);
    const topicEntries = entries
      .filter((entry) => Boolean(entry.name) && !entry.isDirectory)
      .filter((entry) => entry.name?.toLowerCase() !== 'memory.md')
      .filter((entry) => entry.name?.toLowerCase().endsWith('.md'))
      .sort((left, right) => (left.name ?? '').localeCompare(right.name ?? ''));

    return await Promise.all(
      topicEntries.map(async (entry) => {
        const path = await join(workspace.path as string, entry.name as string);
        const { content, exists: fileExists } = await safeReadTextFile(path);
        return createDocument(workspace, 'topic', path, content ?? '', fileExists);
      })
    );
  }

  async getTopic(context: MemoryContext, fileName: string): Promise<MemoryDocument> {
    const workspace = await this.getWorkspace(context);
    const topicFileName = ensureTopicFileName(fileName);

    if (!workspace.path) {
      return createDocument(workspace, 'topic', null, '', false);
    }

    const path = await join(workspace.path, topicFileName);
    const { content, exists: fileExists } = await safeReadTextFile(path);
    return createDocument(workspace, 'topic', path, content ?? '', fileExists);
  }

  async saveTopic(
    context: MemoryContext,
    fileName: string,
    content: string
  ): Promise<MemoryDocument> {
    const workspace = await this.getWorkspace(context);
    const topicFileName = ensureTopicFileName(fileName);
    if (!workspace.path) {
      throw new Error('Memory workspace is unavailable because the workspace root is missing');
    }

    const path = await join(workspace.path, topicFileName);
    const normalized = trimTrailingWhitespace(normalizeLineEndings(content));
    await ensureDirectory(workspace.path);
    await writeTextFile(path, normalized ? `${normalized}\n` : '');
    return createDocument(workspace, 'topic', path, normalized, true);
  }

  async appendTopic(
    context: MemoryContext,
    fileName: string,
    content: string
  ): Promise<MemoryDocument> {
    const workspace = await this.getWorkspace(context);
    const topicFileName = ensureTopicFileName(fileName);
    if (!workspace.path) {
      throw new Error('Memory workspace is unavailable because the workspace root is missing');
    }

    const path = await join(workspace.path, topicFileName);
    const currentContent = await readTextFileForMerge(path);
    const appendContent = formatAppendContent(content);
    const nextContent = currentContent
      ? `${currentContent.trimEnd()}\n${appendContent}`.trim()
      : appendContent;

    return await this.saveTopic(context, topicFileName, nextContent);
  }

  async renameTopic(
    context: MemoryContext,
    fromFileName: string,
    toFileName: string
  ): Promise<MemoryDocument> {
    const workspace = await this.getWorkspace(context);
    const currentName = ensureTopicFileName(fromFileName);
    const nextName = ensureTopicFileName(toFileName);
    if (!workspace.path) {
      throw new Error('Memory workspace is unavailable because the workspace root is missing');
    }

    const currentPath = await join(workspace.path, currentName);
    const nextPath = await join(workspace.path, nextName);
    await rename(currentPath, nextPath);
    return await this.getTopic(context, nextName);
  }

  async deleteTopic(context: MemoryContext, fileName: string): Promise<void> {
    const workspace = await this.getWorkspace(context);
    const topicFileName = ensureTopicFileName(fileName);
    if (!workspace.path) {
      throw new Error('Memory workspace is unavailable because the workspace root is missing');
    }

    const path = await join(workspace.path, topicFileName);
    if (await exists(path)) {
      await remove(path);
    }
  }
}

export const memoryMarkdownRepository = new MemoryMarkdownRepository();
