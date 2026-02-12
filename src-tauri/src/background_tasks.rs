// src-tauri/src/background_tasks.rs
// Background task management for long-running processes

use rand::Rng;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::fs::{create_dir_all, remove_dir_all, File, OpenOptions};
use tokio::io::{AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::Child;
use tokio::sync::{broadcast, Mutex};
use tokio::time::interval;

pub const DEFAULT_MAX_TIMEOUT_MS: u64 = 7_200_000; // 2 hours
pub const CLEANUP_DAYS: u64 = 7;

/// Background task status
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum BackgroundTaskStatus {
    Running,
    Completed,
    Failed,
    Killed,
    Timeout,
}

/// Background task information
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundTaskInfo {
    pub task_id: String,
    pub pid: u32,
    pub command: String,
    pub status: BackgroundTaskStatus,
    pub exit_code: Option<i32>,
    pub start_time: u64,
    pub end_time: Option<u64>,
    pub output_file: String,
    pub error_file: String,
    pub max_timeout_ms: Option<u64>,
    pub is_timed_out: bool,
}

/// Request to spawn a background task
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnBackgroundTaskRequest {
    pub command: String,
    pub cwd: Option<String>,
    pub max_timeout_ms: Option<u64>,
}

/// Response for spawn task
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnBackgroundTaskResponse {
    pub task_id: String,
    pub pid: u32,
    pub output_file: String,
    pub error_file: String,
    pub success: bool,
    pub error: Option<String>,
}

/// Response for task status
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetTaskStatusResponse {
    pub task_id: String,
    pub status: BackgroundTaskStatus,
    pub exit_code: Option<i32>,
    pub running_time_ms: u64,
    pub output_bytes: u64,
    pub error_bytes: u64,
}

/// Response for incremental output
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetIncrementalOutputResponse {
    pub task_id: String,
    pub new_stdout: String,
    pub new_stderr: String,
    pub stdout_bytes_read: u64,
    pub stderr_bytes_read: u64,
    pub is_complete: bool,
}

/// Response for listing tasks
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListTasksResponse {
    pub tasks: Vec<BackgroundTaskInfo>,
    pub running_count: usize,
    pub completed_count: usize,
}

/// Background task handle with process and output tracking
struct BackgroundTaskHandle {
    task_id: String,
    command: String,
    child: Child,
    pid: u32,
    output_file: PathBuf,
    error_file: PathBuf,
    start_time: u64,
    max_timeout_ms: Option<u64>,
    stdout_bytes_written: Arc<Mutex<u64>>,
    stderr_bytes_written: Arc<Mutex<u64>>,
    shutdown_tx: Option<broadcast::Sender<()>>,
    is_timed_out: bool,
    exit_code: Option<i32>,
}

/// Global background task registry
#[derive(Default)]
struct BackgroundTaskRegistry {
    tasks: HashMap<String, Arc<Mutex<BackgroundTaskHandle>>>,
}

impl BackgroundTaskRegistry {
    fn new() -> Self {
        Self {
            tasks: HashMap::new(),
        }
    }

    fn insert(&mut self, task_id: String, handle: Arc<Mutex<BackgroundTaskHandle>>) {
        self.tasks.insert(task_id, handle);
    }

    fn remove(&mut self, task_id: &str) -> Option<Arc<Mutex<BackgroundTaskHandle>>> {
        self.tasks.remove(task_id)
    }

    fn get(&self, task_id: &str) -> Option<Arc<Mutex<BackgroundTaskHandle>>> {
        self.tasks.get(task_id).cloned()
    }

    fn get_all(&self) -> Vec<Arc<Mutex<BackgroundTaskHandle>>> {
        self.tasks.values().cloned().collect()
    }
}

/// Get current timestamp in milliseconds
fn current_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
        .as_millis() as u64
}

/// Generate a unique task ID
fn generate_task_id() -> String {
    let mut rng = rand::thread_rng();
    let random_part: String = std::iter::repeat(())
        .take(8)
        .map(|_| rng.sample(rand::distributions::Alphanumeric) as char)
        .collect();
    format!("bg_{}", random_part)
}

