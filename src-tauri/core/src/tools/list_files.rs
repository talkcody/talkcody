//! List Files Tool
//!
//! List files and directories in the specified directory.
//! Matches TypeScript list-files-tool.tsx logic.

use crate::core::tools::ToolContext;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListFilesResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Execute listFiles tool
pub async fn execute(
    directory_path: &str,
    max_depth: Option<usize>,
    ctx: &ToolContext,
) -> ListFilesResult {
    let max_depth = max_depth.unwrap_or(3);

    // Normalize path
    let path = if Path::new(directory_path).is_absolute() {
        directory_path.to_string()
    } else {
        Path::new(&ctx.workspace_root)
            .join(directory_path)
            .to_string_lossy()
            .to_string()
    };

    // Check if path exists
    if !Path::new(&path).exists() {
        return ListFilesResult {
            success: false,
            result: None,
            error: Some(format!("Directory not found: {}", directory_path)),
        };
    }

    // Check if it's a directory
    if !Path::new(&path).is_dir() {
        return ListFilesResult {
            success: false,
            result: None,
            error: Some(format!("Path is not a directory: {}", directory_path)),
        };
    }

    // Use the existing list_project_files function
    match crate::list_files::list_project_files(
        path.clone(),
        Some(true), // recursive
        Some(max_depth),
        Some(1000), // max_files
    ) {
        Ok(result) => ListFilesResult {
            success: true,
            result: Some(result),
            error: None,
        },
        Err(e) => ListFilesResult {
            success: false,
            result: None,
            error: Some(format!("Failed to list directory: {}", e)),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use tokio::fs::{create_dir_all, write};

    #[tokio::test]
    async fn test_list_files_success() {
        let temp_dir = TempDir::new().unwrap();
        let sub_dir = temp_dir.path().join("subdir");
        create_dir_all(&sub_dir).await.unwrap();
        write(sub_dir.join("file.txt"), "content").await.unwrap();

        let ctx = ToolContext {
            session_id: "test".to_string(),
            task_id: "test".to_string(),
            workspace_root: temp_dir.path().to_string_lossy().to_string(),
            worktree_path: None,
            settings: crate::storage::models::TaskSettings::default(),
            llm_state: None,
        };

        let result = execute(temp_dir.path().to_str().unwrap(), Some(2), &ctx).await;

        assert!(result.success);
        assert!(result.result.is_some());
        assert!(result.result.unwrap().contains("file.txt"));
    }

    #[tokio::test]
    async fn test_list_files_not_found() {
        let temp_dir = TempDir::new().unwrap();

        let ctx = ToolContext {
            session_id: "test".to_string(),
            task_id: "test".to_string(),
            workspace_root: temp_dir.path().to_string_lossy().to_string(),
            worktree_path: None,
            settings: crate::storage::models::TaskSettings::default(),
            llm_state: None,
        };

        let result = execute("nonexistent_dir", Some(3), &ctx).await;

        assert!(!result.success);
        assert!(result.error.unwrap().contains("Directory not found"));
    }
}
