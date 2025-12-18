import { useEffect, useState } from 'react';
import { FileEditReviewCard } from '@/components/tools/file-edit-review-card';
import { GenericToolDoing } from '@/components/tools/generic-tool-doing';
import { type PendingEditEntry, useEditReviewStore } from '@/stores/edit-review-store';

interface EditBlock {
  old_string: string;
  new_string: string;
  description?: string;
}

interface EditFileToolDoingProps {
  file_path: string;
  edits?: EditBlock[];
  taskId: string;
}

/**
 * Responsive wrapper component for edit-file-tool's renderToolDoing
 *
 * This component subscribes to the edit review store and automatically
 * switches between showing the inline review card (when a pending edit exists)
 * and the generic "doing" status (when no review is pending).
 *
 * Uses taskId to look up the correct pending edit from the Map,
 * allowing multiple concurrent tasks to have independent pending edits.
 */
export function EditFileToolDoing({ file_path, edits, taskId }: EditFileToolDoingProps) {
  // Subscribe to the store's pendingEdits Map (reactive)
  const pendingEdits = useEditReviewStore((state) => state.pendingEdits);

  // Use local state to ensure component re-renders when store updates
  const [entry, setEntry] = useState<PendingEditEntry | null>(pendingEdits.get(taskId) || null);

  // Update local state when store changes or taskId changes
  useEffect(() => {
    setEntry(pendingEdits.get(taskId) || null);
  }, [pendingEdits, taskId]);

  // If there's a pending edit for this file and task, show the inline review card
  if (entry && entry.pendingEdit.filePath === file_path) {
    return (
      <FileEditReviewCard taskId={taskId} editId={entry.editId} pendingEdit={entry.pendingEdit} />
    );
  }

  // Otherwise, show the generic "doing" status
  return (
    <GenericToolDoing
      operation="edit"
      filePath={file_path}
      details={edits && edits.length > 1 ? `Applying ${edits.length} edits` : undefined}
    />
  );
}