/// Validate task ID to prevent path traversal
fn validate_task_id(task_id: &str) -> Result<(), String> {
    if task_id.is_empty() {
        return Err("Task ID cannot be empty".to_string());
    }

    // Only allow ASCII alphanumeric, underscore, and hyphen
    // Note: Use is_ascii_alphanumeric() instead of is_alphanumeric() to reject Unicode
    if !task_id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err("Task ID contains invalid characters".to_string());
    }

    // Check for path traversal attempts
    if task_id.contains("..") || task_id.contains('/') || task_id.contains('\\') {
        return Err("Task ID contains path traversal characters".to_string());
    }

    Ok(())
}

/// Get app data directory
async fn get_app_data_dir() -> Result<PathBuf, String> {
    let app_data_dir = dirs::data_dir()
        .ok_or_else(|| "Failed to get app data directory".to_string())?
        .join("com.talkcody");
    Ok(app_data_dir)
}

/// Get background tasks directory
async fn get_background_dir() -> Result<PathBuf, String> {
    let app_data_dir = get_app_data_dir().await?;
    let bg_dir = app_data_dir.join("background");
    if !bg_dir.exists() {
        create_dir_all(&bg_dir).await.map_err(|e| e.to_string())?;
    }
    Ok(bg_dir)
}

/// Get task directory for a specific task
async fn get_task_dir(task_id: &str) -> Result<PathBuf, String> {
    // Validate task ID to prevent path traversal
    validate_task_id(task_id)?;

    let bg_dir = get_background_dir().await?;
    let task_dir = bg_dir.join(task_id);
    if !task_dir.exists() {
        create_dir_all(&task_dir).await.map_err(|e| e.to_string())?;
    }
    Ok(task_dir)
}

/// Determine task status based on exit code and flags
fn determine_task_status(exit_code: Option<i32>, is_timed_out: bool) -> BackgroundTaskStatus {
    if is_timed_out {
        BackgroundTaskStatus::Timeout
    } else if let Some(code) = exit_code {
        if code == 0 {
            BackgroundTaskStatus::Completed
        } else {
            BackgroundTaskStatus::Failed
        }
    } else {
        BackgroundTaskStatus::Running
    }
}

/// Validate command for dangerous patterns (basic security check)
fn validate_command(command: &str) -> Result<(), String> {
    if command.trim().is_empty() {
        return Err("Command cannot be empty".to_string());
    }

    if command.contains('\0') {
        return Err("Command contains null byte".to_string());
    }

    Ok(())
}

/// Global registry storage using tokio Mutex
static REGISTRY: tokio::sync::OnceCell<Arc<Mutex<BackgroundTaskRegistry>>> =
    tokio::sync::OnceCell::const_new();

async fn get_registry() -> Arc<Mutex<BackgroundTaskRegistry>> {
    REGISTRY
        .get_or_init(|| async { Arc::new(Mutex::new(BackgroundTaskRegistry::new())) })
        .await
        .clone()
}

