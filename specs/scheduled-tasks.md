# TalkCody Scheduled Tasks Design

> Document Version: 1.0
> Date: 2026-03-15
> Status: Draft

## Table of Contents

1. [Overview & Design Goals](#1-overview--design-goals)
2. [Competitive Analysis](#2-competitive-analysis)
3. [Core Design Decisions](#3-core-design-decisions)
4. [Architecture](#4-architecture)
5. [Data Model](#5-data-model)
6. [Rust Backend Design](#6-rust-backend-design)
7. [Frontend UI Design](#7-frontend-ui-design)
8. [i18n Requirements](#8-i18n-requirements)
9. [Implementation Phases](#9-implementation-phases)
10. [Edge Cases & Error Handling](#10-edge-cases--error-handling)

---

## 1. Overview & Design Goals

### 1.1 Background

TalkCody 目前支持用户手动创建 AI Task 并与 Agent 对话。当前缺少**定时自动触发**能力，无法让 Agent 在特定时间自主执行任务（如：每天早上 9 点总结 GitHub PR、每小时监控构建状态、15分钟后提醒 Code Review）。

参考 OpenClaw 和 Claude Code 的实现，TalkCody 需要一套**持久化**的定时调度系统，在 App 运行时（MVP）甚至 App 未打开时（后续阶段）自动触发 AI Agent 执行任务。

### 1.2 Design Goals

| Goal | Description |
|------|-------------|
| **Persistence** | 定时任务存储在 SQLite，App 重启后依然有效（不同于 Claude Code session-scoped）|
| **Multi-schedule** | 支持一次性（at）、固定间隔（every）、cron 表达式三种调度类型 |
| **Agent Integration** | 调度触发时，自动创建标准 TalkCody Task，走完整 Agent 执行流程 |
| **Run History** | 每次执行记录状态、输出、耗时，用于审计和调试 |
| **In-App First** | MVP 仅要求 App 运行时调度；App-closed 调度作为后续阶段 |
| **Timezone Aware** | 支持 IANA 时区（`America/Los_Angeles`、`Asia/Shanghai` 等）|
| **Cross-Platform** | macOS / Windows / Linux 均可正常运行 |
| **UI Management** | 提供 CRUD 管理界面，展示调度列表和运行历史 |
| **i18n** | UI 文本支持中英文 |

---

## 2. Competitive Analysis

### 2.1 OpenClaw Cron

OpenClaw 是 AI Agent 框架，Cron 是其 **Gateway** 的内置调度模块。

**核心特点：**

| Feature | Detail |
|---------|--------|
| 存储 | `~/.openclaw/cron/jobs.json` + `runs/<jobId>.jsonl` |
| Schedule 类型 | `at`（一次性）/ `every`（毫秒间隔）/ `cron`（5/6字段表达式）|
| 执行模式 | Main session（通过 heartbeat）/ Isolated session（独立 agent turn）/ Custom persistent session |
| Payload | `systemEvent`（系统事件）/ `agentTurn`（独立 agent 执行，支持 model/thinking override）|
| Delivery | `announce`（发到 IM 频道）/ `webhook`（HTTP POST）/ `none` |
| Stagger | 整点任务加确定性随机偏移（最大 5 分钟），防 API 峰值 |
| 并发 | 默认 `maxConcurrentRuns: 1` |
| Retry | 一次性：transient 错误最多 3 次指数退避；周期性：backoff 后继续 |
| Session Retention | Isolated run sessions 默认 24h 清理 |
| Per-agent isolation | 每个 agent 可独立维护 `jobs.json`（issue #26370）|
| CLI | `openclaw cron add/edit/list/run/remove/runs` |

**设计亮点：**
- Gateway 始终在后台运行，真正实现 App-closed 调度
- Isolated session 每次 fresh start，不污染主会话
- Custom persistent session 支持跨运行积累上下文（如每日站会）
- Delivery 机制将结果推送到 Slack/WhatsApp/Telegram

**不适合直接移植的地方：**
- TalkCody 是桌面应用，无持续运行的 Gateway 进程（MVP 阶段）
- TalkCody 的 Task 本身就是隔离的，无需 session 管理

### 2.2 Claude Code Scheduled Tasks

Claude Code 的 `/loop` 和定时任务是**session-scoped**（session 关闭即销毁）。

| Feature | Detail |
|---------|--------|
| 触发方式 | `/loop 5m <prompt>` 或自然语言（`remind me at 3pm...`）|
| 内部工具 | `CronCreate` / `CronList` / `CronDelete` |
| Schedule | 5字段标准 cron 表达式 |
| 最大任务数 | 50 per session |
| 持久化 | ❌ Session 关闭即销毁 |
| Catch-up | ❌ 错过的不补执行 |
| 自动过期 | Recurring tasks 3天后自动删除 |
| Jitter | 周期任务最多延迟 10% interval（上限 15 分钟）|
| 调度检查 | 每秒检查一次，在 user turn 之间执行 |
| App-closed | ❌ 依赖 GitHub Actions 或 Desktop scheduled tasks |

**设计亮点：**
- 自然语言解析调度表达式（`in 45 minutes`、`every weekday at 9am`）
- Jitter 避免多 session 同时请求 API
- 在 user turn 之间执行，不打断正在进行的对话

**不适合直接移植的地方：**
- 无持久化，不适合 TalkCody 的生产场景
- 3天过期限制过于严格

### 2.3 TalkCody Approach

TalkCody 方案结合两者优点，针对桌面应用特性做出调整：

| Dimension | OpenClaw | Claude Code | **TalkCody** |
|-----------|----------|-------------|--------------|
| 持久化 | ✅ JSON 文件 | ❌ Session-scoped | ✅ **SQLite**（与现有架构一致）|
| 运行引擎 | Gateway 进程 | Session 内 | ✅ **Rust Tokio task**（App 运行时）|
| App-closed | ✅（Gateway 常驻）| ❌ | 📅 **后续阶段**（OS 级调度）|
| Schedule 类型 | at/every/cron | cron | ✅ **at/every/cron** |
| 执行结果 | Session/Channel | Session | ✅ **TalkCody Task**（标准会话）|
| Jitter | ✅ 5分钟内 | ✅ 10% interval | ✅ **可配置 stagger** |
| Retry | ✅ 指数退避 | ❌ | ✅ **分级 retry 策略** |
| UI | CLI | 自然语言 | ✅ **GUI + 自然语言（后续）**|
| 并发限制 | maxConcurrentRuns=1 | 50 tasks | ✅ **与现有 Task 并发限制集成**|

---

## 3. Core Design Decisions

### 3.1 使用 SQLite 持久化（非 JSON 文件）

**决策**：定时任务存储在 `chat_history.db`（复用现有数据库），通过 Migration 系统扩展 Schema。

**理由**：
- TalkCody 已有完整的 SQLite + Migration 基础设施（`src-tauri/core/src/storage/migrations/mod.rs`）
- 支持事务和查询，比 JSON 文件更安全（并发写入、崩溃恢复）
- 与现有 Project/Session 数据天然关联
- 避免引入新的持久化机制

### 3.2 调度器运行在 Rust Tokio 运行时

**决策**：在 Tauri 桌面进程内用 `tokio::task::spawn` 运行一个后台调度 loop。

**理由**：
- TalkCody 已有多个 Tokio 后台任务（`background_tasks.rs`、file watcher、LLM streaming）
- 无需引入额外进程或守护进程
- App 启动时自动恢复 pending jobs

**限制**：App 关闭时调度器停止。App-closed 调度在后续阶段通过 OS 级机制（macOS launchd / Windows Task Scheduler / Linux systemd user）实现。

### 3.3 执行结果创建标准 TalkCody Task

**决策**：调度触发时，Rust 后端通过 Tauri 事件通知前端，前端走标准 `taskService.createTask()` + `executionService.startExecution()` 流程。

**理由**：
- 复用现有 Task 执行管道（LLMService、工具系统、消息持久化）
- 用户可以在 Task 列表中看到定时任务的执行记录
- 与多任务并发限制（3个 Slot）自动集成
- 不重复实现 Agent 执行逻辑

这与 OpenClaw 的 isolated session 思路一致：每次调度触发产生独立的执行上下文。

### 3.4 不实现 Catch-up（默认）

**决策**：App 离线期间错过的调度触发，**默认不补执行**（no catch-up），仅记录 `skipped` 状态。

**理由**：
- 避免 App 重启时批量触发大量任务造成 API 超限
- 适合大多数场景（监控任务、提醒类任务通常不需要补执行）
- 可通过 `catchUp: true` 配置启用（但最多补执行 1 次，避免洪峰）

### 3.5 Jitter 策略

**决策**：参考 OpenClaw，对整点/整半点的 cron 任务自动加最多 2 分钟随机偏移，避免 API 请求峰值。

具体实现：偏移量 = `hash(jobId) % (120 * 1000)` 毫秒，确定性（同一任务始终相同偏移），可通过 `staggerMs: 0` 禁用。

---

## 4. Architecture

### 4.1 System Architecture

```
+-----------------------------------------------------------------------------------+
|                              FRONTEND (React + TypeScript)                         |
|                                                                                   |
|  +---------------------------+   +---------------------------+                    |
|  |  ScheduledTasksPage       |   |  ScheduledTaskRunHistory  |                    |
|  |  - Task list              |   |  - Run records            |                    |
|  |  - Create/Edit modal      |   |  - Status / output link   |                    |
|  +-------------+-------------+   +---------------------------+                    |
|                |                                                                   |
|  +-------------v-------------------------------------------+                    |
|  |              useScheduledTaskStore (Zustand)             |                    |
|  |  - scheduledTasks: ScheduledTask[]                       |                    |
|  |  - runs: ScheduledTaskRun[]                              |                    |
|  |  - CRUD actions (create / update / delete / enable)      |                    |
|  +-------------+-------------------------------------------+                    |
|                |  invoke / listen                                                  |
+----------------|-------------------------------------------------------------------+
                 |  Tauri IPC
+----------------|-------------------------------------------------------------------+
|                |         RUST BACKEND (Tauri Desktop)                             |
|  +-------------v-------------------------------------------+                    |
|  |              Scheduler Module (tokio background task)    |                    |
|  |                                                           |                    |
|  |   App Start                                               |                    |
|  |      ↓                                                    |                    |
|  |   load_due_jobs() ← SQLite (chat_history.db)             |                    |
|  |      ↓                                                    |                    |
|  |   spawn tokio::task  ←─────────────────────────────┐    |                    |
|  |      ↓                                              │    |                    |
|  |   loop every ~10s:                                  │    |                    |
|  |     scan_due_jobs()                                 │    |                    |
|  |       ↓ due job found                               │    |                    |
|  |     claim_job()  [optimistic lock]                  │    |                    |
|  |       ↓                                             │    |                    |
|  |     emit("scheduled-task-trigger", payload)         │    |                    |
|  |       ↓ frontend creates Task + starts execution    │    |                    |
|  |     wait for execution_result event                 │    |                    |
|  |       ↓                                             │    |                    |
|  |     write_run_record()                              │    |                    |
|  |     schedule_next_run() ──────────────────────────>┘    |                    |
|  |                                                           |                    |
|  +-------------+-------------------------------------------+                    |
|                |                                                                   |
|  +-------------v-------------------------------------------+                    |
|  |           SQLite: chat_history.db                        |                    |
|  |   Tables: scheduled_tasks, scheduled_task_runs           |                    |
|  +----------------------------------------------------------+                    |
+-----------------------------------------------------------------------------------+
```

### 4.2 Lifecycle

```
CREATE scheduled_task
        ↓
  compute next_run_at (cron/every/at + stagger)
        ↓
  persist to SQLite (status=enabled)
        ↓
  Scheduler picks up at next tick
        ↓
  claim_job() → set status=running in runs table
        ↓
  emit Tauri event → frontend
        ↓
  Frontend: taskService.createTask(prompt, { projectId, model })
        ↓
  ExecutionService.startExecution(taskId, ...)
        ↓
  Agent Loop runs (tools, LLM streaming, etc.)
        ↓
  Execution completes → invoke("scheduled_task_run_complete", {jobId, taskId, success})
        ↓
  Rust: write ScheduledTaskRun record
        ↓
  if recurring:
    compute_next_run_at()         ← applies stagger again
    update scheduled_task.next_run_at
  else (at / one-shot):
    set scheduled_task.status = "completed"
        ↓
  Scheduler continues loop
```

### 4.3 Component Responsibilities

| Component | Responsibility |
|-----------|----------------|
| `SchedulerService` (Rust) | 后台 Tokio task；扫描 due jobs；claim；emit 事件；记录 run；计算 next_run |
| `ScheduledTaskRepository` (Rust) | CRUD + query for `scheduled_tasks` + `scheduled_task_runs` |
| `CronParser` (Rust) | 解析 cron 表达式；计算 next due time；支持 IANA 时区（`cron` + `chrono-tz` crates）|
| Tauri Commands | `create_scheduled_task`, `update_scheduled_task`, `delete_scheduled_task`, `list_scheduled_tasks`, `list_scheduled_task_runs`, `trigger_scheduled_task_now` |
| Tauri Events | `scheduled-task-trigger`（Rust → Frontend）; `scheduled-task-run-complete`（Frontend → Rust）|
| `useScheduledTaskStore` (TS) | Zustand store；监听 Tauri 事件；调用 task/execution services |
| UI Components | `ScheduledTasksPage`, `ScheduledTaskFormModal`, `ScheduledTaskRunHistory` |

---

## 5. Data Model

### 5.1 TypeScript Types

```typescript
// src/types/scheduled-task.ts

/** Schedule kind discriminated union */
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

/** What the scheduled task does when triggered */
export interface ScheduledTaskPayload {
  /** Prompt sent to the agent */
  message: string;
  /** Optional model override, e.g. "claude-opus-4" */
  model?: string;
  /** Whether to auto-approve edits */
  autoApproveEdits?: boolean;
  /** Whether to auto-approve plan */
  autoApprovePlan?: boolean;
}

/** Execution policy */
export interface ScheduledTaskExecutionPolicy {
  /**
   * Maximum parallel runs of this job.
   * If a run is still in-progress when the next trigger fires, skip.
   * Default: 1 (no overlap)
   */
  maxConcurrentRuns: number;
  /** Whether to catch up missed runs (max 1 catch-up per restart). Default: false */
  catchUp: boolean;
  /** Stagger window in ms to add jitter. 0 = exact timing. Default: auto (2min for top-of-hour cron) */
  staggerMs: number;
}

/** Retry policy for transient failures */
export interface ScheduledTaskRetryPolicy {
  /** Maximum retry attempts on transient error. Default: 2 */
  maxAttempts: number;
  /** Backoff intervals in ms, e.g. [30000, 60000] */
  backoffMs: number[];
}

export interface ScheduledTask {
  id: string;
  name: string;
  description?: string;
  /** Associated project ID. If null, runs in the global default project. */
  projectId: string | null;
  schedule: ScheduledTaskSchedule;
  payload: ScheduledTaskPayload;
  executionPolicy: ScheduledTaskExecutionPolicy;
  retryPolicy: ScheduledTaskRetryPolicy;
  /** 'enabled' | 'disabled' | 'completed' (one-shot done) | 'error' (permanent failure) */
  status: 'enabled' | 'disabled' | 'completed' | 'error';
  /** Unix timestamp ms of next scheduled fire */
  nextRunAt: number | null;
  /** Unix timestamp ms of last successful run */
  lastRunAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export type ScheduledTaskRunStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'  // app was offline when due
  | 'cancelled'; // manually cancelled or max concurrent exceeded

export interface ScheduledTaskRun {
  id: string;
  scheduledTaskId: string;
  /** The TalkCody Task/conversation ID created for this run */
  taskId: string | null;
  status: ScheduledTaskRunStatus;
  /** Unix timestamp ms when this run was triggered */
  triggeredAt: number;
  /** Unix timestamp ms when this run completed */
  completedAt: number | null;
  /** Error message if failed */
  error: string | null;
  /** Attempt number (1-based, >1 means retry) */
  attempt: number;
}

/** Payload emitted from Rust → Frontend when a job is due */
export interface ScheduledTaskTriggerEvent {
  jobId: string;
  runId: string;
  payload: ScheduledTaskPayload;
  projectId: string | null;
}

/** Payload sent from Frontend → Rust after execution completes */
export interface ScheduledTaskRunCompleteEvent {
  jobId: string;
  runId: string;
  taskId: string;
  success: boolean;
  error?: string;
}
```

### 5.2 SQLite Schema

在 `chat_history.db` 中通过 Migration 添加两张新表（migration version 6 和 7）：

```sql
-- Migration 6: scheduled_tasks table
CREATE TABLE scheduled_tasks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    project_id TEXT,                   -- NULL = global default project
    schedule_kind TEXT NOT NULL,       -- 'at' | 'every' | 'cron'
    schedule_at TEXT,                  -- ISO 8601, used when kind='at'
    schedule_every_ms INTEGER,         -- ms interval, used when kind='every'
    schedule_cron_expr TEXT,           -- cron expression, used when kind='cron'
    schedule_tz TEXT,                  -- IANA tz, used when kind='cron'
    payload_message TEXT NOT NULL,
    payload_model TEXT,
    payload_auto_approve_edits INTEGER NOT NULL DEFAULT 0,
    payload_auto_approve_plan INTEGER NOT NULL DEFAULT 0,
    exec_max_concurrent_runs INTEGER NOT NULL DEFAULT 1,
    exec_catch_up INTEGER NOT NULL DEFAULT 0,
    exec_stagger_ms INTEGER NOT NULL DEFAULT -1,  -- -1 = auto
    retry_max_attempts INTEGER NOT NULL DEFAULT 2,
    retry_backoff_ms TEXT NOT NULL DEFAULT '[30000,60000]',  -- JSON array
    status TEXT NOT NULL DEFAULT 'enabled',  -- 'enabled'|'disabled'|'completed'|'error'
    next_run_at INTEGER,               -- Unix ms
    last_run_at INTEGER,               -- Unix ms
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

CREATE INDEX idx_scheduled_tasks_status ON scheduled_tasks(status);
CREATE INDEX idx_scheduled_tasks_next_run ON scheduled_tasks(next_run_at)
    WHERE status = 'enabled';

-- Migration 7: scheduled_task_runs table
CREATE TABLE scheduled_task_runs (
    id TEXT PRIMARY KEY,
    scheduled_task_id TEXT NOT NULL,
    task_id TEXT,                      -- TalkCody conversation ID (NULL for skipped/cancelled)
    status TEXT NOT NULL DEFAULT 'running',
    triggered_at INTEGER NOT NULL,
    completed_at INTEGER,
    error TEXT,
    attempt INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (scheduled_task_id) REFERENCES scheduled_tasks(id) ON DELETE CASCADE
);

CREATE INDEX idx_task_runs_job ON scheduled_task_runs(scheduled_task_id);
CREATE INDEX idx_task_runs_triggered ON scheduled_task_runs(triggered_at);
CREATE INDEX idx_task_runs_status ON scheduled_task_runs(status);
```

---

## 6. Rust Backend Design

### 6.1 Crate Dependencies

在 `src-tauri/core/Cargo.toml` 中添加：

```toml
# Cron expression parsing
cron = "0.12"

# Timezone support
chrono-tz = "0.9"

# Already present: tokio, chrono, serde, serde_json, rusqlite
```

### 6.2 Module Layout

```
src-tauri/core/src/
└── scheduler/
    ├── mod.rs          # SchedulerService + pub API
    ├── repository.rs   # ScheduledTaskRepository (SQLite CRUD)
    ├── cron_utils.rs   # next_run_at calculation (at/every/cron + stagger + tz)
    └── types.rs        # ScheduledTask, ScheduledTaskRun Rust structs
```

### 6.3 SchedulerService

```rust
// src-tauri/core/src/scheduler/mod.rs

use std::sync::Arc;
use tokio::sync::Mutex;
use tokio::time::{interval, Duration};

pub struct SchedulerService {
    db: Arc<crate::database::Database>,
    /// Maps jobId -> runId for in-flight runs (for overlap detection)
    running_jobs: Arc<Mutex<HashMap<String, String>>>,
    app_handle: tauri::AppHandle,
}

impl SchedulerService {
    pub fn new(db: Arc<crate::database::Database>, app_handle: tauri::AppHandle) -> Self { ... }

    /// Start the background scheduler loop.
    /// Called once during Tauri app.setup().
    pub fn start(self: Arc<Self>) {
        tokio::spawn(async move {
            let mut ticker = interval(Duration::from_secs(10));
            loop {
                ticker.tick().await;
                if let Err(e) = self.tick().await {
                    log::error!("[Scheduler] tick error: {e}");
                }
            }
        });
    }

    /// Single scheduler tick: find due jobs, claim & dispatch them.
    async fn tick(&self) -> Result<(), String> {
        let now_ms = now_unix_ms();
        let due_jobs = self.repo().find_due_jobs(now_ms).await?;

        for job in due_jobs {
            // Overlap check
            if self.is_running(&job.id).await {
                if job.exec_max_concurrent_runs <= 1 {
                    log::debug!("[Scheduler] job {} still running, skipping", job.id);
                    continue;
                }
            }

            // Claim: create a run record with status=running
            let run_id = generate_id();
            self.repo().create_run(&ScheduledTaskRun {
                id: run_id.clone(),
                scheduled_task_id: job.id.clone(),
                task_id: None,
                status: RunStatus::Running,
                triggered_at: now_ms,
                completed_at: None,
                error: None,
                attempt: 1,
            }).await?;

            // Mark in-flight
            self.running_jobs.lock().await.insert(job.id.clone(), run_id.clone());

            // Emit Tauri event → Frontend
            self.app_handle.emit("scheduled-task-trigger", ScheduledTaskTriggerPayload {
                job_id: job.id.clone(),
                run_id: run_id.clone(),
                payload: job.payload.clone(),
                project_id: job.project_id.clone(),
            })?;
        }

        Ok(())
    }

    /// Called by Tauri command handler when frontend reports run complete.
    pub async fn on_run_complete(&self, result: RunCompletePayload) -> Result<(), String> {
        let status = if result.success { RunStatus::Completed } else { RunStatus::Failed };
        self.repo().update_run_complete(&result.run_id, status, result.task_id, result.error).await?;

        // Remove from in-flight map
        self.running_jobs.lock().await.remove(&result.job_id);

        // Schedule next run for recurring jobs
        let job = self.repo().find_job(&result.job_id).await?;
        if let Some(job) = job {
            match job.schedule.kind {
                ScheduleKind::Cron | ScheduleKind::Every => {
                    let next = compute_next_run_at(&job.schedule, now_unix_ms())?;
                    self.repo().update_next_run(&job.id, Some(next), Some(now_unix_ms())).await?;
                }
                ScheduleKind::At => {
                    // One-shot: mark completed
                    self.repo().set_job_status(&job.id, JobStatus::Completed).await?;
                }
            }
        }

        Ok(())
    }
}
```

### 6.4 CronUtils (next_run_at calculation)

```rust
// src-tauri/core/src/scheduler/cron_utils.rs

use cron::Schedule;
use chrono::{DateTime, Utc, TimeZone};
use chrono_tz::Tz;
use std::str::FromStr;

/// Compute the next due timestamp (Unix ms) for a schedule,
/// applying jitter if stagger_ms >= 0 (or auto-stagger for top-of-hour cron).
pub fn compute_next_run_at(
    schedule: &ScheduleConfig,
    after_ms: i64,
    job_id: &str,
) -> Result<i64, String> {
    let raw_next = compute_raw_next(schedule, after_ms)?;
    let stagger = effective_stagger_ms(schedule, job_id);
    Ok(raw_next + stagger)
}

fn compute_raw_next(schedule: &ScheduleConfig, after_ms: i64) -> Result<i64, String> {
    match &schedule.kind {
        ScheduleKind::At => {
            let dt = DateTime::parse_from_rfc3339(&schedule.at.as_deref().unwrap_or(""))
                .map_err(|e| e.to_string())?;
            Ok(dt.timestamp_millis())
        }
        ScheduleKind::Every => {
            Ok(after_ms + schedule.every_ms.unwrap_or(60_000) as i64)
        }
        ScheduleKind::Cron => {
            let expr = schedule.cron_expr.as_deref().unwrap_or("* * * * *");
            let tz: Tz = schedule.tz.as_deref()
                .unwrap_or("UTC")
                .parse()
                .map_err(|_| format!("Invalid timezone: {:?}", schedule.tz))?;

            let cron_schedule = Schedule::from_str(expr)
                .map_err(|e| format!("Invalid cron expr '{}': {e}", expr))?;

            let after_dt = tz.timestamp_millis_opt(after_ms).single()
                .ok_or("Invalid timestamp")?;

            let next = cron_schedule.after(&after_dt).next()
                .ok_or("No next run for cron expression")?;

            Ok(next.timestamp_millis())
        }
    }
}

/// Deterministic jitter for top-of-hour cron expressions.
/// Returns milliseconds of stagger to add.
fn effective_stagger_ms(schedule: &ScheduleConfig, job_id: &str) -> i64 {
    // Explicit 0 = no stagger
    if schedule.stagger_ms == Some(0) {
        return 0;
    }
    // Explicit positive value
    if let Some(ms) = schedule.stagger_ms {
        if ms > 0 {
            return deterministic_jitter(job_id, ms as i64);
        }
    }
    // Auto-stagger: apply 2-minute max jitter for top-of-hour cron
    if schedule.kind == ScheduleKind::Cron {
        if is_top_of_hour_cron(schedule.cron_expr.as_deref().unwrap_or("")) {
            return deterministic_jitter(job_id, 120_000); // up to 2 min
        }
    }
    0
}

fn deterministic_jitter(job_id: &str, max_ms: i64) -> i64 {
    // Simple hash of job_id bytes, then modulo max_ms
    let hash: u64 = job_id.bytes().fold(14695981039346656037u64, |h, b| {
        h.wrapping_mul(1099511628211).wrapping_add(b as u64)
    });
    (hash % max_ms as u64) as i64
}

fn is_top_of_hour_cron(expr: &str) -> bool {
    let parts: Vec<&str> = expr.split_whitespace().collect();
    if parts.len() < 2 { return false; }
    parts[0] == "0" // minute field is exactly "0"
}
```

### 6.5 Tauri Commands

```rust
// In desktop/src/lib.rs or a dedicated commands module

#[tauri::command]
pub async fn create_scheduled_task(
    db: State<'_, Arc<Database>>,
    task: CreateScheduledTaskRequest,
) -> Result<ScheduledTask, String> { ... }

#[tauri::command]
pub async fn update_scheduled_task(
    db: State<'_, Arc<Database>>,
    id: String,
    patch: UpdateScheduledTaskRequest,
) -> Result<ScheduledTask, String> { ... }

#[tauri::command]
pub async fn delete_scheduled_task(
    db: State<'_, Arc<Database>>,
    id: String,
) -> Result<(), String> { ... }

#[tauri::command]
pub async fn list_scheduled_tasks(
    db: State<'_, Arc<Database>>,
    project_id: Option<String>,
) -> Result<Vec<ScheduledTask>, String> { ... }

#[tauri::command]
pub async fn list_scheduled_task_runs(
    db: State<'_, Arc<Database>>,
    job_id: String,
    limit: Option<u32>,
) -> Result<Vec<ScheduledTaskRun>, String> { ... }

/// Manually trigger a scheduled task immediately (ignoring schedule)
#[tauri::command]
pub async fn trigger_scheduled_task_now(
    scheduler: State<'_, Arc<SchedulerService>>,
    job_id: String,
) -> Result<String, String> { ... }  // Returns run_id

/// Called by frontend after execution completes
#[tauri::command]
pub async fn report_scheduled_task_run_complete(
    scheduler: State<'_, Arc<SchedulerService>>,
    payload: RunCompletePayload,
) -> Result<(), String> { ... }
```

### 6.6 App Startup Integration

```rust
// In desktop/src/lib.rs, app.setup()

let scheduler = Arc::new(SchedulerService::new(
    Arc::clone(&chat_history_db),
    app.handle().clone(),
));

// Register as managed state for commands
app.manage(Arc::clone(&scheduler));

// Start background loop
scheduler.start();
```

### 6.7 Startup Recovery

App 重启时，Scheduler 的第一次 tick 会处理：
1. **status=running 的 runs**：将其标记为 `failed`（crash during execution），并触发重试（若 retry policy 允许）
2. **catchUp=true 的 enabled jobs**：若 `next_run_at < now`，立即触发一次（最多 1 次）
3. **catchUp=false 的 enabled jobs**：若 `next_run_at < now`，记录 `skipped` run，重新计算 next_run_at

---

## 7. Frontend UI Design

### 7.1 Store

```typescript
// src/stores/scheduled-task-store.ts

import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { taskService } from '@/services/task-service';
import { executionService } from '@/services/execution-service';
import type {
  ScheduledTask,
  ScheduledTaskRun,
  ScheduledTaskTriggerEvent,
  ScheduledTaskRunCompleteEvent,
} from '@/types/scheduled-task';

interface ScheduledTaskState {
  tasks: ScheduledTask[];
  runs: Map<string, ScheduledTaskRun[]>;  // keyed by jobId
  isLoading: boolean;

  // Actions
  loadTasks: (projectId?: string) => Promise<void>;
  createTask: (data: CreateScheduledTaskInput) => Promise<ScheduledTask>;
  updateTask: (id: string, patch: Partial<ScheduledTask>) => Promise<ScheduledTask>;
  deleteTask: (id: string) => Promise<void>;
  enableTask: (id: string) => Promise<void>;
  disableTask: (id: string) => Promise<void>;
  triggerNow: (id: string) => Promise<void>;
  loadRuns: (jobId: string) => Promise<void>;

  // Internal: called when Tauri event fires
  _onTrigger: (event: ScheduledTaskTriggerEvent) => Promise<void>;
}

export const useScheduledTaskStore = create<ScheduledTaskState>((set, get) => ({
  tasks: [],
  runs: new Map(),
  isLoading: false,

  // ... CRUD actions call invoke() Tauri commands

  _onTrigger: async (event) => {
    const { jobId, runId, payload, projectId } = event;
    try {
      // Create a new TalkCody task and start execution
      const taskId = await taskService.createTask(payload.message, {
        projectId: projectId ?? undefined,
      });

      await executionService.startExecution({
        taskId,
        messages: [],
        model: payload.model ?? defaultModel,
        // Pass settings from payload
      });

      // Report completion to Rust backend
      await invoke<void>('report_scheduled_task_run_complete', {
        payload: {
          jobId,
          runId,
          taskId,
          success: true,
        } satisfies ScheduledTaskRunCompleteEvent,
      });
    } catch (err) {
      await invoke<void>('report_scheduled_task_run_complete', {
        payload: {
          jobId,
          runId,
          taskId: null,
          success: false,
          error: String(err),
        },
      });
    }
  },
}));

// Register Tauri event listener (called once in app initialization)
export async function initScheduledTaskListener() {
  await listen<ScheduledTaskTriggerEvent>('scheduled-task-trigger', (event) => {
    useScheduledTaskStore.getState()._onTrigger(event.payload);
  });
}
```

### 7.2 Page Structure

```
src/pages/scheduled-tasks-page.tsx
  └── ScheduledTasksPage
        ├── Header: "Scheduled Tasks" + [+ New Task] button
        ├── ScheduledTaskList
        │     └── ScheduledTaskItem × N
        │           ├── Name, schedule summary (e.g. "Every day at 09:00 CST")
        │           ├── Status badge (enabled / disabled / error)
        │           ├── Next run time (relative: "in 3h 20m")
        │           └── Actions: [Run Now] [Edit] [Enable/Disable] [Delete]
        └── (when task selected) ScheduledTaskRunHistory
              └── RunRecord × N
                    ├── Trigger time
                    ├── Status (completed / failed / skipped)
                    ├── Duration
                    └── [View Task] link → opens corresponding TalkCody task

src/components/scheduled-tasks/
  ├── scheduled-task-list.tsx
  ├── scheduled-task-item.tsx
  ├── scheduled-task-form-modal.tsx  (Create / Edit)
  │     ├── Name field
  │     ├── Schedule picker:
  │     │     ├── Type selector: Once / Interval / Cron
  │     │     ├── Once: datetime picker
  │     │     ├── Interval: number + unit (minutes/hours/days)
  │     │     └── Cron: text input + human-readable preview
  │     ├── Prompt textarea
  │     ├── Model selector (optional override)
  │     ├── Project selector
  │     └── Advanced (stagger, retry, catch-up, auto-approve)
  └── scheduled-task-run-history.tsx
```

### 7.3 Navigation Integration

将 "Scheduled Tasks" 入口添加到左侧 `NavigationSidebar`，与现有的 Tasks、Skills、Agents 等页面并列。

---

## 8. i18n Requirements

在 `src/locales/en.ts` 和 `src/locales/zh.ts` 中添加以下 key（节选）：

```typescript
// English (en.ts)
scheduledTasks: {
  title: 'Scheduled Tasks',
  newTask: 'New Scheduled Task',
  editTask: 'Edit Scheduled Task',
  deleteConfirm: 'Delete this scheduled task?',
  fields: {
    name: 'Name',
    schedule: 'Schedule',
    prompt: 'Prompt',
    model: 'Model (optional)',
    project: 'Project',
    timezone: 'Timezone',
  },
  scheduleKind: {
    at: 'One-time',
    every: 'Interval',
    cron: 'Cron Expression',
  },
  status: {
    enabled: 'Enabled',
    disabled: 'Disabled',
    completed: 'Completed',
    error: 'Error',
  },
  runStatus: {
    running: 'Running',
    completed: 'Completed',
    failed: 'Failed',
    skipped: 'Skipped (app was offline)',
    cancelled: 'Cancelled',
  },
  actions: {
    runNow: 'Run Now',
    enable: 'Enable',
    disable: 'Disable',
    viewTask: 'View Task',
  },
  nextRun: 'Next run',
  lastRun: 'Last run',
  noTasks: 'No scheduled tasks yet',
  runHistory: 'Run History',
},

// Chinese (zh.ts)
scheduledTasks: {
  title: '定时任务',
  newTask: '新建定时任务',
  editTask: '编辑定时任务',
  deleteConfirm: '确认删除该定时任务？',
  fields: {
    name: '名称',
    schedule: '调度计划',
    prompt: '提示词',
    model: '模型（可选）',
    project: '项目',
    timezone: '时区',
  },
  scheduleKind: {
    at: '一次性',
    every: '固定间隔',
    cron: 'Cron 表达式',
  },
  status: {
    enabled: '已启用',
    disabled: '已禁用',
    completed: '已完成',
    error: '错误',
  },
  runStatus: {
    running: '运行中',
    completed: '已完成',
    failed: '失败',
    skipped: '已跳过（App 离线）',
    cancelled: '已取消',
  },
  actions: {
    runNow: '立即运行',
    enable: '启用',
    disable: '禁用',
    viewTask: '查看任务',
  },
  nextRun: '下次运行',
  lastRun: '上次运行',
  noTasks: '暂无定时任务',
  runHistory: '运行历史',
},
```

---

## 9. Implementation Phases

### Phase 1 (MVP): Persistent In-App Scheduler

**目标**: App 运行时定时任务可正常触发、执行、记录历史。

**Scope**:
- [ ] SQLite migrations (version 6, 7) 添加两张新表
- [ ] `scheduler/` Rust 模块：`SchedulerService`、`ScheduledTaskRepository`、`CronUtils`
- [ ] 5 个 Tauri commands（CRUD + trigger_now + run_complete）
- [ ] `useScheduledTaskStore` + `initScheduledTaskListener`
- [ ] `ScheduledTasksPage` + `ScheduledTaskFormModal`（支持 at/every/cron 三种类型）
- [ ] `ScheduledTaskRunHistory` 组件
- [ ] NavigationSidebar 新增入口
- [ ] i18n (en + zh)
- [ ] Startup recovery（处理 running runs + catchUp 逻辑）

**不包含**:
- App-closed 调度（OS 级）
- 自然语言解析 schedule
- Delivery / notification
- 与多任务 Worktree pool 深度集成（直接复用现有并发限制逻辑）

**Acceptance Criteria**:
- 用户可创建 cron 类型定时任务，App 运行时在正确时间自动触发
- 触发后在 Task 列表出现对应任务并自动执行
- 关闭并重启 App 后，定时任务依然存在并继续调度
- Run History 正确记录每次执行的状态

---

### Phase 2: Reliability & Polish

**目标**: 生产可用的稳定性和体验。

**Scope**:
- [ ] Retry policy 实现（transient errors → exponential backoff）
- [ ] 并发 overlap 控制（`maxConcurrentRuns` 配置生效）
- [ ] Jitter / stagger 完整实现（自动检测整点 cron）
- [ ] 定时任务完成时发送系统通知（`notificationService`）
- [ ] 在 Task 详情中标注"由定时任务触发"
- [ ] 定时任务与项目（Project）关联过滤
- [ ] Run History 分页 + 按状态筛选
- [ ] Cron 表达式人性化预览（"每周一至五 上午 9 点"）
- [ ] Timezone 选择器组件

---

### Phase 3: App-Closed Scheduling

**目标**: 即使 TalkCody 未运行，定时任务也能在正确时间自动唤醒并执行。

**各平台方案**:

| Platform | Mechanism | Detail |
|----------|-----------|--------|
| macOS | `launchd` plist | 写入 `~/Library/LaunchAgents/com.talkcody.scheduler.plist`，使用 `StartCalendarInterval` 触发 |
| Windows | Task Scheduler | 使用 `schtasks.exe` 或 Windows API 注册计划任务 |
| Linux | `systemd --user` timer | 写入 `~/.config/systemd/user/talkcody-scheduler.timer` |

**触发流程**:
1. OS 在预定时间启动 TalkCody（或向已运行的实例发送信号）
2. Tauri 接收 `open` 事件（带 `--scheduled-task-run` 参数）
3. Rust Scheduler 立即执行 due jobs

**Scope**:
- [ ] 每次创建/修改定时任务时，同步写入 OS 调度器
- [ ] Tauri `single_instance` 插件处理多实例唤醒
- [ ] 跨平台 OS scheduler 抽象层
- [ ] UI 显示"App-closed execution supported"状态

---

### Phase 4: Natural Language & Advanced Features

**目标**: 对标 Claude Code `/loop` 的 UX，支持 Slack/IM 通知输出。

**Scope**:
- [ ] 自然语言解析 schedule（`"every weekday at 9am"`、`"in 30 minutes"`）
  - 可调用 LLM 解析为标准 cron 表达式，或集成 `natural-cron` 库
- [ ] 在创建 Task 时支持 `@schedule` 语法（`/schedule 0 9 * * 1-5 <prompt>`）
- [ ] Delivery hook：任务完成后推送结果到 Feishu / Telegram（复用现有 gateway 模块）
- [ ] 执行统计看板（总执行次数、成功率、平均耗时）
- [ ] 定时任务模板库（Marketplace 集成）

---

## 10. Edge Cases & Error Handling

### 10.1 DST & Timezone Changes

- **问题**: 夏令时切换导致某天缺少一小时或多出一小时
- **处理**: `cron` + `chrono-tz` 库的 `Schedule::after()` 正确处理 DST 边界；不引入手动偏移计算

### 10.2 App Offline During Due Window

- **默认行为**: `catchUp=false` → 记录 `skipped` run，重新计算 next_run_at
- **CatchUp=true**: 最多补执行 1 次（取最近一次未执行的触发点），防止批量触发

### 10.3 Duplicate Launch Prevention

- Scheduler tick 使用 SQLite 的 `running_jobs` in-memory map + 数据库 run record 双重锁
- `claim_job()` 在写入 `status=running` run record 前检查是否已有 running run for this job（DB-level lock via transaction）

### 10.4 Execution Takes Too Long

- 若上一次 run 仍在进行，下一次触发时间到了：`maxConcurrentRuns=1`（默认）→ skip 本次触发，记录 `cancelled` run
- 极端情况：job 运行超过其调度周期的 3 倍 → 发出告警日志，UI 显示警告

### 10.5 Project Deleted

- `scheduled_tasks.project_id` 外键设为 `ON DELETE SET NULL`
- project_id 变为 NULL 后，任务继续运行，使用 global default project
- UI 显示警告"Associated project was deleted"

### 10.6 Invalid Cron Expression

- 创建/编辑时在前端做实时验证（调用 Tauri command `validate_cron_expr` 或前端 cron 解析库）
- Rust 端 `compute_next_run_at` 返回 `Err`，写入 run record 为 `failed`，任务状态变为 `error`

### 10.7 Concurrent Run History Writes

- 所有 run record 操作通过 `ScheduledTaskRepository` 串行执行（SQLite WAL mode，tokio Mutex）
- 不存在真正的并发写冲突

### 10.8 App Crash During Execution

- 启动 recovery：扫描 `status=running` 的 run records，时间超过 `now - 6h`，标记为 `failed`
- 对支持 retry 的任务，重新排队

### 10.9 Clock Skew / System Time Change

- Scheduler 使用 `SystemTime::now()`，所有时间比较以系统时钟为准
- 系统时间向前跳变：会导致多个 cron 任务立即触发（treat as catch-up scenario）
- 系统时间向后跳变：next_run_at 未到，任务推迟执行（正常）

### 10.10 Migration Backward Compatibility

- 新增两张表，不修改现有表结构，完全向后兼容
- 旧版 App 升级时，migrations 自动执行（无 down 需要）

---

## Appendix A: Cron Expression Reference

| Expression | Meaning |
|-----------|---------|
| `0 9 * * *` | Every day at 09:00 local |
| `0 9 * * 1-5` | Weekdays at 09:00 local |
| `*/30 * * * *` | Every 30 minutes |
| `0 */2 * * *` | Every 2 hours on the hour |
| `0 9 1 * *` | First day of every month at 09:00 |
| `0 0 * * 0` | Every Sunday at midnight |

All cron expressions use 5-field format: `minute hour day-of-month month day-of-week`.

---

## Appendix B: Dependency Reference

| Crate | Version | Purpose |
|-------|---------|---------|
| `cron` | 0.12 | Parse 5-field cron expressions, iterate next due times |
| `chrono-tz` | 0.9 | IANA timezone database for `chrono::DateTime` |
| `tokio` | (existing) | Background scheduler loop |
| `chrono` | (existing) | Datetime arithmetic |
| `serde` / `serde_json` | (existing) | Serialization |
| `rusqlite` | (existing, via Database) | SQLite persistence |
