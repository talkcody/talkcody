import { create } from 'zustand';
import { generateId } from '@/lib/utils';
import type { ProjectTaskQueueState, QueueDraftSnapshot, QueuedTaskDraft } from '@/types';

interface TaskQueueState {
  queuesByProjectId: Map<string, ProjectTaskQueueState>;
  enqueueDraft: (snapshot: QueueDraftSnapshot) => QueuedTaskDraft;
  updateDraft: (
    projectId: string,
    draftId: string,
    updates: Partial<QueuedTaskDraft>
  ) => QueuedTaskDraft | null;
  removeDraft: (projectId: string, draftId: string) => void;
  reorderDrafts: (projectId: string, orderedIds: string[]) => void;
  markBlocked: (projectId: string, draftId: string, reason: string) => void;
  markStarting: (projectId: string, draftId: string, taskId: string) => void;
  dequeueStartedDraft: (projectId: string, draftId: string) => void;
  clearProjectQueue: (projectId: string) => void;
  getQueue: (projectId: string) => QueuedTaskDraft[];
  getHead: (projectId: string) => QueuedTaskDraft | null;
  getQueueCount: (projectId: string) => number;
  hasQueuedItems: (projectId: string) => boolean;
}

function normalizeQueue(items: QueuedTaskDraft[]): QueuedTaskDraft[] {
  return items.map((item, index) => ({
    ...item,
    queuePosition: index + 1,
  }));
}

export const useTaskQueueStore = create<TaskQueueState>()((set, get) => ({
  queuesByProjectId: new Map(),

  enqueueDraft: (snapshot) => {
    const draft: QueuedTaskDraft = {
      id: generateId(),
      projectId: snapshot.projectId,
      sourceTaskId: snapshot.sourceTaskId,
      status: 'queued',
      prompt: snapshot.prompt,
      attachments: snapshot.attachments ?? [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      origin: snapshot.origin ?? 'composer_queue_button',
      queuePosition: 0,
      agentId: snapshot.agentId,
      model: snapshot.model,
      repositoryPath: snapshot.repositoryPath,
      selectedFile: snapshot.selectedFile,
      selectedFileContent: snapshot.selectedFileContent,
      planModeEnabled: snapshot.planModeEnabled,
      ralphLoopEnabled: snapshot.ralphLoopEnabled,
      worktreeEnabled: snapshot.worktreeEnabled,
    };

    set((state) => {
      const queuesByProjectId = new Map(state.queuesByProjectId);
      const projectQueue = queuesByProjectId.get(snapshot.projectId) ?? { items: [] };
      const items = normalizeQueue([...projectQueue.items, draft]);
      const nextDraft = items[items.length - 1] ?? draft;

      queuesByProjectId.set(snapshot.projectId, {
        ...projectQueue,
        items,
      });

      draft.queuePosition = nextDraft.queuePosition;
      return { queuesByProjectId };
    });

    return draft;
  },

  updateDraft: (projectId, draftId, updates) => {
    let updatedDraft: QueuedTaskDraft | null = null;

    set((state) => {
      const projectQueue = state.queuesByProjectId.get(projectId);
      if (!projectQueue) {
        return state;
      }

      const items = normalizeQueue(
        projectQueue.items.map((item) => {
          if (item.id !== draftId) {
            return item;
          }

          updatedDraft = {
            ...item,
            ...updates,
            updatedAt: Date.now(),
          };
          return updatedDraft;
        })
      );

      const queuesByProjectId = new Map(state.queuesByProjectId);
      queuesByProjectId.set(projectId, {
        ...projectQueue,
        items,
      });

      return { queuesByProjectId };
    });

    return updatedDraft;
  },

  removeDraft: (projectId, draftId) => {
    set((state) => {
      const projectQueue = state.queuesByProjectId.get(projectId);
      if (!projectQueue) {
        return state;
      }

      const nextItems = normalizeQueue(projectQueue.items.filter((item) => item.id !== draftId));
      const queuesByProjectId = new Map(state.queuesByProjectId);

      if (nextItems.length === 0) {
        queuesByProjectId.delete(projectId);
      } else {
        queuesByProjectId.set(projectId, {
          ...projectQueue,
          items: nextItems,
        });
      }

      return { queuesByProjectId };
    });
  },

  reorderDrafts: (projectId, orderedIds) => {
    set((state) => {
      const projectQueue = state.queuesByProjectId.get(projectId);
      if (!projectQueue) {
        return state;
      }

      const itemMap = new Map(projectQueue.items.map((item) => [item.id, item]));
      const nextItems = normalizeQueue(
        orderedIds
          .map((id) => itemMap.get(id))
          .filter((item): item is QueuedTaskDraft => Boolean(item))
      );

      const queuesByProjectId = new Map(state.queuesByProjectId);
      queuesByProjectId.set(projectId, {
        ...projectQueue,
        items: nextItems,
      });

      return { queuesByProjectId };
    });
  },

  markBlocked: (projectId, draftId, reason) => {
    get().updateDraft(projectId, draftId, {
      status: 'blocked',
      blockedReason: reason,
    });
  },

  markStarting: (projectId, draftId, taskId) => {
    get().updateDraft(projectId, draftId, {
      status: 'starting',
      materializedTaskId: taskId,
    });
  },

  dequeueStartedDraft: (projectId, draftId) => {
    set((state) => {
      const projectQueue = state.queuesByProjectId.get(projectId);
      if (!projectQueue) {
        return state;
      }

      const queuesByProjectId = new Map(state.queuesByProjectId);
      const nextItems = normalizeQueue(projectQueue.items.filter((item) => item.id !== draftId));

      if (nextItems.length === 0) {
        queuesByProjectId.delete(projectId);
      } else {
        queuesByProjectId.set(projectId, {
          ...projectQueue,
          items: nextItems,
          lastStartedAt: Date.now(),
        });
      }

      return { queuesByProjectId };
    });
  },

  clearProjectQueue: (projectId) => {
    set((state) => {
      const queuesByProjectId = new Map(state.queuesByProjectId);
      queuesByProjectId.delete(projectId);
      return { queuesByProjectId };
    });
  },

  getQueue: (projectId) => {
    return get().queuesByProjectId.get(projectId)?.items ?? [];
  },

  getHead: (projectId) => {
    return get().queuesByProjectId.get(projectId)?.items[0] ?? null;
  },

  getQueueCount: (projectId) => {
    return get().queuesByProjectId.get(projectId)?.items.length ?? 0;
  },

  hasQueuedItems: (projectId) => {
    return (get().queuesByProjectId.get(projectId)?.items.length ?? 0) > 0;
  },
}));