/// Spawn a background task
#[tauri::command]
pub async fn spawn_background_task(
    request: SpawnBackgroundTaskRequest,
) -> Result<SpawnBackgroundTaskResponse, String> {
    // Validate command
    validate_command(&request.command)?;

    let task_id = generate_task_id();
    let start_time = current_time_ms();
    let max_timeout = request.max_timeout_ms.unwrap_or(DEFAULT_MAX_TIMEOUT_MS);

    log::info!("Spawning background task {}: {}", task_id, request.command);

    // Get working directory
    let cwd = request.cwd.clone().or_else(|| {
        std::env::current_dir()
            .ok()
            .map(|p| p.to_string_lossy().to_string())
    });

    // Create task directory and output files
    let task_dir = get_task_dir(&task_id).await?;
    let output_file = task_dir.join("stdout.log");
    let error_file = task_dir.join("stderr.log");

    // Create output files
    let _ = File::create(&output_file)
        .await
        .map_err(|e| e.to_string())?;
    let _ = File::create(&error_file).await.map_err(|e| e.to_string())?;

    // Determine shell based on platform
    #[cfg(unix)]
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());

    #[cfg(windows)]
    let shell = crate::shell_utils::get_windows_shell();

    // Build command
    let mut cmd = if cfg!(unix) {
        let mut c = crate::shell_utils::new_async_command(&shell);
        c.arg("-l").arg("-i").arg("-c").arg(&request.command);
        c
    } else {
        let mut c = crate::shell_utils::new_async_command(&shell);
        if crate::shell_utils::is_powershell(&shell) {
            c.arg("-Command").arg(&request.command);
        } else {
            c.arg("/C").arg(&request.command);
        }
        c
    };

    if let Some(ref dir) = cwd {
        cmd.current_dir(dir);
    }

    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    // Spawn the process
    let mut child = cmd.spawn().map_err(|e| {
        log::error!("Failed to spawn background process: {}", e);
        format!("Failed to spawn process: {}", e)
    })?;

    // Get PID - handle Option<u32>
    let child_pid = child
        .id()
        .ok_or_else(|| "Failed to get process ID".to_string())?;
    log::info!(
        "Background task {} spawned with PID: {}",
        task_id,
        child_pid
    );

    // Take stdout/stderr for async reading
    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;

    // Create broadcast channel for shutdown signal (multiple receivers)
    let (shutdown_tx, _) = broadcast::channel::<()>(1);

    // Shared bytes counters
    let stdout_bytes = Arc::new(Mutex::new(0u64));
    let stderr_bytes = Arc::new(Mutex::new(0u64));

    // Spawn async tasks to read and write output
    let stdout_bytes_clone = stdout_bytes.clone();
    let output_file_clone = output_file.clone();
    let mut stdout_shutdown_rx = shutdown_tx.subscribe();
    tokio::spawn(async move {
        let _ = pipe_output_to_file(
            stdout,
            &output_file_clone,
            stdout_bytes_clone,
            &mut stdout_shutdown_rx,
        )
        .await;
    });

    let stderr_bytes_clone = stderr_bytes.clone();
    let error_file_clone = error_file.clone();
    let mut stderr_shutdown_rx = shutdown_tx.subscribe();
    tokio::spawn(async move {
        let _ = pipe_output_to_file(
            stderr,
            &error_file_clone,
            stderr_bytes_clone,
            &mut stderr_shutdown_rx,
        )
        .await;
    });

    // Create task handle
    let handle = Arc::new(Mutex::new(BackgroundTaskHandle {
        task_id: task_id.clone(),
        command: request.command.clone(),
        child,
        pid: child_pid,
        output_file: output_file.clone(),
        error_file: error_file.clone(),
        start_time,
        max_timeout_ms: Some(max_timeout),
        stdout_bytes_written: stdout_bytes,
        stderr_bytes_written: stderr_bytes,
        shutdown_tx: Some(shutdown_tx),
        is_timed_out: false,
        exit_code: None,
    }));

    // Register the task
    {
        let registry = get_registry().await;
        let mut registry_guard = registry.lock().await;
        registry_guard.insert(task_id.clone(), handle.clone());
    }

    // Start timeout monitor
    let timeout_task_id = task_id.clone();
    tokio::spawn(async move {
        monitor_task_timeout(timeout_task_id, max_timeout).await;
    });

    // Start process exit monitor
    let exit_task_id = task_id.clone();
    let exit_handle = handle.clone();
    tokio::spawn(async move {
        monitor_process_exit(exit_task_id, exit_handle).await;
    });

    Ok(SpawnBackgroundTaskResponse {
        task_id,
        pid: child_pid,
        output_file: output_file.to_string_lossy().to_string(),
        error_file: error_file.to_string_lossy().to_string(),
        success: true,
        error: None,
    })
}

/// Pipe output from reader to file with graceful shutdown
/// Uses raw byte reading to handle non-UTF8 output and avoid line-buffering issues
async fn pipe_output_to_file(
    reader: impl tokio::io::AsyncRead + Unpin,
    file_path: &PathBuf,
    bytes_written: Arc<Mutex<u64>>,
    shutdown_rx: &mut broadcast::Receiver<()>,
) -> Result<(), String> {
    use tokio::io::AsyncReadExt;

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(file_path)
        .await
        .map_err(|e| e.to_string())?;

    let mut buf_reader = BufReader::new(reader);
    let mut buf = [0u8; 8192];

    loop {
        tokio::select! {
            result = buf_reader.read(&mut buf) => {
                match result {
                    Ok(0) => {
                        // EOF
                        break;
                    }
                    Ok(n) => {
                        // Write raw bytes to file (handles non-UTF8 output)
                        file.write_all(&buf[..n]).await.map_err(|e| e.to_string())?;
                        file.flush().await.map_err(|e| e.to_string())?;

                        // Update bytes written with actual byte count
                        let mut bytes = bytes_written.lock().await;
                        *bytes += n as u64;
                    }
                    Err(e) => {
                        log::warn!("Error reading output: {}", e);
                        break;
                    }
                }
            }
            _ = shutdown_rx.recv() => {
                // Shutdown signal received
                log::info!("Output pipe shutting down gracefully");
                break;
            }
        }
    }

    Ok(())
}

