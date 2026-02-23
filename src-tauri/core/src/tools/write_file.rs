//! Write File Tool
//!
//! Create a new file or overwrite an existing file with new content.
//! Matches TypeScript write-file-tool.tsx logic.

use crate::core::tools::ToolContext;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteFileResult {
    pub success: bool,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
}

/// Execute writeFile tool
pub async fn execute(
    file_path: &str,
    content: &str,
    _review_mode: bool,
    ctx: &ToolContext,
) -> WriteFileResult {
    // Handle $RESOURCE prefix - not supported in backend
    if file_path.starts_with("$RESOURCE/") || file_path.starts_with("$RESOURCE\\") {
        return WriteFileResult {
            success: false,
            message: "Resource paths ($RESOURCE/) are not supported in backend mode".to_string(),
            file_path: Some(file_path.to_string()),
        };
    }

    // Normalize path
    let path = if Path::new(file_path).is_absolute() {
        file_path.to_string()
    } else {
        Path::new(&ctx.workspace_root)
            .join(file_path)
            .to_string_lossy()
            .to_string()
    };

    // Security check: ensure path is within workspace
    let workspace_root = Path::new(&ctx.workspace_root)
        .canonicalize()
        .unwrap_or_else(|_| Path::new(&ctx.workspace_root).to_path_buf());
    let target_path = match Path::new(&path).canonicalize() {
        Ok(p) => p,
        Err(_) => {
            // File doesn't exist yet, check parent directories
            // Find the first existing parent directory to validate the path
            let path_obj = Path::new(&path);
            let mut existing_parent: Option<&Path> = None;

            for ancestor in path_obj.ancestors() {
                if ancestor.exists() {
                    existing_parent = Some(ancestor);
                    break;
                }
            }

            if let Some(parent) = existing_parent {
                match parent.canonicalize() {
                    Ok(canon_parent) => {
                        // Reconstruct the path with canonicalized parent
                        let relative_part = path_obj.strip_prefix(parent).unwrap_or(path_obj);
                        canon_parent.join(relative_part)
                    }
                    Err(e) => {
                        return WriteFileResult {
                            success: false,
                            message: format!("Invalid path: {}", e),
                            file_path: Some(path),
                        };
                    }
                }
            } else {
                return WriteFileResult {
                    success: false,
                    message: "Invalid path: no parent directory exists".to_string(),
                    file_path: Some(path),
                };
            }
        }
    };

    // Check if target is within workspace
    if !target_path.starts_with(&workspace_root) {
        return WriteFileResult {
            success: false,
            message: format!(
                "Security Error: File path \"{}\" is outside the allowed project directory \"{}\". Files can only be written within the current project directory.",
                path, ctx.workspace_root
            ),
            file_path: Some(path),
        };
    }

    // Check if file exists
    let file_exists = Path::new(&path).exists();

    // Normalize content (handle line endings like TS normalizeString)
    let normalized_content = normalize_string(content);

    // Ensure parent directory exists
    if let Some(parent) = Path::new(&path).parent() {
        if let Err(e) = tokio::fs::create_dir_all(parent).await {
            return WriteFileResult {
                success: false,
                message: format!("Failed to create directory: {}", e),
                file_path: Some(path),
            };
        }
    }

    // Write file
    match tokio::fs::write(&path, &normalized_content).await {
        Ok(_) => {
            let message = if file_exists {
                format!("Successfully overwrote file: {}", path)
            } else {
                format!("Successfully created file: {}", path)
            };
            WriteFileResult {
                success: true,
                message,
                file_path: Some(path),
            }
        }
        Err(e) => WriteFileResult {
            success: false,
            message: format!("Failed to write file: {}", e),
            file_path: Some(path),
        },
    }
}

/// Normalize string line endings (like TS normalizeString)
fn normalize_string(s: &str) -> String {
    s.replace("\r\n", "\n").replace('\r', "\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[tokio::test]
    async fn test_write_new_file() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("new_file.txt");

        let ctx = ToolContext {
            session_id: "test".to_string(),
            task_id: "test".to_string(),
            workspace_root: temp_dir.path().to_string_lossy().to_string(),
            worktree_path: None,
            settings: crate::storage::models::TaskSettings::default(),
            llm_state: None,
        };

        let result = execute(file_path.to_str().unwrap(), "Hello, World!", false, &ctx).await;

        assert!(result.success);
        assert!(result.message.contains("Successfully created"));
    }

    #[tokio::test]
    async fn test_write_outside_workspace() {
        let temp_dir = TempDir::new().unwrap();
        let outside_path = "/etc/passwd";

        let ctx = ToolContext {
            session_id: "test".to_string(),
            task_id: "test".to_string(),
            workspace_root: temp_dir.path().to_string_lossy().to_string(),
            worktree_path: None,
            settings: crate::storage::models::TaskSettings::default(),
            llm_state: None,
        };

        let result = execute(outside_path, "test content", false, &ctx).await;

        assert!(!result.success);
        assert!(result.message.contains("Security Error"));
    }

    #[tokio::test]
    async fn test_write_with_nested_directory() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("nested/dir/file.txt");

        let ctx = ToolContext {
            session_id: "test".to_string(),
            task_id: "test".to_string(),
            workspace_root: temp_dir.path().to_string_lossy().to_string(),
            worktree_path: None,
            settings: crate::storage::models::TaskSettings::default(),
            llm_state: None,
        };

        let result = execute(file_path.to_str().unwrap(), "Nested content", false, &ctx).await;

        assert!(result.success);

        // Verify file was created
        let content = tokio::fs::read_to_string(&file_path).await.unwrap();
        assert_eq!(content, "Nested content");
    }
}
