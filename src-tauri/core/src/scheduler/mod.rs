//! Scheduler module: SchedulerService (background Tokio loop) + Tauri commands.

pub mod cron_utils;
pub mod repository;
pub mod types;

use crate::database::Database;
use crate::scheduler::cron_utils::{
    compute_next_run_at, now_unix_ms, preview_schedule, validate_cron_expr, validate_timezone,
};
use crate::scheduler::repository::ScheduledTaskRepository;
use crate::scheduler::types::{
    CreateScheduledTaskRequest, JobStatus, RunCompletePayload, RunStatus, RunTriggerSource,
    ScheduledTask, ScheduledTaskRun, ScheduledTaskSchedule, ScheduledTaskTriggerPayload,
    UpdateScheduledTaskRequest,
};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::Emitter;
use tokio::sync::Mutex;
use tokio::time::{interval, Duration};
use uuid::Uuid;

pub struct SchedulerService {
    db: Arc<Database>,
    running_jobs: Arc<Mutex<HashMap<String, Vec<String>>>>,
    app_handle: tauri::AppHandle,
}

impl SchedulerService {
    pub fn new(db: Arc<Database>, app_handle: tauri::AppHandle) -> Self {
        Self {
            db,
            running_jobs: Arc::new(Mutex::new(HashMap::new())),
            app_handle,
        }
    }

    fn repo(&self) -> ScheduledTaskRepository {
        ScheduledTaskRepository::new(Arc::clone(&self.db))
    }

    pub fn start(self: Arc<Self>) {
        let svc = Arc::clone(&self);
        tauri::async_runtime::spawn(async move {
            if let Err(e) = svc.startup_recovery().await {
                log::warn!("[Scheduler] startup recovery error: {}", e);
            }

            let mut ticker = interval(Duration::from_secs(10));
            loop {
                ticker.tick().await;
                if let Err(e) = svc.tick().await {
                    log::error!("[Scheduler] tick error: {}", e);
                }
            }
        });
    }

    async fn startup_recovery(&self) -> Result<(), String> {
        let repo = self.repo();
        let now_ms = now_unix_ms();
        let stale_cutoff = now_ms - 6 * 3600 * 1000;
        let stale = repo.find_stale_running_runs(stale_cutoff).await?;
        for run in stale {
            repo.update_run_complete(
                &run.id,
                &RunStatus::Failed,
                None,
                Some("App restarted during execution".to_string()),
                run.delivery_status.clone(),
                run.delivery_error.clone(),
            )
            .await?;
        }

        let overdue = repo.find_overdue_jobs(now_ms).await?;
        for job in overdue {
            if job.execution_policy.catch_up {
                self.enqueue_run(&job, RunTriggerSource::CatchUp, now_ms, job.next_run_at)
                    .await?;
            } else {
                let run_id = Uuid::new_v4().to_string();
                repo.create_run(&ScheduledTaskRun {
                    id: run_id,
                    scheduled_task_id: job.id.clone(),
                    task_id: None,
                    status: RunStatus::Skipped,
                    triggered_at: job.next_run_at.unwrap_or(now_ms),
                    completed_at: Some(now_ms),
                    error: Some("App was offline when due".to_string()),
                    attempt: 1,
                    trigger_source: RunTriggerSource::CatchUp,
                    scheduled_for_at: job.next_run_at,
                    payload_snapshot_json: Some(
                        serde_json::to_string(&job.payload).map_err(|e| e.to_string())?,
                    ),
                    project_id_snapshot: job.project_id.clone(),
                    delivery_status: None,
                    delivery_error: None,
                })
                .await?;
                self.advance_next_run(&job, now_ms).await?;
            }
        }

        Ok(())
    }