/// Monitor process exit
async fn monitor_process_exit(task_id: String, handle: Arc<Mutex<BackgroundTaskHandle>>) {
    loop {
        tokio::time::sleep(Duration::from_millis(500)).await;

        let mut guard = handle.lock().await;

        // Try to check if process has exited
        match guard.child.try_wait() {
            Ok(Some(status)) => {
                let code = status.code();
                log::info!("Background task {} exited with code: {:?}", task_id, code);
                guard.exit_code = code;
                break;
            }
            Ok(None) => {
                // Still running
            }
            Err(e) => {
                log::error!("Error waiting for task {}: {}", task_id, e);
                break;
            }
        }
    }
}

/// Monitor task timeout
async fn monitor_task_timeout(task_id: String, timeout_ms: u64) {
    let check_interval = Duration::from_secs(5);
    let mut interval = interval(check_interval);
    let start_time = current_time_ms();
    let deadline = start_time + timeout_ms;

    loop {
        interval.tick().await;

        let current_time = current_time_ms();
        if current_time >= deadline {
            log::info!(
                "Background task {} timed out after {}ms",
                task_id,
                timeout_ms
            );

            // Mark task as timed out and kill it (without removing from registry)
            let registry = get_registry().await;
            let handle_opt = {
                let registry_guard = registry.lock().await;
                registry_guard.get(&task_id)
            };

            if let Some(handle) = handle_opt {
                let mut guard = handle.lock().await;
                guard.is_timed_out = true;

                // Kill the process directly without removing from registry
                // This allows users to still query the task status and output
                log::info!("Killing timed out background task {}", task_id);

                // Send shutdown signal to output tasks
                if let Some(shutdown_tx) = guard.shutdown_tx.take() {
                    let _ = shutdown_tx.send(());
                }

                // Kill the process
                if let Err(e) = guard.child.kill().await {
                    log::warn!("Failed to kill timed out task {}: {}", task_id, e);
                }

                // Wait briefly for process to terminate
                let _ = tokio::time::timeout(Duration::from_secs(2), guard.child.wait()).await;

                // Try to get exit code
                match guard.child.try_wait() {
                    Ok(Some(status)) => {
                        guard.exit_code = status.code();
                    }
                    _ => {}
                }
            }
            break;
        }

        // Check if task still exists
        let registry = get_registry().await;
        let exists = {
            let registry_guard = registry.lock().await;
            registry_guard.get(&task_id).is_some()
        };

        if !exists {
            // Task already completed or killed
            break;
        }
    }
}

/// Get task status
#[tauri::command]
pub async fn get_background_task_status(task_id: String) -> Result<GetTaskStatusResponse, String> {
    validate_task_id(&task_id)?;

    let registry = get_registry().await;
    let handle = {
        let registry_guard = registry.lock().await;
        registry_guard.get(&task_id)
    };

    if let Some(handle) = handle {
        let guard = handle.lock().await;

        let status = determine_task_status(guard.exit_code, guard.is_timed_out);
        let running_time = current_time_ms() - guard.start_time;

        let stdout_bytes = *guard.stdout_bytes_written.lock().await;
        let stderr_bytes = *guard.stderr_bytes_written.lock().await;

        Ok(GetTaskStatusResponse {
            task_id,
            status,
            exit_code: guard.exit_code,
            running_time_ms: running_time,
            output_bytes: stdout_bytes,
            error_bytes: stderr_bytes,
        })
    } else {
        Err(format!("Task not found: {}", task_id))
    }
}

