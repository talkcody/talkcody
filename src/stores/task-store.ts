// src/stores/task-store.ts
/**
 * TaskStore - Centralized task and message state management
 *
 * This store manages:
 * - Task list and current task selection
 * - Messages for all tasks (cached by taskId)
 * - Task usage tracking (cost, tokens)
 *
 * Design principles:
 * - Single source of truth for task and message data
 * - Synchronous state updates for immediate UI response
 * - Asynchronous persistence to database (fire-and-forget or awaited)
 */

import { create } from 'zustand';
import { logger } from '@/lib/logger';
import { generateId } from '@/lib/utils';
import { useExecutionStore } from '@/stores/execution-store';
import type { Task, TaskSettings } from '@/types';
import type { ToolMessageContent, UIMessage } from '@/types/agent';

// Stable empty array reference to avoid unnecessary re-renders
const EMPTY_MESSAGES: UIMessage[] = [];

interface StreamingMessagesCacheEntry {
  baseMessages: UIMessage[];
  derivedMessages: UIMessage[];
  streamingContent: string;
}

const streamingMessagesCache = new Map<string, StreamingMessagesCacheEntry>();

interface TaskUsageCacheEntry {
  baseTask: Task;
  runningUsage: RunningTaskUsage;
  derivedTask: Task;
}

const taskUsageCache = new Map<string, TaskUsageCacheEntry>();

interface TaskListCacheEntry {
  tasksRef: Task[];
  runningUsageRef: Map<string, RunningTaskUsage>;
  list: Task[];
}

let taskListCache: TaskListCacheEntry | null = null;

function mergeStreamingContent(
  taskId: string,
  baseMessages: UIMessage[],
  streamingContent: string
): UIMessage[] {
  const lastIndex = baseMessages.length - 1;
  if (lastIndex < 0) {
    streamingMessagesCache.delete(taskId);
    return baseMessages;
  }

  const lastMessage = baseMessages[lastIndex];
  if (!lastMessage || lastMessage.role !== 'assistant' || !lastMessage.isStreaming) {
    streamingMessagesCache.delete(taskId);
    return baseMessages;
  }

  const cached = streamingMessagesCache.get(taskId);
  if (
    cached &&
    cached.baseMessages === baseMessages &&
    cached.streamingContent === streamingContent
  ) {
    return cached.derivedMessages;
  }

  const derivedMessages = [...baseMessages];
  derivedMessages[lastIndex] = {
    ...lastMessage,
    content: streamingContent,
  } as UIMessage;

  streamingMessagesCache.set(taskId, {
    baseMessages,
    derivedMessages,
    streamingContent,
  });

  return derivedMessages;
}

function mergeTaskUsage(
  taskId: string,
  task: Task,
  runningUsage: RunningTaskUsage | undefined
): Task {
  if (!runningUsage) {
    taskUsageCache.delete(taskId);
    return task;
  }

  const cached = taskUsageCache.get(taskId);
  if (cached && cached.baseTask === task && cached.runningUsage === runningUsage) {
    return cached.derivedTask;
  }

  const derivedTask: Task = {
    ...task,
    request_count: task.request_count + runningUsage.requestCountDelta,
    cost: task.cost + runningUsage.costDelta,
    input_token: task.input_token + runningUsage.inputTokensDelta,
    output_token: task.output_token + runningUsage.outputTokensDelta,
    context_usage: runningUsage.contextUsage ?? task.context_usage,
  };
  taskUsageCache.set(taskId, {
    baseTask: task,
    runningUsage,
    derivedTask,
  });

  return derivedTask;
}

function sortTasksByTimeline(list: Task[]): Task[] {
  return list.sort((a, b) => {
    if (b.updated_at !== a.updated_at) {
      return b.updated_at - a.updated_at;
    }
    return b.created_at - a.created_at;
  });
}

function findTaskIndex(tasks: Task[], taskId: string): number {
  return tasks.findIndex((task) => task.id === taskId);
}

