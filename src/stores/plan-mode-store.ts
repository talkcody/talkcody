// src/stores/plan-mode-store.ts
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { logger } from '@/lib/logger';
import { useSettingsStore } from './settings-store';

/**
 * Plan Mode Store
 *
 * Manages the state for Plan Mode functionality.
 * Plan Mode requires AI to create a plan and get user approval before executing modifications.
 */

export interface PlanReviewResult {
  action: 'approve this plan, please implement it' | 'reject this plan, do not implement it';
  editedPlan?: string; // If user edited the plan before approval
  feedback?: string; // If user rejected and provided feedback
}

interface PendingPlan {
  planId: string;
  content: string;
  timestamp: Date;
}

interface PlanModeState {
  /** Global plan mode toggle - affects all conversations */
  isPlanModeEnabled: boolean;

  /** Pending plans per task (taskId -> PendingPlan) */
  pendingPlans: Map<string, PendingPlan>;

  /** Resolvers per task (taskId -> resolver function) */
  planResolvers: Map<string, (result: PlanReviewResult) => void>;

  /**
   * Initialize plan mode state from settings store
   */
  initialize: () => void;

  /**
   * Toggle plan mode on/off
   */
  togglePlanMode: () => void;

  /**
   * Set plan mode state
   */
  setPlanMode: (enabled: boolean) => void;

  /**
   * Set pending plan and resolver function for a specific task
   * Called by ExitPlanMode tool's execute function
   */
  setPendingPlan: (
    taskId: string,
    plan: string,
    resolver: (result: PlanReviewResult) => void
  ) => void;

  /**
   * Approve the plan for a specific task (optionally with edits)
   * Called by UI when user clicks Approve
   */
  approvePlan: (taskId: string, editedPlan?: string) => void;

  /**
   * Reject the plan for a specific task with optional feedback
   * Called by UI when user clicks Reject
   */
  rejectPlan: (taskId: string, feedback?: string) => void;

  /**
   * Clear pending plan and resolver for a specific task
   */
  clearPendingPlan: (taskId: string) => void;

  /**
   * Get pending plan for a specific task
   */
  getPendingPlan: (taskId: string) => PendingPlan | null;
}

