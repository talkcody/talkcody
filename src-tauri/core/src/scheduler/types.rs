//! Scheduled Task data types shared across scheduler, repository, and Tauri commands.

use serde::{Deserialize, Serialize};

// ============== Notification / Delivery / Offline Policies ==============

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledTaskNotificationPolicy {
    #[serde(default)]
    pub notify_on_success: bool,
    #[serde(default = "default_notify_on_failure")]
    pub notify_on_failure: bool,
}

fn default_notify_on_failure() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledTaskDeliveryPolicy {
    #[serde(default)]
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledTaskOfflinePolicy {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_offline_granularity_minutes")]
    pub minute_granularity: i32,
}

fn default_offline_granularity_minutes() -> i32 {
    1
}

impl Default for ScheduledTaskOfflinePolicy {
    fn default() -> Self {
        Self {
            enabled: false,
            minute_granularity: 1,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RunTriggerSource {
    Schedule,
    Manual,
    CatchUp,
    Retry,
    OfflineRunner,
}

impl RunTriggerSource {
    pub fn as_str(&self) -> &'static str {
        match self {
            RunTriggerSource::Schedule => "schedule",
            RunTriggerSource::Manual => "manual",
            RunTriggerSource::CatchUp => "catch_up",
            RunTriggerSource::Retry => "retry",
            RunTriggerSource::OfflineRunner => "offline_runner",
        }
    }
}

impl std::str::FromStr for RunTriggerSource {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "schedule" => Ok(Self::Schedule),
            "manual" => Ok(Self::Manual),
            "catch_up" => Ok(Self::CatchUp),
            "retry" => Ok(Self::Retry),
            "offline_runner" => Ok(Self::OfflineRunner),
            _ => Err(format!("Unknown run trigger source: {}", s)),
        }
    }
}

// ============== Schedule ==============

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum ScheduledTaskSchedule {
    /// One-shot: fire once at a specific ISO 8601 datetime.
    #[serde(rename = "at")]
    At { at: String },
    /// Fixed interval: fire every `every_ms` milliseconds after last run.
    #[serde(rename = "every")]
    Every {
        #[serde(rename = "everyMs")]
        every_ms: i64,
    },
    /// Cron expression: 5-field cron with optional IANA timezone.
    #[serde(rename = "cron")]
    Cron {
        expr: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        tz: Option<String>,
    },
}

// ============== Payload ==============

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledTaskPayload {
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default)]
    pub auto_approve_edits: bool,
    #[serde(default)]
    pub auto_approve_plan: bool,
}

// ============== Execution Policy ==============

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledTaskExecutionPolicy {
    /// Max concurrent runs for this job (default 1 = no overlap).
    #[serde(default = "default_max_concurrent_runs")]
    pub max_concurrent_runs: i64,
    /// Whether to catch up one missed run on restart (default false).
    #[serde(default)]
    pub catch_up: bool,
    /// Stagger window in ms (-1 = auto, 0 = none, >0 = explicit).
    #[serde(default = "default_stagger_ms")]
    pub stagger_ms: i64,
}

fn default_max_concurrent_runs() -> i64 {
    1
}
fn default_stagger_ms() -> i64 {
    -1
}

impl Default for ScheduledTaskExecutionPolicy {
    fn default() -> Self {
        Self {
            max_concurrent_runs: 1,
            catch_up: false,
            stagger_ms: -1,
        }
    }
}

// ============== Retry Policy ==============

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledTaskRetryPolicy {
    /// Max retry attempts on transient error (default 2).
    #[serde(default = "default_max_attempts")]
    pub max_attempts: i32,
    /// Backoff intervals in ms (default [30000, 60000]).
    #[serde(default = "default_backoff_ms")]
    pub backoff_ms: Vec<i64>,
}

fn default_max_attempts() -> i32 {
    2
}
fn default_backoff_ms() -> Vec<i64> {
    vec![30_000, 60_000]
}

impl Default for ScheduledTaskRetryPolicy {
    fn default() -> Self {
        Self {
            max_attempts: 2,
            backoff_ms: vec![30_000, 60_000],
        }
    }
}

