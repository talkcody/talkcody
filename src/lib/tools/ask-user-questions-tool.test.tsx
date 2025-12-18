import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { askUserQuestionsTool } from './ask-user-questions-tool';
import type { AskUserQuestionsOutput } from '@/types/user-question';

// Mock dependencies
const mockStoreState = {
  setPendingQuestions: vi.fn(),
  submitAnswers: vi.fn(),
  clearQuestions: vi.fn(),
  pendingQuestions: [],
  resolver: null,
};

vi.mock('@/stores/user-question-store', () => ({
  useUserQuestionStore: Object.assign(
    // Mock as a function (for selector usage in components)
    vi.fn((selector) => {
      if (typeof selector === 'function') {
        return selector(mockStoreState);
      }
      return mockStoreState;
    }),
    {
      // Also provide getState for direct access
      getState: vi.fn(() => mockStoreState),
    }
  ),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/stores/settings-store', () => ({
  useSettingsStore: vi.fn((selector) => {
    const state = { language: 'en' };
    if (typeof selector === 'function') {
      return selector(state);
    }
    return state;
  }),
}));

import { logger } from '@/lib/logger';
import { useUserQuestionStore } from '@/stores/user-question-store';

const mockLogger = logger as any;

describe('askUserQuestionsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock functions
    mockStoreState.setPendingQuestions = vi.fn();
    mockStoreState.submitAnswers = vi.fn();
    mockStoreState.clearQuestions = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('basic tool properties', () => {
    it('should have correct name', () => {
      expect(askUserQuestionsTool.name).toBe('askUserQuestions');
    });

    it('should have description', () => {
      expect(askUserQuestionsTool.description).toBeTruthy();
      expect(typeof askUserQuestionsTool.description).toBe('string');
      expect(askUserQuestionsTool.description).toContain('question');
    });

    it('should have inputSchema', () => {
      expect(askUserQuestionsTool.inputSchema).toBeTruthy();
    });

    it('should have execute function', () => {
      expect(askUserQuestionsTool.execute).toBeTruthy();
      expect(typeof askUserQuestionsTool.execute).toBe('function');
    });

    it('should not allow concurrent execution', () => {
      expect(askUserQuestionsTool.canConcurrent).toBe(false);
    });
  });

  describe('input validation', () => {
    it('should validate input schema correctly for valid questions', () => {
      const validInput = {
        questions: [
          {
            id: 'q1',
            question: 'What is your favorite color?',
            header: 'Color',
            options: [
              { label: 'Red', description: 'The color red' },
              { label: 'Blue', description: 'The color blue' },
            ],
            multiSelect: false,
          },
        ],
      };

      const result = askUserQuestionsTool.inputSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should reject questions with less than 2 options', () => {
      const invalidInput = {
        questions: [
          {
            id: 'q1',
            question: 'What is your favorite color?',
            header: 'Color',
            options: [{ label: 'Red', description: 'The color red' }],
            multiSelect: false,
          },
        ],
      };

      const result = askUserQuestionsTool.inputSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject questions with more than 5 options', () => {
      const invalidInput = {
        questions: [
          {
            id: 'q1',
            question: 'What is your favorite color?',
            header: 'Color',
            options: [
              { label: 'Red', description: 'Red' },
              { label: 'Blue', description: 'Blue' },
              { label: 'Green', description: 'Green' },
              { label: 'Yellow', description: 'Yellow' },
              { label: 'Purple', description: 'Purple' },
              { label: 'Orange', description: 'Orange' },
            ],
            multiSelect: false,
          },
        ],
      };

      const result = askUserQuestionsTool.inputSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject empty question ID', () => {
      const invalidInput = {
        questions: [
          {
            id: '',
            question: 'What is your favorite color?',
            header: 'Color',
            options: [
              { label: 'Red', description: 'Red' },
              { label: 'Blue', description: 'Blue' },
            ],
            multiSelect: false,
          },
        ],
      };

      const result = askUserQuestionsTool.inputSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject empty question text', () => {
      const invalidInput = {
        questions: [
          {
            id: 'q1',
            question: '',
            header: 'Color',
            options: [
              { label: 'Red', description: 'Red' },
              { label: 'Blue', description: 'Blue' },
            ],
            multiSelect: false,
          },
        ],
      };

      const result = askUserQuestionsTool.inputSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should accept multiple questions (up to 4)', () => {
      const validInput = {
        questions: [
          {
            id: 'q1',
            question: 'Question 1?',
            header: 'Q1',
            options: [
              { label: 'A', description: 'A' },
              { label: 'B', description: 'B' },
            ],
            multiSelect: false,
          },
          {
            id: 'q2',
            question: 'Question 2?',
            header: 'Q2',
            options: [
              { label: 'C', description: 'C' },
              { label: 'D', description: 'D' },
            ],
            multiSelect: true,
          },
        ],
      };

      const result = askUserQuestionsTool.inputSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should reject more than 4 questions', () => {
      const invalidInput = {
        questions: Array.from({ length: 5 }, (_, i) => ({
          id: `q${i + 1}`,
          question: `Question ${i + 1}?`,
          header: `Q${i + 1}`,
          options: [
            { label: 'A', description: 'A' },
            { label: 'B', description: 'B' },
          ],
          multiSelect: false,
        })),
      };

      const result = askUserQuestionsTool.inputSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });
  });

  describe('execution logic', () => {
    it('should reject duplicate question IDs', async () => {
      const input = {
        questions: [
          {
            id: 'duplicate-id',
            question: 'First question?',
            header: 'Q1',
            options: [
              { label: 'A', description: 'A' },
              { label: 'B', description: 'B' },
            ],
            multiSelect: false,
          },
          {
            id: 'duplicate-id',
            question: 'Second question?',
            header: 'Q2',
            options: [
              { label: 'C', description: 'C' },
              { label: 'D', description: 'D' },
            ],
            multiSelect: false,
          },
        ],
      };

      await expect(askUserQuestionsTool.execute?.(input)).rejects.toThrow(
        'Duplicate question IDs found'
      );
    });

    it('should call setPendingQuestions with questions and resolver', async () => {
      const input = {
        questions: [
          {
            id: 'q1',
            question: 'What is your favorite color?',
            header: 'Color',
            options: [
              { label: 'Red', description: 'Red' },
              { label: 'Blue', description: 'Blue' },
            ],
            multiSelect: false,
          },
        ],
      };

      // Execute the tool (it returns a Promise that won't resolve until user submits)
      // Note: execute now accepts optional context with taskId, defaults to 'default'
      const executePromise = askUserQuestionsTool.execute?.(input);

      // Wait for next tick to ensure setPendingQuestions is called
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Verify setPendingQuestions was called
      // New signature: (taskId, questions, resolver)
      expect(mockStoreState.setPendingQuestions).toHaveBeenCalledTimes(1);
      expect(mockStoreState.setPendingQuestions).toHaveBeenCalledWith(
        'default', // taskId defaults to 'default' when no context is provided
        input.questions,
        expect.any(Function)
      );

      // Simulate user submitting answers by calling the resolver
      // Resolver is now the third argument (index 2)
      const resolver = (mockStoreState.setPendingQuestions as any).mock.calls[0][2];
      const mockAnswers: AskUserQuestionsOutput = {
        q1: { selectedOptions: ['Red'], customText: undefined },
      };
      resolver(mockAnswers);

      // Now the promise should resolve with the answers
      const result = await executePromise;
      expect(result).toEqual(mockAnswers);
    });
  });

  describe('React component rendering', () => {
    it('should render AskUserQuestionsUI component', () => {
      const params = {
        questions: [
          {
            id: 'q1',
            question: 'What is your favorite color?',
            header: 'Color',
            options: [
              { label: 'Red', description: 'Red color' },
              { label: 'Blue', description: 'Blue color' },
            ],
            multiSelect: false,
          },
        ],
      };

      const component = askUserQuestionsTool.renderToolDoing?.(params);
      render(component);

      expect(screen.getByText('Please answer the following questions')).toBeInTheDocument();
      expect(screen.getByText('What is your favorite color?')).toBeInTheDocument();
    });

    it('should render AskUserQuestionsResult component', () => {
      const params = {
        questions: [
          {
            id: 'q1',
            question: 'What is your favorite color?',
            header: 'Color',
            options: [
              { label: 'Red', description: 'Red color' },
              { label: 'Blue', description: 'Blue color' },
            ],
            multiSelect: false,
          },
        ],
      };

      const result: AskUserQuestionsOutput = {
        q1: {
          selectedOptions: ['Red'],
          customText: 'Actually, I prefer dark red',
        },
      };

      const component = askUserQuestionsTool.renderToolResult?.(result, params);
      render(component);

      expect(screen.getByText('User Answers Received')).toBeInTheDocument();
      expect(screen.getByText('What is your favorite color?')).toBeInTheDocument();
      expect(screen.getByText('Red')).toBeInTheDocument();
      expect(screen.getByText('Actually, I prefer dark red')).toBeInTheDocument();
    });

    it('should handle multiple questions in result', () => {
      const params = {
        questions: [
          {
            id: 'q1',
            question: 'Favorite color?',
            header: 'Color',
            options: [
              { label: 'Red', description: 'Red' },
              { label: 'Blue', description: 'Blue' },
            ],
            multiSelect: false,
          },
          {
            id: 'q2',
            question: 'Favorite food?',
            header: 'Food',
            options: [
              { label: 'Pizza', description: 'Pizza' },
              { label: 'Pasta', description: 'Pasta' },
            ],
            multiSelect: true,
          },
        ],
      };

      const result: AskUserQuestionsOutput = {
        q1: { selectedOptions: ['Red'], customText: undefined },
        q2: { selectedOptions: ['Pizza', 'Pasta'], customText: undefined },
      };

      const component = askUserQuestionsTool.renderToolResult?.(result, params);
      render(component);

      expect(screen.getByText('Favorite color?')).toBeInTheDocument();
      expect(screen.getByText('Favorite food?')).toBeInTheDocument();
      expect(screen.getByText('Red')).toBeInTheDocument();
      expect(screen.getByText('Pizza')).toBeInTheDocument();
      expect(screen.getByText('Pasta')).toBeInTheDocument();
    });
  });
});
