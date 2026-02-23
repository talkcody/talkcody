//! Read File Tool
//!
//! Read the contents of a file at the specified path.
//! Matches TypeScript read-file-tool.tsx logic.

use crate::core::tools::ToolContext;
use serde::{Deserialize, Serialize};
use std::path::Path;

const MAX_LINES: usize = 1000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadFileResult {
    pub success: bool,
    pub file_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    pub message: String,
}

/// Execute readFile tool
pub async fn execute(
    file_path: &str,
    start_line: Option<usize>,
    line_count: Option<usize>,
    ctx: &ToolContext,
) -> ReadFileResult {
    // Handle $RESOURCE prefix - not supported in backend
    if file_path.starts_with("$RESOURCE/") || file_path.starts_with("$RESOURCE\\") {
        return ReadFileResult {
            success: false,
            file_path: file_path.to_string(),
            content: None,
            message: "Resource paths ($RESOURCE/) are not supported in backend mode".to_string(),
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

    // Check if file exists
    if !Path::new(&path).exists() {
        return ReadFileResult {
            success: false,
            file_path: path,
            content: None,
            message: format!("File not found: {}", file_path),
        };
    }

    // Check if it's a file
    if !Path::new(&path).is_file() {
        return ReadFileResult {
            success: false,
            file_path: path,
            content: None,
            message: format!("Path is not a file: {}", file_path),
        };
    }

    // Read file content
    let full_content = match tokio::fs::read_to_string(&path).await {
        Ok(content) => content,
        Err(e) => {
            return ReadFileResult {
                success: false,
                file_path: path,
                content: None,
                message: format!("Failed to read file: {}", e),
            };
        }
    };

    // Extract lines based on parameters
    let result = extract_lines(&full_content, &path, start_line, line_count);

    ReadFileResult {
        success: result.success,
        file_path: path,
        content: result.content,
        message: result.message,
    }
}

struct LineExtractionResult {
    success: bool,
    content: Option<String>,
    message: String,
}

fn extract_lines(
    full_content: &str,
    file_path: &str,
    start_line: Option<usize>,
    line_count: Option<usize>,
) -> LineExtractionResult {
    let lines: Vec<&str> = full_content.lines().collect();
    let total_lines = lines.len();

    // If no line parameters are specified, handle with max lines limit
    if start_line.is_none() && line_count.is_none() {
        if total_lines > MAX_LINES {
            let truncated_lines = &lines[..MAX_LINES];
            let truncated_content = truncated_lines.join("\n");
            return LineExtractionResult {
                success: true,
                content: Some(truncated_content),
                message: format!(
                    "Successfully read file: {} (TRUNCATED: showing first {} of {} total lines)",
                    file_path, MAX_LINES, total_lines
                ),
            };
        } else {
            return LineExtractionResult {
                success: true,
                content: Some(full_content.to_string()),
                message: format!(
                    "Successfully read {} lines from file: {}",
                    total_lines, file_path
                ),
            };
        }
    }

    // Validate start_line parameter
    if let Some(start) = start_line {
        if start < 1 || start > total_lines {
            return LineExtractionResult {
                success: false,
                content: None,
                message: format!(
                    "Invalid start_line: {}. File has {} lines (valid range: 1-{})",
                    start, total_lines, total_lines
                ),
            };
        }
    }

    // Calculate the actual start index (convert from 1-indexed to 0-indexed)
    let start_index = start_line.map(|s| s - 1).unwrap_or(0);

    // Calculate end index based on line_count and MAX_LINES limit
    let mut end_index: usize;
    if let Some(count) = line_count {
        end_index = (start_index + count).min(total_lines);
    } else {
        end_index = total_lines;
    }

    // Apply MAX_LINES limit if no explicit line_count is specified
    if line_count.is_none() && end_index - start_index > MAX_LINES {
        end_index = start_index + MAX_LINES;
    }

    // Extract the requested lines
    let extracted_lines = &lines[start_index..end_index];
    let extracted_content = extracted_lines.join("\n");

    // Create descriptive message
    let actual_lines_read = extracted_lines.len();
    let start_line_number = start_index + 1;
    let end_line_number = start_index + actual_lines_read;

    let message = if start_line.is_some() && line_count.is_some() {
        format!(
            "Successfully read {} lines ({}-{}) from file: {}",
            actual_lines_read, start_line_number, end_line_number, file_path
        )
    } else if start_line.is_some() {
        if actual_lines_read < total_lines - start_index + 1 {
            format!(
                "Successfully read {} lines ({}-{}) from file: {} (TRUNCATED: limited to {} lines, file has {} total lines)",
                actual_lines_read, start_line_number, end_line_number, file_path, MAX_LINES, total_lines
            )
        } else {
            format!(
                "Successfully read lines {}-{} from file: {}",
                start_line_number, end_line_number, file_path
            )
        }
    } else {
        if actual_lines_read < total_lines {
            format!(
                "Successfully read first {} lines from file: {} (TRUNCATED: limited to {} lines, file has {} total lines)",
                actual_lines_read, file_path, MAX_LINES, total_lines
            )
        } else {
            format!(
                "Successfully read first {} lines from file: {}",
                actual_lines_read, file_path
            )
        }
    };

    LineExtractionResult {
        success: true,
        content: Some(extracted_content),
        message,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use tokio::fs::write;

    #[tokio::test]
    async fn test_read_file_success() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("test.txt");
        write(&file_path, "Hello, World!").await.unwrap();

        let ctx = ToolContext {
            session_id: "test".to_string(),
            task_id: "test".to_string(),
            workspace_root: temp_dir.path().to_string_lossy().to_string(),
            worktree_path: None,
            settings: crate::storage::models::TaskSettings::default(),
            llm_state: None,
        };

        let result = execute(file_path.to_str().unwrap(), None, None, &ctx).await;

        assert!(result.success);
        assert_eq!(result.content, Some("Hello, World!".to_string()));
    }

    #[tokio::test]
    async fn test_read_file_not_found() {
        let temp_dir = TempDir::new().unwrap();

        let ctx = ToolContext {
            session_id: "test".to_string(),
            task_id: "test".to_string(),
            workspace_root: temp_dir.path().to_string_lossy().to_string(),
            worktree_path: None,
            settings: crate::storage::models::TaskSettings::default(),
            llm_state: None,
        };

        let result = execute("nonexistent.txt", None, None, &ctx).await;

        assert!(!result.success);
        assert!(result.message.contains("File not found"));
    }

    #[tokio::test]
    async fn test_read_file_with_line_range() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("test.txt");
        write(&file_path, "line1\nline2\nline3\nline4\nline5")
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

        let result = execute(file_path.to_str().unwrap(), Some(2), Some(2), &ctx).await;

        assert!(result.success);
        assert_eq!(result.content, Some("line2\nline3".to_string()));
    }
}
