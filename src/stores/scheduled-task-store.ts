// src/stores/scheduled-task-store.ts

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { create } from 'zustand';
import { logger } from '@/lib/logger';
import { executionService } from '@/services/execution-service';
import { notificationService } from '@/services/notification-service';
import { scheduledTaskDeliveryService } from '@/services/scheduled-tasks/scheduled-task-delivery-service';
import { taskService } from '@/services/task-service';
import { useSettingsStore } from '@/stores/settings-store';
import type {
  CreateScheduledTaskInput,
  DEFAULT_DELIVERY_POLICY,
  DEFAULT_EXECUTION_POLICY,
  DEFAULT_NOTIFICATION_POLICY,
  DEFAULT_OFFLINE_POLICY,
  DEFAULT_RETRY_POLICY,
  ScheduledTask,
  ScheduledTaskRun,
  ScheduledTaskRunCompletePayload,
  ScheduledTaskSchedule,
  ScheduledTaskStatsSummary,
  ScheduledTaskTriggerEvent,
  UpdateScheduledTaskInput,
} from '@/types/scheduled-task';

interface ScheduledTaskState {
  tasks: ScheduledTask[];
  runs: Map<string, ScheduledTaskRun[]>;
  isLoading: boolean;
  stats: ScheduledTaskStatsSummary | null;
  cronPreview: Array<{ rawAt: number; jitteredAt: number; jitterMs: number }>;

  loadTasks: (projectId?: string) => Promise<void>;
  createTask: (data: CreateScheduledTaskInput) => Promise<ScheduledTask>;
  updateTask: (id: string, patch: UpdateScheduledTaskInput) => Promise<ScheduledTask>;
  deleteTask: (id: string) => Promise<void>;
  enableTask: (id: string) => Promise<ScheduledTask>;
  disableTask: (id: string) => Promise<ScheduledTask>;
  triggerNow: (id: string) => Promise<string>;
  loadRuns: (jobId: string) => Promise<void>;
  loadStats: () => Promise<void>;
  previewCron: (
    schedule: ScheduledTaskSchedule,
    executionPolicy?: { staggerMs?: number }
  ) => Promise<void>;
  syncOfflineRunner: (enabled: boolean) => Promise<void>;
  claimPendingRuns: () => Promise<void>;
  _onTrigger: (event: ScheduledTaskTriggerEvent) => Promise<void>;
}

const DEFAULTS = {
  executionPolicy: { maxConcurrentRuns: 1, catchUp: false, staggerMs: -1 },
  retryPolicy: { maxAttempts: 2, backoffMs: [30_000, 60_000] },
  notificationPolicy: { notifyOnSuccess: false, notifyOnFailure: true },
  deliveryPolicy: { enabled: false },
  offlinePolicy: { enabled: false, minuteGranularity: 1 },
};

