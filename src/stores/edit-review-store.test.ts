import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type PendingEdit,
  type PendingEditEntry,
  useEditReviewStore,
} from './edit-review-store';

// Mock logger to avoid console noise
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

// Helper to create a mock PendingEdit
function createMockPendingEdit(id: string, filePath = '/test/file.ts'): PendingEdit {
  return {
    id,
    filePath,
    originalContent: 'original content',
    newContent: 'new content',
    operation: 'edit',
    timestamp: Date.now(),
  };
}

// Helper to create mock callbacks
function createMockCallbacks(options?: {
  onApproveResult?: { success: boolean; message: string };
  onRejectResult?: { success: boolean; message: string };
  shouldThrow?: boolean;
}) {
  const onApprove = vi.fn().mockImplementation(async () => {
    if (options?.shouldThrow) {
      throw new Error('Approve failed');
    }
    return options?.onApproveResult ?? { success: true, message: 'Approved' };
  });

  const onReject = vi.fn().mockImplementation(async (feedback: string) => {
    if (options?.shouldThrow) {
      throw new Error('Reject failed');
    }
    return options?.onRejectResult ?? { success: true, message: `Rejected: ${feedback}` };
  });

  return { onApprove, onReject };
}

describe('EditReviewStore - Concurrent Task Isolation', () => {
  beforeEach(() => {
    // Reset store to initial state
    useEditReviewStore.setState({ pendingEdits: new Map() });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('setPendingEdit', () => {
    it('should store pending edits separately for different tasks', () => {
      const store = useEditReviewStore.getState();
      const resolver1 = vi.fn();
      const resolver2 = vi.fn();

      store.setPendingEdit(
        'task-1',
        'edit-1',
        createMockPendingEdit('edit-1', '/file1.ts'),
        createMockCallbacks(),
        resolver1
      );
      store.setPendingEdit(
        'task-2',
        'edit-2',
        createMockPendingEdit('edit-2', '/file2.ts'),
        createMockCallbacks(),
        resolver2
      );

      const state = useEditReviewStore.getState();
      expect(state.pendingEdits.size).toBe(2);
      expect(state.pendingEdits.get('task-1')?.editId).toBe('edit-1');
      expect(state.pendingEdits.get('task-2')?.editId).toBe('edit-2');
    });

    it('should NOT overwrite other task pending edit when setting new one', () => {
      const store = useEditReviewStore.getState();
      const resolver1 = vi.fn();
      const resolver2 = vi.fn();

      store.setPendingEdit(
        'task-1',
        'edit-1',
        createMockPendingEdit('edit-1'),
        createMockCallbacks(),
        resolver1
      );
      store.setPendingEdit(
        'task-2',
        'edit-2',
        createMockPendingEdit('edit-2'),
        createMockCallbacks(),
        resolver2
      );

      const state = useEditReviewStore.getState();
      // Task 1's resolver should NOT be affected by Task 2's setPendingEdit
      expect(state.pendingEdits.get('task-1')?.editResolver).toBe(resolver1);
      expect(state.pendingEdits.get('task-2')?.editResolver).toBe(resolver2);
    });

    it('should overwrite same task pending edit when setting new one', () => {
      const store = useEditReviewStore.getState();
      const resolver1 = vi.fn();
      const resolver2 = vi.fn();

      store.setPendingEdit(
        'task-1',
        'edit-1',
        createMockPendingEdit('edit-1'),
        createMockCallbacks(),
        resolver1
      );
      store.setPendingEdit(
        'task-1',
        'edit-2',
        createMockPendingEdit('edit-2'),
        createMockCallbacks(),
        resolver2
      );

      const state = useEditReviewStore.getState();
      expect(state.pendingEdits.size).toBe(1);
      expect(state.pendingEdits.get('task-1')?.editId).toBe('edit-2');
      expect(state.pendingEdits.get('task-1')?.editResolver).toBe(resolver2);
    });
  });

  describe('getPendingEdit', () => {
    it('should return pending edit for existing task', () => {
      const store = useEditReviewStore.getState();
      const pendingEdit = createMockPendingEdit('edit-1');

      store.setPendingEdit('task-1', 'edit-1', pendingEdit, createMockCallbacks(), vi.fn());

      const entry = store.getPendingEdit('task-1');
      expect(entry).not.toBeNull();
      expect(entry?.editId).toBe('edit-1');
      expect(entry?.pendingEdit.filePath).toBe('/test/file.ts');
    });

    it('should return null for non-existent task', () => {
      const store = useEditReviewStore.getState();
      const entry = store.getPendingEdit('non-existent-task');
      expect(entry).toBeNull();
    });
  });

  describe('approveEdit', () => {
    it('should only resolve the specific task pending edit', async () => {
      const store = useEditReviewStore.getState();
      const resolver1 = vi.fn();
      const resolver2 = vi.fn();

      store.setPendingEdit(
        'task-1',
        'edit-1',
        createMockPendingEdit('edit-1'),
        createMockCallbacks(),
        resolver1
      );
      store.setPendingEdit(
        'task-2',
        'edit-2',
        createMockPendingEdit('edit-2'),
        createMockCallbacks(),
        resolver2
      );

      await store.approveEdit('task-1');

      expect(resolver1).toHaveBeenCalledWith(
        expect.objectContaining({ approved: true, success: true })
      );
      expect(resolver2).not.toHaveBeenCalled();

      const state = useEditReviewStore.getState();
      expect(state.pendingEdits.has('task-1')).toBe(false);
      expect(state.pendingEdits.has('task-2')).toBe(true);
    });

    it('should throw error when approving non-existent task', async () => {
      const store = useEditReviewStore.getState();

      await expect(store.approveEdit('non-existent-task')).rejects.toThrow(
        'No pending edit for task non-existent-task'
      );
    });

    it('should call onApprove callback', async () => {
      const store = useEditReviewStore.getState();
      const callbacks = createMockCallbacks();
      const resolver = vi.fn();

      store.setPendingEdit('task-1', 'edit-1', createMockPendingEdit('edit-1'), callbacks, resolver);

      await store.approveEdit('task-1');

      expect(callbacks.onApprove).toHaveBeenCalled();
    });

    it('should handle onApprove callback error', async () => {
      const store = useEditReviewStore.getState();
      const callbacks = createMockCallbacks({ shouldThrow: true });
      const resolver = vi.fn();

      store.setPendingEdit('task-1', 'edit-1', createMockPendingEdit('edit-1'), callbacks, resolver);

      await expect(store.approveEdit('task-1')).rejects.toThrow('Approve failed');

      // Resolver should still be called with error
      expect(resolver).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, approved: false })
      );

      // Entry should be cleared even on error
      const state = useEditReviewStore.getState();
      expect(state.pendingEdits.has('task-1')).toBe(false);
    });
  });

  describe('rejectEdit', () => {
    it('should only reject the specific task pending edit', async () => {
      const store = useEditReviewStore.getState();
      const resolver1 = vi.fn();
      const resolver2 = vi.fn();

      store.setPendingEdit(
        'task-1',
        'edit-1',
        createMockPendingEdit('edit-1'),
        createMockCallbacks(),
        resolver1
      );
      store.setPendingEdit(
        'task-2',
        'edit-2',
        createMockPendingEdit('edit-2'),
        createMockCallbacks(),
        resolver2
      );

      await store.rejectEdit('task-1', 'user feedback');

      expect(resolver1).toHaveBeenCalledWith(
        expect.objectContaining({
          approved: false,
          feedback: 'user feedback',
        })
      );
      expect(resolver2).not.toHaveBeenCalled();

      const state = useEditReviewStore.getState();
      expect(state.pendingEdits.has('task-1')).toBe(false);
      expect(state.pendingEdits.has('task-2')).toBe(true);
    });

    it('should throw error when rejecting non-existent task', async () => {
      const store = useEditReviewStore.getState();

      await expect(store.rejectEdit('non-existent-task', 'feedback')).rejects.toThrow(
        'No pending edit for task non-existent-task'
      );
    });

    it('should call onReject callback with feedback', async () => {
      const store = useEditReviewStore.getState();
      const callbacks = createMockCallbacks();
      const resolver = vi.fn();

      store.setPendingEdit('task-1', 'edit-1', createMockPendingEdit('edit-1'), callbacks, resolver);

      await store.rejectEdit('task-1', 'my feedback');

      expect(callbacks.onReject).toHaveBeenCalledWith('my feedback');
    });
  });

  describe('clearPendingEdit', () => {
    it('should only clear the specific task pending edit', () => {
      const store = useEditReviewStore.getState();

      store.setPendingEdit(
        'task-1',
        'edit-1',
        createMockPendingEdit('edit-1'),
        createMockCallbacks(),
        vi.fn()
      );
      store.setPendingEdit(
        'task-2',
        'edit-2',
        createMockPendingEdit('edit-2'),
        createMockCallbacks(),
        vi.fn()
      );

      store.clearPendingEdit('task-1');

      const state = useEditReviewStore.getState();
      expect(state.pendingEdits.has('task-1')).toBe(false);
      expect(state.pendingEdits.has('task-2')).toBe(true);
    });

    it('should not throw when clearing non-existent task', () => {
      const store = useEditReviewStore.getState();
      expect(() => store.clearPendingEdit('non-existent-task')).not.toThrow();
    });
  });

  describe('concurrent scenarios', () => {
    it('should handle rapid sequential setPendingEdit calls for different tasks', () => {
      const store = useEditReviewStore.getState();
      const resolvers = Array.from({ length: 5 }, () => vi.fn());

      // Simulate 5 tasks setting pending edits in quick succession
      for (let i = 0; i < 5; i++) {
        store.setPendingEdit(
          `task-${i}`,
          `edit-${i}`,
          createMockPendingEdit(`edit-${i}`, `/file${i}.ts`),
          createMockCallbacks(),
          resolvers[i]
        );
      }

      const state = useEditReviewStore.getState();
      expect(state.pendingEdits.size).toBe(5);

      // Each task should have its own pending edit
      for (let i = 0; i < 5; i++) {
        expect(state.pendingEdits.get(`task-${i}`)?.editId).toBe(`edit-${i}`);
        expect(state.pendingEdits.get(`task-${i}`)?.pendingEdit.filePath).toBe(`/file${i}.ts`);
      }
    });

    it('should handle interleaved approve/reject operations correctly', async () => {
      const store = useEditReviewStore.getState();
      const resolver1 = vi.fn();
      const resolver2 = vi.fn();
      const resolver3 = vi.fn();

      store.setPendingEdit(
        'task-1',
        'edit-1',
        createMockPendingEdit('edit-1'),
        createMockCallbacks(),
        resolver1
      );
      store.setPendingEdit(
        'task-2',
        'edit-2',
        createMockPendingEdit('edit-2'),
        createMockCallbacks(),
        resolver2
      );
      store.setPendingEdit(
        'task-3',
        'edit-3',
        createMockPendingEdit('edit-3'),
        createMockCallbacks(),
        resolver3
      );

      // Interleaved operations
      await store.approveEdit('task-1');
      await store.rejectEdit('task-2', 'feedback');
      await store.approveEdit('task-3');

      expect(resolver1).toHaveBeenCalledWith(expect.objectContaining({ approved: true }));
      expect(resolver2).toHaveBeenCalledWith(expect.objectContaining({ approved: false }));
      expect(resolver3).toHaveBeenCalledWith(expect.objectContaining({ approved: true }));

      const state = useEditReviewStore.getState();
      expect(state.pendingEdits.size).toBe(0);
    });

    it('should handle parallel approve operations for different tasks', async () => {
      const store = useEditReviewStore.getState();
      const resolver1 = vi.fn();
      const resolver2 = vi.fn();

      store.setPendingEdit(
        'task-1',
        'edit-1',
        createMockPendingEdit('edit-1'),
        createMockCallbacks(),
        resolver1
      );
      store.setPendingEdit(
        'task-2',
        'edit-2',
        createMockPendingEdit('edit-2'),
        createMockCallbacks(),
        resolver2
      );

      // Parallel approvals
      await Promise.all([store.approveEdit('task-1'), store.approveEdit('task-2')]);

      expect(resolver1).toHaveBeenCalledWith(expect.objectContaining({ approved: true }));
      expect(resolver2).toHaveBeenCalledWith(expect.objectContaining({ approved: true }));

      const state = useEditReviewStore.getState();
      expect(state.pendingEdits.size).toBe(0);
    });
  });
});
