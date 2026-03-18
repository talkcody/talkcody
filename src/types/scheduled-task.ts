// src/types/scheduled-task.ts
// Scheduled Task system types - mirrors Rust scheduler/types.rs

/** Schedule kind: one-time, interval, or cron */
export type ScheduledTaskSchedule =
  | {
      kind: 'at';
      /** ISO 8601 datetime string */
      at: string;
    }
  | {
      kind: 'every';
      /** Interval in milliseconds */
      everyMs: number;
    }
  | {
      kind: 'cron';
      /** 5-field cron expression, e.g. "0 9 * * 1-5" */
      expr: string;
      /** IANA timezone, e.g. "Asia/Shanghai". Defaults to system local. */
      tz?: string;
    };

/** What the agent does when triggered */
export interface ScheduledTaskNotificationPolicy {
  notifyOnSuccess: boolean;
  notifyOnFailure: boolean;
}

export interface ScheduledTaskDeliveryPolicy {
  enabled: boolean;
  channelId?: 'telegram' | 'feishu';
  target?: string;
}

export interface ScheduledTaskOfflinePolicy {
  enabled: boolean;
  minuteGranularity: number;
}

export interface ScheduledTaskScheduleDraft {
  kind: 'at' | 'every' | 'cron';
  at?: string;
  everyMs?: number;
  expr?: string;
  tz?: string;
  explanation?: string;
  warnings?: string[];
}

export interface ScheduledTaskPayload {
  /** Prompt sent to the agent */
  message: string;
  /** Optional model override */
  model?: string;
  /** Whether to auto-approve edits */
  autoApproveEdits?: boolean;
  /** Whether to auto-approve plan */
  autoApprovePlan?: boolean;
}

/** Execution policy (concurrency, catch-up, stagger) */
export interface ScheduledTaskExecutionPolicy {
  /** Max concurrent runs. Default: 1 (no overlap). */
  maxConcurrentRuns: number;
  /** Catch up one missed run on restart. Default: false. */
  catchUp: boolean;
  /** Stagger window ms: -1=auto, 0=none, >0=explicit. */
  staggerMs: number;
}

/** Retry policy for transient failures */
export interface ScheduledTaskRetryPolicy {
  /** Max retry attempts. Default: 2. */
  maxAttempts: number;
  /** Backoff intervals in ms. */
  backoffMs: number[];
}

export type JobStatus = 'enabled' | 'disabled' | 'completed' | 'error';

