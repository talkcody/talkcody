#[cfg(target_os = "linux")]
pub mod linux;
#[cfg(target_os = "macos")]
pub mod macos;
#[cfg(windows)]
pub mod windows;

use super::ScheduledTaskRunnerStatus;
use tauri::AppHandle;

#[cfg(target_os = "macos")]
pub fn status(app: &AppHandle) -> Result<ScheduledTaskRunnerStatus, String> {
    macos::status(app)
}
#[cfg(target_os = "macos")]
pub fn sync(app: &AppHandle, enabled: bool) -> Result<ScheduledTaskRunnerStatus, String> {
    macos::sync(app, enabled)
}

#[cfg(windows)]
pub fn status(app: &AppHandle) -> Result<ScheduledTaskRunnerStatus, String> {
    windows::status(app)
}
#[cfg(windows)]
pub fn sync(app: &AppHandle, enabled: bool) -> Result<ScheduledTaskRunnerStatus, String> {
    windows::sync(app, enabled)
}

#[cfg(target_os = "linux")]
pub fn status(app: &AppHandle) -> Result<ScheduledTaskRunnerStatus, String> {
    linux::status(app)
}
#[cfg(target_os = "linux")]
pub fn sync(app: &AppHandle, enabled: bool) -> Result<ScheduledTaskRunnerStatus, String> {
    linux::sync(app, enabled)
}

#[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
pub fn status(_app: &AppHandle) -> Result<ScheduledTaskRunnerStatus, String> {
    Ok(ScheduledTaskRunnerStatus {
        supported: false,
        installed: false,
        platform: std::env::consts::OS.to_string(),
        detail: Some("OS scheduler integration is not supported on this platform".to_string()),
    })
}
#[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
pub fn sync(app: &AppHandle, _enabled: bool) -> Result<ScheduledTaskRunnerStatus, String> {
    status(app)
}