function upsertTasks(existing: Task[], incoming: Task[]): Task[] {
  if (incoming.length === 0) return existing;

  const next = [...existing];
  const indexById = new Map<string, number>();

  for (let i = 0; i < existing.length; i += 1) {
    const task = existing[i];
    if (task?.id) {
      indexById.set(task.id, i);
    }
  }

  for (const task of incoming) {
    const existingIndex = indexById.get(task.id);
    if (existingIndex === undefined) {
      indexById.set(task.id, next.length);
      next.push(task);
    } else {
      next[existingIndex] = task;
    }
  }

  return next;
}

function getTaskListWithCache(tasks: Task[], runningUsage: Map<string, RunningTaskUsage>): Task[] {
  if (
    taskListCache &&
    taskListCache.tasksRef === tasks &&
    taskListCache.runningUsageRef === runningUsage
  ) {
    return taskListCache.list;
  }

  const list = tasks.map((task) => mergeTaskUsage(task.id, task, runningUsage.get(task.id)));

  taskListCache = {
    tasksRef: tasks,
    runningUsageRef: runningUsage,
    list,
  };

  return list;
}

interface TaskUsageUpdate {
  costDelta?: number;
  inputTokensDelta?: number;
  outputTokensDelta?: number;
  requestCountDelta?: number;
  contextUsage?: number;
}

interface RunningTaskUsage {
  costDelta: number;
  inputTokensDelta: number;
  outputTokensDelta: number;
  requestCountDelta: number;
  contextUsage?: number;
}

interface TaskState {
  // Task list
  tasks: Task[];
  currentTaskId: string | null;

  // Runtime usage deltas for running tasks
  runningTaskUsage: Map<string, RunningTaskUsage>;

  // Messages (by taskId)
  messages: Map<string, UIMessage[]>;

  // Loading states
  loadingTasks: boolean;
  // Error state
  error: string | null;

  // ============================================
  // Task Actions
  // ============================================

  /**
   * Set tasks from database load
   */
  setTasks: (tasks: Task[]) => void;

  /**
   * Add a new task to the store
   */
  addTask: (task: Task) => void;

  /**
   * Add multiple tasks to the store (for pagination)
   */
  addTasks: (tasks: Task[]) => void;

  /**
   * Update a task
   */
  updateTask: (taskId: string, updates: Partial<Task>) => void;

  /**
   * Remove a task from the store
   */
  removeTask: (taskId: string) => void;

  /**
   * Set the current task ID
   */
  setCurrentTaskId: (taskId: string | null) => void;

  /**
   * Update task usage (cost, tokens) and context usage
   */
  updateTaskUsage: (taskId: string, usage: TaskUsageUpdate) => void;

  /**
   * Commit running usage deltas into the task record
   */
  flushRunningTaskUsage: (taskId: string) => void;

  /**
   * Clear running usage without touching task records
   */
  clearRunningTaskUsage: (taskId: string) => void;

  /**
   * Update task settings
   */
  updateTaskSettings: (taskId: string, settings: TaskSettings) => void;

  // ============================================
  // Message Actions
  // ============================================

  /**
   * Set messages for a task (from database load)
   */
  setMessages: (taskId: string, messages: UIMessage[]) => void;

  /**
   * Add a message to a task
   * Returns the message ID
   */
  addMessage: (taskId: string, message: UIMessage) => string;

  /**
   * Update a message
   */
  updateMessage: (taskId: string, messageId: string, updates: Partial<UIMessage>) => void;

  /**
   * Update message content (convenience method for streaming)
   */
  updateMessageContent: (
    taskId: string,
    messageId: string,
    content: string,
    isStreaming?: boolean
  ) => void;

  /**
   * Delete a message
   */
  deleteMessage: (taskId: string, messageId: string) => void;

  /**
   * Delete messages from a specific index onwards
   */
  deleteMessagesFromIndex: (taskId: string, index: number) => void;

  /**
   * Clear all messages for a task
   */
  clearMessages: (taskId: string) => void;

  /**
   * Stop streaming for all messages in a task
   */
  stopStreaming: (taskId: string) => void;

  /**
   * Add a nested tool message to a parent tool message
   */
  addNestedToolMessage: (
    taskId: string,
    parentToolCallId: string,
    nestedMessage: UIMessage
  ) => void;

  // ============================================
  // Loading State Actions
  // ============================================