    async fn tick(&self) -> Result<(), String> {
        let repo = self.repo();
        let now_ms = now_unix_ms();
        let due_jobs = repo.find_due_jobs(now_ms).await?;

        for job in due_jobs {
            let running_count = repo.count_running_runs(&job.id).await?;
            if running_count >= job.execution_policy.max_concurrent_runs {
                self.advance_next_run(&job, now_ms).await?;
                continue;
            }
            self.enqueue_run(&job, RunTriggerSource::Schedule, now_ms, job.next_run_at)
                .await?;
            self.advance_next_run(&job, now_ms).await?;
        }

        Ok(())
    }

    async fn enqueue_run(
        &self,
        job: &ScheduledTask,
        trigger_source: RunTriggerSource,
        now_ms: i64,
        scheduled_for_at: Option<i64>,
    ) -> Result<ScheduledTaskRun, String> {
        let repo = self.repo();
        let run_id = Uuid::new_v4().to_string();
        let run = ScheduledTaskRun {
            id: run_id.clone(),
            scheduled_task_id: job.id.clone(),
            task_id: None,
            status: RunStatus::Queued,
            triggered_at: now_ms,
            completed_at: None,
            error: None,
            attempt: 1,
            trigger_source,
            scheduled_for_at,
            payload_snapshot_json: Some(
                serde_json::to_string(&job.payload).map_err(|e| e.to_string())?,
            ),
            project_id_snapshot: job.project_id.clone(),
            delivery_status: None,
            delivery_error: None,
        };
        repo.create_run(&run).await?;
        let _ = self.app_handle.emit(
            "scheduled-task-trigger",
            ScheduledTaskTriggerPayload {
                job_id: job.id.clone(),
                run_id: run_id.clone(),
                payload: job.payload.clone(),
                project_id: job.project_id.clone(),
            },
        );
        Ok(run)
    }

    pub async fn claim_pending_runs(&self) -> Result<Vec<ScheduledTaskRun>, String> {
        let repo = self.repo();
        let runs = repo.list_queued_runs().await?;
        for run in &runs {
            repo.mark_run_started(&run.id).await?;
        }
        Ok(runs)
    }

    pub async fn on_run_complete(&self, result: RunCompletePayload) -> Result<(), String> {
        let repo = self.repo();
        let status = if result.success {
            RunStatus::Completed
        } else {
            RunStatus::Failed
        };

        repo.update_run_complete(
            &result.run_id,
            &status,
            result.task_id.clone(),
            result.error.clone(),
            result.delivery_status.clone(),
            result.delivery_error.clone(),
        )
        .await?;

        {
            let mut map = self.running_jobs.lock().await;
            if let Some(runs) = map.get_mut(&result.job_id) {
                runs.retain(|r| r != &result.run_id);
                if runs.is_empty() {
                    map.remove(&result.job_id);
                }
            }
        }

        if let Some(job) = repo.find_by_id(&result.job_id).await? {
            repo.update_next_run(&job.id, job.next_run_at, Some(now_unix_ms()))
                .await?;
            if !result.success {
                let runs = repo.list_runs(&job.id, 20).await?;
                let failed_attempts = runs
                    .iter()
                    .filter(|r| matches!(r.status, RunStatus::Failed))
                    .count() as i32;
                if failed_attempts <= job.retry_policy.max_attempts {
                    let backoff = job
                        .retry_policy
                        .backoff_ms
                        .get((failed_attempts - 1).max(0) as usize)
                        .copied()
                        .unwrap_or(60_000);
                    let retry_at = now_unix_ms() + backoff;
                    self.enqueue_run(&job, RunTriggerSource::Retry, retry_at, Some(retry_at))
                        .await?;
                }
            }
        }

        Ok(())
    }

