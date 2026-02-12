pub mod analytics;
pub mod archive;
pub mod background_tasks;
pub mod code_navigation;
pub mod constants;
pub mod core;
pub mod database;
pub mod device_id;
pub mod directory_tree;
pub mod dock_menu;
pub mod feishu_gateway;
pub mod file_search;
pub mod file_watcher;
pub mod git;
pub mod glob;
pub mod http_proxy;
pub mod integrations;
pub mod keep_awake;
pub mod lint;
pub mod list_files;
pub mod llm;
pub mod lsp;
pub mod oauth_callback_server;
pub mod platform;
pub mod script_executor;
pub mod search;
pub mod security;
pub mod server;
pub mod shell_utils;
pub mod storage;
pub mod streaming;
pub mod telegram_gateway;
pub mod terminal;
pub mod walker;
pub mod websocket;
pub mod window_manager;

use analytics::AnalyticsState;
use archive::{
    CreateTarballRequest, CreateTarballResult, ExtractTarballRequest, ExtractTarballResult,
};
use code_navigation::{CodeNavState, CodeNavigationService};
use database::Database;
use file_watcher::FileWatcher;
use llm::tracing::writer::TraceWriter;
use script_executor::{ScriptExecutionRequest, ScriptExecutionResult, ScriptExecutor};
use serde::{Deserialize, Serialize};
use server::{config::ServerConfig, state::ServerState};
use std::process::Stdio;
use std::sync::OnceLock;
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant, SystemTime};
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};
use tokio::io::BufReader;
use tokio::process::Command as TokioCommand;
use tokio::sync::Mutex as TokioMutex;
use tokio::time::Duration as TokioDuration;
use websocket::WebSocketState;
use window_manager::{create_window, WindowRegistry, WindowState};

// Global app handle for dock menu and other cross-module access
// This is initialized once during app setup and provides safe static access to the AppHandle
//
// SAFETY: This uses OnceLock which guarantees:
// - Thread-safe initialization (only the first call to set() succeeds)
// - No data races (immutable after initialization)
// - Static lifetime (lives for entire program duration)
//
// IMPORTANT: set_app_handle() must be called exactly once during app.setup()
// before any code calls get_app_handle()
static APP_HANDLE: OnceLock<tauri::AppHandle> = OnceLock::new();

/// Server information for client discovery
#[derive(Clone)]
pub struct ServerInfo {
    pub addr: std::net::SocketAddr,
}

/// Initialize the global app handle
///
/// # Panics
///
/// Panics if called more than once. This should only be called once during app.setup().
/// Multiple calls indicate a programming error in the initialization sequence.
pub fn set_app_handle(app: tauri::AppHandle) {
    APP_HANDLE.set(app).expect(
        "FATAL: set_app_handle() called more than once. This is a bug in app initialization.",
    );
}

/// Get the global app handle
///
/// # Panics
///
/// Panics if called before set_app_handle(). All calls to this function must happen
/// after the app is fully initialized in app.setup().
pub fn get_app_handle() -> &'static tauri::AppHandle {
    APP_HANDLE
        .get()
        .expect("FATAL: get_app_handle() called before set_app_handle(). This is a bug in initialization order.")
}

#[derive(Clone, Serialize, Deserialize)]
struct Payload {
    args: Vec<String>,
    cwd: String,
}

