import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUserQuestionStore } from './user-question-store';
import type { AskUserQuestionsOutput, Question } from '@/types/user-question';

// Mock logger to avoid console noise
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

// Helper to create mock questions
function createMockQuestions(count = 1): Question[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `question-${i}`,
    question: `What is question ${i}?`,
    header: `Q${i}`,
    options: [
      { label: 'Option A', description: 'First option' },
      { label: 'Option B', description: 'Second option' },
    ],
    multiSelect: false,
  }));
}

// Helper to create mock answers
function createMockAnswers(questionIds: string[]): AskUserQuestionsOutput {
  const answers: AskUserQuestionsOutput = {};
  for (const id of questionIds) {
    answers[id] = {
      selectedOptions: ['Option A'],
      customText: undefined,
    };
  }
  return answers;
}

describe('UserQuestionStore - Concurrent Task Isolation', () => {
  beforeEach(() => {
    // Reset store to initial state
    useUserQuestionStore.setState({ pendingQuestions: new Map() });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('setPendingQuestions', () => {
    it('should store pending questions separately for different tasks', () => {
      const store = useUserQuestionStore.getState();
      const resolver1 = vi.fn();
      const resolver2 = vi.fn();

      const questions1 = createMockQuestions(2);
      const questions2 = createMockQuestions(3);

      store.setPendingQuestions('task-1', questions1, resolver1);
      store.setPendingQuestions('task-2', questions2, resolver2);

      const state = useUserQuestionStore.getState();
      expect(state.pendingQuestions.size).toBe(2);
      expect(state.pendingQuestions.get('task-1')?.pendingQuestions.length).toBe(2);
      expect(state.pendingQuestions.get('task-2')?.pendingQuestions.length).toBe(3);
    });

    it('should NOT overwrite other task pending questions when setting new one', () => {
      const store = useUserQuestionStore.getState();
      const resolver1 = vi.fn();
      const resolver2 = vi.fn();

      store.setPendingQuestions('task-1', createMockQuestions(1), resolver1);
      store.setPendingQuestions('task-2', createMockQuestions(1), resolver2);

      const state = useUserQuestionStore.getState();
      // Task 1's resolver should NOT be affected by Task 2's setPendingQuestions
      expect(state.pendingQuestions.get('task-1')?.resolver).toBe(resolver1);
      expect(state.pendingQuestions.get('task-2')?.resolver).toBe(resolver2);
    });

    it('should overwrite same task pending questions when setting new one', () => {
      const store = useUserQuestionStore.getState();
      const resolver1 = vi.fn();
      const resolver2 = vi.fn();

      store.setPendingQuestions('task-1', createMockQuestions(1), resolver1);
      store.setPendingQuestions('task-1', createMockQuestions(2), resolver2);

      const state = useUserQuestionStore.getState();
      expect(state.pendingQuestions.size).toBe(1);
      expect(state.pendingQuestions.get('task-1')?.pendingQuestions.length).toBe(2);
      expect(state.pendingQuestions.get('task-1')?.resolver).toBe(resolver2);
    });
  });

  describe('getPendingQuestions', () => {
    it('should return pending questions for existing task', () => {
      const store = useUserQuestionStore.getState();
      const questions = createMockQuestions(2);

      store.setPendingQuestions('task-1', questions, vi.fn());

      const entry = store.getPendingQuestions('task-1');
      expect(entry).not.toBeNull();
      expect(entry?.pendingQuestions.length).toBe(2);
      expect(entry?.pendingQuestions[0].id).toBe('question-0');
    });

    it('should return null for non-existent task', () => {
      const store = useUserQuestionStore.getState();
      const entry = store.getPendingQuestions('non-existent-task');
      expect(entry).toBeNull();
    });
  });

  describe('submitAnswers', () => {
    it('should only resolve the specific task pending questions', () => {
      const store = useUserQuestionStore.getState();
      const resolver1 = vi.fn();
      const resolver2 = vi.fn();

      store.setPendingQuestions('task-1', createMockQuestions(1), resolver1);
      store.setPendingQuestions('task-2', createMockQuestions(1), resolver2);

      const answers = createMockAnswers(['question-0']);
      store.submitAnswers('task-1', answers);

      expect(resolver1).toHaveBeenCalledWith(answers);
      expect(resolver2).not.toHaveBeenCalled();

      const state = useUserQuestionStore.getState();
      expect(state.pendingQuestions.has('task-1')).toBe(false);
      expect(state.pendingQuestions.has('task-2')).toBe(true);
    });

    it('should not throw when submitting answers for non-existent task', () => {
      const store = useUserQuestionStore.getState();
      const answers = createMockAnswers(['question-0']);

      // Should not throw, just log error
      expect(() => store.submitAnswers('non-existent-task', answers)).not.toThrow();
    });

    it('should clear pending questions after submitting', () => {
      const store = useUserQuestionStore.getState();
      const resolver = vi.fn();

      store.setPendingQuestions('task-1', createMockQuestions(1), resolver);

      const answers = createMockAnswers(['question-0']);
      store.submitAnswers('task-1', answers);

      const state = useUserQuestionStore.getState();
      expect(state.pendingQuestions.has('task-1')).toBe(false);
    });
  });

  describe('clearQuestions', () => {
    it('should only clear the specific task pending questions', () => {
      const store = useUserQuestionStore.getState();

      store.setPendingQuestions('task-1', createMockQuestions(1), vi.fn());
      store.setPendingQuestions('task-2', createMockQuestions(1), vi.fn());

      store.clearQuestions('task-1');

      const state = useUserQuestionStore.getState();
      expect(state.pendingQuestions.has('task-1')).toBe(false);
      expect(state.pendingQuestions.has('task-2')).toBe(true);
    });

    it('should not throw when clearing non-existent task', () => {
      const store = useUserQuestionStore.getState();
      expect(() => store.clearQuestions('non-existent-task')).not.toThrow();
    });
  });

  describe('concurrent scenarios', () => {
    it('should handle rapid sequential setPendingQuestions calls for different tasks', () => {
      const store = useUserQuestionStore.getState();
      const resolvers = Array.from({ length: 5 }, () => vi.fn());

      // Simulate 5 tasks setting pending questions in quick succession
      for (let i = 0; i < 5; i++) {
        store.setPendingQuestions(`task-${i}`, createMockQuestions(i + 1), resolvers[i]);
      }

      const state = useUserQuestionStore.getState();
      expect(state.pendingQuestions.size).toBe(5);

      // Each task should have its own pending questions
      for (let i = 0; i < 5; i++) {
        expect(state.pendingQuestions.get(`task-${i}`)?.pendingQuestions.length).toBe(i + 1);
        expect(state.pendingQuestions.get(`task-${i}`)?.resolver).toBe(resolvers[i]);
      }
    });

    it('should handle interleaved submit/clear operations correctly', () => {
      const store = useUserQuestionStore.getState();
      const resolver1 = vi.fn();
      const resolver2 = vi.fn();
      const resolver3 = vi.fn();

      store.setPendingQuestions('task-1', createMockQuestions(1), resolver1);
      store.setPendingQuestions('task-2', createMockQuestions(1), resolver2);
      store.setPendingQuestions('task-3', createMockQuestions(1), resolver3);

      // Interleaved operations
      store.submitAnswers('task-1', createMockAnswers(['question-0']));
      store.clearQuestions('task-2');
      store.submitAnswers('task-3', createMockAnswers(['question-0']));

      expect(resolver1).toHaveBeenCalled();
      expect(resolver2).not.toHaveBeenCalled(); // Cleared, not resolved
      expect(resolver3).toHaveBeenCalled();

      const state = useUserQuestionStore.getState();
      expect(state.pendingQuestions.size).toBe(0);
    });

    it('should preserve resolver identity across multiple operations', () => {
      const store = useUserQuestionStore.getState();
      const resolver1 = vi.fn();
      const resolver2 = vi.fn();

      // Set task-1
      store.setPendingQuestions('task-1', createMockQuestions(1), resolver1);

      // Set task-2 (should not affect task-1)
      store.setPendingQuestions('task-2', createMockQuestions(1), resolver2);

      // Submit task-2 (should not affect task-1's resolver)
      store.submitAnswers('task-2', createMockAnswers(['question-0']));

      // Now submit task-1 - should use original resolver1
      store.submitAnswers('task-1', createMockAnswers(['question-0']));

      expect(resolver1).toHaveBeenCalled();
      expect(resolver2).toHaveBeenCalled();
    });
  });

  describe('Promise resolution pattern', () => {
    it('should work with actual Promise pattern like tool execution', async () => {
      const store = useUserQuestionStore.getState();

      // Simulate how the tool would use it
      const resultPromise = new Promise<AskUserQuestionsOutput>((resolve) => {
        store.setPendingQuestions('task-1', createMockQuestions(1), resolve);
      });

      // Simulate user submitting answers
      const answers = createMockAnswers(['question-0']);
      store.submitAnswers('task-1', answers);

      // Promise should resolve with the answers
      const result = await resultPromise;
      expect(result).toEqual(answers);
    });

    it('should handle multiple concurrent Promise patterns', async () => {
      const store = useUserQuestionStore.getState();

      // Simulate two concurrent tool executions
      const promise1 = new Promise<AskUserQuestionsOutput>((resolve) => {
        store.setPendingQuestions('task-1', createMockQuestions(1), resolve);
      });

      const promise2 = new Promise<AskUserQuestionsOutput>((resolve) => {
        store.setPendingQuestions('task-2', createMockQuestions(2), resolve);
      });

      // Submit answers for both
      const answers1 = createMockAnswers(['question-0']);
      const answers2 = createMockAnswers(['question-0', 'question-1']);

      store.submitAnswers('task-1', answers1);
      store.submitAnswers('task-2', answers2);

      // Both should resolve correctly
      const [result1, result2] = await Promise.all([promise1, promise2]);

      expect(result1).toEqual(answers1);
      expect(result2).toEqual(answers2);
    });
  });
});
