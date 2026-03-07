import { appDataDir, join } from '@tauri-apps/api/path';
import { exists, mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { logger } from '@/lib/logger';

export const GLOBAL_MEMORY_FILE_NAME = 'memory.md';
export const PROJECT_MEMORY_FILE_NAME = 'AGENTS.md';
export const PROJECT_MEMORY_ROOT_FILE_NAMES = [
  PROJECT_MEMORY_FILE_NAME,
  'CLAUDE.md',
  'GEMINI.md',
] as const;
export const PROJECT_MEMORY_SECTION_TITLE = 'Long-Term Memory';
export const PROJECT_MEMORY_SECTION_HEADING = `## ${PROJECT_MEMORY_SECTION_TITLE}`;

export type MemoryScope = 'global' | 'project';

export interface MemoryDocument {
  scope: MemoryScope;
  path: string | null;
  content: string;
  exists: boolean;
  sourceType?: 'global_file' | 'project_root_section';
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
}

export interface MemoryReadOptions {
  workspaceRoot?: string;
  taskId?: string;
}

export interface MemorySearchOptions extends MemoryReadOptions {
  scopes?: MemoryScope[];
  maxResults?: number;
}

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

type SectionRange = {
  start: number;
  contentStart: number;
  end: number;
  content: string;
};

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findMarkdownSection(content: string, heading: string): SectionRange | null {
  const normalized = normalizeLineEndings(content);
  const headingPattern = new RegExp(`^${escapeForRegex(heading)}\\s*$`, 'm');
  const headingMatch = headingPattern.exec(normalized);
  if (!headingMatch || headingMatch.index === undefined) {
    return null;
  }

  const start = headingMatch.index;
  const contentStart = start + headingMatch[0].length;
  const currentHeadingLevel = headingMatch[0].match(/^(#{1,6})\s+/)?.[1]?.length ?? 6;
  const nextHeadingPattern = /^(#{1,6})\s+.+$/gm;
  nextHeadingPattern.lastIndex = contentStart;

  let end = normalized.length;
  let nextMatch = nextHeadingPattern.exec(normalized);
  while (nextMatch) {
    const nextHeadingLevel = nextMatch[1]?.length ?? 6;
    if (nextHeadingLevel <= currentHeadingLevel) {
      end = nextMatch.index;
      break;
    }
    nextMatch = nextHeadingPattern.exec(normalized);
  }

  const sectionContent = normalized
    .substring(contentStart, end)
    .replace(/^\n+/, '')
    .replace(/\n+$/, '');

  return {
    start,
    contentStart,
    end,
    content: sectionContent,
  };
}

export function extractLongTermMemorySection(content: string): string {
  return findMarkdownSection(content, PROJECT_MEMORY_SECTION_HEADING)?.content ?? '';
}

export function removeLongTermMemorySection(content: string): string {
  const normalizedContent = normalizeLineEndings(content);
  const section = findMarkdownSection(normalizedContent, PROJECT_MEMORY_SECTION_HEADING);

  if (!section) {
    return normalizedContent;
  }

  const before = normalizedContent.substring(0, section.start).trimEnd();
  const after = normalizedContent.substring(section.end).replace(/^\n+/, '');

  if (!before && !after) {
    return '';
  }

  if (!before) {
    return `${after.trimStart()}\n`;
  }

  if (!after) {
    return `${before}\n`;
  }

  return `${before}\n\n${after.trimStart()}`.trimEnd() + '\n';
}

export function upsertLongTermMemorySection(content: string, sectionContent: string): string {
  const normalizedContent = normalizeLineEndings(content);
  const normalizedSectionContent = trimTrailingWhitespace(normalizeLineEndings(sectionContent));
  const section = findMarkdownSection(normalizedContent, PROJECT_MEMORY_SECTION_HEADING);
  const renderedSection =
    `${PROJECT_MEMORY_SECTION_HEADING}\n\n${normalizedSectionContent}`.trimEnd();

  if (!section) {
    const base = normalizedContent.trimEnd();
    if (!base) {
      return `${renderedSection}\n`;
    }
    return `${base}\n\n${renderedSection}\n`;
  }

  const before = normalizedContent.substring(0, section.start).trimEnd();
  const after = normalizedContent.substring(section.end).replace(/^\n+/, '');
  if (!before && !after) {
    return `${renderedSection}\n`;
  }
  if (!after) {
    return `${before}\n\n${renderedSection}\n`;
  }
  if (!before) {
    return `${renderedSection}\n\n${after.trimStart()}\n`;
  }
  return `${before}\n\n${renderedSection}\n\n${after.trimStart()}`.trimEnd() + '\n';
}

export function appendToLongTermMemorySection(content: string, appendContent: string): string {
  const formattedAppend = formatAppendContent(appendContent);
  if (!formattedAppend) {
    return content;
  }

  const existingSection = extractLongTermMemorySection(content);
  const nextSectionContent = existingSection
    ? `${existingSection.trimEnd()}\n${formattedAppend}`
    : formattedAppend;

  return upsertLongTermMemorySection(content, nextSectionContent);
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

async function ensureParentDirectory(filePath: string): Promise<void> {
  const parts = filePath.split(/[/\\]/);
  parts.pop();
  const directoryPath = parts.join('/');
  if (!directoryPath) {
    return;
  }
  if (!(await exists(directoryPath))) {
    await mkdir(directoryPath, { recursive: true });
  }
}

async function resolveGlobalMemoryPath(): Promise<string> {
  const appDir = await appDataDir();
  return await join(appDir, 'memory', GLOBAL_MEMORY_FILE_NAME);
}

async function resolveProjectMemoryPath(workspaceRoot?: string): Promise<string | null> {
  if (!workspaceRoot) {
    return null;
  }

  for (const fileName of PROJECT_MEMORY_ROOT_FILE_NAMES) {
    const candidatePath = await join(workspaceRoot, fileName);
    if (await exists(candidatePath)) {
      return candidatePath;
    }
  }

  return await join(workspaceRoot, PROJECT_MEMORY_FILE_NAME);
}

class MemoryService {
  async getGlobalDocument(): Promise<MemoryDocument> {
    const path = await resolveGlobalMemoryPath();
    const { content, exists: fileExists } = await safeReadTextFile(path);
    return {
      scope: 'global',
      path,
      content: content ?? '',
      exists: fileExists,
      sourceType: 'global_file',
    };
  }

  async getProjectMemoryDocument(workspaceRoot?: string): Promise<MemoryDocument> {
    const path = await resolveProjectMemoryPath(workspaceRoot);
    if (!path) {
      return {
        scope: 'project',
        path: null,
        content: '',
        exists: false,
        sourceType: 'project_root_section',
      };
    }

    const { content: fullContent, exists: fileExists } = await safeReadTextFile(path);
    return {
      scope: 'project',
      path,
      content: extractLongTermMemorySection(fullContent ?? ''),
      exists: fileExists,
      sourceType: 'project_root_section',
    };
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

    if (scope === 'global') return [snapshot.global];
    return [snapshot.project];
  }

  async writeGlobal(content: string): Promise<MemoryDocument> {
    const path = await resolveGlobalMemoryPath();
    await ensureParentDirectory(path);
    const normalized = trimTrailingWhitespace(normalizeLineEndings(content));
    await writeTextFile(path, normalized ? `${normalized}\n` : '');
    return {
      scope: 'global',
      path,
      content: normalized,
      exists: true,
    };
  }

  async appendGlobal(content: string): Promise<MemoryDocument> {
    const path = await resolveGlobalMemoryPath();
    const currentContent = await readTextFileForMerge(path);
    const appendContent = formatAppendContent(content);
    const nextContent = currentContent
      ? `${currentContent.trimEnd()}\n${appendContent}`.trim()
      : appendContent;
    return await this.writeGlobal(nextContent);
  }

  async writeProjectSection(workspaceRoot: string, content: string): Promise<MemoryDocument> {
    return this.writeProjectMemoryDocument(workspaceRoot, content);
  }

  async writeProjectMemoryDocument(
    workspaceRoot: string,
    content: string
  ): Promise<MemoryDocument> {
    const path = await resolveProjectMemoryPath(workspaceRoot);
    if (!path) {
      throw new Error('Project memory is unavailable because the workspace root is missing');
    }

    const existingContent = await readTextFileForMerge(path);
    const nextFileContent = upsertLongTermMemorySection(existingContent, content);
    await ensureParentDirectory(path);
    await writeTextFile(path, nextFileContent);
    return {
      scope: 'project',
      path,
      content: trimTrailingWhitespace(normalizeLineEndings(content)),
      exists: true,
      sourceType: 'project_root_section',
    };
  }

  async appendProjectSection(workspaceRoot: string, content: string): Promise<MemoryDocument> {
    return this.appendProjectMemoryDocument(workspaceRoot, content);
  }

  async appendProjectMemoryDocument(
    workspaceRoot: string,
    content: string
  ): Promise<MemoryDocument> {
    const path = await resolveProjectMemoryPath(workspaceRoot);
    if (!path) {
      throw new Error('Project memory is unavailable because the workspace root is missing');
    }

    const existingContent = await readTextFileForMerge(path);
    const nextFileContent = appendToLongTermMemorySection(existingContent, content);
    await ensureParentDirectory(path);
    await writeTextFile(path, nextFileContent);
    return {
      scope: 'project',
      path,
      content: extractLongTermMemorySection(nextFileContent),
      exists: true,
      sourceType: 'project_root_section',
    };
  }

  async search(query: string, options: MemorySearchOptions = {}): Promise<MemorySearchResult[]> {
    const trimmedQuery = query.trim().toLowerCase();
    if (!trimmedQuery) {
      return [];
    }

    const scopes: MemoryScope[] =
      options.scopes && options.scopes.length > 0 ? options.scopes : ['global', 'project'];
    const documents = await Promise.all(
      scopes.map(async (scope) => {
        const [document] = await this.read(scope, options);
        return document;
      })
    );

    const results: MemorySearchResult[] = [];
    for (const document of documents) {
      if (!document) {
        continue;
      }

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

        results.push({
          scope: document.scope,
          path: document.path,
          snippet: line.trim(),
          score,
          backend: 'text',
          lineNumber: index + 1,
        });
      });
    }

    return results
      .sort((left, right) => right.score - left.score)
      .slice(0, options.maxResults ?? 10);
  }
}

export const memoryService = new MemoryService();
