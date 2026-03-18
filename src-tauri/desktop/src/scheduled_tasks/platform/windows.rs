use crate::scheduled_tasks::{
    app_run_interval_minutes, executable_path, runner_args, ScheduledTaskRunnerStatus,
};
use std::process::Command;
use tauri::AppHandle;

const TASK_NAME: &str = "TalkCodyScheduledTaskRunner";

pub fn status(_app: &AppHandle) -> Result<ScheduledTaskRunnerStatus, String> {
    let output = Command::new("schtasks")
        .args(["/Query", "/TN", TASK_NAME])
        .output()
        .map_err(|e| e.to_string())?;

    Ok(ScheduledTaskRunnerStatus {
        supported: true,
        installed: output.status.success(),
        platform: "windows".to_string(),
        detail: Some(TASK_NAME.to_string()),
    })
}

pub fn sync(app: &AppHandle, enabled: bool) -> Result<ScheduledTaskRunnerStatus, String> {
    if enabled {
        let exe = executable_path(app)?;
        let mut task_run = format!("\"{}\"", exe.to_string_lossy());
        for arg in runner_args() {
            task_run.push(' ');
            task_run.push_str(&arg);
        }
        let _ = Command::new("schtasks")
            .args([
                "/Create",
                "/F",
                "/SC",
                "MINUTE",
                "/MO",
                &app_run_interval_minutes().to_string(),
                "/TN",
                TASK_NAME,
                "/TR",
                &task_run,
            ])
            .output();
    } else {
        let _ = Command::new("schtasks")
            .args(["/Delete", "/F", "/TN", TASK_NAME])
            .output();
    }

    status(app)
}
