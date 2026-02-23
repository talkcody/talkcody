//! Edit File Tool
//!
//! Edit an existing file with one or more text replacements.
//! Matches TypeScript edit-file-tool.tsx logic.

use crate::core::tools::ToolContext;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditFileResult {
    pub success: bool,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub edits_applied: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_replacements: Option<usize>,
}

#[derive(Debug, Deserialize)]
pub struct EditBlock {
    pub old_string: String,
    pub new_string: String,
}

/// Execute editFile tool
pub async fn execute(
    file_path: &str,
    edits: Vec<EditBlock>,
    _review_mode: bool,
    ctx: &ToolContext,
) -> EditFileResult {
    // Handle $RESOURCE prefix - not supported in backend
    if file_path.starts_with("$RESOURCE/") || file_path.starts_with("$RESOURCE\\") {
        return EditFileResult {
            success: false,
            message: "Resource paths ($RESOURCE/) are not supported in backend mode".to_string(),
            edits_applied: None,
            total_replacements: None,
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
            // File doesn't exist yet
            return EditFileResult {
                success: false,
                message: format!(
                    "File not found: {}. This tool only edits existing files. Use create-file or write-file for new files.",
                    file_path
                ),
                edits_applied: None,
                total_replacements: None,
            };
        }
    };

    // Check if target is within workspace
    if !target_path.starts_with(&workspace_root) {
        return EditFileResult {
            success: false,
            message: format!(
                "Security Error: File path \"{}\" is outside the allowed project directory \"{}\". Files can only be edited within the current project directory.",
                path, ctx.workspace_root
            ),
            edits_applied: None,
            total_replacements: None,
        };
    }

    // Read current content
    let current_content = match tokio::fs::read_to_string(&path).await {
        Ok(content) => normalize_string(&content),
        Err(e) => {
            return EditFileResult {
                success: false,
                message: format!(
                    "File not found: {}. This tool only edits existing files. Use create-file or write-file for new files. Error: {}",
                    file_path, e
                ),
                edits_applied: None,
                total_replacements: None,
            };
        }
    };

    // Validate edits
    if edits.is_empty() {
        return EditFileResult {
            success: false,
            message: "At least one edit block is required.".to_string(),
            edits_applied: None,
            total_replacements: None,
        };
    }

    // Check for empty old_strings
    for (i, edit) in edits.iter().enumerate() {
        if edit.old_string.trim().is_empty() {
            return EditFileResult {
                success: false,
                message: format!(
                    "Edit {}: old_string cannot be empty. Use write-file or create-file for new content.",
                    i + 1
                ),
                edits_applied: None,
                total_replacements: None,
            };
        }
    }

    // Check for duplicate edits
    let unique_edits: std::collections::HashSet<String> = edits
        .iter()
        .map(|e| format!("{}:::{}", e.old_string, e.new_string))
        .collect();
    if unique_edits.len() != edits.len() {
        return EditFileResult {
            success: false,
            message: "Duplicate edit blocks detected. Each edit should be unique. Remove duplicate edits.".to_string(),
            edits_applied: None,
            total_replacements: None,
        };
    }

    // Check if old_string equals new_string for any edit
    for (i, edit) in edits.iter().enumerate() {
        if edit.old_string == edit.new_string {
            return EditFileResult {
                success: false,
                message: format!(
                    "Edit {}: No changes needed. The old_string and new_string are identical.",
                    i + 1
                ),
                edits_applied: None,
                total_replacements: None,
            };
        }
    }

    // Apply edits sequentially
    let mut working_content = current_content.clone();
    let mut total_replacements = 0;

    for (i, edit) in edits.iter().enumerate() {
        let normalized_old = normalize_string(&edit.old_string);
        let normalized_new = normalize_string(&edit.new_string);

        // Try exact match first
        if working_content.contains(&normalized_old) {
            let replacement =
                safe_literal_replace(&working_content, &normalized_old, &normalized_new, false);
            if replacement.occurrences > 0 {
                working_content = replacement.result;
                total_replacements += replacement.occurrences;
                continue;
            }
        }

        // Try smart matching
        let smart_result = smart_match(&working_content, &normalized_old);
        match smart_result.match_type {
            MatchType::Exact | MatchType::Smart => {
                if let Some(corrected_old) = smart_result.corrected_old_string {
                    let replacement = safe_literal_replace(
                        &smart_result.result,
                        &corrected_old,
                        &normalized_new,
                        false,
                    );
                    working_content = replacement.result;
                    total_replacements += replacement.occurrences;
                } else {
                    let replacement = safe_literal_replace(
                        &smart_result.result,
                        &normalized_old,
                        &normalized_new,
                        false,
                    );
                    working_content = replacement.result;
                    total_replacements += replacement.occurrences;
                }
            }
            MatchType::None => {
                let error_msg = generate_edit_error_message(&current_content, i, edit, file_path);
                return EditFileResult {
                    success: false,
                    message: error_msg,
                    edits_applied: None,
                    total_replacements: None,
                };
            }
        }
    }

    // Check if content changed
    if working_content == current_content {
        return EditFileResult {
            success: false,
            message: "No changes applied. The content is identical after all replacements. This should not happen - please report this issue.".to_string(),
            edits_applied: None,
            total_replacements: None,
        };
    }

    // Write the modified content
    match tokio::fs::write(&path, &working_content).await {
        Ok(_) => EditFileResult {
            success: true,
            message: format!(
                "Successfully applied {} edit{} to {} ({} total replacement{})",
                edits.len(),
                if edits.len() > 1 { "s" } else { "" },
                file_path,
                total_replacements,
                if total_replacements > 1 { "s" } else { "" }
            ),
            edits_applied: Some(edits.len()),
            total_replacements: Some(total_replacements),
        },
        Err(e) => EditFileResult {
            success: false,
            message: format!("Failed to write file: {}", e),
            edits_applied: None,
            total_replacements: None,
        },
    }
}

