//! Code Search Tool
//!
//! Fast text search across the codebase using ripgrep.
//! Matches TypeScript code-search-tool.tsx logic.

use crate::core::tools::ToolContext;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeSearchResult {
    pub success: bool,
    pub result: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Execute codeSearch tool
pub async fn execute(
    pattern: &str,
    path: &str,
    file_types: Option<Vec<String>>,
    ctx: &ToolContext,
) -> CodeSearchResult {
    // Validate required parameters
    if path.trim().is_empty() {
        return CodeSearchResult {
            success: false,
            result: "Error: Missing required parameter".to_string(),
            error: Some("The \"path\" parameter is required. Please provide the absolute path to the directory to search in.".to_string()),
        };
    }

    // Resolve relative paths to absolute paths
    let search_path = if Path::new(path).is_absolute() {
        path.to_string()
    } else {
        Path::new(&ctx.workspace_root)
            .join(path)
            .to_string_lossy()
            .to_string()
    };

    // Use existing RipgrepSearch
    let search = crate::search::RipgrepSearch::new()
        .with_max_results(50)
        .with_file_types(file_types);

    match search.search_content(pattern, &search_path) {
        Ok(results) => {
            if results.is_empty() {
                return CodeSearchResult {
                    success: true,
                    result: "No matches found".to_string(),
                    error: None,
                };
            }

            // Format results like TypeScript
            let mut formatted_results = String::new();
            let mut total_matches = 0;

            for file_result in results {
                formatted_results.push_str(&format!("\nFile: {}\n", file_result.file_path));
                for m in &file_result.matches {
                    formatted_results.push_str(&format!(
                        "  {}: {}\n",
                        m.line_number,
                        m.line_content.trim()
                    ));
                    total_matches += 1;
                }
            }

            CodeSearchResult {
                success: true,
                result: format!(
                    "Found {} matches:\n{}",
                    total_matches,
                    formatted_results.trim()
                ),
                error: None,
            }
        }
        Err(e) => CodeSearchResult {
            success: false,
            result: "Error executing code search".to_string(),
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
    async fn test_code_search_found() {
        let temp_dir = TempDir::new().unwrap();
        write(temp_dir.path().join("test.txt"), "Hello, World!")
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

        let result = execute("Hello", temp_dir.path().to_str().unwrap(), None, &ctx).await;

        assert!(result.success);
        assert!(result.result.contains("Found"));
        assert!(result.result.contains("test.txt"));
    }

    #[tokio::test]
    async fn test_code_search_not_found() {
        let temp_dir = TempDir::new().unwrap();

        let ctx = ToolContext {
            session_id: "test".to_string(),
            task_id: "test".to_string(),
            workspace_root: temp_dir.path().to_string_lossy().to_string(),
            worktree_path: None,
            settings: crate::storage::models::TaskSettings::default(),
            llm_state: None,
        };

        let result = execute("xyz123", temp_dir.path().to_str().unwrap(), None, &ctx).await;

        assert!(result.success);
        assert_eq!(result.result, "No matches found");
    }
}
