import { beforeEach, describe, expect, it } from 'vitest';
import { useTaskQueueStore } from './task-queue-store';

describe('task-queue-store', () => {
  beforeEach(() => {
    useTaskQueueStore.setState({ queuesByProjectId: new Map() });
  });

  it('enqueues drafts in FIFO order with queue positions', () => {
    const store = useTaskQueueStore.getState();

    const first = store.enqueueDraft({
      projectId: 'project-a',
      sourceTaskId: 'task-1',
      prompt: 'first prompt',
    });
    const second = store.enqueueDraft({
      projectId: 'project-a',
      sourceTaskId: 'task-1',
      prompt: 'second prompt',
    });

    const queue = store.getQueue('project-a');
    expect(queue).toHaveLength(2);
    expect(queue[0]?.id).toBe(first.id);
    expect(queue[0]?.queuePosition).toBe(1);
    expect(queue[1]?.id).toBe(second.id);
    expect(queue[1]?.queuePosition).toBe(2);
  });

  it('keeps project queues isolated', () => {
    const store = useTaskQueueStore.getState();

    store.enqueueDraft({
      projectId: 'project-a',
      sourceTaskId: 'task-1',
      prompt: 'first prompt',
    });
    store.enqueueDraft({
      projectId: 'project-b',
      sourceTaskId: 'task-2',
      prompt: 'second prompt',
    });

    expect(store.getQueue('project-a')).toHaveLength(1);
    expect(store.getQueue('project-b')).toHaveLength(1);
  });

  it('marks drafts blocked and removes started drafts', () => {
    const store = useTaskQueueStore.getState();

    const draft = store.enqueueDraft({
      projectId: 'project-a',
      sourceTaskId: 'task-1',
      prompt: 'blocked prompt',
    });

    store.markBlocked('project-a', draft.id, 'failed before start');
    expect(store.getHead('project-a')?.status).toBe('blocked');
    expect(store.getHead('project-a')?.blockedReason).toBe('failed before start');

    store.markStarting('project-a', draft.id, 'task-queued');
    store.dequeueStartedDraft('project-a', draft.id);
    expect(store.getHead('project-a')).toBeNull();
  });
});