/// Get incremental output
#[tauri::command]
pub async fn get_background_task_output(
    task_id: String,
    stdout_bytes_read: u64,
    stderr_bytes_read: u64,
) -> Result<GetIncrementalOutputResponse, String> {
    validate_task_id(&task_id)?;

    let registry = get_registry().await;
    let handle = {
        let registry_guard = registry.lock().await;
        registry_guard.get(&task_id)
    };

    if let Some(handle) = handle {
        let guard = handle.lock().await;

        // Read new content from files with efficient seek
        let output_file = &guard.output_file;
        let error_file = &guard.error_file;

        // Returns (content, next_offset) to prevent skipping data when reads are capped
        let (new_stdout, next_stdout_offset) =
            read_file_content(output_file, stdout_bytes_read).await?;
        let (new_stderr, next_stderr_offset) =
            read_file_content(error_file, stderr_bytes_read).await?;

        // Check if process is complete (including timed out tasks)
        let is_complete = guard.exit_code.is_some() || guard.is_timed_out;

        Ok(GetIncrementalOutputResponse {
            task_id,
            new_stdout,
            new_stderr,
            stdout_bytes_read: next_stdout_offset,
            stderr_bytes_read: next_stderr_offset,
            is_complete,
        })
    } else {
        Err(format!("Task not found: {}", task_id))
    }
}

/// Maximum bytes to read in a single call to prevent memory issues
const MAX_READ_BYTES: usize = 64 * 1024; // 64KB

/// Read file content from specific byte offset with efficient seeking
/// Returns (content, next_offset) where next_offset is from_byte + bytes_read
/// This ensures incremental output doesn't skip data when capping reads
async fn read_file_content(file_path: &PathBuf, from_byte: u64) -> Result<(String, u64), String> {
    use tokio::io::AsyncSeekExt;

    if !file_path.exists() {
        return Ok((String::new(), from_byte));
    }

    let mut file = OpenOptions::new()
        .read(true)
        .open(file_path)
        .await
        .map_err(|e| e.to_string())?;

    let metadata = file.metadata().await.map_err(|e| e.to_string())?;
    let file_size = metadata.len();

    if from_byte >= file_size {
        return Ok((String::new(), from_byte));
    }

    // Seek to the position
    file.seek(std::io::SeekFrom::Start(from_byte))
        .await
        .map_err(|e| e.to_string())?;

    // Limit bytes to read to prevent memory issues with large files
    let remaining = (file_size - from_byte) as usize;
    let bytes_to_read = remaining.min(MAX_READ_BYTES);
    let mut buffer = vec![0u8; bytes_to_read];

    // Use read instead of read_exact to handle partial reads
    let n = file.read(&mut buffer).await.map_err(|e| e.to_string())?;

    // Truncate buffer to actual bytes read
    buffer.truncate(n);

    // Calculate next offset based on actual bytes read
    let next_offset = from_byte + n as u64;

    // Use lossy decoding to handle non-UTF8 output gracefully
    let content = String::from_utf8_lossy(&buffer).to_string();
    Ok((content, next_offset))
}

/// Kill a background task
/// Keeps the task registered until the process is confirmed terminated
#[tauri::command]
pub async fn kill_background_task(task_id: String) -> Result<bool, String> {
    validate_task_id(&task_id)?;

    let registry = get_registry().await;
    // Get handle without removing from registry yet
    let handle = {
        let registry_guard = registry.lock().await;
        registry_guard.get(&task_id).map(|h| h.clone())
    };

    if let Some(handle) = handle {
        let mut guard = handle.lock().await;

        log::info!("Killing background task {}", task_id);

        // Send shutdown signal to output tasks
        if let Some(shutdown_tx) = guard.shutdown_tx.take() {
            let _ = shutdown_tx.send(());
        }

        // Kill the process and return error if it fails
        guard.child.kill().await.map_err(|e| {
            log::error!("Failed to kill task {}: {}", task_id, e);
            format!("Failed to kill task {}: {}", task_id, e)
        })?;

        // Wait for process to terminate (with timeout)
        let _ = tokio::time::timeout(Duration::from_secs(2), guard.child.wait()).await;

        log::info!("Background task {} killed successfully", task_id);

        // Only remove from registry after successful kill
        let mut registry_guard = registry.lock().await;
        registry_guard.remove(&task_id);

        Ok(true)
    } else {
        Ok(false)
    }
}

