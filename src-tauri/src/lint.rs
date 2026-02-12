use serde::{Deserialize, Serialize};
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter};

/// Cached result of bun availability check.
/// Note: This is a static cache that persists for the lifetime of the application.
/// If the user installs bun after the app starts, they will need to restart the app
/// for the change to take effect. This is intentional to avoid repeated shell executions.
static BUN_AVAILABLE: OnceLock<bool> = OnceLock::new();

/// Cached result of node availability check.
/// Same caching behavior as BUN_AVAILABLE.
static NODE_AVAILABLE: OnceLock<bool> = OnceLock::new();

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RuntimeStatus {
    pub bun_available: bool,
    pub node_available: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LintDiagnostic {
    pub severity: String,
    pub message: String,
    pub line: u32,
    pub column: u32,
    pub end_line: u32,
    pub end_column: u32,
    pub code: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LintResult {
    pub file_path: String,
    pub diagnostics: Vec<LintDiagnostic>,
    pub request_id: String,
    pub timestamp: u64,
}

/// Check if bun is available on the system
fn is_bun_available() -> bool {
    *BUN_AVAILABLE.get_or_init(|| {
        let mut cmd = crate::shell_utils::new_command("bun");
        cmd.arg("--version");
        cmd.output()
            .map(|output| output.status.success())
            .unwrap_or(false)
    })
}

/// Check if node is available on the system
fn is_node_available() -> bool {
    *NODE_AVAILABLE.get_or_init(|| {
        let mut cmd = crate::shell_utils::new_command("node");
        cmd.arg("--version");
        cmd.output()
            .map(|output| output.status.success())
            .unwrap_or(false)
    })
}

/// Check if lint runtime (bun or node) is available
#[tauri::command]
pub fn check_lint_runtime() -> RuntimeStatus {
    RuntimeStatus {
        bun_available: is_bun_available(),
        node_available: is_node_available(),
    }
}

/// Get the file extension from a file path
fn get_file_extension(file_path: &str) -> Option<&str> {
    std::path::Path::new(file_path)
        .extension()
        .and_then(|ext| ext.to_str())
}

/// Check if a file type is supported by biome
fn is_supported_file_type(file_path: &str) -> bool {
    matches!(
        get_file_extension(file_path),
        Some("js" | "jsx" | "ts" | "tsx" | "json" | "jsonc" | "css" | "html")
    )
}

/// Execute biome lint on the original file directly
/// This function assumes the file has been saved (via auto-save)
fn execute_biome_lint(file_path: &str, root_path: &str, request_id: &str) -> LintResult {
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    // Check if file type is supported
    if !is_supported_file_type(file_path) {
        log::debug!("File type not supported for lint: {}", file_path);
        return LintResult {
            file_path: file_path.to_string(),
            diagnostics: vec![],
            request_id: request_id.to_string(),
            timestamp,
        };
    }

    // Check if file exists
    if !std::path::Path::new(file_path).exists() {
        log::warn!("File does not exist for lint: {}", file_path);
        return LintResult {
            file_path: file_path.to_string(),
            diagnostics: vec![],
            request_id: request_id.to_string(),
            timestamp,
        };
    }

    // Read file content for accurate line/column calculation
    let file_content = std::fs::read_to_string(file_path).unwrap_or_default();

    // Choose executor based on availability
    let executor = if is_bun_available() { "bunx" } else { "npx" };
    log::debug!("Using {} to run biome lint on: {}", executor, file_path);

    // Run biome lint directly on the original file
    // Set current_dir to root_path so biome can find biome.json
    let mut biome_cmd = crate::shell_utils::new_command(executor);
    biome_cmd
        .args(["biome", "lint", file_path, "--reporter", "json"])
        .current_dir(root_path);
    let output = biome_cmd.output();

    let diagnostics = match output {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);

            log::debug!(
                "Biome output - stdout length: {}, stderr length: {}, exit code: {:?}",
                stdout.len(),
                stderr.len(),
                output.status.code()
            );

            if !stderr.is_empty() && log::log_enabled!(log::Level::Debug) {
                log::debug!("Biome stderr: {}", stderr);
            }

            parse_biome_json_output(&stdout, &file_content)
        }
        Err(e) => {
            log::error!("Failed to execute biome: {}", e);
            vec![]
        }
    };

    LintResult {
        file_path: file_path.to_string(),
        diagnostics,
        request_id: request_id.to_string(),
        timestamp,
    }
}

