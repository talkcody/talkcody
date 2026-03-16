import { MEMORY_WORKSPACE_INDEX_FILE_NAME } from './memory-scope-config';
import type { MemoryIndexRoute, MemoryWorkspaceAudit, ParsedMemoryIndex } from './memory-types';

export const MEMORY_INDEX_INJECTION_LINE_LIMIT = 200;

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/g, '\n');
}

export function countLines(content: string): number {
  if (!content) {
    return 0;
  }

  return normalizeLineEndings(content).split('\n').length;
}

export function getInjectedIndexSlice(
  content: string,
  maxLines = MEMORY_INDEX_INJECTION_LINE_LIMIT
): string {
  return normalizeLineEndings(content).split('\n').slice(0, maxLines).join('\n').trimEnd();
}

function parseDescription(line: string, fileName: string): string | undefined {
  const [, suffix = ''] = line.split(fileName, 2);
  const cleaned = suffix.replace(/^\s*[:\-–—]\s*/, '').trim();
  return cleaned || undefined;
}

export function parseMemoryIndex(content: string): ParsedMemoryIndex {
  const normalizedContent = normalizeLineEndings(content);
  const lines = normalizedContent.split('\n');
  const seen = new Set<string>();
  const routes: MemoryIndexRoute[] = [];

  lines.forEach((line, index) => {
    const matches = line.match(/\b([A-Za-z0-9._-]+\.md)\b/g) ?? [];
    for (const match of matches) {
      if (match.toLowerCase() === MEMORY_WORKSPACE_INDEX_FILE_NAME.toLowerCase()) {
        continue;
      }
      if (seen.has(match)) {
        continue;
      }

      seen.add(match);
      routes.push({
        fileName: match,
        lineNumber: index + 1,
        rawLine: line,
        description: parseDescription(line, match),
      });
    }
  });

  return {
    routes,
    totalLineCount: countLines(normalizedContent),
    injectedLineCount: countLines(getInjectedIndexSlice(normalizedContent)),
    injectedContent: getInjectedIndexSlice(normalizedContent),
  };
}

export function extractIndexedTopicFiles(content: string): string[] {
  return parseMemoryIndex(content)
    .routes.map((route) => route.fileName)
    .sort();
}

export function buildMemoryWorkspaceAudit(
  indexContent: string,
  topicFiles: string[]
): MemoryWorkspaceAudit {
  const sortedTopicFiles = [...new Set(topicFiles.filter(Boolean))].sort();
  const indexedTopicFiles = extractIndexedTopicFiles(indexContent);
  const indexedSet = new Set(indexedTopicFiles);
  const topicSet = new Set(sortedTopicFiles);

  return {
    overInjectionLimit: countLines(indexContent) > MEMORY_INDEX_INJECTION_LINE_LIMIT,
    injectedLineCount: countLines(getInjectedIndexSlice(indexContent)),
    totalLineCount: countLines(indexContent),
    topicFiles: sortedTopicFiles,
    indexedTopicFiles,
    unindexedTopicFiles: sortedTopicFiles.filter((fileName) => !indexedSet.has(fileName)),
    missingTopicFiles: indexedTopicFiles.filter((fileName) => !topicSet.has(fileName)),
  };
}
