import { logger } from '@/lib/logger';
import {
  type MemoryMarkdownRepository,
  memoryMarkdownRepository,
} from './memory-markdown-repository';
import {
  type MemoryProjectionRepository,
  memoryProjectionRepository,
} from './memory-projection-repository';
import type {
  MemoryContext,
  MemoryDocument,
  MemoryQueryOptions,
  MemorySearchResult,
} from './memory-types';

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/g, '\n');
}

function scoreLineMatch(document: MemoryDocument, line: string, query: string): number {
  const haystack = line.toLowerCase();
  let score = 1;

  if (haystack === query) {
    score += 3;
  }
  if (haystack.startsWith(query)) {
    score += 2;
  }
  if (/^#+\s+/.test(line.trim())) {
    score += 2;
  }
  if (/^[-*]\s+/.test(line.trim())) {
    score += 1;
  }
  if (document.kind === 'index') {
    score += 1;
  }

  return score;
}

async function collectDocuments(
  repository: MemoryMarkdownRepository,
  contexts: MemoryContext[]
): Promise<MemoryDocument[]> {
  const resultSets = await Promise.all(
    contexts.map(async (context) => {
      const indexDocument = await repository.getIndex(context);
      const topics = await repository.listTopics(context);
      return [indexDocument, ...topics];
    })
  );

  return resultSets.flat();
}

export class MemoryQueryService {
  constructor(
    private readonly repository: MemoryMarkdownRepository = memoryMarkdownRepository,
    private readonly projectionRepository: MemoryProjectionRepository = memoryProjectionRepository
  ) {}

  async search(query: string, options: MemoryQueryOptions = {}): Promise<MemorySearchResult[]> {
    const trimmedQuery = query.trim().toLowerCase();
    if (!trimmedQuery) {
      return [];
    }

    const contexts: MemoryContext[] =
      options.contexts && options.contexts.length > 0
        ? options.contexts
        : [{ scope: 'global' }, { scope: 'project' }];

    if (this.projectionRepository.isAvailable()) {
      try {
        const projectedResults = await this.projectionRepository.search(query, {
          contexts,
          maxResults: options.maxResults,
        });
        if (projectedResults.length > 0) {
          return projectedResults.slice(0, options.maxResults ?? 10);
        }
      } catch (error) {
        logger.warn('[MemoryQueryService] Projection search failed; falling back to text scan', {
          error,
        });
      }
    }

    const documents = await collectDocuments(this.repository, contexts);
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

        results.push({
          scope: document.scope,
          path: document.path,
          snippet: line.trim(),
          score: scoreLineMatch(document, line, trimmedQuery),
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

export const memoryQueryService = new MemoryQueryService();
