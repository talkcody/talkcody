use crate::scheduled_tasks::{
    app_run_interval_minutes, executable_path, runner_args, ScheduledTaskRunnerStatus,
};
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use tauri::AppHandle;

fn systemd_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Cannot resolve home directory".to_string())?;
    Ok(home.join(".config").join("systemd").join("user"))
}

fn service_path() -> Result<PathBuf, String> {
    Ok(systemd_dir()?.join("talkcody-scheduler.service"))
}

fn timer_path() -> Result<PathBuf, String> {
    Ok(systemd_dir()?.join("talkcody-scheduler.timer"))
}

pub fn status(_app: &AppHandle) -> Result<ScheduledTaskRunnerStatus, String> {
    let timer = timer_path()?;
    Ok(ScheduledTaskRunnerStatus {
        supported: true,
        installed: timer.exists(),
        platform: "linux".to_string(),
        detail: Some(timer.to_string_lossy().to_string()),
    })
}

pub fn sync(app: &AppHandle, enabled: bool) -> Result<ScheduledTaskRunnerStatus, String> {
    let dir = systemd_dir()?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let service = service_path()?;
    let timer = timer_path()?;

    if enabled {
        let exe = executable_path(app)?;
        let args = runner_args().join(" ");
        fs::write(
            &service,
            format!(
                "[Unit]\nDescription=TalkCody Scheduled Task Runner\n\n[Service]\nType=oneshot\nExecStart={} {}\n",
                exe.to_string_lossy(),
                args
            ),
        )
        .map_err(|e| e.to_string())?;
        fs::write(
            &timer,
            format!(
                "[Unit]\nDescription=Run TalkCody Scheduler every {} minute\n\n[Timer]\nOnBootSec=30s\nOnUnitActiveSec={}min\nUnit=talkcody-scheduler.service\n\n[Install]\nWantedBy=timers.target\n",
                app_run_interval_minutes(),
                app_run_interval_minutes()
            ),
        )
        .map_err(|e| e.to_string())?;
        let _ = Command::new("systemctl")
            .args(["--user", "daemon-reload"])
            .output();
        let _ = Command::new("systemctl")
            .args(["--user", "enable", "--now", "talkcody-scheduler.timer"])
            .output();
    } else {
        let _ = Command::new("systemctl")
            .args(["--user", "disable", "--now", "talkcody-scheduler.timer"])
            .output();
        if service.exists() {
            fs::remove_file(&service).map_err(|e| e.to_string())?;
        }
        if timer.exists() {
            fs::remove_file(&timer).map_err(|e| e.to_string())?;
        }
        let _ = Command::new("systemctl")
            .args(["--user", "daemon-reload"])
            .output();
    }

    status(app)
}
