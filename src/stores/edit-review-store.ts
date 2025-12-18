// src/stores/edit-review-store.ts
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { logger } from '@/lib/logger';

/**
 * Edit Review Store
 *
 * Manages the state for inline edit review functionality.
 * This store is used to display edit previews inline in the chat message
 * instead of in a popup dialog.
 *
 * IMPORTANT: This store supports multiple concurrent pending edits,
 * keyed by taskId to allow multiple tasks to have pending edits simultaneously.
 */

export interface PendingEdit {
  id: string;
  filePath: string;
  originalContent: string;
  newContent: string;
  operation: 'edit' | 'write';
  timestamp: number;
  toolCallId?: string;
  metadata?: {
    editCount?: number;
    edits?: Array<{
      index: number;
      description: string;
      occurrences: number;
      matchType: string;
    }>;
  };
}

export interface ReviewResult {
  approved: boolean;
  feedback?: string;
}

export interface FileEditReviewResult {
  success: boolean;
  message: string;
  approved?: boolean;
  feedback?: string;
}

interface EditCallbacks {
  onApprove: () => Promise<{ success: boolean; message: string }>;
  onReject: (feedback: string) => Promise<{ success: boolean; message: string; feedback?: string }>;
  onAllowAll?: () => Promise<{ success: boolean; message: string }>;
}

/**
 * Entry for a single pending edit, stored per taskId
 */
export interface PendingEditEntry {
  pendingEdit: PendingEdit;
  editId: string;
  callbacks: EditCallbacks;
  editResolver: (result: FileEditReviewResult) => void;
}

// ============================================================================
// Store State and Actions
// ============================================================================

interface EditReviewState {
  /** Map of pending edits, keyed by taskId */
  pendingEdits: Map<string, PendingEditEntry>;

  /**
   * Set pending edit with all required data
   * Called by edit-file-tool's execute function
   */
  setPendingEdit: (
    taskId: string,
    editId: string,
    pendingEdit: PendingEdit,
    callbacks: EditCallbacks,
    resolver: (result: FileEditReviewResult) => void
  ) => void;

  /**
   * Get pending edit entry for a specific task
   */
  getPendingEdit: (taskId: string) => PendingEditEntry | null;

  /**
   * Approve the edit for a specific task
   * Executes the onApprove callback and resolves the Promise
   */
  approveEdit: (taskId: string) => Promise<void>;

  /**
   * Reject the edit for a specific task with feedback
   * Executes the onReject callback and resolves the Promise
   */
  rejectEdit: (taskId: string, feedback: string) => Promise<void>;

  /**
   * Allow all edits in a specific task's conversation
   * Executes the onAllowAll callback and resolves the Promise
   */
  allowAllEdit: (taskId: string) => Promise<void>;

  /**
   * Clear pending edit for a specific task
   */
  clearPendingEdit: (taskId: string) => void;
}

