import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorktreeStore } from '@/stores/worktree-store';
import type { WorktreeInfo } from '@/types/worktree';

// IMPORTANT: Unmock workspace-root-service to test the real implementation
// The global setup.ts mocks this module, so we need to explicitly import the real one
vi.unmock('@/services/workspace-root-service');

// Re-mock settings manager with our values (override global setup)
vi.mock('@/stores/settings-store', () => ({
  settingsManager: {
    getCurrentRootPath: vi.fn(() => '/main/project'),
    getProject: vi.fn(() => Promise.resolve('project-1')),
    getAutoApproveEditsGlobal: vi.fn(() => false),
    setAutoApproveEditsGlobal: vi.fn(),
  },
  useSettingsStore: {
    getState: vi.fn(() => ({
      language: 'en',
      getAutoApproveEditsGlobal: vi.fn(() => false),
      setAutoApproveEditsGlobal: vi.fn(),
    })),
    subscribe: vi.fn(),
    setState: vi.fn(),
  },
}));

// Re-mock database service with our values (override global setup)
vi.mock('@/services/database-service', () => ({
  databaseService: {
    getProject: vi.fn(() =>
      Promise.resolve({
        id: 'project-1',
        root_path: '/main/project',
        name: 'Test Project',
      })
    ),
    getTaskDetails: vi.fn(() =>
      Promise.resolve({
        id: 'task-1',
        title: 'Test Task',
        project_id: 'project-1',
        created_at: Date.now(),
        updated_at: Date.now(),
        message_count: 0,
        request_count: 0,
        cost: 0,
        input_token: 0,
        output_token: 0,
      })
    ),
  },
}));

// Import after vi.unmock
import { getEffectiveWorkspaceRoot, getValidatedWorkspaceRoot } from './workspace-root-service';

// Helper to create mock WorktreeInfo
function createMockWorktreeInfo(
  poolIndex: number,
  path: string,
  taskId: string | null = null
): WorktreeInfo {
  return {
    poolIndex,
    path,
    branchName: `talkcody-pool-${poolIndex}`,
    inUse: taskId !== null,
    taskId,
    changesCount: 0,
    lastUsed: null,
    createdAt: new Date().toISOString(),
  };
}

describe('WorkspaceRootService - getValidatedWorkspaceRoot', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should accept equivalent Windows paths with different separators', async () => {
    const { settingsManager } = await import('@/stores/settings-store');
    const { databaseService } = await import('@/services/database-service');

    vi.mocked(settingsManager.getCurrentRootPath).mockReturnValueOnce('D:\\Code\\GraphCoder-main');
    vi.mocked(settingsManager.getProject).mockResolvedValueOnce('project-1');
    vi.mocked(databaseService.getProject).mockResolvedValueOnce({
      id: 'project-1',
      root_path: 'D:/Code/GraphCoder-main',
      name: 'Test Project',
    });

    const root = await getValidatedWorkspaceRoot();

    expect(root).toBe('D:\\Code\\GraphCoder-main');
  });

  it('should throw when Windows paths differ beyond separators', async () => {
    const { settingsManager } = await import('@/stores/settings-store');
    const { databaseService } = await import('@/services/database-service');

    vi.mocked(settingsManager.getCurrentRootPath).mockReturnValueOnce('D:\\Code\\GraphCoder-main');
    vi.mocked(settingsManager.getProject).mockResolvedValueOnce('project-1');
    vi.mocked(databaseService.getProject).mockResolvedValueOnce({
      id: 'project-1',
      root_path: 'D:/Code/Other',
      name: 'Test Project',
    });

    await expect(getValidatedWorkspaceRoot()).rejects.toThrow(
      'Workspace root path mismatch: settings="D:\\Code\\GraphCoder-main", project="D:/Code/Other"'
    );
  });
});