/// Normalize string line endings
fn normalize_string(s: &str) -> String {
    s.replace("\r\n", "\n").replace('\r', "\n")
}

struct ReplacementResult {
    result: String,
    occurrences: usize,
}

/// Performs safe literal string replacement
fn safe_literal_replace(
    content: &str,
    old_string: &str,
    new_string: &str,
    replace_all: bool,
) -> ReplacementResult {
    let all_occurrences = content.matches(old_string).count();

    if all_occurrences == 0 {
        return ReplacementResult {
            result: content.to_string(),
            occurrences: 0,
        };
    }

    if replace_all {
        let result = content.replace(old_string, new_string);
        ReplacementResult {
            result,
            occurrences: all_occurrences,
        }
    } else {
        // Replace only first occurrence
        if let Some(index) = content.find(old_string) {
            let result = format!(
                "{}{}{}",
                &content[..index],
                new_string,
                &content[index + old_string.len()..]
            );
            ReplacementResult {
                result,
                occurrences: 1,
            }
        } else {
            ReplacementResult {
                result: content.to_string(),
                occurrences: 0,
            }
        }
    }
}

enum MatchType {
    Exact,
    Smart,
    None,
}

struct SmartMatchResult {
    result: String,
    _occurrences: usize,
    match_type: MatchType,
    corrected_old_string: Option<String>,
}

/// Smart matching algorithm with fallback strategies
fn smart_match(content: &str, search_text: &str) -> SmartMatchResult {
    // Try exact match first
    if content.contains(search_text) {
        return SmartMatchResult {
            result: content.to_string(),
            _occurrences: 1,
            match_type: MatchType::Exact,
            corrected_old_string: None,
        };
    }

    // Try with normalized line endings (already normalized by caller, but double check)
    let normalized_content = normalize_string(content);
    let normalized_search = normalize_string(search_text);

    if normalized_content.contains(&normalized_search) {
        return SmartMatchResult {
            result: normalized_content,
            _occurrences: 1,
            match_type: MatchType::Smart,
            corrected_old_string: Some(normalized_search),
        };
    }

    // Try trimmed whitespace matching
    let content_lines: Vec<&str> = normalized_content.lines().collect();
    let search_lines: Vec<&str> = normalized_search.lines().collect();

    if search_lines.is_empty() {
        return SmartMatchResult {
            result: content.to_string(),
            _occurrences: 0,
            match_type: MatchType::None,
            corrected_old_string: None,
        };
    }

    for i in 0..=content_lines.len().saturating_sub(search_lines.len()) {
        let candidate_lines = &content_lines[i..i + search_lines.len()];
        let trimmed_candidate: Vec<&str> = candidate_lines.iter().map(|l| l.trim()).collect();
        let trimmed_search: Vec<&str> = search_lines.iter().map(|l| l.trim()).collect();

        if trimmed_candidate == trimmed_search {
            // Found match with different whitespace - extract the exact text from file
            let exact_text_from_file = candidate_lines.join("\n");
            return SmartMatchResult {
                result: normalized_content,
                _occurrences: 1,
                match_type: MatchType::Smart,
                corrected_old_string: Some(exact_text_from_file),
            };
        }
    }

    SmartMatchResult {
        result: content.to_string(),
        _occurrences: 0,
        match_type: MatchType::None,
        corrected_old_string: None,
    }
}