    async fn advance_next_run(&self, job: &ScheduledTask, after_ms: i64) -> Result<(), String> {
        let repo = self.repo();
        match &job.schedule {
            ScheduledTaskSchedule::At { .. } => {
                repo.set_status(&job.id, &JobStatus::Completed).await?;
            }
            ScheduledTaskSchedule::Every { .. } | ScheduledTaskSchedule::Cron { .. } => {
                match compute_next_run_at(&job.schedule, &job.execution_policy, after_ms, &job.id) {
                    Ok(next) => {
                        repo.update_next_run(&job.id, Some(next), job.last_run_at)
                            .await?;
                    }
                    Err(e) => {
                        log::error!(
                            "[Scheduler] Failed to compute next run for '{}': {}",
                            job.name,
                            e
                        );
                        repo.set_status(&job.id, &JobStatus::Error).await?;
                    }
                }
            }
        }
        Ok(())
    }
}

#[tauri::command]
pub async fn create_scheduled_task(
    db: tauri::State<'_, Arc<Database>>,
    request: CreateScheduledTaskRequest,
) -> Result<ScheduledTask, String> {
    if let ScheduledTaskSchedule::Cron { expr, tz } = &request.schedule {
        validate_cron_expr(expr)?;
        if let Some(tz_str) = tz {
            validate_timezone(tz_str)?;
        }
    }
    if let ScheduledTaskSchedule::Every { every_ms } = &request.schedule {
        if request.offline_policy.enabled && *every_ms < 60_000 {
            return Err("Offline mode requires interval >= 60000ms".to_string());
        }
    }

    let repo = ScheduledTaskRepository::new(Arc::clone(&db));
    let now_ms = now_unix_ms();
    let id = Uuid::new_v4().to_string();
    let next_run_at =
        compute_next_run_at(&request.schedule, &request.execution_policy, now_ms, &id).ok();

    let task = ScheduledTask {
        id: id.clone(),
        name: request.name,
        description: request.description,
        project_id: request.project_id,
        schedule: request.schedule,
        schedule_nl_text: request.schedule_nl_text,
        payload: request.payload,
        execution_policy: request.execution_policy,
        retry_policy: request.retry_policy,
        notification_policy: request.notification_policy,
        delivery_policy: request.delivery_policy,
        offline_policy: request.offline_policy,
        status: JobStatus::Enabled,
        next_run_at,
        last_run_at: None,
        created_at: now_ms,
        updated_at: now_ms,
    };

    repo.create(&task).await?;
    Ok(task)
}

#[tauri::command]
pub async fn update_scheduled_task(
    db: tauri::State<'_, Arc<Database>>,
    id: String,
    request: UpdateScheduledTaskRequest,
) -> Result<ScheduledTask, String> {
    let repo = ScheduledTaskRepository::new(Arc::clone(&db));
    let existing = repo
        .find_by_id(&id)
        .await?
        .ok_or_else(|| format!("Scheduled task not found: {}", id))?;

    if let Some(ScheduledTaskSchedule::Cron { expr, tz }) = &request.schedule {
        validate_cron_expr(expr)?;
        if let Some(tz_str) = tz {
            validate_timezone(tz_str)?;
        }
    }

    let now_ms = now_unix_ms();
    let new_schedule = request
        .schedule
        .clone()
        .unwrap_or(existing.schedule.clone());
    let new_exec_policy = request
        .execution_policy
        .clone()
        .unwrap_or(existing.execution_policy.clone());
    let next_run_at = if request.schedule.is_some() || request.execution_policy.is_some() {
        compute_next_run_at(&new_schedule, &new_exec_policy, now_ms, &id).ok()
    } else {
        existing.next_run_at
    };

    let updated = ScheduledTask {
        id: existing.id.clone(),
        name: request.name.unwrap_or(existing.name),
        description: request.description.or(existing.description),
        project_id: existing.project_id,
        schedule: new_schedule,
        schedule_nl_text: request.schedule_nl_text.or(existing.schedule_nl_text),
        payload: request.payload.unwrap_or(existing.payload),
        execution_policy: new_exec_policy,
        retry_policy: request.retry_policy.unwrap_or(existing.retry_policy),
        notification_policy: request
            .notification_policy
            .unwrap_or(existing.notification_policy),
        delivery_policy: request.delivery_policy.unwrap_or(existing.delivery_policy),
        offline_policy: request.offline_policy.unwrap_or(existing.offline_policy),
        status: request.status.unwrap_or(existing.status),
        next_run_at,
        last_run_at: existing.last_run_at,
        created_at: existing.created_at,
        updated_at: now_ms,
    };

    repo.update(&id, &updated).await?;
    Ok(updated)
}