describe('WorkspaceRootService - getEffectiveWorkspaceRoot', () => {
  beforeEach(() => {
    // Reset worktree store to initial state
    useWorktreeStore.setState({
      isWorktreeEnabled: false,
      pool: new Map(),
      taskWorktreeMap: new Map(),
      isMerging: false,
      currentMergeTaskId: null,
      mergeStatus: 'idle',
      lastMergeResult: null,
      isLoading: false,
      isInitialized: true,
      error: null,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('basic path resolution', () => {
    it('should return main project path for task without worktree', async () => {
      const path = await getEffectiveWorkspaceRoot('task-no-worktree');
      expect(path).toBe('/main/project');
    });

    it('should return main project path when taskId is empty string', async () => {
      const path = await getEffectiveWorkspaceRoot('');
      expect(path).toBe('/main/project');
    });

    it('should use task project root when task belongs to different project', async () => {
      const { settingsManager } = await import('@/stores/settings-store');
      const { databaseService } = await import('@/services/database-service');
      const { useTaskStore } = await import('@/stores/task-store');

      vi.mocked(settingsManager.getCurrentRootPath).mockReturnValueOnce('D:/Code/UIF-RS');
      vi.mocked(settingsManager.getProject).mockResolvedValueOnce('project-1');

      useTaskStore.getState().addTask({
        id: 'task-2',
        title: 'Task Two',
        project_id: 'project-2',
        created_at: Date.now(),
        updated_at: Date.now(),
        message_count: 0,
        request_count: 0,
        cost: 0,
        input_token: 0,
        output_token: 0,
      });

      vi.mocked(databaseService.getProject)
        .mockResolvedValueOnce({
          id: 'project-2',
          root_path: 'D:/Code/SharePaste',
          name: 'SharePaste',
        })
        .mockResolvedValueOnce({
          id: 'project-1',
          root_path: 'D:/Code/UIF-RS',
          name: 'UIF-RS',
        });

      const path = await getEffectiveWorkspaceRoot('task-2');
      expect(path).toBe('D:/Code/SharePaste');
    });
  });

  describe('worktree path resolution', () => {
    it('should return worktree path for task with assigned worktree', async () => {
      const worktreeInfo = createMockWorktreeInfo(
        0,
        '/project/.talkcody-worktrees/pool-0',
        'task-1'
      );

      // Set up store state
      useWorktreeStore.setState({
        pool: new Map([[0, worktreeInfo]]),
        taskWorktreeMap: new Map([['task-1', 0]]),
      });

      const path = await getEffectiveWorkspaceRoot('task-1');
      expect(path).toBe('/project/.talkcody-worktrees/pool-0');
    });

    it('should return main project path if worktree path equals base root', async () => {
      // Edge case: worktree path same as main (shouldn't happen in practice)
      const worktreeInfo = createMockWorktreeInfo(0, '/main/project', 'task-1');

      useWorktreeStore.setState({
        pool: new Map([[0, worktreeInfo]]),
        taskWorktreeMap: new Map([['task-1', 0]]),
      });

      const path = await getEffectiveWorkspaceRoot('task-1');
      expect(path).toBe('/main/project');
    });
  });

  describe('concurrent task isolation', () => {
    it('should isolate paths between concurrent tasks with different worktrees', async () => {
      const worktree0 = createMockWorktreeInfo(
        0,
        '/project/.talkcody-worktrees/pool-0',
        'task-1'
      );
      const worktree1 = createMockWorktreeInfo(
        1,
        '/project/.talkcody-worktrees/pool-1',
        'task-2'
      );

      useWorktreeStore.setState({
        pool: new Map([
          [0, worktree0],
          [1, worktree1],
        ]),
        taskWorktreeMap: new Map([
          ['task-1', 0],
          ['task-2', 1],
        ]),
      });

      // Resolve both paths in parallel
      const [path1, path2] = await Promise.all([
        getEffectiveWorkspaceRoot('task-1'),
        getEffectiveWorkspaceRoot('task-2'),
      ]);

      expect(path1).toBe('/project/.talkcody-worktrees/pool-0');
      expect(path2).toBe('/project/.talkcody-worktrees/pool-1');
      expect(path1).not.toBe(path2);
    });

    it('should handle mixed scenarios: some tasks with worktree, some without', async () => {
      const worktree0 = createMockWorktreeInfo(
        0,
        '/project/.talkcody-worktrees/pool-0',
        'task-with-worktree'
      );

      useWorktreeStore.setState({
        pool: new Map([[0, worktree0]]),
        taskWorktreeMap: new Map([['task-with-worktree', 0]]),
      });

      const [pathWithWorktree, pathWithoutWorktree] = await Promise.all([
        getEffectiveWorkspaceRoot('task-with-worktree'),
        getEffectiveWorkspaceRoot('task-without-worktree'),
      ]);

      expect(pathWithWorktree).toBe('/project/.talkcody-worktrees/pool-0');
      expect(pathWithoutWorktree).toBe('/main/project');
    });

    it('should handle rapid sequential calls for multiple tasks', async () => {
      // Set up 5 tasks with worktrees
      const pool = new Map<number, WorktreeInfo>();
      const taskWorktreeMap = new Map<string, number>();

      for (let i = 0; i < 5; i++) {
        const worktree = createMockWorktreeInfo(
          i,
          `/project/.talkcody-worktrees/pool-${i}`,
          `task-${i}`
        );
        pool.set(i, worktree);
        taskWorktreeMap.set(`task-${i}`, i);
      }

      useWorktreeStore.setState({ pool, taskWorktreeMap });

      // Resolve all paths in parallel
      const paths = await Promise.all(
        Array.from({ length: 5 }, (_, i) => getEffectiveWorkspaceRoot(`task-${i}`))
      );

      // Each task should get its own worktree path
      for (let i = 0; i < 5; i++) {
        expect(paths[i]).toBe(`/project/.talkcody-worktrees/pool-${i}`);
      }

      // All paths should be unique
      const uniquePaths = new Set(paths);
      expect(uniquePaths.size).toBe(5);
    });
  });

  describe('edge cases', () => {
    it('should handle task with mapping but missing pool entry', async () => {
      // Task is mapped to pool index 0, but pool has no entry for it
      useWorktreeStore.setState({
        pool: new Map(), // Empty pool
        taskWorktreeMap: new Map([['task-orphan', 0]]),
      });

      // getEffectiveRootPath returns null when pool entry is missing
      // So getEffectiveWorkspaceRoot should fall back to base root
      const path = await getEffectiveWorkspaceRoot('task-orphan');
      expect(path).toBe('/main/project');
    });

    it('should handle worktree with null path', async () => {
      const worktreeWithNullPath: WorktreeInfo = {
        poolIndex: 0,
        path: '', // Empty path
        branchName: 'talkcody-pool-0',
        inUse: true,
        taskId: 'task-1',
        changesCount: 0,
        lastUsed: null,
        createdAt: new Date().toISOString(),
      };

      useWorktreeStore.setState({
        pool: new Map([[0, worktreeWithNullPath]]),
        taskWorktreeMap: new Map([['task-1', 0]]),
      });

      // Empty path should be treated as falsy, fall back to base root
      const path = await getEffectiveWorkspaceRoot('task-1');
      expect(path).toBe('/main/project');
    });
  });
});
