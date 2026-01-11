import { act, renderHook } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it, beforeEach } from 'vitest';
import { useExecutionStore } from '@/stores/execution-store';
import { useTaskStore } from '@/stores/task-store';
import type { Task } from '@/types/task';
import type { UIMessage } from '@/types/agent';
import { useTask } from './use-task';

const createTask = (id: string, title: string): Task => ({
  id,
  title,
  project_id: 'project-1',
  created_at: 1,
  updated_at: 1,
  message_count: 0,
  cost: 0,
  input_token: 0,
  output_token: 0,
});

const createMessage = (id: string, content: string): UIMessage => ({
  id,
  role: 'assistant',
  content,
  timestamp: new Date(),
  isStreaming: false,
});

const resetStores = () => {
  useExecutionStore.setState({ executions: new Map() });
  useTaskStore.setState({
    tasks: [],
    runningTaskUsage: new Map(),
    messages: new Map(),
    loadingMessages: new Set(),
    currentTaskId: null,
  });
};

describe('useTask selectors', () => {
  beforeEach(() => {
    resetStores();
  });

  it('does not rerender when other task messages update', () => {
    const taskA = createTask('task-a', 'Task A');
    const taskB = createTask('task-b', 'Task B');

    const messages = new Map<string, UIMessage[]>();
    messages.set('task-a', [createMessage('a1', 'hello a')]);
    messages.set('task-b', [createMessage('b1', 'hello b')]);

    useTaskStore.setState({
      tasks: [taskA, taskB],
      messages,
    });

    const { result } = renderHook(() => {
      const renderCount = useRef(0);
      renderCount.current += 1;
      return { ...useTask('task-a'), renders: renderCount.current };
    });

    expect(result.current.renders).toBe(1);

    act(() => {
      useTaskStore.setState((state) => {
        const nextMessages = new Map(state.messages);
        const taskBMessages = nextMessages.get('task-b') || [];
        nextMessages.set('task-b', [...taskBMessages, createMessage('b2', 'more b')]);
        return { messages: nextMessages };
      });
    });

    expect(result.current.renders).toBe(1);
  });

  it('rerenders when current task messages update', () => {
    const taskA = createTask('task-a', 'Task A');

    useTaskStore.setState({
      tasks: [taskA],
      messages: new Map([['task-a', [createMessage('a1', 'hello a')]]]),
    });

    const { result } = renderHook(() => {
      const renderCount = useRef(0);
      renderCount.current += 1;
      return { ...useTask('task-a'), renders: renderCount.current };
    });

    expect(result.current.renders).toBe(1);

    act(() => {
      useTaskStore.setState((state) => {
        const nextMessages = new Map(state.messages);
        const taskAMessages = nextMessages.get('task-a') || [];
        nextMessages.set('task-a', [...taskAMessages, createMessage('a2', 'more a')]);
        return { messages: nextMessages };
      });
    });

    expect(result.current.renders).toBe(2);
  });

  it('returns stable messages reference while streaming content is unchanged', () => {
    const taskA = createTask('task-a', 'Task A');
    const streamingMessage: UIMessage = {
      id: 'msg-1',
      role: 'assistant',
      content: 'initial',
      timestamp: new Date(),
      isStreaming: true,
    };

    useTaskStore.setState({
      tasks: [taskA],
      messages: new Map([['task-a', [streamingMessage]]]),
    });

    const executions = new Map();
    executions.set('task-a', {
      taskId: 'task-a',
      status: 'running',
      abortController: new AbortController(),
      startTime: new Date(),
      streamingContent: 'partial update',
      isStreaming: true,
      serverStatus: '',
    });
    useExecutionStore.setState({
      executions,
    });

    const first = useTaskStore.getState().getMessages('task-a');
    const second = useTaskStore.getState().getMessages('task-a');

    expect(first[first.length - 1]?.content).toBe('partial update');
    expect(second).toBe(first);
  });

  it('returns stable task reference when running usage is unchanged', () => {
    const taskA = createTask('task-a', 'Task A');

    useTaskStore.setState({
      tasks: [taskA],
    });

    useTaskStore.getState().updateTaskUsage('task-a', {
      costDelta: 1,
      inputTokensDelta: 2,
      outputTokensDelta: 3,
    });

    const first = useTaskStore.getState().getTask('task-a');
    const second = useTaskStore.getState().getTask('task-a');

    expect(first).toBeDefined();
    expect(second).toBe(first);
  });

  it('returns stable task list reference when state is unchanged', () => {
    const taskA = createTask('task-a', 'Task A');
    const taskB = createTask('task-b', 'Task B');

    useTaskStore.setState({
      tasks: [taskA, taskB],
    });

    const firstList = useTaskStore.getState().getTaskList();
    const secondList = useTaskStore.getState().getTaskList();

    expect(firstList).toHaveLength(2);
    expect(secondList).toBe(firstList);
  });
});