export interface ScheduledTask {
  id: string;
  name: string;
  description?: string;
  /** Associated project ID. null = global default project. */
  projectId: string | null;
  schedule: ScheduledTaskSchedule;
  scheduleNlText?: string;
  payload: ScheduledTaskPayload;
  executionPolicy: ScheduledTaskExecutionPolicy;
  retryPolicy: ScheduledTaskRetryPolicy;
  notificationPolicy: ScheduledTaskNotificationPolicy;
  deliveryPolicy: ScheduledTaskDeliveryPolicy;
  offlinePolicy: ScheduledTaskOfflinePolicy;
  status: JobStatus;
  /** Unix timestamp ms of next scheduled fire */
  nextRunAt: number | null;
  /** Unix timestamp ms of last successful run */
  lastRunAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export type ScheduledTaskRunStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'cancelled';

export interface ScheduledTaskRun {
  id: string;
  scheduledTaskId: string;
  /** The TalkCody conversation/task ID created for this run */
  taskId: string | null;
  status: ScheduledTaskRunStatus;
  /** Unix timestamp ms when triggered */
  triggeredAt: number;
  /** Unix timestamp ms when completed */
  completedAt: number | null;
  error: string | null;
  /** 1-based attempt number */
  attempt: number;
  triggerSource?: 'schedule' | 'manual' | 'catch_up' | 'retry' | 'offline_runner';
  scheduledForAt?: number | null;
  payloadSnapshotJson?: string | null;
  projectIdSnapshot?: string | null;
  deliveryStatus?: string | null;
  deliveryError?: string | null;
}

/** Emitted from Rust → Frontend when a job is due (Tauri event payload) */
export interface ScheduledTaskTriggerEvent {
  jobId: string;
  runId: string;
  payload: ScheduledTaskPayload;
  projectId: string | null;
}

/** Sent Frontend → Rust after execution completes */
export interface ScheduledTaskRunCompletePayload {
  jobId: string;
  runId: string;
  taskId: string | null;
  success: boolean;
  error?: string;
  deliveryStatus?: string;
  deliveryError?: string;
}

/** Input for creating a new scheduled task */
export interface CreateScheduledTaskInput {
  name: string;
  description?: string;
  projectId?: string | null;
  schedule: ScheduledTaskSchedule;
  scheduleNlText?: string;
  payload: ScheduledTaskPayload;
  executionPolicy?: Partial<ScheduledTaskExecutionPolicy>;
  retryPolicy?: Partial<ScheduledTaskRetryPolicy>;
  notificationPolicy?: Partial<ScheduledTaskNotificationPolicy>;
  deliveryPolicy?: Partial<ScheduledTaskDeliveryPolicy>;
  offlinePolicy?: Partial<ScheduledTaskOfflinePolicy>;
}

/** Input for updating an existing scheduled task */
export interface UpdateScheduledTaskInput {
  name?: string;
  description?: string;
  schedule?: ScheduledTaskSchedule;
  scheduleNlText?: string;
  payload?: ScheduledTaskPayload;
  executionPolicy?: ScheduledTaskExecutionPolicy;
  retryPolicy?: ScheduledTaskRetryPolicy;
  notificationPolicy?: ScheduledTaskNotificationPolicy;
  deliveryPolicy?: ScheduledTaskDeliveryPolicy;
  offlinePolicy?: ScheduledTaskOfflinePolicy;
  status?: JobStatus;
}

// ============ Helpers ============

/** Build a human-readable schedule summary string */
export function scheduleToSummary(schedule: ScheduledTaskSchedule, tz?: string): string {
  switch (schedule.kind) {
    case 'at': {
      try {
        return new Date(schedule.at).toLocaleString();
      } catch {
        return schedule.at;
      }
    }
    case 'every': {
      const ms = schedule.everyMs;
      if (ms < 60_000) return `Every ${Math.round(ms / 1000)}s`;
      if (ms < 3_600_000) return `Every ${Math.round(ms / 60_000)} min`;
      if (ms < 86_400_000) return `Every ${Math.round(ms / 3_600_000)} h`;
      return `Every ${Math.round(ms / 86_400_000)} day(s)`;
    }
    case 'cron': {
      const tzLabel = schedule.tz ?? tz ?? 'local';
      return `${schedule.expr} (${tzLabel})`;
    }
  }
}

export interface ScheduledTaskDeliveryResult {
  status: 'none' | 'delivered' | 'failed';
  deliveredAt: number | null;
  error?: string;
}

export interface ScheduledTaskStatsSummary {
  totalRuns: number;
  completedRuns: number;
  failedRuns: number;
  queuedRuns: number;
  retriedRuns: number;
  successRate: number;
  avgDurationMs: number;
  deliveryFailures: number;
}

/** Default execution policy */
export const DEFAULT_EXECUTION_POLICY: ScheduledTaskExecutionPolicy = {
  maxConcurrentRuns: 1,
  catchUp: false,
  staggerMs: -1,
};

/** Default retry policy */
export const DEFAULT_RETRY_POLICY: ScheduledTaskRetryPolicy = {
  maxAttempts: 2,
  backoffMs: [30_000, 60_000],
};

export const DEFAULT_NOTIFICATION_POLICY: ScheduledTaskNotificationPolicy = {
  notifyOnSuccess: false,
  notifyOnFailure: true,
};

export const DEFAULT_DELIVERY_POLICY: ScheduledTaskDeliveryPolicy = {
  enabled: false,
};

export const DEFAULT_OFFLINE_POLICY: ScheduledTaskOfflinePolicy = {
  enabled: false,
  minuteGranularity: 1,
};