#[tauri::command]
pub async fn delete_scheduled_task(
    db: tauri::State<'_, Arc<Database>>,
    id: String,
) -> Result<(), String> {
    let repo = ScheduledTaskRepository::new(Arc::clone(&db));
    repo.delete(&id).await
}

#[tauri::command]
pub async fn list_scheduled_tasks(
    db: tauri::State<'_, Arc<Database>>,
    project_id: Option<String>,
) -> Result<Vec<ScheduledTask>, String> {
    let repo = ScheduledTaskRepository::new(Arc::clone(&db));
    repo.list(project_id.as_deref()).await
}

#[tauri::command]
pub async fn list_scheduled_task_runs(
    db: tauri::State<'_, Arc<Database>>,
    job_id: String,
    limit: Option<u32>,
) -> Result<Vec<ScheduledTaskRun>, String> {
    let repo = ScheduledTaskRepository::new(Arc::clone(&db));
    repo.list_runs(&job_id, limit.unwrap_or(50)).await
}

#[tauri::command]
pub async fn claim_scheduled_task_runs(
    scheduler: tauri::State<'_, Arc<SchedulerService>>,
) -> Result<Vec<ScheduledTaskRun>, String> {
    scheduler.claim_pending_runs().await
}

#[tauri::command]
pub async fn trigger_scheduled_task_now(
    db: tauri::State<'_, Arc<Database>>,
    scheduler: tauri::State<'_, Arc<SchedulerService>>,
    job_id: String,
) -> Result<String, String> {
    let repo = ScheduledTaskRepository::new(Arc::clone(&db));
    let job = repo
        .find_by_id(&job_id)
        .await?
        .ok_or_else(|| format!("Scheduled task not found: {}", job_id))?;
    let run = scheduler
        .enqueue_run(
            &job,
            RunTriggerSource::Manual,
            now_unix_ms(),
            Some(now_unix_ms()),
        )
        .await?;
    Ok(run.id)
}

#[tauri::command]
pub async fn report_scheduled_task_run_complete(
    scheduler: tauri::State<'_, Arc<SchedulerService>>,
    payload: RunCompletePayload,
) -> Result<(), String> {
    scheduler.on_run_complete(payload).await
}

#[tauri::command]
pub fn validate_scheduled_task_cron(expr: String) -> Result<(), String> {
    validate_cron_expr(&expr)
}

#[tauri::command]
pub fn validate_scheduled_task_timezone(tz: String) -> Result<(), String> {
    validate_timezone(&tz)
}

#[tauri::command]
pub fn preview_scheduled_task_cron(
    schedule: ScheduledTaskSchedule,
    execution_policy: crate::scheduler::types::ScheduledTaskExecutionPolicy,
    count: Option<usize>,
    from_ms: Option<i64>,
    job_id: Option<String>,
) -> Result<Vec<crate::scheduler::cron_utils::CronPreviewEntry>, String> {
    preview_schedule(
        &schedule,
        &execution_policy,
        from_ms.unwrap_or_else(now_unix_ms),
        count.unwrap_or(5),
        job_id.as_deref().unwrap_or("preview"),
    )
}

#[tauri::command]
pub async fn get_scheduled_task_stats(
    db: tauri::State<'_, Arc<Database>>,
) -> Result<serde_json::Value, String> {
    let repo = ScheduledTaskRepository::new(Arc::clone(&db));
    repo.get_stats_summary().await
}