export const usePlanModeStore = create<PlanModeState>()(
  devtools(
    (set, get) => ({
      isPlanModeEnabled: false,
      pendingPlans: new Map(),
      planResolvers: new Map(),

      initialize: () => {
        // Load initial state from settings store
        const settingsStore = useSettingsStore.getState();
        const isPlanModeEnabled = settingsStore.getPlanModeEnabled();

        logger.info('[PlanModeStore] Initializing from settings', {
          isPlanModeEnabled,
        });

        set({ isPlanModeEnabled }, false, 'initialize');
      },

      togglePlanMode: () => {
        const currentState = get().isPlanModeEnabled;
        const newState = !currentState;

        set({ isPlanModeEnabled: newState }, false, 'togglePlanMode');

        // Sync with settings store for persistence
        useSettingsStore
          .getState()
          .setPlanModeEnabled(newState)
          .catch((error) => {
            logger.error('[PlanModeStore] Failed to persist plan mode state:', error);
          });
      },

      setPlanMode: (enabled) => {
        logger.info('[PlanModeStore] Setting plan mode', { enabled });

        set({ isPlanModeEnabled: enabled }, false, 'setPlanMode');

        // Sync with settings store for persistence
        useSettingsStore
          .getState()
          .setPlanModeEnabled(enabled)
          .catch((error) => {
            logger.error('[PlanModeStore] Failed to persist plan mode state:', error);
          });
      },

      setPendingPlan: (taskId, plan, resolver) => {
        const planId = `plan_${Date.now()}`;

        logger.info('[PlanModeStore] Setting pending plan', {
          taskId,
          planId,
          planLength: plan.length,
          planPreview: plan.substring(0, 100),
        });

        set(
          (state) => {
            const newPendingPlans = new Map(state.pendingPlans);
            const newPlanResolvers = new Map(state.planResolvers);
            newPendingPlans.set(taskId, {
              planId,
              content: plan,
              timestamp: new Date(),
            });
            newPlanResolvers.set(taskId, resolver);
            return {
              pendingPlans: newPendingPlans,
              planResolvers: newPlanResolvers,
            };
          },
          false,
          'setPendingPlan'
        );
      },

      approvePlan: (taskId, editedPlan) => {
        const { pendingPlans, planResolvers } = get();
        const pendingPlan = pendingPlans.get(taskId);
        const planResolver = planResolvers.get(taskId);

        if (!pendingPlan) {
          logger.error('[PlanModeStore] No pending plan to approve', { taskId });
          return;
        }

        logger.info('[PlanModeStore] Approving plan', {
          taskId,
          planId: pendingPlan.planId,
          wasEdited: !!editedPlan,
        });

        if (planResolver) {
          planResolver({
            action: 'approve this plan, please implement it',
            editedPlan,
          });

          // Exit plan mode after approval so AI can execute the plan
          logger.info('[PlanModeStore] Exiting plan mode after plan approval', { taskId });

          // Clear state for this task and disable plan mode after resolving
          set(
            (state) => {
              const newPendingPlans = new Map(state.pendingPlans);
              const newPlanResolvers = new Map(state.planResolvers);
              newPendingPlans.delete(taskId);
              newPlanResolvers.delete(taskId);
              return {
                pendingPlans: newPendingPlans,
                planResolvers: newPlanResolvers,
                isPlanModeEnabled: false,
              };
            },
            false,
            'approvePlan'
          );

          // Sync with settings store for persistence
          useSettingsStore
            .getState()
            .setPlanModeEnabled(false)
            .catch((error) => {
              logger.error(
                '[PlanModeStore] Failed to persist plan mode state after approval:',
                error
              );
            });
        } else {
          logger.error('[PlanModeStore] No resolver found when approving plan', { taskId });
        }
      },

      rejectPlan: (taskId, feedback) => {
        const { pendingPlans, planResolvers } = get();
        const pendingPlan = pendingPlans.get(taskId);
        const planResolver = planResolvers.get(taskId);

        if (!pendingPlan) {
          logger.error('[PlanModeStore] No pending plan to reject', { taskId });
          return;
        }

        logger.info('[PlanModeStore] Rejecting plan', {
          taskId,
          planId: pendingPlan.planId,
          hasFeedback: !!feedback,
          feedbackLength: feedback?.length || 0,
        });

        if (planResolver) {
          planResolver({
            action: 'reject this plan, do not implement it',
            feedback,
          });

          // Clear state for this task after resolving
          set(
            (state) => {
              const newPendingPlans = new Map(state.pendingPlans);
              const newPlanResolvers = new Map(state.planResolvers);
              newPendingPlans.delete(taskId);
              newPlanResolvers.delete(taskId);
              return {
                pendingPlans: newPendingPlans,
                planResolvers: newPlanResolvers,
              };
            },
            false,
            'rejectPlan'
          );
        } else {
          logger.error('[PlanModeStore] No resolver found when rejecting plan', { taskId });
        }
      },

      clearPendingPlan: (taskId) => {
        logger.info('[PlanModeStore] Clearing pending plan', { taskId });

        set(
          (state) => {
            const newPendingPlans = new Map(state.pendingPlans);
            const newPlanResolvers = new Map(state.planResolvers);
            newPendingPlans.delete(taskId);
            newPlanResolvers.delete(taskId);
            return {
              pendingPlans: newPendingPlans,
              planResolvers: newPlanResolvers,
            };
          },
          false,
          'clearPendingPlan'
        );
      },

      getPendingPlan: (taskId) => {
        return get().pendingPlans.get(taskId) || null;
      },
    }),
    {
      name: 'plan-mode-store',
      enabled: import.meta.env.DEV,
    }
  )
);
