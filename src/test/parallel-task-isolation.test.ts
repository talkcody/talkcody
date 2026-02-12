import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock logger FIRST before any imports that may use it

import { useEditReviewStore, type PendingEdit } from '@/stores/edit-review-store';
import { useWorktreeStore } from '@/stores/worktree-store';
import type { WorktreeInfo } from '@/types/worktree';

// Mock workspace-root-service
vi.unmock('@/services/workspace-root-service');

// Mock settings manager
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
      getReasoningEffort: vi.fn(() => 'medium'),
      getAutoApproveEditsGlobal: vi.fn(() => false),
      setAutoApproveEditsGlobal: vi.fn(),
    })),
    subscribe: vi.fn(),
    setState: vi.fn(),
  },
}));

// Mock database service
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
    startSpan: vi.fn().mockResolvedValue(undefined),
    endSpan: vi.fn().mockResolvedValue(undefined),
  },
}));

// Import after mocks
import { getEffectiveWorkspaceRoot } from '@/services/workspace-root-service';

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

// Helper to create mock PendingEdit
function createMockPendingEdit(
  id: string,
  filePath: string,
  taskId: string
): PendingEdit {
  return {
    id,
    filePath,
    originalContent: 'original content',
    newContent: 'new content from ' + taskId,
    operation: 'edit',
    timestamp: Date.now(),
  };
}

// Helper to create mock callbacks
function createMockCallbacks() {
  return {
    onApprove: vi.fn().mockResolvedValue({ success: true, message: 'Approved' }),
    onReject: vi.fn().mockResolvedValue({ success: true, message: 'Rejected' }),
  };
}