// Legacy: Keep for backward compatibility with existing windows
struct AppState {
    file_watcher: Mutex<Option<FileWatcher>>,
    window_registry: WindowRegistry,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CloseAction {
    Allow,
    ExitApp,
}

fn close_action_for_window(label: &str) -> CloseAction {
    if label == "main" {
        CloseAction::ExitApp
    } else {
        CloseAction::Allow
    }
}

#[tauri::command]
fn start_file_watching(
    path: String,
    app_handle: AppHandle,
    state: State<AppState>,
) -> Result<(), String> {
    log::info!(
        "Starting file watching for path: {} (legacy broadcast mode)",
        path
    );
    let mut watcher_guard = state.file_watcher.lock().map_err(|e| e.to_string())?;

    if let Some(mut watcher) = watcher_guard.take() {
        log::info!("Stopping existing file watcher");
        watcher.stop();
    }

    let mut watcher = FileWatcher::new().map_err(|e| e.to_string())?;
    watcher
        .watch_directory(&path, app_handle, None)
        .map_err(|e| e.to_string())?;

    *watcher_guard = Some(watcher);
    log::info!("File watching started successfully for: {}", path);
    Ok(())
}

#[tauri::command]
fn stop_file_watching(state: State<AppState>) -> Result<(), String> {
    log::info!("Stopping file watching");
    let mut watcher_guard = state.file_watcher.lock().map_err(|e| e.to_string())?;

    if let Some(mut watcher) = watcher_guard.take() {
        log::info!("File watcher stopped");
        watcher.stop();
    }

    Ok(())
}

#[tauri::command]
fn search_file_content(
    query: String,
    root_path: String,
    file_types: Option<Vec<String>>,
    exclude_dirs: Option<Vec<String>>,
) -> Result<Vec<search::SearchResult>, String> {
    let start_time = Instant::now();
    log::info!(
        "Starting search for query: '{}' in path: {}",
        query,
        root_path
    );

    let searcher = search::RipgrepSearch::new()
        .with_max_results(50)
        .with_max_matches_per_file(10)
        .with_file_types(file_types)
        .with_exclude_dirs(exclude_dirs);

    let result = searcher.search_content(&query, &root_path).map_err(|e| {
        log::error!("Search error: {}", e);
        format!("Search failed: {}", e)
    });

    let duration = start_time.elapsed();
    if let Ok(ref results) = result {
        log::info!(
            "Search completed successfully with {} results in {}ms",
            results.len(),
            duration.as_millis()
        );
    } else {
        log::error!("Search failed after {}ms", duration.as_millis());
    }

    result
}

#[tauri::command]
fn search_files_fast(
    query: String,
    root_path: String,
    max_results: Option<usize>,
) -> Result<Vec<file_search::FileSearchResult>, String> {
    let start_time = Instant::now();
    log::info!(
        "Starting fast file search for query: '{}' in path: {}",
        query,
        root_path
    );

    let searcher =
        file_search::HighPerformanceFileSearch::new().with_max_results(max_results.unwrap_or(200));

    let result = searcher.search_files(&root_path, &query).map_err(|e| {
        log::error!("File search error: {}", e);
        format!("File search failed: {}", e)
    });

    let duration = start_time.elapsed();
    if let Ok(ref results) = result {
        log::info!(
            "File search completed successfully with {} results in {}ms",
            results.len(),
            duration.as_millis()
        );
    } else {
        log::error!("File search failed after {}ms", duration.as_millis());
    }

    result
}

#[tauri::command]
fn create_project_window(
    app_handle: AppHandle,
    state: State<AppState>,
    project_id: Option<String>,
    root_path: Option<String>,
    is_new_window: bool,
) -> Result<String, String> {
    log::info!("Creating project window for project_id: {:?}, root_path: {:?}, is_new_window: {}. Triggering dock menu update.", project_id, root_path, is_new_window);
    let result = create_window(
        &app_handle,
        &state.window_registry,
        project_id,
        root_path,
        is_new_window,
    );
    if result.is_ok() {
        // Refresh dock menu to show the updated recent projects list
        // This spawns the refresh task without blocking
        tauri::async_runtime::spawn(async move {
            dock_menu::refresh_dock_menu().await;
        });
    }
    result
}

#[tauri::command]
async fn refresh_dock_menu() {
    dock_menu::refresh_dock_menu().await;
}

#[tauri::command]
fn get_all_project_windows(
    state: State<AppState>,
) -> Result<Vec<window_manager::WindowInfo>, String> {
    log::info!("Getting all project windows");
    state.window_registry.get_all_windows()
}

#[tauri::command]
fn get_current_window_label(window: tauri::Window) -> Result<String, String> {
    Ok(window.label().to_string())
}

#[tauri::command]
fn get_window_info(
    window: tauri::Window,
    state: State<AppState>,
) -> Result<Option<(String, String)>, String> {
    let label = window.label();
    let windows = state.window_registry.get_all_windows()?;

    let window_info = windows.iter().find(|w| w.label == label);

    match window_info {
        Some(info) => {
            if let (Some(project_id), Some(root_path)) = (&info.project_id, &info.root_path) {
                log::info!(
                    "Window info found for {}: project_id={}, root_path={}",
                    label,
                    project_id,
                    root_path
                );
                Ok(Some((project_id.clone(), root_path.clone())))
            } else {
                log::info!("Window {} has no associated project (New Window)", label);
                Ok(None)
            }
        }
        None => {
            log::info!("Window {} not found in registry", label);
            Ok(None)
        }
    }
}

#[tauri::command]
fn check_project_window_exists(
    state: State<AppState>,
    root_path: String,
) -> Result<Option<String>, String> {
    log::info!("Checking if project window exists for: {}", root_path);
    state.window_registry.find_window_by_project(&root_path)
}

#[tauri::command]
fn focus_project_window(app_handle: AppHandle, label: String) -> Result<(), String> {
    log::info!("Focusing window: {}", label);
    if let Some(window) = app_handle.get_webview_window(&label) {
        window.set_focus().map_err(|e| e.to_string())?;
        window.show().map_err(|e| e.to_string())?;
        #[cfg(target_os = "macos")]
        {
            use cocoa::appkit::NSApplication;
            unsafe {
                let app = cocoa::appkit::NSApp();
                app.activateIgnoringOtherApps_(cocoa::base::YES);
            }
        }
        Ok(())
    } else {
        Err(format!("Window not found: {}", label))
    }
}

#[tauri::command]
fn close_project_window(
    app_handle: AppHandle,
    state: State<AppState>,
    label: String,
) -> Result<(), String> {
    log::info!("Closing window: {}", label);
    state.window_registry.unregister_window(&label)?;
    if let Some(window) = app_handle.get_webview_window(&label) {
        window.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn update_window_project(
    state: State<AppState>,
    label: String,
    project_id: Option<String>,
    root_path: Option<String>,
) -> Result<(), String> {
    log::info!(
        "Updating window {} with project_id: {:?}, root_path: {:?}",
        label,
        project_id,
        root_path
    );
    state
        .window_registry
        .update_window_project(&label, project_id, root_path)
}

#[tauri::command]
fn start_window_file_watching(
    window_label: String,
    path: String,
    app_handle: AppHandle,
    state: State<AppState>,
) -> Result<(), String> {
    log::info!(
        "Starting file watching for window {} at path: {}",
        window_label,
        path
    );
    let mut watcher = FileWatcher::new().map_err(|e| e.to_string())?;
    watcher
        .watch_directory(&path, app_handle, Some(window_label.clone()))
        .map_err(|e| e.to_string())?;
    state
        .window_registry
        .set_window_file_watcher(&window_label, Some(watcher))?;
    log::info!(
        "File watching started successfully for window: {}",
        window_label
    );
    Ok(())
}

#[tauri::command]
fn stop_window_file_watching(window_label: String, state: State<AppState>) -> Result<(), String> {
    log::info!("Stopping file watching for window: {}", window_label);
    state
        .window_registry
        .set_window_file_watcher(&window_label, None)?;
    Ok(())
}

#[tauri::command]
fn activate_app(app_handle: tauri::AppHandle) -> Result<(), String> {
    log::info!("Activating app to bring to foreground");
    #[cfg(target_os = "macos")]
    {
        let _ = &app_handle;
        use cocoa::appkit::NSApplication;
        unsafe {
            let app = cocoa::appkit::NSApp();
            app.activateIgnoringOtherApps_(cocoa::base::YES);
        }
        log::info!("App activated successfully on macOS");
    }
    #[cfg(not(target_os = "macos"))]
    {
        if let Some(window) = app_handle.get_webview_window("main") {
            if let Err(e) = window.unminimize() {
                log::warn!("Failed to unminimize window: {}", e);
            }
            if let Err(e) = window.show() {
                log::warn!("Failed to show window: {}", e);
            }
            if let Err(e) = window.set_focus() {
                log::warn!("Failed to set focus on window: {}", e);
            }
            log::info!("App window activated successfully on Linux/Windows");
        } else {
            return Err("Failed to get main window".to_string());
        }
    }
    Ok(())
}

#[derive(Serialize)]
struct ShellResult {
    stdout: String,
    stderr: String,
    code: i32,
    timed_out: bool,
    idle_timed_out: bool,
    pid: Option<u32>,
}

const DEFAULT_TIMEOUT_MS: u64 = 120_000;
const DEFAULT_IDLE_TIMEOUT_MS: u64 = 5_000;

#[tauri::command]
async fn execute_user_shell(
    command: String,
    cwd: Option<String>,
    timeout_ms: Option<u64>,
    idle_timeout_ms: Option<u64>,
) -> Result<ShellResult, String> {
    log::info!("Executing user shell command: {}", command);
    let max_timeout = TokioDuration::from_millis(timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS));
    let idle_timeout =
        TokioDuration::from_millis(idle_timeout_ms.unwrap_or(DEFAULT_IDLE_TIMEOUT_MS));

    #[cfg(unix)]
    {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
        let mut cmd = crate::shell_utils::new_async_command(&shell);
        cmd.arg("-l").arg("-i").arg("-c").arg(&command);
        if let Some(ref dir) = cwd {
            cmd.current_dir(dir);
        }
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn shell: {}", e))?;
        let child_pid = child.id();
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        execute_with_idle_timeout(
            &mut child,
            stdout,
            stderr,
            max_timeout,
            idle_timeout,
            child_pid,
        )
        .await
    }
    #[cfg(windows)]
    {
        // Get shell from COMSPEC or default to cmd.exe
        // Remove surrounding quotes if present (Windows env vars sometimes have quotes)
        let shell = shell_utils::get_windows_shell();

        let mut cmd = crate::shell_utils::new_async_command(&shell);
        if shell_utils::is_powershell(&shell) {
            cmd.arg("-Command").arg(&command);
        } else {
            cmd.arg("/C").arg(&command);
        }
        if let Some(ref dir) = cwd {
            cmd.current_dir(dir);
        }
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn shell: {}", e))?;
        let child_pid = child.id();
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        execute_with_idle_timeout(
            &mut child,
            stdout,
            stderr,
            max_timeout,
            idle_timeout,
            child_pid,
        )
        .await
    }
}

async fn execute_with_idle_timeout(
    child: &mut tokio::process::Child,
    stdout: Option<tokio::process::ChildStdout>,
    stderr: Option<tokio::process::ChildStderr>,
    max_timeout: TokioDuration,
    idle_timeout: TokioDuration,
    child_pid: Option<u32>,
) -> Result<ShellResult, String> {
    use tokio::io::AsyncReadExt;

    // Maximum output size to prevent memory exhaustion (256KB per stream)
    const MAX_OUTPUT_BYTES: usize = 256 * 1024;

    let start_time = Instant::now();
    let mut stdout_buffer = Vec::new();
    let mut stderr_buffer = Vec::new();
    let mut last_output_time = Instant::now();
    let mut timed_out = false;
    let mut idle_timed_out = false;

    // Use raw byte readers instead of line-based readers
    // This ensures idle timeout resets on ANY output, not just newlines
    let mut stdout_reader = stdout.map(BufReader::new);
    let mut stderr_reader = stderr.map(BufReader::new);
    let mut stdout_buf = [0u8; 4096];
    let mut stderr_buf = [0u8; 4096];

    // Helper function to append data with size cap
    fn append_capped(buf: &mut Vec<u8>, chunk: &[u8]) {
        let remaining = MAX_OUTPUT_BYTES.saturating_sub(buf.len());
        if remaining > 0 {
            buf.extend_from_slice(&chunk[..chunk.len().min(remaining)]);
        }
    }

    loop {
        if start_time.elapsed() >= max_timeout {
            timed_out = true;
            // Kill the child process on timeout to prevent process leaks
            if let Err(e) = child.kill().await {
                log::warn!("Failed to kill timed out process: {}", e);
            }
            // Wait briefly for process to terminate
            let _ = tokio::time::timeout(std::time::Duration::from_secs(2), child.wait()).await;
            break;
        }
        if last_output_time.elapsed() >= idle_timeout {
            idle_timed_out = true;
            // Kill the child process on idle timeout to prevent process leaks
            if let Err(e) = child.kill().await {
                log::warn!("Failed to kill idle timed out process: {}", e);
            }
            // Wait briefly for process to terminate
            let _ = tokio::time::timeout(std::time::Duration::from_secs(2), child.wait()).await;
            break;
        }
        let remaining_idle = idle_timeout.saturating_sub(last_output_time.elapsed());
        let remaining_max = max_timeout.saturating_sub(start_time.elapsed());
        let wait_duration = std::cmp::min(remaining_idle, remaining_max);

        tokio::select! {
            status = child.wait() => {
                match status {
                    Ok(exit_status) => {
                        // Flush any remaining output
                        if let Some(ref mut reader) = stdout_reader {
                            loop {
                                match reader.read(&mut stdout_buf).await {
                                    Ok(0) => break,
                                    Ok(n) => append_capped(&mut stdout_buffer, &stdout_buf[..n]),
                                    Err(_) => break,
                                }
                            }
                        }
                        if let Some(ref mut reader) = stderr_reader {
                            loop {
                                match reader.read(&mut stderr_buf).await {
                                    Ok(0) => break,
                                    Ok(n) => append_capped(&mut stderr_buffer, &stderr_buf[..n]),
                                    Err(_) => break,
                                }
                            }
                        }
                        return Ok(ShellResult {
                            stdout: String::from_utf8_lossy(&stdout_buffer).to_string(),
                            stderr: String::from_utf8_lossy(&stderr_buffer).to_string(),
                            code: exit_status.code().unwrap_or(-1),
                            timed_out: false,
                            idle_timed_out: false,
                            pid: child_pid,
                        });
                    }
                    Err(e) => return Err(format!("Failed to wait for process: {}", e)),
                }
            }
            result = async {
                if let Some(ref mut reader) = stdout_reader {
                    reader.read(&mut stdout_buf).await
                } else {
                    std::future::pending().await
                }
            } => {
                match result {
                    Ok(0) => { stdout_reader = None; }
                    Ok(n) => {
                        append_capped(&mut stdout_buffer, &stdout_buf[..n]);
                        last_output_time = Instant::now();
                    }
                    Err(_) => { stdout_reader = None; }
                }
            }
            result = async {
                if let Some(ref mut reader) = stderr_reader {
                    reader.read(&mut stderr_buf).await
                } else {
                    std::future::pending().await
                }
            } => {
                match result {
                    Ok(0) => { stderr_reader = None; }
                    Ok(n) => {
                        append_capped(&mut stderr_buffer, &stderr_buf[..n]);
                        last_output_time = Instant::now();
                    }
                    Err(_) => { stderr_reader = None; }
                }
            }
            _ = tokio::time::sleep(wait_duration) => {}
        }
        if stdout_reader.is_none() && stderr_reader.is_none() {
            // Both stdout and stderr are closed, but child may still be running
            // Wait for child to exit (respecting remaining timeout) to avoid orphan processes
            let remaining_max = max_timeout.saturating_sub(start_time.elapsed());
            match tokio::time::timeout(remaining_max, child.wait()).await {
                Ok(Ok(exit_status)) => {
                    return Ok(ShellResult {
                        stdout: String::from_utf8_lossy(&stdout_buffer).to_string(),
                        stderr: String::from_utf8_lossy(&stderr_buffer).to_string(),
                        code: exit_status.code().unwrap_or(-1),
                        timed_out: false,
                        idle_timed_out: false,
                        pid: child_pid,
                    });
                }
                Ok(Err(e)) => return Err(format!("Failed to wait for process: {}", e)),
                Err(_) => {
                    // Timeout waiting for child exit
                    timed_out = true;
                    if let Err(e) = child.kill().await {
                        log::warn!("Failed to kill process after timeout: {}", e);
                    }
                    // Wait briefly after kill
                    let _ =
                        tokio::time::timeout(std::time::Duration::from_secs(2), child.wait()).await;
                    break;
                }
            }
        }
    }
    // Try to get the exit code after timeout/kill
    let exit_code = match child.try_wait() {
        Ok(Some(status)) => status.code().unwrap_or(-1),
        _ => -1,
    };

    Ok(ShellResult {
        stdout: String::from_utf8_lossy(&stdout_buffer).to_string(),
        stderr: String::from_utf8_lossy(&stderr_buffer).to_string(),
        code: exit_code,
        timed_out,
        idle_timed_out,
        pid: child_pid,
    })
}

#[tauri::command]
async fn execute_skill_script(
    request: ScriptExecutionRequest,
) -> Result<ScriptExecutionResult, String> {
    ScriptExecutor::execute(request).await
}

#[tauri::command]
fn create_skill_tarball(request: CreateTarballRequest) -> Result<CreateTarballResult, String> {
    archive::create_tarball(request)
}

#[tauri::command]
fn extract_skill_tarball(request: ExtractTarballRequest) -> Result<ExtractTarballResult, String> {
    archive::extract_tarball(request)
}

#[tauri::command]
fn estimate_tokens(text: String) -> usize {
    let mut cjk_count = 0;
    let mut other_count = 0;
    for c in text.chars() {
        if is_cjk_char(c) {
            cjk_count += 1;
        } else {
            other_count += 1;
        }
    }
    let other_tokens = if other_count > 0 {
        (other_count / 4).max(1)
    } else {
        0
    };
    (cjk_count + other_tokens).max(1)
}

#[inline]
fn is_cjk_char(c: char) -> bool {
    matches!(c, '\u{4E00}'..='\u{9FFF}' | '\u{3400}'..='\u{4DBF}' | '\u{F900}'..='\u{FAFF}' | '\u{3040}'..='\u{309F}' | '\u{30A0}'..='\u{30FF}' | '\u{AC00}'..='\u{D7AF}')
}

fn cleanup_old_logs(log_dir: &std::path::Path, days_to_keep: u64) {
    let cutoff = SystemTime::now() - Duration::from_secs(days_to_keep * 24 * 60 * 60);
    if let Ok(entries) = std::fs::read_dir(log_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("log") {
                continue;
            }
            if let Ok(metadata) = entry.metadata() {
                if let Ok(modified) = metadata.modified() {
                    if modified < cutoff {
                        let _ = std::fs::remove_file(&path);
                    }
                }
            }
        }
    }
}

fn init_trace_writer_state<R, M>(manager: &M, database: Arc<Database>) -> Arc<TraceWriter>
where
    R: tauri::Runtime,
    M: Manager<R>,
{
    let trace_writer = Arc::new(TraceWriter::new(database));
    let trace_writer_clone = trace_writer.clone();
    tauri::async_runtime::spawn(async move {
        trace_writer_clone.start();
    });
    manager.manage(trace_writer.clone());
    trace_writer
}

pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            file_watcher: Mutex::new(None),
            window_registry: WindowRegistry::new(),
        })
        .manage(keep_awake::KeepAwakeStateWrapper::new())
        .manage(AnalyticsState::new())
        .manage(telegram_gateway::default_state())
        .manage(feishu_gateway::default_state())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            if let Err(e) = app.emit("single-instance", Payload { args: argv, cwd }) {
                log::error!("Failed to emit single-instance event: {}", e);
            }
        }))
        .setup(|app| {
            // Set global app handle first (used by dock menu and other modules)
            set_app_handle(app.handle().clone());

            if app
                .try_state::<keep_awake::KeepAwakeStateWrapper>()
                .is_none()
            {
                log::warn!("KeepAwake state missing during setup; registering default state");
                app.manage(keep_awake::KeepAwakeStateWrapper::new());
            }

            if let Ok(log_dir) = app.path().app_log_dir() {
                cleanup_old_logs(&log_dir, 3);
            }
            let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
            let db_path = app_data_dir.join("talkcody.db");
            let db_path_str = db_path.to_string_lossy().to_string();
            let database = Arc::new(Database::new(db_path_str));
            app.manage(database.clone());

            // Start Cloud Backend Server with full runtime
            let server_config = server::config::ServerConfig::new(app_data_dir.clone(), app_data_dir.clone());
            let (event_tx, _event_rx) = tokio::sync::mpsc::unbounded_channel::<core::types::RuntimeEvent>();

            let server_handle = app.handle().clone();
            let server_config_clone = server_config.clone();
            tauri::async_runtime::spawn(async move {
                match server::state::ServerStateFactory::create(server_config_clone, event_tx).await {
                    Ok(server_state) => {
                        // Start server with the configured state
                        let bind_addr = std::net::SocketAddr::from(([127, 0, 0, 1], 0));
                        match tokio::net::TcpListener::bind(bind_addr).await {
                            Ok(listener) => {
                                let addr = listener.local_addr().unwrap_or(bind_addr);
                                log::info!("Cloud backend server started on {}", addr);
                                server_handle.manage(ServerInfo { addr });
                            }
                            Err(e) => {
                                log::error!("Failed to bind server: {}", e);
                            }
                        }
                    }
                    Err(e) => {
                        log::error!("Failed to create server state: {}", e);
                    }
                }
            });

            // Initialize LLM tracing
            init_trace_writer_state(app, database.clone());

            let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
            let llm_state = llm::auth::api_key_manager::LlmState::new(
                database.clone(),
                app_data_dir.clone(),
                llm::providers::provider_configs::builtin_providers(),
            );
            app.manage(llm_state);

            let model_sync_handle = app.handle().clone();
            let model_sync_data_dir = app_data_dir.clone();
            tauri::async_runtime::spawn(async move {
                if let Some(state) = model_sync_handle
                    .try_state::<llm::auth::api_key_manager::LlmState>()
                {
                    let api_keys = {
                        let guard = state.api_keys.lock().await;
                        guard.clone()
                    };
                    llm::models::model_sync::start_background_sync(
                        model_sync_handle.clone(),
                        api_keys,
                        model_sync_data_dir,
                    );
                }
            });

            // Load custom providers from filesystem and register them asynchronously
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Some(state) = app_handle.try_state::<llm::auth::api_key_manager::LlmState>() {
                    let api_keys = state.api_keys.lock().await;
                    match api_keys.load_custom_providers().await {
                        Ok(custom_config) => {
                            let mut registry = state.registry.lock().await;
                            let provider_count = custom_config.providers.len();
                            for (provider_id, config) in custom_config.providers {
                                if config.enabled {
                                    registry.register_provider(crate::llm::types::ProviderConfig {
                                        id: provider_id.clone(),
                                        name: config.name.clone(),
                                        protocol: match config.provider_type {
                                            crate::llm::types::CustomProviderType::Anthropic => {
                                                crate::llm::types::ProtocolType::Claude
                                            }
                                            crate::llm::types::CustomProviderType::OpenAiCompatible => {
                                                crate::llm::types::ProtocolType::OpenAiCompatible
                                            }
                                        },
                                        base_url: config.base_url.clone(),
                                        api_key_name: format!("custom_{}", provider_id),
                                        supports_oauth: false,
                                        supports_coding_plan: false,
                                        supports_international: false,
                                        coding_plan_base_url: None,
                                        international_base_url: None,
                                        headers: None,
                                        extra_body: None,
                                        auth_type: crate::llm::types::AuthType::Bearer,
                                    });
                                }
                            }
                            log::info!("Loaded {} custom providers from filesystem", provider_count);
                        }
                        Err(e) => {
                            log::warn!("Failed to load custom providers: {}", e);
                        }
                    }
                }
            });

            let ws_state = Arc::new(TokioMutex::new(WebSocketState::new()));
            app.manage(ws_state);
            let code_nav_state = CodeNavState(RwLock::new(CodeNavigationService::new()));
            app.manage(code_nav_state);
            let lsp_state = lsp::LspState(tokio::sync::Mutex::new(lsp::LspRegistry::new()));
            app.manage(lsp_state);

            // Start analytics session
            let app_version = app.package_info().version.to_string();
            let app_data_dir_clone = app_data_dir.clone();
            if let Some(analytics_state) = app.try_state::<AnalyticsState>() {
                let state = analytics_state.inner().clone();
                tauri::async_runtime::spawn(async move {
                    analytics::start_session(&state, &app_data_dir_clone, &app_version).await;
                });
            }

            #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
            {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
            }

            if let Some(app_state) = app.try_state::<AppState>() {
                let state = WindowState {
                    project_id: None,
                    root_path: None,
                    file_watcher: None,
                };
                let _ = app_state
                    .window_registry
                    .register_window("main".to_string(), state);
            }

            // Initialize dock menu on macOS
            #[cfg(target_os = "macos")]
            {
                dock_menu::setup_dock_menu();
            }

            log::info!("Setup complete");
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_clipboard::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: None,
                    }),
                ])
                .level(if cfg!(debug_assertions) {
                    log::LevelFilter::Debug
                } else {
                    log::LevelFilter::Info
                })
                .max_file_size(100_000_000)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepAll)
                .timezone_strategy(tauri_plugin_log::TimezoneStrategy::UseLocal)
                .build(),
        )
        .on_menu_event(|app, event| {
            dock_menu::handle_dock_menu_event(app, event);
        })
        .invoke_handler(tauri::generate_handler![
            start_file_watching,
            stop_file_watching,
            search_file_content,
            search_files_fast,
            list_files::list_project_files,
            directory_tree::build_directory_tree,
            directory_tree::load_directory_children,
            directory_tree::clear_directory_cache,
            directory_tree::invalidate_directory_path,
            glob::search_files_by_glob,
            create_project_window,
            get_all_project_windows,
            get_current_window_label,
            get_window_info,
            check_project_window_exists,
            focus_project_window,
            close_project_window,
            update_window_project,
            refresh_dock_menu,
            start_window_file_watching,
            stop_window_file_watching,
            activate_app,
            database::db_connect,
            database::db_execute,
            database::db_query,
            database::db_batch,
            http_proxy::proxy_fetch,
            http_proxy::stream_fetch,
            git::git_get_status,
            git::git_is_repository,
            git::git_get_all_file_statuses,
            git::git_get_line_changes,
            git::git_get_all_file_diffs,
            git::git_get_raw_diff_text,
            git::git_get_default_worktree_root,
            git::git_acquire_worktree,
            git::git_release_worktree,
            git::git_remove_worktree,
            git::git_list_worktrees,
            git::git_get_worktree_changes,
            git::git_commit_worktree,
            git::git_merge_worktree,
            git::git_abort_merge,
            git::git_continue_merge,
            git::git_cleanup_worktrees,
            git::git_sync_worktree_from_main,
            git::git_abort_rebase,
            websocket::ws_connect,
            websocket::ws_send,
            websocket::ws_disconnect,
            execute_user_shell,
            execute_skill_script,
            create_skill_tarball,
            extract_skill_tarball,
            terminal::pty_spawn,
            terminal::pty_write,
            terminal::pty_resize,
            terminal::pty_kill,
            code_navigation::code_nav_index_file,
            code_navigation::code_nav_index_files_batch,
            code_navigation::code_nav_find_definition,
            code_navigation::code_nav_find_references_hybrid,
            code_navigation::code_nav_clear_file,
            code_navigation::code_nav_clear_all,
            code_navigation::code_nav_save_index,
            code_navigation::code_nav_load_index,
            code_navigation::code_nav_get_index_metadata,
            code_navigation::code_nav_delete_index,
            code_navigation::code_nav_get_indexed_files,
            code_navigation::summarize_code_content,
            estimate_tokens,
            lint::run_lint,
            lint::check_lint_runtime,
            background_tasks::spawn_background_task,
            background_tasks::get_background_task_status,
            background_tasks::get_background_task_output,
            background_tasks::kill_background_task,
            background_tasks::list_background_tasks,
            background_tasks::cleanup_background_tasks,
            lsp::lsp_start_server,
            lsp::lsp_send_message,
            lsp::lsp_stop_server,
            lsp::lsp_list_servers,
            lsp::lsp_check_server_available,
            lsp::lsp_get_server_config,
            lsp::lsp_get_server_status,
            lsp::lsp_download_server,
            oauth_callback_server::start_oauth_callback_server,
            llm::commands::llm_stream_text,
            llm::commands::llm_list_available_models,
            llm::commands::llm_register_custom_provider,
            llm::commands::llm_check_model_updates,
            llm::commands::llm_get_provider_configs,
            llm::commands::llm_get_models_config,
            llm::commands::llm_is_model_available,
            llm::commands::llm_transcribe_audio,
            llm::commands::llm_calculate_cost,
            llm::commands::llm_get_completion,
            llm::commands::llm_generate_commit_message,
            llm::commands::llm_generate_title,
            llm::commands::llm_compact_context,
            llm::commands::llm_enhance_prompt,
            llm::auth::api_key_manager::llm_set_setting,
            llm::auth::oauth::llm_openai_oauth_start,
            llm::auth::oauth::llm_openai_oauth_complete,
            llm::auth::oauth::llm_openai_oauth_refresh,
            llm::auth::oauth::llm_openai_oauth_refresh_from_store,
            llm::auth::oauth::llm_openai_oauth_disconnect,
            llm::auth::openai_usage::llm_openai_oauth_usage,
            llm::auth::oauth::llm_claude_oauth_start,
            llm::auth::oauth::llm_claude_oauth_complete,
            llm::auth::oauth::llm_claude_oauth_refresh,
            llm::auth::oauth::llm_claude_oauth_disconnect,
            llm::auth::oauth::llm_github_copilot_oauth_start_device_code,
            llm::auth::oauth::llm_github_copilot_oauth_poll_device_code,
            llm::auth::oauth::llm_github_copilot_oauth_refresh,
            llm::auth::oauth::llm_github_copilot_oauth_disconnect,
            llm::auth::oauth::llm_github_copilot_oauth_tokens,
            llm::auth::oauth::llm_oauth_status,
            device_id::get_device_id,
            keep_awake::keep_awake_acquire,
            keep_awake::keep_awake_release,
            keep_awake::keep_awake_get_ref_count,
            keep_awake::keep_awake_is_preventing,
            telegram_gateway::telegram_get_config,
            telegram_gateway::telegram_set_config,
            telegram_gateway::telegram_start,
            telegram_gateway::telegram_stop,
            telegram_gateway::telegram_get_status,
            telegram_gateway::telegram_is_running,
            telegram_gateway::telegram_send_message,
            telegram_gateway::telegram_edit_message,
            feishu_gateway::feishu_get_config,
            feishu_gateway::feishu_set_config,
            feishu_gateway::feishu_start,
            feishu_gateway::feishu_stop,
            feishu_gateway::feishu_get_status,
            feishu_gateway::feishu_is_running,
            feishu_gateway::feishu_send_message,
            feishu_gateway::feishu_edit_message,
        ])
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { .. } = event {
                match close_action_for_window(window.label()) {
                    CloseAction::ExitApp => {
                        window.app_handle().exit(0);
                        return;
                    }
                    CloseAction::Allow => {}
                }
            }
            // Clean up resources when main window is destroyed
            if let WindowEvent::Destroyed = event {
                if window.label() == "main" {
                    log::info!("Main window destroyed, cleaning up resources");

                    // Stop legacy file watcher
                    if let Some(app_state) = window.try_state::<AppState>() {
                        if let Ok(mut watcher_guard) = app_state.file_watcher.lock() {
                            if let Some(mut watcher) = watcher_guard.take() {
                                log::info!("Stopping legacy file watcher on app exit");
                                watcher.stop();
                            }
                        }
                        // Clean up all window registry watchers
                        app_state.window_registry.cleanup_all_watchers();
                    }

                    log::info!("Resource cleanup completed");
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // RunEvent::Exit always runs (unlike ExitRequested which is inconsistent on macOS)
            // See: https://github.com/tauri-apps/tauri/issues/9198
            if let tauri::RunEvent::Exit = event {
                log::info!("App exiting, sending session_end");

                // Send session_end synchronously before exit
                if let Some(analytics_state) = app_handle.try_state::<AnalyticsState>() {
                    analytics::send_session_end_sync(analytics_state.inner());
                }

                // Shutdown trace writer
                if let Some(trace_writer) = app_handle.try_state::<Arc<TraceWriter>>() {
                    trace_writer.inner().shutdown_blocking();
                }

                // Close database connection to release file handles
                if let Some(db) = app_handle.try_state::<Arc<Database>>() {
                    log::info!("Closing database connection on app exit");
                    db.inner().close_sync();
                }

                log::info!("session_end sent, app will exit now");
            }
        });
}

