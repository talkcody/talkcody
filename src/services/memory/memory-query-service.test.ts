import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemoryMarkdownRepository } from './memory-markdown-repository';
import type { MemoryProjectionRepository } from './memory-projection-repository';
import { MemoryQueryService } from './memory-query-service';

describe('MemoryQueryService', () => {
  const markdownRepository = {
    getIndex: vi.fn(),
    listTopics: vi.fn(),
  } as unknown as MemoryMarkdownRepository;

  const projectionRepository = {
    isAvailable: vi.fn(),
    search: vi.fn(),
    syncDocument: vi.fn(),
    deleteDocument: vi.fn(),
  } as unknown as MemoryProjectionRepository;

  const queryService = new MemoryQueryService(markdownRepository, projectionRepository);

  beforeEach(() => {
    vi.clearAllMocks();
    projectionRepository.isAvailable.mockReturnValue(false);
    markdownRepository.getIndex.mockImplementation(async (context: { scope: 'global' | 'project' }) => ({
      scope: context.scope,
      path: `/${context.scope}/MEMORY.md`,
      content: context.scope === 'global' ? '# Memory Index\n- bun' : '# Project Index',
      exists: true,
      kind: 'index',
      fileName: 'MEMORY.md',
    }));
    markdownRepository.listTopics.mockImplementation(async (context: { scope: 'global' | 'project' }) =>
      context.scope === 'global'
        ? [
            {
              scope: 'global',
              path: '/global/preferences.md',
              content: '## Preferences\n\n- Use bun',
              exists: true,
              kind: 'topic',
              fileName: 'preferences.md',
            },
          ]
        : []
    );
  });

  it('searches markdown documents with the text backend', async () => {
    const results = await queryService.search('bun', {
      contexts: [{ scope: 'global' }],
      maxResults: 10,
    });

    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scope: 'global',
          kind: 'index',
          backend: 'text',
        }),
        expect.objectContaining({
          scope: 'global',
          kind: 'topic',
          backend: 'text',
        }),
      ])
    );
  });

  it('uses projection results when the projection backend is available', async () => {
    projectionRepository.isAvailable.mockReturnValue(true);
    projectionRepository.search.mockResolvedValue([
      {
        scope: 'global',
        path: '/projection/preferences.md',
        snippet: 'Use bun',
        score: 9,
        backend: 'projection',
        lineNumber: 3,
        kind: 'topic',
        fileName: 'preferences.md',
      },
    ]);

    const results = await queryService.search('bun', {
      contexts: [{ scope: 'global' }],
    });

    expect(projectionRepository.search).toHaveBeenCalled();
    expect(results).toEqual([
      expect.objectContaining({
        backend: 'projection',
        fileName: 'preferences.md',
      }),
    ]);
  });

  it('falls back to text search when projection lookup fails', async () => {
    projectionRepository.isAvailable.mockReturnValue(true);
    projectionRepository.search.mockRejectedValue(new Error('projection unavailable'));

    const results = await queryService.search('bun', {
      contexts: [{ scope: 'global' }],
    });

    expect(results.some((result) => result.backend === 'text')).toBe(true);
  });
});
