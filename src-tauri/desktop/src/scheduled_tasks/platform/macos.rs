use crate::scheduled_tasks::{
    app_run_interval_minutes, executable_path, runner_args, ScheduledTaskRunnerStatus,
};
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use tauri::AppHandle;

fn plist_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Cannot resolve home directory".to_string())?;
    Ok(home
        .join("Library")
        .join("LaunchAgents")
        .join("com.talkcody.scheduler.plist"))
}

fn plist_content(executable: &str, args: &[String]) -> String {
    let mut program_args = format!("<string>{}</string>\n", executable);
    for arg in args {
        program_args.push_str(&format!("    <string>{}</string>\n", arg));
    }
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>com.talkcody.scheduler</string>
    <key>ProgramArguments</key>
    <array>
    {program_args}    </array>
    <key>StartInterval</key>
    <integer>{interval}</integer>
  </dict>
</plist>
"#,
        interval = app_run_interval_minutes() * 60,
        program_args = program_args
    )
}

pub fn status(_app: &AppHandle) -> Result<ScheduledTaskRunnerStatus, String> {
    let path = plist_path()?;
    Ok(ScheduledTaskRunnerStatus {
        supported: true,
        installed: path.exists(),
        platform: "macos".to_string(),
        detail: Some(path.to_string_lossy().to_string()),
    })
}

pub fn sync(app: &AppHandle, enabled: bool) -> Result<ScheduledTaskRunnerStatus, String> {
    let path = plist_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    if enabled {
        let exe = executable_path(app)?;
        let content = plist_content(&exe.to_string_lossy(), &runner_args());
        fs::write(&path, content).map_err(|e| e.to_string())?;
        let _ = Command::new("launchctl")
            .args(["unload", path.to_string_lossy().as_ref()])
            .output();
        let _ = Command::new("launchctl")
            .args(["load", path.to_string_lossy().as_ref()])
            .output();
    } else if path.exists() {
        let _ = Command::new("launchctl")
            .args(["unload", path.to_string_lossy().as_ref()])
            .output();
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }

    status(app)
}