export const useScheduledTaskStore = create<ScheduledTaskState>((set, get) => ({
  tasks: [],
  runs: new Map(),
  isLoading: false,
  stats: null,
  cronPreview: [],

  loadTasks: async (projectId?: string) => {
    set({ isLoading: true });
    try {
      const tasks = await invoke<ScheduledTask[]>('list_scheduled_tasks', {
        projectId: projectId ?? null,
      });
      set({ tasks });
    } catch (err) {
      logger.error('[ScheduledTaskStore] loadTasks error:', err);
    } finally {
      set({ isLoading: false });
    }
  },

  createTask: async (data: CreateScheduledTaskInput) => {
    const task = await invoke<ScheduledTask>('create_scheduled_task', {
      request: {
        name: data.name,
        description: data.description ?? null,
        projectId: data.projectId ?? null,
        schedule: data.schedule,
        scheduleNlText: data.scheduleNlText ?? null,
        payload: data.payload,
        executionPolicy: {
          ...DEFAULTS.executionPolicy,
          ...data.executionPolicy,
        },
        retryPolicy: {
          ...DEFAULTS.retryPolicy,
          ...data.retryPolicy,
        },
        notificationPolicy: {
          ...DEFAULTS.notificationPolicy,
          ...data.notificationPolicy,
        },
        deliveryPolicy: {
          ...DEFAULTS.deliveryPolicy,
          ...data.deliveryPolicy,
        },
        offlinePolicy: {
          ...DEFAULTS.offlinePolicy,
          ...data.offlinePolicy,
        },
      },
    });
    set((state) => ({ tasks: [task, ...state.tasks] }));
    if (task.offlinePolicy?.enabled) {
      await get().syncOfflineRunner(true);
    }
    return task;
  },

  updateTask: async (id: string, patch: UpdateScheduledTaskInput) => {
    const updated = await invoke<ScheduledTask>('update_scheduled_task', {
      id,
      request: patch,
    });
    set((state) => ({ tasks: state.tasks.map((t) => (t.id === id ? updated : t)) }));
    await get().syncOfflineRunner(get().tasks.some((task) => task.offlinePolicy?.enabled));
    return updated;
  },

  deleteTask: async (id: string) => {
    await invoke<void>('delete_scheduled_task', { id });
    set((state) => ({ tasks: state.tasks.filter((t) => t.id !== id) }));
    await get().syncOfflineRunner(
      get().tasks.some((task) => task.id !== id && task.offlinePolicy?.enabled)
    );
  },

  enableTask: async (id: string) => get().updateTask(id, { status: 'enabled' }),
  disableTask: async (id: string) => get().updateTask(id, { status: 'disabled' }),

  triggerNow: async (id: string) => invoke<string>('trigger_scheduled_task_now', { jobId: id }),

  loadRuns: async (jobId: string) => {
    try {
      const runs = await invoke<ScheduledTaskRun[]>('list_scheduled_task_runs', {
        jobId,
        limit: 50,
      });
      set((state) => {
        const next = new Map(state.runs);
        next.set(jobId, runs);
        return { runs: next };
      });
    } catch (err) {
      logger.error('[ScheduledTaskStore] loadRuns error:', err);
    }
  },

  loadStats: async () => {
    try {
      const stats = await invoke<ScheduledTaskStatsSummary>('get_scheduled_task_stats');
      set({ stats });
    } catch (err) {
      logger.error('[ScheduledTaskStore] loadStats error:', err);
    }
  },

  previewCron: async (
    schedule: ScheduledTaskSchedule,
    executionPolicy?: { staggerMs?: number }
  ) => {
    try {
      const cronPreview = await invoke<
        Array<{ rawAt: number; jitteredAt: number; jitterMs: number }>
      >('preview_scheduled_task_cron', {
        schedule,
        executionPolicy: {
          ...DEFAULTS.executionPolicy,
          ...(executionPolicy ?? {}),
        },
        count: 5,
      });
      set({ cronPreview });
    } catch (err) {
      logger.error('[ScheduledTaskStore] previewCron error:', err);
      set({ cronPreview: [] });
    }
  },

  syncOfflineRunner: async (enabled: boolean) => {
    try {
      await invoke('scheduled_task_runner_sync', { enabled });
    } catch (err) {
      logger.error('[ScheduledTaskStore] syncOfflineRunner error:', err);
    }
  },

  claimPendingRuns: async () => {
    try {
      const runs = await invoke<ScheduledTaskRun[]>('claim_scheduled_task_runs');
      const tasks = get().tasks;
      for (const run of runs) {
        const job = tasks.find((task) => task.id === run.scheduledTaskId);
        if (!job) continue;
        await get()._onTrigger({
          jobId: job.id,
          runId: run.id,
          payload: job.payload,
          projectId: job.projectId,
        });
      }
    } catch (err) {
      logger.error('[ScheduledTaskStore] claimPendingRuns error:', err);
    }
  },

  _onTrigger: async (event: ScheduledTaskTriggerEvent) => {
    const { jobId, runId, payload, projectId } = event;
    logger.info('[ScheduledTaskStore] Job triggered:', { jobId, runId });

    try {
      const settingsState = useSettingsStore.getState();
      const model = payload.model ?? settingsState.model ?? '';
      const taskId = await taskService.createTask(payload.message, {
        projectId: projectId ?? undefined,
      });

      await executionService.startExecution({
        taskId,
        messages: [],
        model,
        isNewTask: true,
        userMessage: payload.message,
      });

      const currentJob = get().tasks.find((task) => task.id === jobId);
      const deliveryResult = await scheduledTaskDeliveryService.deliver({
        policy: currentJob?.deliveryPolicy,
        title: currentJob?.name ?? 'Scheduled Task',
        body: payload.message,
      });

      if (currentJob?.notificationPolicy?.notifyOnSuccess) {
        await notificationService.notifyScheduledTaskResult({
          taskName: currentJob.name,
          success: true,
          body: payload.message,
        });
      }

      const completePayload: ScheduledTaskRunCompletePayload = {
        jobId,
        runId,
        taskId,
        success: true,
        deliveryStatus: deliveryResult.status,
        deliveryError: deliveryResult.error,
      };
      await invoke<void>('report_scheduled_task_run_complete', { payload: completePayload });
      const updated = await invoke<ScheduledTask[]>('list_scheduled_tasks', { projectId: null });
      set({ tasks: updated });
      await get().loadStats();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error('[ScheduledTaskStore] Execution failed:', errMsg);
      const currentJob = get().tasks.find((task) => task.id === jobId);
      if (currentJob?.notificationPolicy?.notifyOnFailure) {
        await notificationService.notifyScheduledTaskResult({
          taskName: currentJob.name,
          success: false,
          body: errMsg,
        });
      }
      const failPayload: ScheduledTaskRunCompletePayload = {
        jobId,
        runId,
        taskId: null,
        success: false,
        error: errMsg,
      };
      try {
        await invoke<void>('report_scheduled_task_run_complete', { payload: failPayload });
      } catch (reportErr) {
        logger.error('[ScheduledTaskStore] Failed to report run failure:', reportErr);
      }
      await get().loadStats();
    }
  },
}));

let listenerInitialized = false;

export async function initScheduledTaskListener(): Promise<void> {
  if (listenerInitialized) return;
  listenerInitialized = true;

  await listen<ScheduledTaskTriggerEvent>('scheduled-task-trigger', (event) => {
    useScheduledTaskStore.getState()._onTrigger(event.payload);
  });

  await useScheduledTaskStore.getState().loadTasks();
  await useScheduledTaskStore.getState().loadStats();
  await useScheduledTaskStore.getState().claimPendingRuns();

  logger.info('[ScheduledTaskStore] Event listener registered');
}
