import { Check, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { z } from 'zod';
import { PlanReviewCard } from '@/components/plan/plan-review-card';
import { Card } from '@/components/ui/card';
import { createTool } from '@/lib/create-tool';
import { logger } from '@/lib/logger';
import { type PlanReviewResult, usePlanModeStore } from '@/stores/plan-mode-store';

// Input schema for the tool
const inputSchema = z.strictObject({
  plan: z.string().min(1).describe('The implementation plan in Markdown format'),
});

interface ToolContext {
  taskId?: string;
}

/**
 * Execute function that pauses and waits for user to review the plan
 */
async function executeExitPlanMode(
  params: z.infer<typeof inputSchema>,
  context?: ToolContext
): Promise<PlanReviewResult> {
  const { plan } = params;
  const taskId = context?.taskId;

  if (!taskId) {
    logger.error('[ExitPlanMode] taskId is required but not provided');
    return {
      action: 'reject this plan, do not implement it',
      feedback: 'Internal error: taskId is required for exitPlanMode',
    };
  }

  // Create a Promise that will be resolved when user reviews the plan
  return new Promise<PlanReviewResult>((resolve) => {
    logger.info('[ExitPlanMode] Creating Promise and setting pending plan', { taskId });

    // Store the plan and resolver in the store with taskId
    // The UI component will call approvePlan or rejectPlan which will resolve this Promise
    usePlanModeStore.getState().setPendingPlan(taskId, plan, resolve);
  });
}

/**
 * Result component for approved plan
 */
function PlanApprovedResult({ plan, editedPlan }: { plan: string; editedPlan?: string }) {
  return (
    <Card className="border-green-500/50 bg-green-500/10 p-4">
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
          <Check className="size-5" />
          <span className="font-medium">Plan Approved</span>
        </div>
        {editedPlan && (
          <p className="text-muted-foreground text-sm">
            The plan was edited before approval. Proceeding with the modified version.
          </p>
        )}
        {plan && (
          <div className="prose prose-sm dark:prose-invert max-w-none mt-2 pt-2 border-t border-green-500/30">
            <ReactMarkdown>{plan}</ReactMarkdown>
          </div>
        )}
      </div>
    </Card>
  );
}

/**
 * Result component for rejected plan
 */
function PlanRejectedResult({ feedback }: { feedback?: string }) {
  return (
    <Card className="border-orange-500/50 bg-orange-500/10 p-4">
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-orange-600 dark:text-orange-400">
          <X className="size-5" />
          <span className="font-medium">Plan Rejected</span>
        </div>
        {feedback && (
          <div className="mt-2 space-y-1">
            <p className="text-foreground text-sm font-medium">User Feedback:</p>
            <p className="text-muted-foreground text-sm italic">{feedback}</p>
          </div>
        )}
      </div>
    </Card>
  );
}

export const exitPlanModeTool = createTool({
  name: 'exitPlanMode',
  description: `Present an implementation plan to the user for review and approval. This tool is REQUIRED in Plan Mode before making any file modifications.

When in Plan Mode, you must:
1. Gather all necessary context using read-only tools (ReadFile, Grep, Glob, etc.)
2. Analyze the task and create a detailed implementation plan
3. Use this tool to present your plan to the user
4. Wait for the user to approve, edit, or reject the plan

The plan should be in Markdown format and include:
- Clear step-by-step implementation details
- Files to be modified, created, or deleted
- Potential edge cases and considerations
- Testing approach

The user can:
- Approve the plan as-is and let you proceed
- Edit the plan before approval
- Reject the plan with feedback for you to revise

IMPORTANT: Do NOT make any file modifications until the plan is approved.
You could only use this tool when plan mode is enabled.`,
  inputSchema,
  canConcurrent: false,
  hidden: true,
  execute: executeExitPlanMode,

  renderToolDoing: (params: z.infer<typeof inputSchema>, context?: ToolContext) => {
    return <PlanReviewCard planContent={params.plan} taskId={context?.taskId} />;
  },

  renderToolResult: (result: PlanReviewResult, { plan }) => {
    if (result.action === 'approve this plan, please implement it') {
      return <PlanApprovedResult plan={plan || ''} editedPlan={result.editedPlan} />;
    }
    return <PlanRejectedResult feedback={result.feedback} />;
  },
});
