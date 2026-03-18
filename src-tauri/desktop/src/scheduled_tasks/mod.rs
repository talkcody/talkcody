//! Desktop scheduled task runner and OS scheduler integration.

pub mod platform;
pub mod runner;

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
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
