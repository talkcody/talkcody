import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useTaskQueue } from '@/hooks/use-task-queue';
import { useTaskQueueStore } from '@/stores/task-queue-store';

describe('useTaskQueue', () => {
  beforeEach(() => {
    useTaskQueueStore.setState({
      queuesByProjectId: new Map(),
    });
  });

  it('returns a stable empty queue reference when projectId is missing', () => {
    const { result, rerender } = renderHook(({ projectId }: { projectId?: string | null }) =>
      useTaskQueue(projectId),
    {
      initialProps: { projectId: null },
    });

    const firstQueue = result.current.queue;
    expect(result.current.queueCount).toBe(0);
    expect(result.current.queueHead).toBeNull();

    rerender({ projectId: null });

    expect(result.current.queue).toBe(firstQueue);
    expect(result.current.queueCount).toBe(0);
    expect(result.current.hasQueuedItems).toBe(false);
  });

  it('returns the same backing queue array for an empty project queue across rerenders', () => {
    const { result, rerender } = renderHook(() => useTaskQueue('project-1'));

    const firstQueue = result.current.queue;
    rerender();

    expect(result.current.queue).toBe(firstQueue);
    expect(result.current.queueCount).toBe(0);
  });
});
