import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getInjectedIndexMock } = vi.hoisted(() => ({
  getInjectedIndexMock: vi.fn(),
}));

vi.mock('@/services/memory/memory-service', () => ({
  memoryService: {
    getInjectedIndex: getInjectedIndexMock,
  },
}));

import type { ResolveContext } from '../../../types/prompt';
import { GlobalMemoryProvider } from './global-memory-provider';

describe('GlobalMemoryProvider', () => {
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

  it('reads the injected global MEMORY.md index slice', async () => {
    getInjectedIndexMock.mockResolvedValue({
      scope: 'global',
      path: '/global-memory/MEMORY.md',
      content: '- User preference',
      exists: true,
      sourceType: 'global_index',
    });

    const provider = GlobalMemoryProvider();
    const result = await provider.resolveWithMetadata?.('global_memory', ctx);

    expect(getInjectedIndexMock).toHaveBeenCalledWith({ scope: 'global' });
    expect(result?.value).toBe('- User preference');
    expect(result?.sources).toEqual([
      {
        sourcePath: '/global-memory/MEMORY.md',
        sectionKind: 'global_memory',
      },
    ]);
  });
});
