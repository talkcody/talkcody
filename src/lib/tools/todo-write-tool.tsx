import { z } from 'zod';
import { TodoWriteToolDoing } from '@/components/tools/todo-write-tool-doing';
import { TodoWriteToolResult } from '@/components/tools/todo-write-tool-result';
import { createTool } from '@/lib/create-tool';
import { logger } from '@/lib/logger';
import { fileTodoService } from '@/services/file-todo-service';
import { DESCRIPTION, PROMPT } from './todo-write-tool-prompt';

// Define the TodoItem interface to match the tool's expected format
export interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

// Convert tool TodoItem to file service CreateTodoItem format (without ID)
const convertToolTodoToFileTodo = (toolTodo: TodoItem): import('@/types').CreateTodoItem => {
  return {
    id: toolTodo.id,
    content: toolTodo.content,
    status: toolTodo.status,
  };
};

// Implementation of setTodos with task ID binding
const setTodos = async (taskId: string, todos: TodoItem[]): Promise<void> => {
  try {
    const fileTodos = todos.map(convertToolTodoToFileTodo);
    await fileTodoService.saveTodos(taskId, fileTodos);
  } catch (error) {
    logger.error('Error setting todos:', error);
    throw error;
  }
};

const TodoItemSchema = z.object({
  content: z.string().min(1).describe('The task description or content'),
  status: z.enum(['pending', 'in_progress', 'completed']).describe('Current status of the task'),
  id: z.string().min(1).describe('Unique identifier for the task'),
});

const inputSchema = z.strictObject({
  todos: z.array(TodoItemSchema).describe('The updated todo list'),
});

function validateTodos(todos: TodoItem[]): { isValid: boolean; error?: string } {
  // Check for duplicate IDs
  const ids = todos.map((todo) => todo.id);
  const uniqueIds = new Set(ids);
  if (ids.length !== uniqueIds.size) {
    return {
      isValid: false,
      error: 'Duplicate todo IDs found',
    };
  }

  // Check for multiple in_progress tasks
  const inProgressTasks = todos.filter((todo) => todo.status === 'in_progress');
  if (inProgressTasks.length > 1) {
    return {
      isValid: false,
      error: 'Only one task can be in_progress at a time',
    };
  }

  // Validate each todo
  for (const todo of todos) {
    if (!todo.content?.trim()) {
      return {
        isValid: false,
        error: `Todo with ID "${todo.id}" has empty content`,
      };
    }
    if (!['pending', 'in_progress', 'completed'].includes(todo.status)) {
      return {
        isValid: false,
        error: `Invalid status "${todo.status}" for todo "${todo.id}"`,
      };
    }
  }

  return { isValid: true };
}

// Execute function that will handle the todo updates
async function executeTodoWrite(
  params: z.infer<typeof inputSchema>,
  context: { taskId?: string; subagentId?: string }
) {
  const { todos } = params;

  // Validate todos
  const validation = validateTodos(todos as TodoItem[]);
  if (!validation.isValid) {
    throw new Error(validation.error || 'Invalid todo data');
  }

  const taskId = context?.taskId;
  if (!taskId) {
    logger.warn('No current task ID found');
    throw new Error('No current task ID found');
  }

  // Subagents share the parent taskId, so they need a stable per-subagent storage key.
  const persistenceKey = context.subagentId ?? taskId;

  // Store the todos
  await setTodos(persistenceKey, todos as TodoItem[]);

  return todos;
}

export const todoWriteTool = createTool({
  name: 'todoWrite',
  description: `${DESCRIPTION}\n${PROMPT}`,
  inputSchema,
  canConcurrent: false,
  execute: executeTodoWrite,
  renderToolDoing: (params: z.infer<typeof inputSchema>) => {
    return <TodoWriteToolDoing todos={params.todos} />;
  },
  renderToolResult: (result: unknown, _params: z.infer<typeof inputSchema>) => {
    const isError =
      result instanceof Error || (typeof result === 'string' && result.includes('Error'));

    if (isError) {
      return (
        <TodoWriteToolResult
          success={false}
          todos={[]}
          error={result instanceof Error ? result.message : result}
        />
      );
    }

    // Use the todos from the result (the return value of execute function)
    // This ensures we display the updated todos that were actually persisted
    const currentTodos = (result as TodoItem[]) || [];

    return <TodoWriteToolResult success={true} todos={currentTodos} />;
  },
});