#[cfg(test)]
mod tests {
    use super::close_action_for_window;
    use super::init_trace_writer_state;
    use crate::database::Database;
    use crate::llm::tracing::writer::TraceWriter;
    use std::sync::Arc;
    use tauri::Manager;
    use tempfile::TempDir;

    #[test]
    fn close_action_for_main_window_exits_app() {
        assert_eq!(close_action_for_window("main"), super::CloseAction::ExitApp);
    }

    #[test]
    fn close_action_for_non_main_window_allows_close() {
        assert_eq!(
            close_action_for_window("settings"),
            super::CloseAction::Allow
        );
    }

    /// This test uses Tauri test infrastructure that may not work on Windows CI
    #[test]
    #[cfg(not(target_os = "windows"))]
    fn trace_writer_state_is_arc_in_app_state() {
        let app = tauri::test::mock_app();
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("trace_writer_state.db");
        let db = Arc::new(Database::new(db_path.to_string_lossy().to_string()));

        let trace_writer = init_trace_writer_state(&app, db);

        let window = tauri::WebviewWindowBuilder::new(
            &app,
            "trace-writer-state-test",
            tauri::WebviewUrl::App("index.html".into()),
        )
        .build()
        .unwrap();

        let state = window.app_handle().state::<Arc<TraceWriter>>();
        assert!(Arc::ptr_eq(state.inner(), &trace_writer));
    }
}
