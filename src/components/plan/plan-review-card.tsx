import { Check, Edit2, X } from 'lucide-react';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { useLocale } from '@/hooks/use-locale';
import { usePlanModeStore } from '@/stores/plan-mode-store';

interface PlanReviewCardProps {
  planContent: string;
  taskId?: string;
}

export function PlanReviewCard({ planContent, taskId }: PlanReviewCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState(planContent);
  const [showFeedbackInput, setShowFeedbackInput] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const { t } = useLocale();
  const { approvePlan, rejectPlan } = usePlanModeStore();

  const handleApprove = () => {
    if (!taskId) {
      console.error('[PlanReviewCard] taskId is required for approval');
      return;
    }
    // If content was edited, pass the edited version
    const finalContent = isEditing && editedContent !== planContent ? editedContent : undefined;
    approvePlan(taskId, finalContent);
    setSubmitted(true);
  };

  const handleReject = () => {
    if (!showFeedbackInput) {
      // Show feedback input first
      setShowFeedbackInput(true);
      return;
    }

    if (!taskId) {
      console.error('[PlanReviewCard] taskId is required for rejection');
      return;
    }

    // Submit rejection with feedback
    rejectPlan(taskId, feedback.trim() || undefined);
    setSubmitted(true);
  };

  const handleEdit = () => {
    setIsEditing(!isEditing);
    if (!isEditing) {
      // Reset edited content when entering edit mode
      setEditedContent(planContent);
    }
  };

  const handleCancelFeedback = () => {
    setShowFeedbackInput(false);
    setFeedback('');
  };

  if (submitted) {
    return (
      <Card className="border-green-500/50 bg-green-500/10 p-4">
        <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
          <Check className="size-5" />
          <span className="font-medium">{t.PlanReview.submitted}</span>
        </div>
      </Card>
    );
  }

  return (
    <Card className="border-blue-500/50 bg-blue-500/10 p-4 w-full overflow-hidden">
      <div className="space-y-4 min-w-0">
        {/* Header */}
        <div>
          <h3 className="font-semibold text-foreground text-lg">{t.PlanReview.title}</h3>
          <p className="text-muted-foreground text-sm">{t.PlanReview.description}</p>
        </div>

        {/* Plan Content */}
        <div className="rounded-lg border border-border bg-background p-4 w-full overflow-hidden">
          {isEditing ? (
            <div className="space-y-2">
              <div className="text-muted-foreground text-xs">{t.PlanReview.editHint}</div>
              <Textarea
                value={editedContent}
                onChange={(e) => setEditedContent(e.target.value)}
                className="min-h-[300px] resize-vertical font-mono text-sm w-full"
                placeholder={t.PlanReview.editPlaceholder}
              />
            </div>
          ) : (
            <div className="prose prose-sm dark:prose-invert max-w-none break-words">
              <ReactMarkdown>{planContent}</ReactMarkdown>
            </div>
          )}
        </div>

        {/* Feedback Input (shown when rejecting) */}
        {showFeedbackInput && (
          <div className="space-y-2 rounded-lg border border-orange-500/50 bg-orange-500/10 p-4 w-full overflow-hidden">
            <div className="text-foreground text-sm font-medium">{t.PlanReview.feedbackPrompt}</div>
            <Textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              className="min-h-[100px] resize-none w-full"
              placeholder={t.PlanReview.feedbackPlaceholder}
            />
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-2 pt-2">
          {showFeedbackInput ? (
            <>
              <Button variant="outline" onClick={handleCancelFeedback} className="min-w-[100px]">
                {t.PlanReview.cancel}
              </Button>
              <Button onClick={handleReject} variant="destructive" className="min-w-[100px]">
                <X className="mr-2 size-4" />
                {t.PlanReview.submitRejection}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={handleEdit} className="min-w-[100px]">
                <Edit2 className="mr-2 size-4" />
                {isEditing ? t.PlanReview.preview : t.PlanReview.edit}
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowFeedbackInput(true)}
                className="min-w-[120px] border-orange-500/50 text-orange-600 hover:bg-orange-500/10 dark:text-orange-400"
              >
                <X className="mr-2 size-4" />
                {t.PlanReview.rejectAndFeedback}
              </Button>
              <Button
                onClick={handleApprove}
                className="min-w-[100px] bg-green-600 hover:bg-green-700"
              >
                <Check className="mr-2 size-4" />
                {t.PlanReview.approve}
              </Button>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