describe('Parallel Task File Isolation', () => {
  beforeEach(() => {
    // Reset worktree store
    useWorktreeStore.setState({
      isWorktreeEnabled: true,
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

    // Reset edit review store
    useEditReviewStore.setState({ pendingEdits: new Map() });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('worktree path isolation', () => {
    it('should return different worktree paths for parallel tasks', async () => {
      // Setup: Two tasks with different worktrees
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

      // Get paths for both tasks
      const path1 = await getEffectiveWorkspaceRoot('task-1');
      const path2 = await getEffectiveWorkspaceRoot('task-2');

      // Verify paths are different
      expect(path1).toBe('/project/.talkcody-worktrees/pool-0');
      expect(path2).toBe('/project/.talkcody-worktrees/pool-1');
      expect(path1).not.toBe(path2);
    });

    it('should return main project path for task without worktree', async () => {
      // Setup: Only task-1 has a worktree
      const worktree0 = createMockWorktreeInfo(
        0,
        '/project/.talkcody-worktrees/pool-0',
        'task-1'
      );

      useWorktreeStore.setState({
        pool: new Map([[0, worktree0]]),
        taskWorktreeMap: new Map([['task-1', 0]]),
      });

      // Task with worktree gets worktree path
      const pathWithWorktree = await getEffectiveWorkspaceRoot('task-1');
      expect(pathWithWorktree).toBe('/project/.talkcody-worktrees/pool-0');

      // Task without worktree gets main project path
      const pathWithoutWorktree = await getEffectiveWorkspaceRoot('task-no-worktree');
      expect(pathWithoutWorktree).toBe('/main/project');
    });

    it('should support up to 3 parallel tasks with different worktrees', async () => {
      // Setup: Three tasks with three different worktrees (max pool size)
      const worktrees = [0, 1, 2].map((i) =>
        createMockWorktreeInfo(i, `/project/.talkcody-worktrees/pool-${i}`, `task-${i}`)
      );

      const pool = new Map<number, WorktreeInfo>();
      const taskWorktreeMap = new Map<string, number>();
      worktrees.forEach((wt, i) => {
        pool.set(i, wt);
        taskWorktreeMap.set(`task-${i}`, i);
      });

      useWorktreeStore.setState({ pool, taskWorktreeMap });

      // Resolve all paths in parallel
      const paths = await Promise.all([
        getEffectiveWorkspaceRoot('task-0'),
        getEffectiveWorkspaceRoot('task-1'),
        getEffectiveWorkspaceRoot('task-2'),
      ]);

      // Verify all paths are unique
      expect(paths[0]).toBe('/project/.talkcody-worktrees/pool-0');
      expect(paths[1]).toBe('/project/.talkcody-worktrees/pool-1');
      expect(paths[2]).toBe('/project/.talkcody-worktrees/pool-2');
      expect(new Set(paths).size).toBe(3);
    });
  });

  describe('edit review card isolation', () => {
    it('should show independent review cards for parallel write operations', () => {
      const store = useEditReviewStore.getState();
      const resolver1 = vi.fn();
      const resolver2 = vi.fn();

      // Simulate two tasks triggering write file review
      store.setPendingEdit(
        'task-1',
        'edit-1',
        createMockPendingEdit('edit-1', '/src/test.ts', 'task-1'),
        createMockCallbacks(),
        resolver1
      );
      store.setPendingEdit(
        'task-2',
        'edit-2',
        createMockPendingEdit('edit-2', '/src/test.ts', 'task-2'),
        createMockCallbacks(),
        resolver2
      );

      // Verify both have independent review entries
      const state = useEditReviewStore.getState();
      expect(state.pendingEdits.size).toBe(2);
      expect(state.pendingEdits.get('task-1')?.editId).toBe('edit-1');
      expect(state.pendingEdits.get('task-2')?.editId).toBe('edit-2');
    });

    it('should approve task-1 edit without affecting task-2', async () => {
      const store = useEditReviewStore.getState();
      const resolver1 = vi.fn();
      const resolver2 = vi.fn();

      // Setup two pending edits
      store.setPendingEdit(
        'task-1',
        'edit-1',
        createMockPendingEdit('edit-1', '/src/file1.ts', 'task-1'),
        createMockCallbacks(),
        resolver1
      );
      store.setPendingEdit(
        'task-2',
        'edit-2',
        createMockPendingEdit('edit-2', '/src/file2.ts', 'task-2'),
        createMockCallbacks(),
        resolver2
      );

      // Approve task-1's edit
      await store.approveEdit('task-1');

      // Verify task-1 is resolved, task-2 is still pending
      expect(resolver1).toHaveBeenCalledWith(
        expect.objectContaining({ approved: true })
      );
      expect(resolver2).not.toHaveBeenCalled();

      const state = useEditReviewStore.getState();
      expect(state.pendingEdits.has('task-1')).toBe(false);
      expect(state.pendingEdits.has('task-2')).toBe(true);
    });

    it('should reject task-2 edit without affecting task-1', async () => {
      const store = useEditReviewStore.getState();
      const resolver1 = vi.fn();
      const resolver2 = vi.fn();

      // Setup two pending edits
      store.setPendingEdit(
        'task-1',
        'edit-1',
        createMockPendingEdit('edit-1', '/src/file1.ts', 'task-1'),
        createMockCallbacks(),
        resolver1
      );
      store.setPendingEdit(
        'task-2',
        'edit-2',
        createMockPendingEdit('edit-2', '/src/file2.ts', 'task-2'),
        createMockCallbacks(),
        resolver2
      );

      // Reject task-2's edit
      await store.rejectEdit('task-2', 'Not needed');

      // Verify task-2 is resolved with rejection, task-1 is still pending
      expect(resolver2).toHaveBeenCalledWith(
        expect.objectContaining({ approved: false, feedback: 'Not needed' })
      );
      expect(resolver1).not.toHaveBeenCalled();

      const state = useEditReviewStore.getState();
      expect(state.pendingEdits.has('task-1')).toBe(true);
      expect(state.pendingEdits.has('task-2')).toBe(false);
    });

    it('should handle same file path in different worktrees independently', () => {
      const store = useEditReviewStore.getState();

      // Both tasks editing "src/test.ts" but in different worktrees
      // The file_path in pendingEdit would be the absolute path including worktree
      store.setPendingEdit(
        'task-1',
        'edit-1',
        createMockPendingEdit(
          'edit-1',
          '/project/.talkcody-worktrees/pool-0/src/test.ts',
          'task-1'
        ),
        createMockCallbacks(),
        vi.fn()
      );
      store.setPendingEdit(
        'task-2',
        'edit-2',
        createMockPendingEdit(
          'edit-2',
          '/project/.talkcody-worktrees/pool-1/src/test.ts',
          'task-2'
        ),
        createMockCallbacks(),
        vi.fn()
      );

      const state = useEditReviewStore.getState();
      expect(state.pendingEdits.size).toBe(2);

      // Verify file paths are different (worktree-specific)
      const edit1Path = state.pendingEdits.get('task-1')?.pendingEdit.filePath;
      const edit2Path = state.pendingEdits.get('task-2')?.pendingEdit.filePath;

      expect(edit1Path).toContain('pool-0');
      expect(edit2Path).toContain('pool-1');
      expect(edit1Path).not.toBe(edit2Path);
    });
  });

  describe('concurrent execution scenarios', () => {
    it('should handle rapid parallel task creation and path resolution', async () => {
      // Setup 5 tasks (more than pool size to test mixed scenarios)
      const pool = new Map<number, WorktreeInfo>();
      const taskWorktreeMap = new Map<string, number>();

      // Only 3 tasks get worktrees (max pool size)
      for (let i = 0; i < 3; i++) {
        pool.set(
          i,
          createMockWorktreeInfo(i, `/project/.talkcody-worktrees/pool-${i}`, `task-${i}`)
        );
        taskWorktreeMap.set(`task-${i}`, i);
      }

      useWorktreeStore.setState({ pool, taskWorktreeMap });

      // Resolve paths for all 5 tasks in parallel
      const paths = await Promise.all([
        getEffectiveWorkspaceRoot('task-0'),
        getEffectiveWorkspaceRoot('task-1'),
        getEffectiveWorkspaceRoot('task-2'),
        getEffectiveWorkspaceRoot('task-3'), // No worktree
        getEffectiveWorkspaceRoot('task-4'), // No worktree
      ]);

      // First 3 tasks get worktree paths
      expect(paths[0]).toBe('/project/.talkcody-worktrees/pool-0');
      expect(paths[1]).toBe('/project/.talkcody-worktrees/pool-1');
      expect(paths[2]).toBe('/project/.talkcody-worktrees/pool-2');

      // Last 2 tasks get main project path
      expect(paths[3]).toBe('/main/project');
      expect(paths[4]).toBe('/main/project');
    });

    it('should maintain edit isolation during interleaved approve/reject operations', async () => {
      const store = useEditReviewStore.getState();
      const resolvers = Array.from({ length: 4 }, () => vi.fn());

      // Setup 4 pending edits
      for (let i = 0; i < 4; i++) {
        store.setPendingEdit(
          `task-${i}`,
          `edit-${i}`,
          createMockPendingEdit(`edit-${i}`, `/src/file${i}.ts`, `task-${i}`),
          createMockCallbacks(),
          resolvers[i]
        );
      }

      // Interleaved operations
      await store.approveEdit('task-0');
      await store.rejectEdit('task-2', 'feedback');
      await store.approveEdit('task-1');
      await store.rejectEdit('task-3', 'another feedback');

      // Verify all resolvers were called with correct results
      expect(resolvers[0]).toHaveBeenCalledWith(expect.objectContaining({ approved: true }));
      expect(resolvers[1]).toHaveBeenCalledWith(expect.objectContaining({ approved: true }));
      expect(resolvers[2]).toHaveBeenCalledWith(expect.objectContaining({ approved: false }));
      expect(resolvers[3]).toHaveBeenCalledWith(expect.objectContaining({ approved: false }));

      // All edits should be cleared
      const state = useEditReviewStore.getState();
      expect(state.pendingEdits.size).toBe(0);
    });
  });
});
