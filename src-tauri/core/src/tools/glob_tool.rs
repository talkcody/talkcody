//! Glob Tool
//!
//! Fast file pattern matching tool that works with any codebase size.
//! Matches TypeScript glob-tool.tsx logic.

use crate::core::tools::ToolContext;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobResult {
    pub path: String,
    pub is_directory: bool,
    pub modified_time: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobToolResult {
    pub success: bool,
    pub result: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Execute glob tool
pub async fn execute(pattern: &str, path: Option<&str>, ctx: &ToolContext) -> GlobToolResult {
    // Get search path
    let search_path = match path {
        Some(p) if !p.is_empty() => {
            if Path::new(p).is_absolute() {
                p.to_string()
            } else {
                Path::new(&ctx.workspace_root)
                    .join(p)
                    .to_string_lossy()
                    .to_string()
            }
        }
        _ => ctx.workspace_root.clone(),
    };

    // Use existing HighPerformanceGlob
    let glob = crate::glob::HighPerformanceGlob::new();

    match glob.search_files_by_glob(pattern, &search_path, 100) {
        Ok(results) => {
            if results.is_empty() {
                return GlobToolResult {
                    success: true,
                    result: format!(
                        "No files found matching pattern \"{}\" in {}",
                        pattern, search_path
                    ),
                    error: None,
                };
            }

            // Format results like TypeScript
            let formatted: Vec<String> = results
                .iter()
                .map(|r| {
                    let relative_path = r
                        .path
                        .strip_prefix(&search_path)
                        .map(|p| p.to_string())
                        .unwrap_or_else(|| r.path.clone());
                    let clean_relative = relative_path.trim_start_matches(['/', '\\']);
                    let timestamp = chrono::DateTime::from_timestamp(r.modified_time as i64, 0)
                        .map(|dt| dt.format("%Y-%m-%d").to_string())
                        .unwrap_or_else(|| "unknown".to_string());

                    if r.is_directory {
                        format!("{} ({}) [DIR]", clean_relative, timestamp)
                    } else {
                        format!("{} ({})", clean_relative, timestamp)
                    }
                })
                .collect();

            GlobToolResult {
                success: true,
                result: format!(
                    "Found {} file(s) matching \"{}\":\n\n{}",
                    results.len(),
                    pattern,
                    formatted.join("\n")
                ),
                error: None,
            }
        }
        Err(e) => GlobToolResult {
            success: false,
            result: "Error: Failed to search files with glob pattern".to_string(),
            error: Some(e),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use tokio::fs::write;

    #[tokio::test]
    async fn test_glob_found() {
        let temp_dir = TempDir::new().unwrap();
        write(temp_dir.path().join("test.txt"), "content")
            .await
            .unwrap();

        let ctx = ToolContext {
            session_id: "test".to_string(),
            task_id: "test".to_string(),
            workspace_root: temp_dir.path().to_string_lossy().to_string(),
            worktree_path: None,
            settings: crate::storage::models::TaskSettings::default(),
            llm_state: None,
        };

        let result = execute("*.txt", None, &ctx).await;

        assert!(result.success);
        assert!(result.result.contains("Found"));
        assert!(result.result.contains("test.txt"));
    }

    #[tokio::test]
    async fn test_glob_not_found() {
        let temp_dir = TempDir::new().unwrap();

        let ctx = ToolContext {
            session_id: "test".to_string(),
            task_id: "test".to_string(),
            workspace_root: temp_dir.path().to_string_lossy().to_string(),
            worktree_path: None,
            settings: crate::storage::models::TaskSettings::default(),
            llm_state: None,
        };

        let result = execute("*.xyz", None, &ctx).await;

        assert!(result.success);
        assert!(result.result.contains("No files found"));
    }
}
