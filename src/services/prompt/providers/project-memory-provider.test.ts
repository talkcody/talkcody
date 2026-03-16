import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getInjectedIndexMock } = vi.hoisted(() => ({
  getInjectedIndexMock: vi.fn(),
}));

vi.mock('@/services/memory/memory-service', () => ({
  memoryService: {
    getInjectedIndex: getInjectedIndexMock,
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

  it('reads the injected project MEMORY.md index slice', async () => {
    getInjectedIndexMock.mockResolvedValue({
      scope: 'project',
      path: '/repo-memory/MEMORY.md',
      content: '- Important project memory',
      exists: true,
      sourceType: 'project_index',
    });

    const provider = ProjectMemoryProvider();
    const result = await provider.resolveWithMetadata?.('project_memory', ctx);

    expect(result?.value).toContain('Important project memory');
    expect(getInjectedIndexMock).toHaveBeenCalledWith({
      scope: 'project',
      workspaceRoot: '/repo',
    });
    expect(result?.sources).toEqual([
      {
        sourcePath: '/repo-memory/MEMORY.md',
        sectionKind: 'project_memory',
      },
    ]);
  });
});