/// List all background tasks
#[tauri::command]
pub async fn list_background_tasks() -> Result<ListTasksResponse, String> {
    let registry = get_registry().await;
    let handles = {
        let registry_guard = registry.lock().await;
        registry_guard.get_all()
    };

    let mut tasks: Vec<BackgroundTaskInfo> = Vec::new();
    let mut running_count = 0;
    let mut completed_count = 0;

    for handle in handles {
        let guard = handle.lock().await;

        let status = determine_task_status(guard.exit_code, guard.is_timed_out);

        if matches!(status, BackgroundTaskStatus::Running) {
            running_count += 1;
        } else {
            completed_count += 1;
        }

        let end_time = guard.exit_code.map(|_| current_time_ms());

        let task_info = BackgroundTaskInfo {
            task_id: guard.task_id.clone(),
            pid: guard.pid,
            command: guard.command.clone(),
            status,
            exit_code: guard.exit_code,
            start_time: guard.start_time,
            end_time,
            output_file: guard.output_file.to_string_lossy().to_string(),
            error_file: guard.error_file.to_string_lossy().to_string(),
            max_timeout_ms: guard.max_timeout_ms,
            is_timed_out: guard.is_timed_out,
        };

        tasks.push(task_info);
    }

    Ok(ListTasksResponse {
        tasks,
        running_count,
        completed_count,
    })
}

/// Cleanup old background task directories
#[tauri::command]
pub async fn cleanup_background_tasks() -> Result<u32, String> {
    let bg_dir = get_background_dir().await?;
    let cutoff = SystemTime::now() - Duration::from_secs(CLEANUP_DAYS * 24 * 60 * 60);

    if !bg_dir.exists() {
        return Ok(0);
    }

    let mut cleaned_count = 0;
    let entries = std::fs::read_dir(&bg_dir).map_err(|e| e.to_string())?;

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        if let Ok(metadata) = entry.metadata() {
            if let Ok(modified) = metadata.modified() {
                if modified < cutoff {
                    log::info!("Cleaning up old background task: {:?}", path);
                    if let Err(e) = remove_dir_all(&path).await {
                        log::warn!("Failed to cleanup task directory {:?}: {}", path, e);
                    } else {
                        cleaned_count += 1;
                    }
                }
            }
        }
    }

    Ok(cleaned_count)
}

#[cfg(test)]
mod tests {
    use super::*;

    // =========================================================================
    // Tests for validate_task_id - Path Traversal Security (Bug #8)
    // =========================================================================

    #[test]
    fn test_validate_task_id_valid_alphanumeric() {
        assert!(validate_task_id("bg_abc123").is_ok());
        assert!(validate_task_id("task123").is_ok());
        assert!(validate_task_id("ABC123xyz").is_ok());
    }

    #[test]
    fn test_validate_task_id_valid_with_underscore_hyphen() {
        assert!(validate_task_id("bg_task-1").is_ok());
        assert!(validate_task_id("my-task_123").is_ok());
        assert!(validate_task_id("task_with_underscore").is_ok());
        assert!(validate_task_id("task-with-hyphen").is_ok());
    }

