use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use log::{error, info, warn};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PtySpawnResult {
    pub pty_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PtyOutput {
    pub pty_id: String,
    pub data: String,
}

struct PtySession {
    writer: Box<dyn Write + Send>,
}

type PtyRegistry = Arc<Mutex<HashMap<String, PtySession>>>;

lazy_static::lazy_static! {
    static ref PTY_SESSIONS: PtyRegistry = Arc::new(Mutex::new(HashMap::new()));
}

/// Windows shell configurations: (command, version_args, shell_args)
#[cfg(target_os = "windows")]
const WINDOWS_SHELLS: &[(&str, &[&str], &[&str])] = &[
    ("pwsh", &["--version"], &["-NoLogo", "-NoExit"]),
    ("powershell", &["-Version"], &["-NoLogo", "-NoExit"]),
    ("cmd.exe", &["/?"], &[]),
];

/// Check if a shell command is available and working
#[cfg(target_os = "windows")]
fn check_shell_available(cmd: &str, args: &[&str]) -> bool {
    match std::process::Command::new(cmd).args(args).output() {
        Ok(output) => {
            if output.status.success() {
                true
            } else {
                warn!(
                    "{} found but returned error status: {:?}",
                    cmd, output.status
                );
                false
            }
        }
        Err(e) => {
            info!("{} not available: {}", cmd, e);
            false
        }
    }
}

/// Get default shell based on user preference or auto-detection
fn get_default_shell(preferred_shell: Option<&str>) -> String {
    #[cfg(target_os = "windows")]
    {
        // If user specified a shell, try to use it
        if let Some(shell) = preferred_shell {
            if shell != "auto" {
                info!("Using user-preferred shell: {}", shell);
                return shell.to_string();
            }
        }

        // Auto-detect: prefer PowerShell Core > Windows PowerShell > cmd.exe
        for (cmd, version_args, _) in WINDOWS_SHELLS {
            if check_shell_available(cmd, version_args) {
                info!("Detected shell: {}", cmd);
                return cmd.to_string();
            }
        }

        // Final fallback
        warn!("No shell detected, falling back to COMSPEC or cmd.exe");
        std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string())
    }

    #[cfg(not(target_os = "windows"))]
    {
        // If user specified a shell, try to use it
        if let Some(shell) = preferred_shell {
            if shell != "auto" {
                info!("Using user-preferred shell: {}", shell);
                return shell.to_string();
            }
        }

        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
    }
}

/// Get shell arguments based on shell type
#[cfg(target_os = "windows")]
fn get_shell_args(shell: &str) -> Vec<&'static str> {
    for (cmd, _, args) in WINDOWS_SHELLS {
        if shell.contains(cmd) {
            return args.to_vec();
        }
    }
    // Default: no args for unknown shells
    vec![]
}

/// Try to spawn shells in order, falling back to next shell if one fails
#[cfg(target_os = "windows")]
fn spawn_with_fallback(
    slave: &Box<dyn portable_pty::PtySlave>,
    cwd: Option<&str>,
) -> Result<(String, Box<dyn portable_pty::Child + Send + Sync>), String> {
    let mut last_error = String::new();

    for (shell_cmd, version_args, shell_args) in WINDOWS_SHELLS {
        // First check if shell is available
        if !check_shell_available(shell_cmd, version_args) {
            info!("Shell {} not available, trying next...", shell_cmd);
            continue;
        }

        info!("Attempting to spawn shell: {}", shell_cmd);
        let mut cmd = CommandBuilder::new(*shell_cmd);

        if let Some(cwd_path) = cwd {
            cmd.cwd(cwd_path);
        }

        if !shell_args.is_empty() {
            cmd.args(*shell_args);
            info!("Added shell args: {:?}", shell_args);
        }

        match slave.spawn_command(cmd) {
            Ok(child) => {
                info!("Successfully spawned shell: {}", shell_cmd);
                return Ok((shell_cmd.to_string(), child));
            }
            Err(e) => {
                warn!("Failed to spawn shell '{}': {}, trying next...", shell_cmd, e);
                last_error = format!("Failed to spawn shell '{}': {}", shell_cmd, e);
            }
        }
    }

    // All shells failed
    error!("All shell spawn attempts failed. Last error: {}", last_error);
    Err(format!(
        "Failed to spawn any shell. Tried: {:?}. Last error: {}",
        WINDOWS_SHELLS.iter().map(|(cmd, _, _)| *cmd).collect::<Vec<_>>(),
        last_error
    ))
}