  setLoadingTasks: (loading: boolean) => void;
  setError: (error: string | null) => void;

  // ============================================
  // Selectors (pure functions)
  // ============================================

  /**
   * Get a task by ID
   */
  getTask: (taskId: string) => Task | undefined;

  /**
   * Get all tasks as array (sorted by updatedAt desc)
   */
  getTaskList: () => Task[];

  /**
   * Get messages for a task
   */
  getMessages: (taskId: string) => UIMessage[];

  /**
   * Find message index by ID
   */
  findMessageIndex: (taskId: string, messageId: string) => number;

  /**
   * Get the last user message for a task
   */
  getLastUserMessage: (taskId: string) => UIMessage | null;
}

export const useTaskStore = create<TaskState>()((set, get) => ({
  tasks: [],
  currentTaskId: null,
  runningTaskUsage: new Map(),
  messages: new Map(),
  loadingTasks: false,
  error: null,

  // ============================================
  // Task Actions
  // ============================================

  setTasks: (tasks) => {
    set(() => {
      const sortedTasks = sortTasksByTimeline([...tasks]);
      return { tasks: sortedTasks };
    });
  },

  addTask: (task) => {
    set((state) => {
      const nextTasks = upsertTasks(state.tasks, [task]);
      return { tasks: sortTasksByTimeline([...nextTasks]) };
    });
  },

  addTasks: (tasks) => {
    set((state) => {
      const nextTasks = upsertTasks(state.tasks, tasks);
      return { tasks: sortTasksByTimeline([...nextTasks]) };
    });
  },

  updateTask: (taskId, updates) => {
    set((state) => {
      const index = findTaskIndex(state.tasks, taskId);
      if (index < 0) return state;

      const nextTasks = [...state.tasks];
      const task = nextTasks[index]!;
      nextTasks[index] = { ...task, ...updates };

      return { tasks: sortTasksByTimeline(nextTasks) };
    });
  },

  removeTask: (taskId) => {
    set((state) => {
      const tasks = state.tasks.filter((task) => task.id !== taskId);
      const messages = new Map(state.messages);
      const runningTaskUsage = new Map(state.runningTaskUsage);

      messages.delete(taskId);
      runningTaskUsage.delete(taskId);
      taskUsageCache.delete(taskId);

      // Clear current task if it was deleted
      const newCurrentTaskId = state.currentTaskId === taskId ? null : state.currentTaskId;

      return {
        tasks,
        messages,
        runningTaskUsage,
        currentTaskId: newCurrentTaskId,
      };
    });
  },

  setCurrentTaskId: (taskId) => {
    set({ currentTaskId: taskId });
  },

  updateTaskUsage: (taskId, usage) => {
    set((state) => {
      const index = findTaskIndex(state.tasks, taskId);
      if (index < 0) return state;

      const runningTaskUsage = new Map(state.runningTaskUsage);
      const existing = runningTaskUsage.get(taskId) || {
        costDelta: 0,
        inputTokensDelta: 0,
        outputTokensDelta: 0,
        requestCountDelta: 0,
      };

      const nextUsage: RunningTaskUsage = {
        costDelta: existing.costDelta + (usage.costDelta ?? 0),
        inputTokensDelta: existing.inputTokensDelta + (usage.inputTokensDelta ?? 0),
        outputTokensDelta: existing.outputTokensDelta + (usage.outputTokensDelta ?? 0),
        requestCountDelta: existing.requestCountDelta + (usage.requestCountDelta ?? 0),
        contextUsage: usage.contextUsage ?? existing.contextUsage,
      };

      runningTaskUsage.set(taskId, nextUsage);
      return { runningTaskUsage };
    });
  },

  flushRunningTaskUsage: (taskId) => {
    set((state) => {
      const index = findTaskIndex(state.tasks, taskId);
      if (index < 0) return state;

      const delta = state.runningTaskUsage.get(taskId);
      if (!delta) return state;

      const nextTasks = [...state.tasks];
      const task = nextTasks[index]!;
      nextTasks[index] = {
        ...task,
        request_count: task.request_count + delta.requestCountDelta,
        cost: task.cost + delta.costDelta,
        input_token: task.input_token + delta.inputTokensDelta,
        output_token: task.output_token + delta.outputTokensDelta,
        context_usage: delta.contextUsage ?? task.context_usage,
      };

      const runningTaskUsage = new Map(state.runningTaskUsage);
      runningTaskUsage.delete(taskId);

      return { tasks: sortTasksByTimeline(nextTasks), runningTaskUsage };
    });
  },

  clearRunningTaskUsage: (taskId) => {
    set((state) => {
      if (!state.runningTaskUsage.has(taskId)) return state;
      const runningTaskUsage = new Map(state.runningTaskUsage);
      runningTaskUsage.delete(taskId);
      return { runningTaskUsage };
    });
  },

  updateTaskSettings: (taskId, settings) => {
    set((state) => {
      const index = findTaskIndex(state.tasks, taskId);
      if (index < 0) return state;

      const nextTasks = [...state.tasks];
      const task = nextTasks[index]!;
      const existingSettings: TaskSettings = task.settings ? JSON.parse(task.settings) : {};
      nextTasks[index] = {
        ...task,
        settings: JSON.stringify({ ...existingSettings, ...settings }),
      };
      return { tasks: sortTasksByTimeline(nextTasks) };
    });
  },

  // ============================================
  // Message Actions
  // ============================================

  setMessages: (taskId, messages) => {
    set((state) => {
      const existingMessages = state.messages.get(taskId) || [];

      const loadedIds = new Set(messages.map((m) => m.id));
      const pendingMessages = existingMessages.filter((m) => !loadedIds.has(m.id));

      const merged = [...messages, ...pendingMessages];
      merged.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      const messagesMap = new Map(state.messages);
      messagesMap.set(taskId, merged);
      return { messages: messagesMap };
    });
  },

  addMessage: (taskId, message) => {
    const messageId = message.id || generateId();
    const fullMessage = { ...message, id: messageId };

    set((state) => {
      const existing = state.messages.get(taskId) || [];
      const messagesMap = new Map(state.messages);
      messagesMap.set(taskId, [...existing, fullMessage]);

      // Only update timestamp for user messages
      const index = findTaskIndex(state.tasks, taskId);
      if (index >= 0 && message.role === 'user') {
        const nextTasks = [...state.tasks];
        const task = nextTasks[index]!;
        nextTasks[index] = {
          ...task,
          updated_at: Date.now(),
          message_count: (task.message_count ?? 0) + 1,
        };
        return {
          messages: messagesMap,
          tasks: sortTasksByTimeline(nextTasks),
        };
      }

      return {
        messages: messagesMap,
      };
    });

    return messageId;
  },

  updateMessage: (taskId, messageId, updates) => {
    set((state) => {
      const messages = state.messages.get(taskId);
      if (!messages) return state;

      const index = messages.findIndex((msg) => msg.id === messageId);
      if (index < 0) return state;

      const updatedMessages = [...messages];
      updatedMessages[index] = { ...updatedMessages[index], ...updates } as UIMessage;

      const messagesMap = new Map(state.messages);
      messagesMap.set(taskId, updatedMessages);
      return { messages: messagesMap };
    });
  },

  updateMessageContent: (taskId, messageId, content, isStreaming = false) => {
    set((state) => {
      const messages = state.messages.get(taskId);
      if (!messages) return state;

      const index = messages.findIndex((msg) => msg.id === messageId);
      if (index < 0) return state;

      const updatedMessages = [...messages];
      updatedMessages[index] = {
        ...updatedMessages[index],
        content,
        isStreaming,
      } as UIMessage;

      const messagesMap = new Map(state.messages);
      messagesMap.set(taskId, updatedMessages);
      return { messages: messagesMap };
    });
  },

  deleteMessage: (taskId, messageId) => {
    set((state) => {
      const messages = state.messages.get(taskId);
      if (!messages) return state;

      const messagesMap = new Map(state.messages);
      messagesMap.set(
        taskId,
        messages.filter((msg) => msg.id !== messageId)
      );
      return { messages: messagesMap };
    });
  },

  deleteMessagesFromIndex: (taskId, index) => {
    set((state) => {
      const messages = state.messages.get(taskId);
      if (!messages) return state;

      const messagesMap = new Map(state.messages);
      messagesMap.set(taskId, messages.slice(0, index));
      return { messages: messagesMap };
    });
  },

  clearMessages: (taskId) => {
    set((state) => {
      const messagesMap = new Map(state.messages);
      messagesMap.set(taskId, []);
      return { messages: messagesMap };
    });
  },

  stopStreaming: (taskId) => {
    set((state) => {
      const messages = state.messages.get(taskId);
      if (!messages) return state;

      const updatedMessages = messages.map((msg) => {
        const updates: Partial<UIMessage> = {};

        if ('isStreaming' in msg && msg.isStreaming) {
          updates.isStreaming = false;
        }
        if ('renderDoingUI' in msg && msg.renderDoingUI) {
          updates.renderDoingUI = false;
        }

        return Object.keys(updates).length > 0 ? { ...msg, ...updates } : msg;
      });
      const messagesMap = new Map(state.messages);
      messagesMap.set(taskId, updatedMessages);
      return { messages: messagesMap };
    });
  },

  addNestedToolMessage: (taskId, parentToolCallId, nestedMessage) => {
    set((state) => {
      const messages = state.messages.get(taskId);
      if (!messages) {
        logger.warn('[TaskStore] No messages found for task:', taskId);
        return state;
      }

      let foundParent = false;
      const updatedMessages = messages.map((msg) => {
        // Find parent tool message by toolCallId (stored in content for tool messages)
        const isToolMessage = msg.role === 'tool';
        const toolContent = isToolMessage && Array.isArray(msg.content) ? msg.content[0] : null;
        const msgToolCallId = (toolContent as ToolMessageContent | null)?.toolCallId;

        if (isToolMessage && msgToolCallId === parentToolCallId) {
          foundParent = true;
          const existingNested = msg.nestedTools || [];
          const existingIndex = existingNested.findIndex((t) => t.id === nestedMessage.id);

          let updatedNested: UIMessage[];
          if (existingIndex >= 0) {
            updatedNested = [...existingNested];
            updatedNested[existingIndex] = nestedMessage;
          } else {
            updatedNested = [...existingNested, nestedMessage];
          }

          return { ...msg, nestedTools: updatedNested };
        }
        return msg;
      });

      if (!foundParent) {
        logger.warn('[TaskStore] Parent message NOT FOUND for toolCallId:', parentToolCallId);
      }

      const messagesMap = new Map(state.messages);
      messagesMap.set(taskId, updatedMessages);
      return { messages: messagesMap };
    });
  },

  // ============================================
  // Loading State Actions
  // ============================================

  setLoadingTasks: (loading) => {
    set({ loadingTasks: loading });
  },

  setError: (error) => {
    set({ error });
  },

  // ============================================
  // Selectors
  // ============================================

  getTask: (taskId) => {
    const index = findTaskIndex(get().tasks, taskId);
    if (index < 0) return undefined;

    const task = get().tasks[index]!;
    return mergeTaskUsage(taskId, task, get().runningTaskUsage.get(taskId));
  },

  getTaskList: () => {
    const { tasks, runningTaskUsage } = get();
    return getTaskListWithCache(tasks, runningTaskUsage);
  },

  getMessages: (taskId) => {
    const messages = get().messages.get(taskId) || EMPTY_MESSAGES;
    const execution = useExecutionStore.getState().getExecution(taskId);
    const streamingContent = execution?.streamingContent;
    const isRunning = execution?.status === 'running';

    if (!streamingContent || !isRunning) {
      streamingMessagesCache.delete(taskId);
      return messages;
    }

    return mergeStreamingContent(taskId, messages, streamingContent);
  },

  findMessageIndex: (taskId, messageId) => {
    const messages = get().messages.get(taskId) || [];
    return messages.findIndex((msg) => msg.id === messageId);
  },

  getLastUserMessage: (taskId) => {
    const messages = get().messages.get(taskId) || [];
    const userMessages = messages.filter((msg) => msg.role === 'user');
    return userMessages.length > 0 ? (userMessages[userMessages.length - 1] ?? null) : null;
  },
}));

// Export store instance for direct access in non-React contexts
export const taskStore = useTaskStore;
