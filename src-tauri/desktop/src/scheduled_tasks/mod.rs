//! Desktop scheduled task runner and OS scheduler integration.

pub mod platform;
pub mod runner;

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledTaskRunnerStatus {
    pub supported: bool,
    pub installed: bool,
    pub platform: String,
    pub detail: Option<String>,
}

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

fn executable_path(_app: &AppHandle) -> Result<PathBuf, String> {
    std::env::current_exe().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn scheduled_task_runner_status(app: AppHandle) -> Result<ScheduledTaskRunnerStatus, String> {
    platform::status(&app)
}

#[tauri::command]
pub fn scheduled_task_runner_sync(
    app: AppHandle,
    enabled: bool,
) -> Result<ScheduledTaskRunnerStatus, String> {
    platform::sync(&app, enabled)
}

#[tauri::command]
pub fn scheduled_task_runner_run_now(app: AppHandle) -> Result<(), String> {
    runner::run_due_tasks_now(&app)
}

pub fn sync_runner_for_current_platform(
    app: &AppHandle,
    enabled: bool,
) -> Result<ScheduledTaskRunnerStatus, String> {
    platform::sync(app, enabled)
}

pub fn is_runner_mode(args: &[String]) -> bool {
    args.iter().any(|arg| arg == "--scheduled-task-runner")
}

pub fn app_run_interval_minutes() -> u32 {
    1
}

pub fn runner_args() -> Vec<String> {
    vec!["--scheduled-task-runner".to_string()]
}

/// Resolve the app data directory for the headless runner.
///
/// In runner mode the executable is launched by launchd/cron and the
/// `TALKCODY_APP_DATA_DIR` environment variable is set by `runner::run_due_tasks_now`
/// so that the headless process knows where the database lives without a Tauri
/// `AppHandle` being available.
fn headless_app_data_dir() -> Option<PathBuf> {
    // 1. Prefer the env var injected by the spawning process.
    if let Ok(dir) = std::env::var("TALKCODY_APP_DATA_DIR") {
        let p = PathBuf::from(dir);
        if !p.as_os_str().is_empty() {
            return Some(p);
        }
    }

    // 2. Fall back to the platform default so the runner works even when
    //    invoked directly by launchd (which does not set the env var).
    #[cfg(target_os = "macos")]
    {
        dirs::data_dir().map(|d| d.join("com.talkcody"))
    }
    #[cfg(not(target_os = "macos"))]
    {
        dirs::data_dir().map(|d| d.join("talkcody"))
    }
}

/// Run the scheduler in headless mode (no Tauri window, no Dock icon).
///
/// This function is called when the binary is started with `--scheduled-task-runner`.
/// It opens the SQLite database, performs one scheduler tick to enqueue any due
/// tasks, and exits.  The main GUI process will pick up the queued runs via
/// `claim_scheduled_task_runs` the next time it is active.
pub fn run_headless_runner() {
    let data_dir = match headless_app_data_dir() {
        Some(d) => d,
        None => {
            eprintln!("[scheduled-task-runner] Could not determine app data directory");
            std::process::exit(1);
        }
    };

    let db_path = data_dir.join("talkcody.db");

    // Build a minimal tokio runtime — no Tauri involved, so no window appears.
    let rt = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(rt) => rt,
        Err(e) => {
            eprintln!(
                "[scheduled-task-runner] Failed to build tokio runtime: {}",
                e
            );
            std::process::exit(1);
        }
    };

    rt.block_on(async move {
        use crate::database::Database;
        use crate::scheduler::cron_utils::now_unix_ms;
        use crate::scheduler::repository::ScheduledTaskRepository;
        use crate::scheduler::types::{RunStatus, RunTriggerSource, ScheduledTaskRun};
        use uuid::Uuid;

        let db = Arc::new(Database::new(db_path.to_string_lossy().to_string()));

        if let Err(e) = db.connect().await {
            eprintln!("[scheduled-task-runner] DB connect error: {}", e);
            std::process::exit(1);
        }

        // Run migrations so the schema is up-to-date even on first headless run.
        {
            use crate::storage::migrations::{talkcody_db::talkcody_migrations, MigrationRunner};
            let registry = talkcody_migrations();
            let runner = MigrationRunner::new(&db, &registry);
            if let Err(e) = runner.migrate().await {
                eprintln!("[scheduled-task-runner] Migration error: {}", e);
                std::process::exit(1);
            }
        }

        let repo = ScheduledTaskRepository::new(Arc::clone(&db));
        let now_ms = now_unix_ms();

        let due_jobs = match repo.find_due_jobs(now_ms).await {
            Ok(jobs) => jobs,
            Err(e) => {
                eprintln!("[scheduled-task-runner] find_due_jobs error: {}", e);
                std::process::exit(1);
            }
        };

        for job in due_jobs {
            // Respect max_concurrent_runs even in headless mode.
            let running = repo.count_running_runs(&job.id).await.unwrap_or(0);
            if running >= job.execution_policy.max_concurrent_runs {
                // Advance the next_run_at so we don't keep retrying.
                let _ = advance_next_run_headless(&repo, &job, now_ms).await;
                continue;
            }

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
                trigger_source: RunTriggerSource::Schedule,
                scheduled_for_at: job.next_run_at,
                payload_snapshot_json: Some(
                    serde_json::to_string(&job.payload).unwrap_or_default(),
                ),
                project_id_snapshot: job.project_id.clone(),
                delivery_status: None,
                delivery_error: None,
            };

            if let Err(e) = repo.create_run(&run).await {
                eprintln!(
                    "[scheduled-task-runner] Failed to enqueue run for job {}: {}",
                    job.id, e
                );
                continue;
            }

            let _ = advance_next_run_headless(&repo, &job, now_ms).await;

            log::info!(
                "[scheduled-task-runner] Enqueued run {} for job {}",
                run_id,
                job.id
            );
        }
    });
}

use crate::scheduler::cron_utils::compute_next_run_at;

async fn advance_next_run_headless(
    repo: &crate::scheduler::repository::ScheduledTaskRepository,
    job: &crate::scheduler::types::ScheduledTask,
    now_ms: i64,
) -> Result<(), String> {
    let next = compute_next_run_at(&job.schedule, &job.execution_policy, now_ms, &job.id)?;
    repo.update_next_run(&job.id, Some(next), Some(now_ms))
        .await
}
