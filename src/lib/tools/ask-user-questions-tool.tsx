import { z } from 'zod';
import { AskUserQuestionsResult } from '@/components/tools/ask-user-questions-result';
import { AskUserQuestionsUI } from '@/components/tools/ask-user-questions-ui';
import { createTool } from '@/lib/create-tool';
import { logger } from '@/lib/logger';
import { useUserQuestionStore } from '@/stores/user-question-store';
import type { ToolExecuteContext, ToolRenderContext } from '@/types/tool';
import type { AskUserQuestionsOutput } from '@/types/user-question';

// Zod schema for question option
const QuestionOptionSchema = z.object({
  label: z.string().min(1).describe('The label/text for this option'),
  description: z.string().min(1).describe('Description of what this option means'),
});

// Zod schema for a single question
const QuestionSchema = z.object({
  id: z.string().min(1).describe('Unique identifier for the question'),
  question: z.string().min(1).describe('The question text to ask the user'),
  header: z
    .string()
    .min(1)
    .max(20)
    .describe('Short header/title for the tab (recommended max 12 chars)'),
  options: z
    .array(QuestionOptionSchema)
    .min(2)
    .max(5)
    .describe('2-5 options for the user to choose from'),
  multiSelect: z.boolean().describe('Whether to allow multiple selections'),
});

// Input schema for the tool
const inputSchema = z.strictObject({
  questions: z.array(QuestionSchema).min(1).max(4).describe('1-4 questions to ask the user'),
});

/**
 * Execute function that pauses and waits for user input
 */
async function executeAskUserQuestions(
  params: z.infer<typeof inputSchema>,
  context?: ToolExecuteContext
): Promise<AskUserQuestionsOutput> {
  const { questions } = params;
  const taskId = context?.taskId || 'default';

  logger.info('[AskUserQuestions] Executing with questions:', {
    taskId,
    questionCount: questions.length,
    questionIds: questions.map((q) => q.id),
  });

  // Validate that question IDs are unique
  const ids = questions.map((q) => q.id);
  const uniqueIds = new Set(ids);
  if (ids.length !== uniqueIds.size) {
    throw new Error('Duplicate question IDs found');
  }

  // Create a Promise that will be resolved when user submits answers
  return new Promise<AskUserQuestionsOutput>((resolve) => {
    logger.info('[AskUserQuestions] Creating Promise and setting pending questions', { taskId });

    // Store the questions and resolver in the store with taskId
    // The UI component will call submitAnswers which will resolve this Promise
    useUserQuestionStore.getState().setPendingQuestions(taskId, questions, resolve);
  });
}

/**
 * AskUserQuestions Tool
 *
 * Allows the agent to ask the user questions and pause execution until
 * the user provides answers via the UI.
 */
export const askUserQuestionsTool = createTool({
  name: 'askUserQuestions',
  description: `Ask the user one or more questions to gather additional information needed to complete the task.

This tool should be used when you encounter ambiguities, need clarification, or require more details to proceed effectively. It allows for interactive problem-solving by enabling direct communication with the user.

Each question can have:
- 2-5 predefined options for the user to choose from
- Support for single or multiple selection
- An automatic "Other" option for custom text input

Use this tool judiciously to maintain a balance between gathering necessary information and avoiding excessive back-and-forth.
You could only use this tool when plan mode is enabled.`,
  inputSchema,
  canConcurrent: false,
  hidden: true,
  execute: executeAskUserQuestions,

  renderToolDoing: (params: z.infer<typeof inputSchema>, context?: ToolRenderContext) => {
    const taskId = context?.taskId || 'default';
    return <AskUserQuestionsUI questions={params.questions} taskId={taskId} />;
  },

  renderToolResult: (result: AskUserQuestionsOutput, params: z.infer<typeof inputSchema>) => {
    return <AskUserQuestionsResult answers={result} questions={params.questions} />;
  },
});
