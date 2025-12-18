mod file_watcher;
mod search;
mod list_files;
mod directory_tree;
mod file_search;
mod glob;
mod constants;
mod window_manager;
mod database;
mod http_proxy;
mod git;
mod websocket;
mod terminal;
mod script_executor;
mod archive;
mod code_navigation;
mod analytics;
mod lint;

use file_watcher::FileWatcher;
use window_manager::{WindowRegistry, WindowState, create_window};
use database::Database;
use websocket::WebSocketState;
use script_executor::{ScriptExecutor, ScriptExecutionRequest, ScriptExecutionResult};
use archive::{CreateTarballRequest, CreateTarballResult, ExtractTarballRequest, ExtractTarballResult};
use code_navigation::{CodeNavigationService, CodeNavState};
use analytics::AnalyticsState;
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Instant, SystemTime, Duration};
use std::process::Stdio;
use tauri::{AppHandle, State, Emitter, Manager, WindowEvent};
use tauri_plugin_deep_link::DeepLinkExt;
use serde::{Serialize, Deserialize};
use tokio::sync::Mutex as TokioMutex;
use tokio::process::Command as TokioCommand;
use tokio::io::BufReader;
use tokio::time::Duration as TokioDuration;

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

#[tauri::command]
fn start_file_watching(path: String, app_handle: AppHandle, state: State<AppState>) -> Result<(), String> {
    log::info!("Starting file watching for path: {}", path);
    let mut watcher_guard = state.file_watcher.lock().map_err(|e| e.to_string())?;

    // Stop any existing watcher properly
    if let Some(mut watcher) = watcher_guard.take() {
        log::info!("Stopping existing file watcher");
        watcher.stop();
    }

    // Create new watcher
    let mut watcher = FileWatcher::new().map_err(|e| e.to_string())?;
    watcher.watch_directory(&path, app_handle).map_err(|e| e.to_string())?;

    *watcher_guard = Some(watcher);
    log::info!("File watching started successfully for: {}", path);
    Ok(())
}