#[tauri::command]
pub async fn pty_spawn(
    app: AppHandle,
    cwd: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
    preferred_shell: Option<String>,
) -> Result<PtySpawnResult, String> {
    info!("Spawning new PTY session");

    let pty_system = native_pty_system();
    let pty_size = PtySize {
        rows: rows.unwrap_or(24),
        cols: cols.unwrap_or(80),
        pixel_width: 0,
        pixel_height: 0,
    };

    let pair = pty_system
        .openpty(pty_size)
        .map_err(|e| format!("Failed to open PTY: {}", e))?;

    // Try to spawn shell with fallback mechanism on Windows
    #[cfg(target_os = "windows")]
    let (shell, child) = {
        let preferred = preferred_shell.as_deref();

        // If user specified a specific shell (not auto), try only that shell
        if let Some(shell) = preferred {
            if shell != "auto" {
                info!("Attempting user-specified shell: {}", shell);
                let mut cmd = CommandBuilder::new(shell);
                if let Some(ref cwd_path) = cwd {
                    cmd.cwd(cwd_path);
                }
                let args = get_shell_args(shell);
                if !args.is_empty() {
                    cmd.args(&args);
                    info!("Added shell args: {:?}", args);
                }
                let child = pair.slave.spawn_command(cmd).map_err(|e| {
                    error!("Failed to spawn user-specified shell '{}': {}", shell, e);
                    format!("Failed to spawn shell '{}': {}", shell, e)
                })?;
                (shell.to_string(), child)
            } else {
                // Auto mode: try shells in order with fallback
                spawn_with_fallback(&pair.slave, cwd.as_deref())?
            }
        } else {
            // No preference: auto mode
            spawn_with_fallback(&pair.slave, cwd.as_deref())?
        }
    };

    #[cfg(not(target_os = "windows"))]
    let (shell, child) = {
        let shell = get_default_shell(preferred_shell.as_deref());
        info!("Spawning shell: {}", shell);
        let mut cmd = CommandBuilder::new(&shell);

        if let Some(ref cwd_path) = cwd {
            info!("Setting working directory: {}", cwd_path);
            cmd.cwd(cwd_path);
        }

        // Check if shell is zsh and disable PROMPT_SP (partial line marker)
        if shell.contains("zsh") {
            cmd.args(&["-o", "no_prompt_sp", "-l"]);
        } else {
            cmd.arg("-l");
        }

        let child = pair.slave.spawn_command(cmd).map_err(|e| {
            error!("Failed to spawn shell '{}': {}", shell, e);
            format!("Failed to spawn shell: {}", e)
        })?;

        (shell, child)
    };

    info!("Shell '{}' spawned successfully", shell);

    let pty_id = uuid::Uuid::new_v4().to_string();
    let writer = pair.master.take_writer().map_err(|e| format!("Failed to take writer: {}", e))?;
    let mut reader = pair.master.try_clone_reader().map_err(|e| format!("Failed to clone reader: {}", e))?;

    // Store the session
    {
        let mut sessions = PTY_SESSIONS.lock().unwrap();
        sessions.insert(
            pty_id.clone(),
            PtySession {
                writer,
            },
        );
    }

    // Spawn a task to read output
    let pty_id_clone = pty_id.clone();
    let app_clone = app.clone();
    info!("Starting PTY read loop for {}", pty_id);
    tokio::spawn(async move {
        let mut buffer = [0u8; 8192];
        info!("PTY {} read loop started", pty_id_clone);
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => {
                    info!("PTY {} closed (read returned 0)", pty_id_clone);
                    // PTY closed
                    let _ = app_clone.emit(
                        "pty-output",
                        PtyOutput {
                            pty_id: pty_id_clone.clone(),
                            data: String::new(),
                        },
                    );
                    break;
                }
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buffer[..n]).to_string();
                    info!("PTY {} read {} bytes", pty_id_clone, n);
                    let emit_result = app_clone.emit(
                        "pty-output",
                        PtyOutput {
                            pty_id: pty_id_clone.clone(),
                            data,
                        },
                    );
                    if let Err(e) = emit_result {
                        error!("Failed to emit pty-output event: {}", e);
                    }
                }
                Err(e) => {
                    error!("Error reading from PTY {}: {}", pty_id_clone, e);
                    break;
                }
            }
        }

        // Clean up session
        let mut sessions = PTY_SESSIONS.lock().unwrap();
        sessions.remove(&pty_id_clone);

        // Emit close event
        let _ = app_clone.emit(
            "pty-close",
            serde_json::json!({ "pty_id": pty_id_clone }),
        );
    });

    // Wait a bit for the child process to start
    drop(child);

    Ok(PtySpawnResult { pty_id })
}

#[tauri::command]
pub fn pty_write(pty_id: String, data: String) -> Result<(), String> {
    info!("pty_write called: pty_id={}, data_len={}", pty_id, data.len());
    let mut sessions = PTY_SESSIONS.lock().unwrap();

    if let Some(session) = sessions.get_mut(&pty_id) {
        session
            .writer
            .write_all(data.as_bytes())
            .map_err(|e| {
                error!("Failed to write to PTY {}: {}", pty_id, e);
                format!("Failed to write to PTY: {}", e)
            })?;
        session
            .writer
            .flush()
            .map_err(|e| {
                error!("Failed to flush PTY {}: {}", pty_id, e);
                format!("Failed to flush PTY: {}", e)
            })?;
        info!("pty_write successful for {}", pty_id);
        Ok(())
    } else {
        error!("PTY session {} not found", pty_id);
        Err(format!("PTY session {} not found", pty_id))
    }
}

#[tauri::command]
pub fn pty_resize(pty_id: String, cols: u16, rows: u16) -> Result<(), String> {
    info!("Resizing PTY {} to {}x{}", pty_id, cols, rows);
    // Note: portable-pty doesn't provide direct access to resize after creation
    // This would require keeping a reference to the PtyPair, which complicates the design
    // For now, we'll accept the command but note that resize isn't fully implemented
    // A full implementation would require restructuring to keep the PtyPair accessible
    Ok(())
}

#[tauri::command]
pub fn pty_kill(pty_id: String) -> Result<(), String> {
    info!("Killing PTY session {}", pty_id);
    let mut sessions = PTY_SESSIONS.lock().unwrap();

    if sessions.remove(&pty_id).is_some() {
        Ok(())
    } else {
        Err(format!("PTY session {} not found", pty_id))
    }
}