// ============== Job Status ==============

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum JobStatus {
    Enabled,
    Disabled,
    Completed,
    Error,
}

impl JobStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            JobStatus::Enabled => "enabled",
            JobStatus::Disabled => "disabled",
            JobStatus::Completed => "completed",
            JobStatus::Error => "error",
        }
    }
}

impl std::str::FromStr for JobStatus {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "enabled" => Ok(JobStatus::Enabled),
            "disabled" => Ok(JobStatus::Disabled),
            "completed" => Ok(JobStatus::Completed),
            "error" => Ok(JobStatus::Error),
            _ => Err(format!("Unknown job status: {}", s)),
        }
    }
}

// ============== Scheduled Task ==============

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledTask {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    pub schedule: ScheduledTaskSchedule,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schedule_nl_text: Option<String>,
    pub payload: ScheduledTaskPayload,
    pub execution_policy: ScheduledTaskExecutionPolicy,
    pub retry_policy: ScheduledTaskRetryPolicy,
    pub notification_policy: ScheduledTaskNotificationPolicy,
    pub delivery_policy: ScheduledTaskDeliveryPolicy,
    pub offline_policy: ScheduledTaskOfflinePolicy,
    pub status: JobStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_run_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_run_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

// ============== Run Status ==============

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RunStatus {
    Queued,
    Running,
    Completed,
    Failed,
    Skipped,
    Cancelled,
}

impl RunStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            RunStatus::Queued => "queued",
            RunStatus::Running => "running",
            RunStatus::Completed => "completed",
            RunStatus::Failed => "failed",
            RunStatus::Skipped => "skipped",
            RunStatus::Cancelled => "cancelled",
        }
    }
}

impl std::str::FromStr for RunStatus {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "queued" => Ok(RunStatus::Queued),
            "running" => Ok(RunStatus::Running),
            "completed" => Ok(RunStatus::Completed),
            "failed" => Ok(RunStatus::Failed),
            "skipped" => Ok(RunStatus::Skipped),
            "cancelled" => Ok(RunStatus::Cancelled),
            _ => Err(format!("Unknown run status: {}", s)),
        }
    }
}

// ============== Scheduled Task Run ==============

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledTaskRun {
    pub id: String,
    pub scheduled_task_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    pub status: RunStatus,
    pub triggered_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub attempt: i32,
    pub trigger_source: RunTriggerSource,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scheduled_for_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payload_snapshot_json: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id_snapshot: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delivery_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delivery_error: Option<String>,
}

// ============== IPC Payloads ==============

/// Emitted from Rust → Frontend when a job is due.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledTaskTriggerPayload {
    pub job_id: String,
    pub run_id: String,
    pub payload: ScheduledTaskPayload,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
}

/// Sent from Frontend → Rust after execution completes.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunCompletePayload {
    pub job_id: String,
    pub run_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delivery_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delivery_error: Option<String>,
}

// ============== Create / Update requests ==============

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateScheduledTaskRequest {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    pub schedule: ScheduledTaskSchedule,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schedule_nl_text: Option<String>,
    pub payload: ScheduledTaskPayload,
    #[serde(default)]
    pub execution_policy: ScheduledTaskExecutionPolicy,
    #[serde(default)]
    pub retry_policy: ScheduledTaskRetryPolicy,
    #[serde(default)]
    pub notification_policy: ScheduledTaskNotificationPolicy,
    #[serde(default)]
    pub delivery_policy: ScheduledTaskDeliveryPolicy,
    #[serde(default)]
    pub offline_policy: ScheduledTaskOfflinePolicy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateScheduledTaskRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schedule: Option<ScheduledTaskSchedule>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schedule_nl_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payload: Option<ScheduledTaskPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_policy: Option<ScheduledTaskExecutionPolicy>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_policy: Option<ScheduledTaskRetryPolicy>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notification_policy: Option<ScheduledTaskNotificationPolicy>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delivery_policy: Option<ScheduledTaskDeliveryPolicy>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offline_policy: Option<ScheduledTaskOfflinePolicy>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<JobStatus>,
}