/// Parse biome JSON output format
/// file_content is the full content of the file being linted, used for accurate line/column calculation
fn parse_biome_json_output(output: &str, file_content: &str) -> Vec<LintDiagnostic> {
    let mut diagnostics = Vec::new();

    log::debug!("parse_biome_json_output: input length = {}", output.len());

    // Build line index once for efficient offset conversion
    let line_index = LineIndex::new(file_content);

    // Biome outputs JSON with diagnostics array
    // Try to parse each line as JSON (biome may output multiple JSON objects)
    for (line_num, line) in output.lines().enumerate() {
        let line = line.trim();
        if line.is_empty() || !line.starts_with('{') {
            continue;
        }

        log::debug!(
            "Trying to parse line {} as JSON (length: {})",
            line_num,
            line.len()
        );
        match serde_json::from_str::<serde_json::Value>(line) {
            Ok(json) => {
                log::debug!("Parsed JSON successfully, checking for diagnostics field");
                if let Some(diags) = json.get("diagnostics").and_then(|d| d.as_array()) {
                    log::debug!("Found {} diagnostics in line", diags.len());
                    for diag in diags {
                        if let Some(diagnostic) = parse_single_diagnostic(diag, &line_index) {
                            diagnostics.push(diagnostic);
                        }
                    }
                } else {
                    log::debug!("No diagnostics field found in JSON");
                }
            }
            Err(e) => {
                log::debug!("Failed to parse line as JSON: {}", e);
            }
        }
    }

    // If no JSON parsed, try to parse the entire output as one JSON object
    if diagnostics.is_empty() && !output.trim().is_empty() {
        log::debug!("No diagnostics found in lines, trying to parse entire output as JSON");
        match serde_json::from_str::<serde_json::Value>(output) {
            Ok(json) => {
                log::debug!("Parsed entire output as JSON successfully");
                if let Some(diags) = json.get("diagnostics").and_then(|d| d.as_array()) {
                    log::debug!("Found {} diagnostics in full output", diags.len());
                    for diag in diags {
                        if let Some(diagnostic) = parse_single_diagnostic(diag, &line_index) {
                            diagnostics.push(diagnostic);
                        }
                    }
                } else {
                    log::debug!("No diagnostics field in full JSON output");
                }
            }
            Err(e) => {
                log::debug!("Failed to parse entire output as JSON: {}", e);
            }
        }
    }

    log::debug!(
        "parse_biome_json_output: returning {} diagnostics",
        diagnostics.len()
    );
    diagnostics
}

/// Parse a single diagnostic from biome JSON
/// line_index is used for efficient byte offset to line/column conversion
fn parse_single_diagnostic(
    diag: &serde_json::Value,
    line_index: &LineIndex,
) -> Option<LintDiagnostic> {
    // Get severity
    let severity = diag
        .get("severity")
        .and_then(|s| s.as_str())
        .unwrap_or("error")
        .to_lowercase();

    // Map biome severity to our format
    let severity = match severity.as_str() {
        "fatal" | "error" => "error",
        "warning" => "warning",
        "information" | "hint" => "info",
        _ => "error",
    }
    .to_string();

    // Get message
    let message = diag
        .get("message")
        .and_then(|m| {
            // Message can be a string or an array of objects with text
            if m.is_string() {
                m.as_str().map(|s| s.to_string())
            } else if m.is_array() {
                let parts: Vec<String> = m
                    .as_array()?
                    .iter()
                    .filter_map(|part| {
                        part.get("content")
                            .and_then(|c| c.as_str())
                            .map(|s| s.to_string())
                    })
                    .collect();
                Some(parts.join(""))
            } else {
                None
            }
        })
        .or_else(|| {
            diag.get("description")
                .and_then(|d| d.as_str())
                .map(|s| s.to_string())
        })?;

    // Get location
    let location = diag.get("location")?;
    let span = location.get("span")?;

    let start = span.get(0).and_then(|s| s.as_u64()).unwrap_or(0);
    let end = span.get(1).and_then(|s| s.as_u64()).unwrap_or(start);

    // For biome, span is byte offset relative to the full file
    // Use the line index for efficient line/column calculation
    let (line, column) = line_index.offset_to_line_col(start as usize);
    let (end_line, end_column) = line_index.offset_to_line_col(end as usize);

    // Get rule code
    let code = diag
        .get("category")
        .and_then(|c| c.as_str())
        .map(|s| s.to_string());

    Some(LintDiagnostic {
        severity,
        message,
        line,
        column,
        end_line,
        end_column,
        code,
    })
}

/// Line index for efficient byte offset to line/column conversion
struct LineIndex {
    /// Byte offset of the start of each line (0-indexed lines, but we use 1-indexed externally)
    line_starts: Vec<usize>,
    /// The source string for column calculation
    source: String,
}