#[tauri::command]
fn stop_file_watching(state: State<AppState>) -> Result<(), String> {
    log::info!("Stopping file watching");
    let mut watcher_guard = state.file_watcher.lock().map_err(|e| e.to_string())?;

    // Properly stop the existing watcher
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
    exclude_dirs: Option<Vec<String>>
) -> Result<Vec<search::SearchResult>, String> {
    let start_time = Instant::now();
    log::info!("Starting search for query: '{}' in path: {}", query, root_path);

    let searcher = search::RipgrepSearch::new()
        .with_max_results(50)
        .with_max_matches_per_file(10)
        .with_file_types(file_types)
        .with_exclude_dirs(exclude_dirs);

    let result = searcher.search_content(&query, &root_path)
        .map_err(|e| {
            log::error!("Search error: {}", e);
            format!("Search failed: {}", e)
        });

    let duration = start_time.elapsed();
    if let Ok(ref results) = result {
        log::info!("Search completed successfully with {} results in {}ms", results.len(), duration.as_millis());
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
    log::info!("Starting fast file search for query: '{}' in path: {}", query, root_path);

    let searcher = file_search::HighPerformanceFileSearch::new()
        .with_max_results(max_results.unwrap_or(200));

    let result = searcher.search_files(&root_path, &query)
        .map_err(|e| {
            log::error!("File search error: {}", e);
            format!("File search failed: {}", e)
        });

    let duration = start_time.elapsed();
    if let Ok(ref results) = result {
        log::info!("File search completed successfully with {} results in {}ms", results.len(), duration.as_millis());
    } else {
        log::error!("File search failed after {}ms", duration.as_millis());
    }

    result
}

// Window management commands

#[tauri::command]
fn create_project_window(
    app_handle: AppHandle,
    state: State<AppState>,
    project_id: Option<String>,
    root_path: Option<String>,
) -> Result<String, String> {
    log::info!("Creating project window for project_id: {:?}, root_path: {:?}", project_id, root_path);
    create_window(&app_handle, &state.window_registry, project_id, root_path)
}

#[tauri::command]
fn get_all_project_windows(state: State<AppState>) -> Result<Vec<window_manager::WindowInfo>, String> {
    log::info!("Getting all project windows");
    state.window_registry.get_all_windows()
}

#[tauri::command]
fn get_current_window_label(window: tauri::Window) -> Result<String, String> {
    Ok(window.label().to_string())
}

#[tauri::command]
fn check_project_window_exists(state: State<AppState>, root_path: String) -> Result<Option<String>, String> {
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
fn close_project_window(app_handle: AppHandle, state: State<AppState>, label: String) -> Result<(), String> {
    log::info!("Closing window: {}", label);

    // Unregister from state
    state.window_registry.unregister_window(&label)?;

    // Close the window
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
    log::info!("Updating window {} with project_id: {:?}, root_path: {:?}", label, project_id, root_path);
    state.window_registry.update_window_project(&label, project_id, root_path)
}

#[tauri::command]
fn start_window_file_watching(
    window_label: String,
    path: String,
    app_handle: AppHandle,
    state: State<AppState>,
) -> Result<(), String> {
    log::info!("Starting file watching for window {} at path: {}", window_label, path);

    // Create new watcher
    let mut watcher = FileWatcher::new().map_err(|e| e.to_string())?;
    watcher.watch_directory(&path, app_handle).map_err(|e| e.to_string())?;

    // Set watcher for this window
    state.window_registry.set_window_file_watcher(&window_label, Some(watcher))?;

    log::info!("File watching started successfully for window: {}", window_label);
    Ok(())
}

#[tauri::command]
fn stop_window_file_watching(window_label: String, state: State<AppState>) -> Result<(), String> {
    log::info!("Stopping file watching for window: {}", window_label);
    state.window_registry.set_window_file_watcher(&window_label, None)?;
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
        // On Linux and Windows, use Tauri's window management to bring window to front
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
            log::error!("Failed to get main window for activation");
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

/// Default maximum timeout in milliseconds (2 minutes)
const DEFAULT_TIMEOUT_MS: u64 = 120_000;
/// Default idle timeout in milliseconds (5 seconds)
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
    let idle_timeout = TokioDuration::from_millis(idle_timeout_ms.unwrap_or(DEFAULT_IDLE_TIMEOUT_MS));

    #[cfg(unix)]
    {
        // Get user's default shell from environment
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
        log::info!("Using shell: {}", shell);

        let mut cmd = TokioCommand::new(&shell);

        // Use -l for login shell and -i for interactive shell to load user's profile
        // This ensures .zshrc/.bashrc are loaded, making nvm/pyenv/rbenv available
        // Use -c to execute the command
        cmd.arg("-l").arg("-i").arg("-c").arg(&command);

        if let Some(ref dir) = cwd {
            cmd.current_dir(dir);
            log::info!("Working directory: {}", dir);
        }

        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        let mut child = cmd.spawn().map_err(|e| {
            log::error!("Failed to spawn shell process: {}", e);
            format!("Failed to spawn shell: {}", e)
        })?;

        let child_pid = child.id();
        log::info!("Spawned process with PID: {:?}", child_pid);

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        let result = execute_with_idle_timeout(
            &mut child,
            stdout,
            stderr,
            max_timeout,
            idle_timeout,
            child_pid,
        )
        .await;

        result
    }

    #[cfg(windows)]
    {
        // On Windows, use PowerShell or cmd
        let shell = std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string());
        log::info!("Using shell: {}", shell);

        let mut cmd = TokioCommand::new(&shell);

        if shell.to_lowercase().contains("powershell") {
            cmd.arg("-Command").arg(&command);
        } else {
            // cmd.exe
            cmd.arg("/C").arg(&command);
        }

        if let Some(ref dir) = cwd {
            cmd.current_dir(dir);
            log::info!("Working directory: {}", dir);
        }

        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        let mut child = cmd.spawn().map_err(|e| {
            log::error!("Failed to spawn shell process: {}", e);
            format!("Failed to spawn shell: {}", e)
        })?;

        let child_pid = child.id();
        log::info!("Spawned process with PID: {:?}", child_pid);

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        let result = execute_with_idle_timeout(
            &mut child,
            stdout,
            stderr,
            max_timeout,
            idle_timeout,
            child_pid,
        )
        .await;

        result
    }
}

/// Execute command with idle timeout detection
/// Returns when:
/// 1. Process exits normally
/// 2. No output received for idle_timeout duration
/// 3. Total execution exceeds max_timeout
async fn execute_with_idle_timeout(
    child: &mut tokio::process::Child,
    stdout: Option<tokio::process::ChildStdout>,
    stderr: Option<tokio::process::ChildStderr>,
    max_timeout: TokioDuration,
    idle_timeout: TokioDuration,
    child_pid: Option<u32>,
) -> Result<ShellResult, String> {
    use tokio::io::AsyncBufReadExt;

    let start_time = Instant::now();
    let mut stdout_lines: Vec<String> = Vec::new();
    let mut stderr_lines: Vec<String> = Vec::new();
    let mut last_output_time = Instant::now();
    let mut timed_out = false;
    let mut idle_timed_out = false;

    // Create buffered readers for stdout and stderr
    let mut stdout_reader = stdout.map(|s| BufReader::new(s).lines());
    let mut stderr_reader = stderr.map(|s| BufReader::new(s).lines());

    loop {
        // Check if we've exceeded max timeout
        if start_time.elapsed() >= max_timeout {
            log::info!("Max timeout reached, returning collected output");
            timed_out = true;
            break;
        }

        // Check if we've been idle for too long
        if last_output_time.elapsed() >= idle_timeout {
            log::info!("Idle timeout reached ({:?} since last output), returning collected output", idle_timeout);
            idle_timed_out = true;
            break;
        }

        // Calculate remaining time for this iteration
        let remaining_idle = idle_timeout.saturating_sub(last_output_time.elapsed());
        let remaining_max = max_timeout.saturating_sub(start_time.elapsed());
        let wait_duration = std::cmp::min(remaining_idle, remaining_max);

        // Try to read from stdout, stderr, or check if process exited
        tokio::select! {
            // Check if process has exited
            status = child.wait() => {
                match status {
                    Ok(exit_status) => {
                        let exit_code = exit_status.code().unwrap_or(-1);
                        log::info!("Process exited with code: {}", exit_code);

                        // Read any remaining output
                        if let Some(ref mut reader) = stdout_reader {
                            while let Ok(Some(line)) = reader.next_line().await {
                                stdout_lines.push(line);
                            }
                        }
                        if let Some(ref mut reader) = stderr_reader {
                            while let Ok(Some(line)) = reader.next_line().await {
                                stderr_lines.push(line);
                            }
                        }

                        return Ok(ShellResult {
                            stdout: stdout_lines.join("\n"),
                            stderr: stderr_lines.join("\n"),
                            code: exit_code,
                            timed_out: false,
                            idle_timed_out: false,
                            pid: child_pid,
                        });
                    }
                    Err(e) => {
                        log::error!("Failed to wait for process: {}", e);
                        return Err(format!("Failed to wait for process: {}", e));
                    }
                }
            }

            // Try to read from stdout
            result = async {
                if let Some(ref mut reader) = stdout_reader {
                    reader.next_line().await
                } else {
                    // No stdout, wait forever (will be cancelled by other branches)
                    std::future::pending().await
                }
            } => {
                match result {
                    Ok(Some(line)) => {
                        stdout_lines.push(line);
                        last_output_time = Instant::now();
                    }
                    Ok(None) => {
                        // stdout closed
                        stdout_reader = None;
                    }
                    Err(e) => {
                        log::warn!("Error reading stdout: {}", e);
                        stdout_reader = None;
                    }
                }
            }

            // Try to read from stderr
            result = async {
                if let Some(ref mut reader) = stderr_reader {
                    reader.next_line().await
                } else {
                    // No stderr, wait forever (will be cancelled by other branches)
                    std::future::pending().await
                }
            } => {
                match result {
                    Ok(Some(line)) => {
                        stderr_lines.push(line);
                        last_output_time = Instant::now();
                    }
                    Ok(None) => {
                        // stderr closed
                        stderr_reader = None;
                    }
                    Err(e) => {
                        log::warn!("Error reading stderr: {}", e);
                        stderr_reader = None;
                    }
                }
            }

            // Timeout for idle detection
            _ = tokio::time::sleep(wait_duration) => {
                // Will be handled in the next loop iteration
            }
        }

        // If both stdout and stderr are closed, wait a bit for process to exit
        if stdout_reader.is_none() && stderr_reader.is_none() {
            log::info!("Both stdout and stderr closed, waiting for process to exit");
            match tokio::time::timeout(TokioDuration::from_millis(500), child.wait()).await {
                Ok(Ok(status)) => {
                    let exit_code = status.code().unwrap_or(-1);
                    log::info!("Process exited with code: {}", exit_code);
                    return Ok(ShellResult {
                        stdout: stdout_lines.join("\n"),
                        stderr: stderr_lines.join("\n"),
                        code: exit_code,
                        timed_out: false,
                        idle_timed_out: false,
                        pid: child_pid,
                    });
                }
                Ok(Err(e)) => {
                    log::error!("Failed to wait for process: {}", e);
                    return Err(format!("Failed to wait for process: {}", e));
                }
                Err(_) => {
                    // Process hasn't exited yet, but streams are closed
                    // This can happen with long-running processes
                    log::info!("Process still running after streams closed");
                    break;
                }
            }
        }
    }

    // Return with timeout flag
    Ok(ShellResult {
        stdout: stdout_lines.join("\n"),
        stderr: stderr_lines.join("\n"),
        code: -1, // Process still running
        timed_out,
        idle_timed_out,
        pid: child_pid,
    })
}

/// Execute a skill script (Python, Bash, or Node.js)
#[tauri::command]
async fn execute_skill_script(request: ScriptExecutionRequest) -> Result<ScriptExecutionResult, String> {
    log::info!(
        "Executing skill script: {} (type: {})",
        request.script_path,
        request.script_type
    );
    ScriptExecutor::execute(request).await
}

/// Create a tar.gz archive from a directory
#[tauri::command]
fn create_skill_tarball(request: CreateTarballRequest) -> Result<CreateTarballResult, String> {
    log::info!(
        "Creating tarball from {} to {}",
        request.source_dir,
        request.output_path
    );
    archive::create_tarball(request)
}

/// Extract a tar.gz archive to a directory
#[tauri::command]
fn extract_skill_tarball(request: ExtractTarballRequest) -> Result<ExtractTarballResult, String> {
    log::info!(
        "Extracting tarball from {} to {}",
        request.tarball_path,
        request.dest_dir
    );
    archive::extract_tarball(request)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
/// Clean up old log files, keeping only logs from the last N days
fn cleanup_old_logs(log_dir: &std::path::Path, days_to_keep: u64) {
    let cutoff = SystemTime::now() - Duration::from_secs(days_to_keep * 24 * 60 * 60);

    if let Ok(entries) = std::fs::read_dir(log_dir) {
        for entry in entries.flatten() {
            let path = entry.path();

            // Only process .log files
            if path.extension().and_then(|s| s.to_str()) != Some("log") {
                continue;
            }

            // Check file modification time
            if let Ok(metadata) = entry.metadata() {
                if let Ok(modified) = metadata.modified() {
                    if modified < cutoff {
                        if let Err(e) = std::fs::remove_file(&path) {
                            log::warn!("Failed to remove old log file {:?}: {}", path, e);
                        } else {
                            log::info!("Removed old log file: {:?}", path);
                        }
                    }
                }
            }
        }
    }
}

pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            file_watcher: Mutex::new(None),
            window_registry: WindowRegistry::new(),
        })
        .manage(AnalyticsState::new())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            if let Err(e) = app.emit("single-instance", Payload { args: argv, cwd }) {
                log::error!("Failed to emit single-instance event: {}", e);
            }
        }))
        .setup(|app| {
            // Clean up old log files (keep only last 3 days)
            if let Ok(log_dir) = app.path().app_log_dir() {
                log::info!("Cleaning up old log files in: {:?}", log_dir);
                cleanup_old_logs(&log_dir, 3);
            }

            // Initialize database
            let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
            let db_path = app_data_dir.join("talkcody.db");
            let db_path_str = db_path.to_string_lossy().to_string();

            log::info!("Initializing database at: {}", db_path_str);
            let database = Arc::new(Database::new(db_path_str));
            app.manage(database);

            // Initialize WebSocket state
            log::info!("Initializing WebSocket state");
            let ws_state = Arc::new(TokioMutex::new(WebSocketState::new()));
            app.manage(ws_state);

            // Initialize Code Navigation state
            log::info!("Initializing Code Navigation state");
            let code_nav_state = CodeNavState(RwLock::new(CodeNavigationService::new()));
            app.manage(code_nav_state);

            // Start analytics session
            let app_version = app.package_info().version.to_string();
            let app_data_dir_clone = app_data_dir.clone();
            if let Some(analytics_state) = app.try_state::<AnalyticsState>() {
                let state = analytics_state.inner().clone();
                tauri::async_runtime::spawn(async move {
                    analytics::start_session(&state, &app_data_dir_clone, &app_version).await;
                });
            }

            // Platform-specific deep link registration
            #[cfg(target_os = "macos")]
            {
                // Deep link is automatically registered via Info.plist on macOS
                log::info!("Deep link handler configured for URL scheme: talkcody:// (via Info.plist)");
            }

            #[cfg(target_os = "linux")]
            {
                // Linux requires runtime registration to create .desktop file and configure xdg-mime
                log::info!("Registering deep link handler for URL scheme: talkcody://");
                match app.deep_link().register_all() {
                    Ok(_) => log::info!("Deep link handler registered successfully on Linux"),
                    Err(e) => log::error!("Failed to register deep link handler on Linux: {}", e),
                }
            }

            #[cfg(windows)]
            {
                // Windows deep link registration
                log::info!("Deep link handler configured for URL scheme: talkcody://");
            }

            // Check if there are any initial deep link URLs (works on all platforms)
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                log::info!("Initial deep link URLs found: {:?}", urls);
                for url in &urls {
                    log::info!("Initial deep link URL: {}", url);
                }
            } else {
                log::info!("No initial deep link URLs");
            }

            // Initialize updater plugin for desktop platforms
            #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
            {
                log::info!("Initializing updater plugin");
                app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
            }

            // Register the main window
            let main_window_label = "main";
            if let Some(app_state) = app.try_state::<AppState>() {
                let state = WindowState {
                    project_id: None,
                    root_path: None,
                    file_watcher: None,
                };
                if let Err(e) = app_state.window_registry.register_window(main_window_label.to_string(), state) {
                    log::error!("Failed to register main window: {}", e);
                }
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
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir { file_name: None }),
                ])
                .level(log::LevelFilter::Info)
                .max_file_size(100_000_000) // 10MB per log file
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepAll)
                .timezone_strategy(tauri_plugin_log::TimezoneStrategy::UseLocal)
                .build()
        )
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
            // Window management commands
            create_project_window,
            get_all_project_windows,
            get_current_window_label,
            check_project_window_exists,
            focus_project_window,
            close_project_window,
            update_window_project,
            start_window_file_watching,
            stop_window_file_watching,
            activate_app,
            // Database commands
            database::db_connect,
            database::db_execute,
            database::db_query,
            database::db_batch,
            // HTTP proxy
            http_proxy::proxy_fetch,
            http_proxy::proxy_fetch_stream,
            http_proxy::stream_fetch,
            // Git commands
            git::git_get_status,
            git::git_is_repository,
            git::git_get_all_file_statuses,
            git::git_get_line_changes,
            git::git_get_all_file_diffs,
            git::git_get_raw_diff_text,
            // Git worktree commands
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
            // WebSocket commands
            websocket::ws_connect,
            websocket::ws_send,
            websocket::ws_disconnect,
            // Shell execution
            execute_user_shell,
            execute_skill_script,
            // Archive operations
            create_skill_tarball,
            extract_skill_tarball,
            // Terminal (PTY) commands
            terminal::pty_spawn,
            terminal::pty_write,
            terminal::pty_resize,
            terminal::pty_kill,
            // Code navigation commands
            code_navigation::code_nav_index_file,
            code_navigation::code_nav_index_files_batch,
            code_navigation::code_nav_find_definition,
            code_navigation::code_nav_find_references_hybrid,
            code_navigation::code_nav_clear_file,
            code_navigation::code_nav_clear_all,
            // Code navigation persistence commands
            code_navigation::code_nav_save_index,
            code_navigation::code_nav_load_index,
            code_navigation::code_nav_get_index_metadata,
            code_navigation::code_nav_delete_index,
            code_navigation::code_nav_get_indexed_files,
            // Lint commands
            lint::run_lint,
            lint::check_lint_runtime,
        ])
        .on_window_event(|window, event| {
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

                // Close database connection to release file handles
                if let Some(db) = app_handle.try_state::<Arc<Database>>() {
                    log::info!("Closing database connection on app exit");
                    db.inner().close_sync();
                }

                log::info!("session_end sent, app will exit now");
            }
        });
}