    #[test]
    fn test_validate_task_id_empty_rejected() {
        let result = validate_task_id("");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("cannot be empty"));
    }

    #[test]
    fn test_validate_task_id_path_traversal_dot_dot() {
        // This was the critical security bug - path traversal with ..
        let result = validate_task_id("../etc/passwd");
        assert!(result.is_err());

        let result = validate_task_id("..\\windows\\system32");
        assert!(result.is_err());

        let result = validate_task_id("task/../other");
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_task_id_path_traversal_forward_slash() {
        let result = validate_task_id("task/subdir");
        assert!(result.is_err());

        let result = validate_task_id("/etc/passwd");
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_task_id_path_traversal_backslash() {
        let result = validate_task_id("task\\subdir");
        assert!(result.is_err());

        let result = validate_task_id("C:\\Windows\\System32");
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_task_id_invalid_special_chars() {
        assert!(validate_task_id("task@123").is_err());
        assert!(validate_task_id("task#123").is_err());
        assert!(validate_task_id("task$123").is_err());
        assert!(validate_task_id("task%123").is_err());
        assert!(validate_task_id("task&123").is_err());
        assert!(validate_task_id("task*123").is_err());
        assert!(validate_task_id("task!123").is_err());
        assert!(validate_task_id("task 123").is_err()); // space
        assert!(validate_task_id("task\t123").is_err()); // tab
        assert!(validate_task_id("task\n123").is_err()); // newline
    }

    #[test]
    fn test_validate_task_id_unicode_rejected() {
        // Unicode characters should be rejected
        assert!(validate_task_id("task中文").is_err());
        assert!(validate_task_id("task日本語").is_err());
        assert!(validate_task_id("täsk").is_err());
    }

    // =========================================================================
    // Tests for BackgroundTaskStatus serialization (Bug #6)
    // =========================================================================

    #[test]
    fn test_status_serializes_to_lowercase() {
        // Bug was: enum variants were PascalCase but frontend expected lowercase
        let status = BackgroundTaskStatus::Running;
        let json = serde_json::to_string(&status).unwrap();
        assert_eq!(json, "\"running\"");

        let status = BackgroundTaskStatus::Completed;
        let json = serde_json::to_string(&status).unwrap();
        assert_eq!(json, "\"completed\"");

        let status = BackgroundTaskStatus::Failed;
        let json = serde_json::to_string(&status).unwrap();
        assert_eq!(json, "\"failed\"");

        let status = BackgroundTaskStatus::Killed;
        let json = serde_json::to_string(&status).unwrap();
        assert_eq!(json, "\"killed\"");

        let status = BackgroundTaskStatus::Timeout;
        let json = serde_json::to_string(&status).unwrap();
        assert_eq!(json, "\"timeout\"");
    }

    #[test]
    fn test_status_deserializes_from_lowercase() {
        let status: BackgroundTaskStatus = serde_json::from_str("\"running\"").unwrap();
        assert_eq!(status, BackgroundTaskStatus::Running);

        let status: BackgroundTaskStatus = serde_json::from_str("\"completed\"").unwrap();
        assert_eq!(status, BackgroundTaskStatus::Completed);

        let status: BackgroundTaskStatus = serde_json::from_str("\"failed\"").unwrap();
        assert_eq!(status, BackgroundTaskStatus::Failed);

        let status: BackgroundTaskStatus = serde_json::from_str("\"killed\"").unwrap();
        assert_eq!(status, BackgroundTaskStatus::Killed);

        let status: BackgroundTaskStatus = serde_json::from_str("\"timeout\"").unwrap();
        assert_eq!(status, BackgroundTaskStatus::Timeout);
    }

    #[test]
    fn test_status_pascalcase_deserialization_fails() {
        // Ensure PascalCase doesn't work (frontend sends lowercase)
        let result: Result<BackgroundTaskStatus, _> = serde_json::from_str("\"Running\"");
        assert!(result.is_err());

        let result: Result<BackgroundTaskStatus, _> = serde_json::from_str("\"Completed\"");
        assert!(result.is_err());
    }

    // =========================================================================
    // Tests for validate_command (Bug prevention)
    // =========================================================================

    #[test]
    fn test_validate_command_valid() {
        assert!(validate_command("ls -la").is_ok());
        assert!(validate_command("echo hello").is_ok());
        assert!(validate_command("npm run build").is_ok());
        assert!(validate_command("python script.py").is_ok());
    }

    #[test]
    fn test_validate_command_empty_rejected() {
        let result = validate_command("");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("cannot be empty"));

        let result = validate_command("   ");
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_command_null_byte_rejected() {
        let result = validate_command("ls\0-la");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("null byte"));
    }

    // =========================================================================
    // Tests for determine_task_status logic
    // =========================================================================

    #[test]
    fn test_determine_status_running() {
        // No exit code, not timed out = Running
        let status = determine_task_status(None, false);
        assert_eq!(status, BackgroundTaskStatus::Running);
    }

    #[test]
    fn test_determine_status_completed() {
        // Exit code 0 = Completed
        let status = determine_task_status(Some(0), false);
        assert_eq!(status, BackgroundTaskStatus::Completed);
    }

    #[test]
    fn test_determine_status_failed() {
        // Non-zero exit code = Failed
        let status = determine_task_status(Some(1), false);
        assert_eq!(status, BackgroundTaskStatus::Failed);

        let status = determine_task_status(Some(-1), false);
        assert_eq!(status, BackgroundTaskStatus::Failed);

        let status = determine_task_status(Some(127), false);
        assert_eq!(status, BackgroundTaskStatus::Failed);
    }

    #[test]
    fn test_determine_status_timeout() {
        // Timeout flag takes precedence
        let status = determine_task_status(None, true);
        assert_eq!(status, BackgroundTaskStatus::Timeout);

        // Even with exit code, timeout takes precedence
        let status = determine_task_status(Some(0), true);
        assert_eq!(status, BackgroundTaskStatus::Timeout);

        let status = determine_task_status(Some(1), true);
        assert_eq!(status, BackgroundTaskStatus::Timeout);
    }

    // =========================================================================
    // Tests for generate_task_id format
    // =========================================================================

    #[test]
    fn test_generate_task_id_format() {
        let task_id = generate_task_id();

        // Should start with "bg_"
        assert!(task_id.starts_with("bg_"));

        // Should be valid according to our validation
        assert!(validate_task_id(&task_id).is_ok());

        // Should be reasonable length
        assert!(task_id.len() > 3 && task_id.len() < 50);
    }

    #[test]
    fn test_generate_task_id_unique() {
        // Generate multiple IDs and ensure they're all different
        let ids: Vec<String> = (0..100).map(|_| generate_task_id()).collect();
        let unique_ids: std::collections::HashSet<_> = ids.iter().collect();
        assert_eq!(ids.len(), unique_ids.len());
    }

    // =========================================================================
    // Tests for BackgroundTaskInfo serialization (camelCase)
    // =========================================================================

    #[test]
    fn test_task_info_serializes_camelcase() {
        let info = BackgroundTaskInfo {
            task_id: "bg_test123".to_string(),
            pid: 12345,
            command: "echo hello".to_string(),
            status: BackgroundTaskStatus::Running,
            exit_code: None,
            start_time: 1000000,
            end_time: None,
            output_file: "/tmp/stdout.log".to_string(),
            error_file: "/tmp/stderr.log".to_string(),
            max_timeout_ms: Some(7200000),
            is_timed_out: false,
        };

        let json = serde_json::to_string(&info).unwrap();

        // Check camelCase field names
        assert!(json.contains("\"taskId\""));
        assert!(json.contains("\"startTime\""));
        assert!(json.contains("\"endTime\""));
        assert!(json.contains("\"exitCode\""));
        assert!(json.contains("\"outputFile\""));
        assert!(json.contains("\"errorFile\""));
        assert!(json.contains("\"maxTimeoutMs\""));
        assert!(json.contains("\"isTimedOut\""));

        // Ensure snake_case is NOT used
        assert!(!json.contains("\"task_id\""));
        assert!(!json.contains("\"start_time\""));
        assert!(!json.contains("\"max_timeout_ms\""));
    }

    // =========================================================================
    // Tests for SpawnBackgroundTaskResponse serialization
    // =========================================================================

    #[test]
    fn test_spawn_response_serializes_camelcase() {
        let response = SpawnBackgroundTaskResponse {
            task_id: "bg_test".to_string(),
            pid: 123,
            output_file: "/tmp/out.log".to_string(),
            error_file: "/tmp/err.log".to_string(),
            success: true,
            error: None,
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("\"taskId\""));
        assert!(json.contains("\"outputFile\""));
        assert!(json.contains("\"errorFile\""));
        assert!(!json.contains("\"task_id\""));
    }

    // =========================================================================
    // Tests for constants
    // =========================================================================

    #[test]
    fn test_default_timeout_is_two_hours() {
        assert_eq!(DEFAULT_MAX_TIMEOUT_MS, 7_200_000);
        // 2 hours = 2 * 60 * 60 * 1000 = 7,200,000 ms
        assert_eq!(DEFAULT_MAX_TIMEOUT_MS, 2 * 60 * 60 * 1000);
    }

    #[test]
    fn test_cleanup_days_is_seven() {
        assert_eq!(CLEANUP_DAYS, 7);
    }
}
