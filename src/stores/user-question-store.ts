// src/stores/user-question-store.ts
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { logger } from '@/lib/logger';
import type { AskUserQuestionsOutput, Question } from '@/types/user-question';

/**
 * User Question Store
 *
 * Manages the state for AskUserQuestions tool.
 * Provides a mechanism to pause tool execution and wait for user input.
 *
 * IMPORTANT: This store supports multiple concurrent pending questions,
 * keyed by taskId to allow multiple tasks to have pending questions simultaneously.
 */

/**
 * Entry for a single pending question set, stored per taskId
 */
interface PendingQuestionEntry {
  pendingQuestions: Question[];
  resolver: (answers: AskUserQuestionsOutput) => void;
}

interface UserQuestionState {
  /** Map of pending questions, keyed by taskId */
  pendingQuestions: Map<string, PendingQuestionEntry>;

  /**
   * Set pending questions and the resolver function for a specific task
   * Called by the tool's execute function
   */
  setPendingQuestions: (
    taskId: string,
    questions: Question[],
    resolver: (answers: AskUserQuestionsOutput) => void
  ) => void;

  /**
   * Get pending questions for a specific task
   */
  getPendingQuestions: (taskId: string) => PendingQuestionEntry | null;

  /**
   * Submit user's answers for a specific task
   * Called by the UI component when user clicks submit
   */
  submitAnswers: (taskId: string, answers: AskUserQuestionsOutput) => void;

  /**
   * Clear pending questions and resolver for a specific task
   */
  clearQuestions: (taskId: string) => void;
}

export const useUserQuestionStore = create<UserQuestionState>()(
  devtools(
    (set, get) => ({
      pendingQuestions: new Map(),

      setPendingQuestions: (taskId, questions, resolver) => {
        logger.info('[UserQuestionStore] Setting pending questions', {
          taskId,
          questionCount: questions.length,
          questionIds: questions.map((q) => q.id),
        });

        set(
          (state) => {
            const newMap = new Map(state.pendingQuestions);
            newMap.set(taskId, {
              pendingQuestions: questions,
              resolver,
            });
            return { pendingQuestions: newMap };
          },
          false,
          'setPendingQuestions'
        );
      },

      getPendingQuestions: (taskId) => {
        return get().pendingQuestions.get(taskId) || null;
      },

      submitAnswers: (taskId, answers) => {
        const entry = get().pendingQuestions.get(taskId);

        logger.info('[UserQuestionStore] Submitting answers', {
          taskId,
          answerCount: Object.keys(answers).length,
          questionIds: Object.keys(answers),
        });

        if (entry) {
          entry.resolver(answers);

          // Clear state for this task after resolving
          set(
            (state) => {
              const newMap = new Map(state.pendingQuestions);
              newMap.delete(taskId);
              return { pendingQuestions: newMap };
            },
            false,
            'submitAnswers'
          );
        } else {
          logger.error('[UserQuestionStore] No pending questions found for task', { taskId });
        }
      },

      clearQuestions: (taskId) => {
        logger.info('[UserQuestionStore] Clearing questions', { taskId });

        set(
          (state) => {
            const newMap = new Map(state.pendingQuestions);
            newMap.delete(taskId);
            return { pendingQuestions: newMap };
          },
          false,
          'clearQuestions'
        );
      },
    }),
    {
      name: 'user-question-store',
      enabled: import.meta.env.DEV,
    }
  )
);
