import { Check } from 'lucide-react';
import { useState } from 'react';
import { FileDiffPreview } from '@/components/tools/file-diff-preview';
import { Card } from '@/components/ui/card';
import { logger } from '@/lib/logger';
import type { PendingEdit } from '@/stores/edit-review-store';
import { useEditReviewStore } from '@/stores/edit-review-store';

interface FileEditReviewCardProps {
  taskId: string;
  editId: string;
  pendingEdit: PendingEdit;
}

export function FileEditReviewCard({ taskId, editId, pendingEdit }: FileEditReviewCardProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Get store methods
  const { approveEdit, rejectEdit, allowAllEdit } = useEditReviewStore();

  const handleApprove = async () => {
    if (isProcessing) return;

    setIsProcessing(true);
    logger.info('[FileEditReviewCard] User approved edit', { taskId, editId });

    try {
      // Call the store method with taskId
      await approveEdit(taskId);

      // Mark as submitted
      setSubmitted(true);
    } catch (error) {
      logger.error('[FileEditReviewCard] Error approving edit:', error);
      // Error is already handled in the store
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReject = async (feedback: string) => {
    if (isProcessing) return;

    setIsProcessing(true);
    logger.info('[FileEditReviewCard] User rejected edit', { taskId, editId, feedback });

    try {
      // Call the store method with taskId
      await rejectEdit(taskId, feedback);

      // Mark as submitted
      setSubmitted(true);
    } catch (error) {
      logger.error('[FileEditReviewCard] Error rejecting edit:', error);
      // Error is already handled in the store
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAllowAll = async () => {
    if (isProcessing) return;

    setIsProcessing(true);
    logger.info('[FileEditReviewCard] User allowed all edits', { taskId, editId });

    try {
      // Call the store method with taskId
      await allowAllEdit(taskId);

      // Mark as submitted
      setSubmitted(true);
    } catch (error) {
      logger.error('[FileEditReviewCard] Error allowing all edits:', error);
      // Error is already handled in the store
    } finally {
      setIsProcessing(false);
    }
  };

  // Show submitted status
  if (submitted) {
    return (
      <Card className="border-green-500/50 bg-green-500/10 p-4">
        <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
          <Check className="size-5" />
          <span className="font-medium">Edit review submitted successfully</span>
        </div>
      </Card>
    );
  }

  // Show the diff preview
  return (
    <FileDiffPreview
      filePath={pendingEdit.filePath}
      originalContent={pendingEdit.originalContent}
      newContent={pendingEdit.newContent}
      operation={pendingEdit.operation}
      onApprove={handleApprove}
      onReject={handleReject}
      onAllowAll={handleAllowAll}
    />
  );
}