impl LineIndex {
    /// Build a line index from source code
    fn new(source: &str) -> Self {
        let mut line_starts = vec![0]; // First line starts at offset 0
        for (i, ch) in source.char_indices() {
            if ch == '\n' {
                line_starts.push(i + 1); // Next line starts after the newline
            }
        }
        Self {
            line_starts,
            source: source.to_string(),
        }
    }

    /// Convert byte offset to line and column (1-indexed)
    fn offset_to_line_col(&self, offset: usize) -> (u32, u32) {
        // Binary search to find the line
        let line_idx = match self.line_starts.binary_search(&offset) {
            Ok(idx) => idx,      // Exact match: offset is at start of a line
            Err(idx) => idx - 1, // offset is within line (idx - 1)
        };

        let line_start = self.line_starts[line_idx];

        // Calculate column by counting characters from line start to offset
        let col = self.source[line_start..offset.min(self.source.len())]
            .chars()
            .count() as u32
            + 1;

        (line_idx as u32 + 1, col) // Convert to 1-indexed
    }
}

/// Convert byte offset to line and column (1-indexed)
/// Note: For multiple offsets, prefer using LineIndex directly
#[cfg(test)]
fn byte_offset_to_line_col(source: &str, offset: usize) -> (u32, u32) {
    let index = LineIndex::new(source);
    index.offset_to_line_col(offset)
}

/// Run lint asynchronously and emit result via event
/// This command returns immediately and sends the result via "lint-result" event
/// Note: This lints the saved file directly, so ensure the file is saved before calling
#[tauri::command]
pub async fn run_lint(
    app: AppHandle,
    file_path: String,
    root_path: String,
    request_id: String,
) -> Result<(), String> {
    log::debug!(
        "Received lint request: {} in {} (id: {})",
        file_path,
        root_path,
        request_id
    );

    // Spawn an async task to handle the blocking lint operation
    // This ensures proper error handling if the task panics
    let app_clone = app.clone();
    let file_path_clone = file_path.clone();
    let request_id_clone = request_id.clone();

    tokio::spawn(async move {
        // Run the blocking lint operation
        let result = tokio::task::spawn_blocking(move || {
            execute_biome_lint(&file_path, &root_path, &request_id)
        })
        .await;

        match result {
            Ok(lint_result) => {
                log::debug!(
                    "Lint completed for {} (id: {}): {} diagnostics",
                    lint_result.file_path,
                    lint_result.request_id,
                    lint_result.diagnostics.len()
                );

                // Emit result to frontend
                if let Err(e) = app_clone.emit("lint-result", &lint_result) {
                    log::error!("Failed to emit lint result: {}", e);
                }
            }
            Err(e) => {
                log::error!(
                    "Lint task panicked for {} (id: {}): {:?}",
                    file_path_clone,
                    request_id_clone,
                    e
                );
                // Emit an empty result so the frontend doesn't hang
                let empty_result = LintResult {
                    file_path: file_path_clone,
                    diagnostics: vec![],
                    request_id: request_id_clone,
                    timestamp: std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_millis() as u64)
                        .unwrap_or(0),
                };
                if let Err(e) = app_clone.emit("lint-result", &empty_result) {
                    log::error!("Failed to emit empty lint result: {}", e);
                }
            }
        }
    });

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_supported_file_type() {
        assert!(is_supported_file_type("test.ts"));
        assert!(is_supported_file_type("test.tsx"));
        assert!(is_supported_file_type("test.js"));
        assert!(is_supported_file_type("test.jsx"));
        assert!(is_supported_file_type("test.json"));
        assert!(is_supported_file_type("test.css"));
        assert!(!is_supported_file_type("test.rs"));
        assert!(!is_supported_file_type("test.py"));
        assert!(!is_supported_file_type("test.md"));
    }

    #[test]
    fn test_byte_offset_to_line_col() {
        let source = "line1\nline2\nline3";

        // First character
        assert_eq!(byte_offset_to_line_col(source, 0), (1, 1));

        // End of first line
        assert_eq!(byte_offset_to_line_col(source, 5), (1, 6));

        // Start of second line
        assert_eq!(byte_offset_to_line_col(source, 6), (2, 1));

        // Middle of second line
        assert_eq!(byte_offset_to_line_col(source, 8), (2, 3));
    }

    #[test]
    fn test_get_file_extension() {
        assert_eq!(get_file_extension("test.ts"), Some("ts"));
        assert_eq!(get_file_extension("path/to/file.tsx"), Some("tsx"));
        assert_eq!(get_file_extension("noextension"), None);
    }
}
