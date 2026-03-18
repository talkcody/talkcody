use super::{app_data_dir, executable_path, runner_args};
use std::process::Command;
use tauri::AppHandle;

pub fn run_due_tasks_now(app: &AppHandle) -> Result<(), String> {
    let exe = executable_path(app)?;
    let data_dir = app_data_dir(app)?;

    Command::new(exe)
        .args(runner_args())
        .env("TALKCODY_APP_DATA_DIR", data_dir)
        .spawn()
        .map_err(|e| format!("Failed to spawn scheduled task runner: {}", e))?;

    Ok(())
}