/// Generates detailed error message when an edit fails to match
fn generate_edit_error_message(
    content: &str,
    edit_index: usize,
    edit: &EditBlock,
    file_path: &str,
) -> String {
    let normalized_old = normalize_string(&edit.old_string);
    let similar_texts = find_similar_text(content, &normalized_old, 3);

    let mut error_msg = format!(
        "Edit {} failed: Could not find exact match in {}.\n\n",
        edit_index + 1,
        file_path
    );
    error_msg.push_str("❌ The old_string was not found exactly as provided.\n\n");

    // Check if the issue is with line ending format
    if edit.old_string.contains("\\n") {
        error_msg.push_str("🔍 Your old_string contains literal \\n characters. Try using actual line breaks instead.\n\n");
        error_msg
            .push_str("💡 Suggested fix: Replace \\n with actual newlines in your old_string.\n\n");
    }

    if !similar_texts.is_empty() {
        error_msg.push_str("🔍 Found similar text at these locations:\n");
        for (i, text) in similar_texts.iter().enumerate() {
            error_msg.push_str(&format!("\n{}. {}\n", i + 1, text));
        }
        error_msg.push_str("\n💡 Copy the exact text from the file (including proper indentation) and use it as old_string.\n");
    } else {
        error_msg.push_str("🔍 No similar text found. The content might have changed.\n");
        error_msg.push_str("💡 Use readFile to verify the current file content and copy the exact text you want to replace.\n");
    }

    error_msg
}

/// Finds similar text in content for error suggestions
fn find_similar_text(content: &str, search_text: &str, max_results: usize) -> Vec<String> {
    let lines: Vec<&str> = content.lines().collect();
    let search_lines: Vec<&str> = search_text.lines().collect();
    let mut results = Vec::new();

    let first_line = search_lines.first().and_then(|l| {
        let trimmed = l.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    });

    if let Some(first) = first_line {
        for (i, line) in lines.iter().enumerate() {
            if line.contains(first) && results.len() < max_results {
                let context_start = i.saturating_sub(2);
                let context_end = (i + 5).min(lines.len());
                let context = lines[context_start..context_end].join("\n");
                results.push(format!("Near line {}:\n{}", i + 1, context));
            }
        }
    }

    results
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use tokio::fs::write;

    #[tokio::test]
    async fn test_edit_file_success() {
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

        let edits = vec![EditBlock {
            old_string: "World".to_string(),
            new_string: "Rust".to_string(),
        }];

        let result = execute(file_path.to_str().unwrap(), edits, false, &ctx).await;

        assert!(result.success);

        // Verify file was modified
        let content = tokio::fs::read_to_string(&file_path).await.unwrap();
        assert_eq!(content, "Hello, Rust!");
    }

    #[tokio::test]
    async fn test_edit_file_not_found() {
        let temp_dir = TempDir::new().unwrap();

        let ctx = ToolContext {
            session_id: "test".to_string(),
            task_id: "test".to_string(),
            workspace_root: temp_dir.path().to_string_lossy().to_string(),
            worktree_path: None,
            settings: crate::storage::models::TaskSettings::default(),
            llm_state: None,
        };

        let edits = vec![EditBlock {
            old_string: "old".to_string(),
            new_string: "new".to_string(),
        }];

        let result = execute("nonexistent.txt", edits, false, &ctx).await;

        assert!(!result.success);
        assert!(result.message.contains("File not found"));
    }

    #[tokio::test]
    async fn test_edit_file_no_changes_needed() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("test.txt");
        write(&file_path, "same content").await.unwrap();

        let ctx = ToolContext {
            session_id: "test".to_string(),
            task_id: "test".to_string(),
            workspace_root: temp_dir.path().to_string_lossy().to_string(),
            worktree_path: None,
            settings: crate::storage::models::TaskSettings::default(),
            llm_state: None,
        };

        let edits = vec![EditBlock {
            old_string: "same content".to_string(),
            new_string: "same content".to_string(),
        }];

        let result = execute(file_path.to_str().unwrap(), edits, false, &ctx).await;

        assert!(!result.success);
        assert!(result.message.contains("No changes needed"));
    }
}
