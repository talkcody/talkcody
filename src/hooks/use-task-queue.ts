import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useTaskQueueStore } from '@/stores/task-queue-store';

const EMPTY_QUEUE = [] as const;

export function useTaskQueue(projectId?: string | null) {
  const queue = useTaskQueueStore(
    useShallow((state) => {
      const normalizedProjectId = projectId ?? '';
      const items = normalizedProjectId ? state.getQueue(normalizedProjectId) : EMPTY_QUEUE;
      const head = items[0] ?? null;

      return {
        queue: items,
        queueHead: head,
        queueCount: items.length,
        hasQueuedItems: items.length > 0,
        isBlocked: head?.status === 'blocked',
      };
    })
  );

  const actions = useMemo(
    () => ({
      removeDraft: (draftId: string) => {
        if (!projectId) return;
        useTaskQueueStore.getState().removeDraft(projectId, draftId);
      },
      clearQueue: () => {
        if (!projectId) return;
        useTaskQueueStore.getState().clearProjectQueue(projectId);
      },
    }),
    [projectId]
  );

  return {
    ...queue,
    ...actions,
  };
}