export const useEditReviewStore = create<EditReviewState>()(
  devtools(
    (set, get) => ({
      pendingEdits: new Map(),

      setPendingEdit: (taskId, editId, pendingEdit, callbacks, resolver) => {
        logger.info('[EditReviewStore] Setting pending edit', {
          taskId,
          editId,
          filePath: pendingEdit.filePath,
          operation: pendingEdit.operation,
        });

        set(
          (state) => {
            const newMap = new Map(state.pendingEdits);
            newMap.set(taskId, {
              pendingEdit,
              editId,
              callbacks,
              editResolver: resolver,
            });
            return { pendingEdits: newMap };
          },
          false,
          'setPendingEdit'
        );
      },

      getPendingEdit: (taskId) => {
        return get().pendingEdits.get(taskId) || null;
      },

      approveEdit: async (taskId) => {
        const entry = get().pendingEdits.get(taskId);

        if (!entry) {
          logger.error('[EditReviewStore] No pending edit to approve', { taskId });
          throw new Error(`No pending edit for task ${taskId}`);
        }

        const { editId, callbacks, editResolver } = entry;

        logger.info('[EditReviewStore] Approving edit', { taskId, editId });

        try {
          // Execute the onApprove callback
          const result = await callbacks.onApprove();

          // Resolve the Promise with success result
          editResolver({
            success: true,
            message: result.message,
            approved: true,
          });

          // Clear state for this task after resolving
          set(
            (state) => {
              const newMap = new Map(state.pendingEdits);
              newMap.delete(taskId);
              return { pendingEdits: newMap };
            },
            false,
            'approveEdit'
          );
        } catch (error) {
          logger.error('[EditReviewStore] Error approving edit:', error);

          // Resolve with error
          editResolver({
            success: false,
            message: `Failed to approve edit: ${error instanceof Error ? error.message : 'Unknown error'}`,
            approved: false,
          });

          // Clear state for this task
          set(
            (state) => {
              const newMap = new Map(state.pendingEdits);
              newMap.delete(taskId);
              return { pendingEdits: newMap };
            },
            false,
            'approveEdit-error'
          );

          throw error;
        }
      },

      rejectEdit: async (taskId, feedback) => {
        const entry = get().pendingEdits.get(taskId);

        if (!entry) {
          logger.error('[EditReviewStore] No pending edit to reject', { taskId });
          throw new Error(`No pending edit for task ${taskId}`);
        }

        const { editId, callbacks, editResolver } = entry;

        logger.info('[EditReviewStore] Rejecting edit', { taskId, editId, feedback });

        try {
          // Execute the onReject callback
          const result = await callbacks.onReject(feedback);

          // Resolve the Promise with rejection result
          editResolver({
            success: true,
            message: result.message || `Edit rejected. Feedback: ${feedback}`,
            approved: false,
            feedback,
          });

          // Clear state for this task after resolving
          set(
            (state) => {
              const newMap = new Map(state.pendingEdits);
              newMap.delete(taskId);
              return { pendingEdits: newMap };
            },
            false,
            'rejectEdit'
          );
        } catch (error) {
          logger.error('[EditReviewStore] Error rejecting edit:', error);

          // Resolve with error
          editResolver({
            success: false,
            message: `Failed to reject edit: ${error instanceof Error ? error.message : 'Unknown error'}`,
            approved: false,
          });

          // Clear state for this task
          set(
            (state) => {
              const newMap = new Map(state.pendingEdits);
              newMap.delete(taskId);
              return { pendingEdits: newMap };
            },
            false,
            'rejectEdit-error'
          );

          throw error;
        }
      },

      allowAllEdit: async (taskId) => {
        const entry = get().pendingEdits.get(taskId);

        if (!entry) {
          logger.error('[EditReviewStore] No pending edit to allow all', { taskId });
          throw new Error(`No pending edit for task ${taskId}`);
        }

        const { editId, callbacks, editResolver } = entry;

        if (!callbacks.onAllowAll) {
          logger.error('[EditReviewStore] No onAllowAll callback registered', { taskId });
          throw new Error('No onAllowAll callback registered');
        }

        logger.info('[EditReviewStore] Allowing all edits', { taskId, editId });

        try {
          // Execute the onAllowAll callback
          const result = await callbacks.onAllowAll();

          // Resolve the Promise with success result
          editResolver({
            success: true,
            message: result.message,
            approved: true,
          });

          // Clear state for this task after resolving
          set(
            (state) => {
              const newMap = new Map(state.pendingEdits);
              newMap.delete(taskId);
              return { pendingEdits: newMap };
            },
            false,
            'allowAllEdit'
          );
        } catch (error) {
          logger.error('[EditReviewStore] Error allowing all edits:', error);

          // Resolve with error
          editResolver({
            success: false,
            message: `Failed to allow all edits: ${error instanceof Error ? error.message : 'Unknown error'}`,
            approved: false,
          });

          // Clear state for this task
          set(
            (state) => {
              const newMap = new Map(state.pendingEdits);
              newMap.delete(taskId);
              return { pendingEdits: newMap };
            },
            false,
            'allowAllEdit-error'
          );

          throw error;
        }
      },

      clearPendingEdit: (taskId) => {
        logger.info('[EditReviewStore] Clearing pending edit', { taskId });

        set(
          (state) => {
            const newMap = new Map(state.pendingEdits);
            newMap.delete(taskId);
            return { pendingEdits: newMap };
          },
          false,
          'clearPendingEdit'
        );
      },
    }),
    {
      name: 'edit-review-store',
      enabled: import.meta.env.DEV,
    }
  )
);
