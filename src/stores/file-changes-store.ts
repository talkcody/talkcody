import { create } from 'zustand';

export interface FileChange {
  toolId: string;
  filePath: string;
  operation: 'write' | 'edit';
  timestamp: number;
  originalContent?: string; // For edit operations, to show diff
  newContent?: string; // For edit operations, to show diff
}

interface FileChangesStore {
  changesByTask: Map<string, FileChange[]>;

  // Add a file change for a task
  addChange: (
    taskId: string,
    toolId: string,
    filePath: string,
    operation: 'write' | 'edit',
    originalContent?: string,
    newContent?: string
  ) => void;

  // Get all changes for a specific task
  getChanges: (taskId: string) => FileChange[];

  // Clear changes for a specific task
  clearTask: (taskId: string) => void;

  // Clear all changes
  clearAll: () => void;
}

export const useFileChangesStore = create<FileChangesStore>((set, get) => ({
  changesByTask: new Map(),

  addChange: (taskId, toolId, filePath, operation, originalContent, newContent) => {
    set((state) => {
      const newMap = new Map(state.changesByTask);
      const existing = newMap.get(taskId) || [];

      const newChange: FileChange = {
        toolId,
        filePath,
        operation,
        timestamp: Date.now(),
        originalContent,
        newContent,
      };

      // Always append new change to support multiple changes to the same file
      newMap.set(taskId, [...existing, newChange]);

      return { changesByTask: newMap };
    });
  },

  getChanges: (taskId) => {
    return get().changesByTask.get(taskId) || [];
  },

  clearTask: (taskId) => {
    set((state) => {
      const newMap = new Map(state.changesByTask);
      newMap.delete(taskId);
      return { changesByTask: newMap };
    });
  },

  clearAll: () => {
    set({ changesByTask: new Map() });
  },
}));
