import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getProjectMemoryDocumentMock } = vi.hoisted(() => ({
  getProjectMemoryDocumentMock: vi.fn(),
}));

vi.mock('@/services/memory/memory-service', () => ({
  memoryService: {
    getProjectMemoryDocument: getProjectMemoryDocumentMock,
  },
}));

import type { ResolveContext } from '@/types/prompt';
import { ProjectMemoryProvider } from './project-memory-provider';

describe('ProjectMemoryProvider', () => {
  const ctx: ResolveContext = {
    workspaceRoot: '/repo',
    currentWorkingDirectory: undefined,
    recentFilePaths: undefined,
    taskId: undefined,
    agentId: 'test-agent',
    cache: new Map(),
    readFile: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads the root Long-Term Memory section separately from instructions', async () => {
    getProjectMemoryDocumentMock.mockResolvedValue({
      scope: 'project',
      path: '/repo/CLAUDE.md',
      content: '- Important project memory',
      exists: true,
      sourceType: 'project_root_section',
    });

    const provider = ProjectMemoryProvider();
    const result = await provider.resolveWithMetadata?.('project_memory', ctx);

    expect(result?.value).toContain('Important project memory');
    expect(result?.sources).toEqual([
      {
        sourcePath: '/repo/CLAUDE.md',
        sectionKind: 'project_memory',
      },
    ]);
  });
});
