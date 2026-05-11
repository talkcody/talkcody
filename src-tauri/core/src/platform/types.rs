//! Platform Types
//!
//! Shared types for platform operations (filesystem, git, shell)

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Context for platform operations
#[derive(Debug, Clone)]
pub struct PlatformContext {
    /// Workspace root directory (all operations must be within this directory)
    pub workspace_root: PathBuf,
    /// Optional worktree path for git operations
    pub worktree_path: Option<PathBuf>,
    /// Maximum file size for read operations (bytes)
    pub max_file_size: usize,
    /// Timeout for shell operations (seconds)
    pub shell_timeout_secs: u64,
}

impl Default for PlatformContext {
    fn default() -> Self {
        Self {
            workspace_root: std::env::current_dir().unwrap_or_else(|_| PathBuf::from("/")),
            worktree_path: None,
            max_file_size: 10 * 1024 * 1024, // 10MB
            shell_timeout_secs: 120,
        }
    }
}

/// Result of a platform operation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformResult<T> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<String>,
}

impl<T> PlatformResult<T> {
    pub fn success(data: T) -> Self {
        Self {
            success: true,
            data: Some(data),
            error: None,
        }
    }

    pub fn error(message: String) -> Self {
        Self {
            success: false,
            data: None,
            error: Some(message),
        }
    }
}

/// File information
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub is_directory: bool,
    pub is_file: bool,
    pub modified_at: Option<i64>,
    pub created_at: Option<i64>,
}

/// Directory entry
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryEntry {
    pub path: String,
    pub name: String,
    pub is_directory: bool,
    pub is_file: bool,
}

/// Git status information
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub is_repository: bool,
    pub branch: Option<String>,
    pub ahead: i32,
    pub behind: i32,
    pub staged: Vec<GitFileStatus>,
    pub unstaged: Vec<GitFileStatus>,
    pub untracked: Vec<String>,
}

/// Git file status
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileStatus {
    pub path: String,
    pub status: String, // "modified", "added", "deleted", "renamed", etc.
    pub old_path: Option<String>, // For renames
}

/// Shell command result
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub timed_out: bool,
}

/// Search result
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub path: String,
    pub line: usize,
    pub column: usize,
    pub text: String,
    pub context_before: Vec<String>,
    pub context_after: Vec<String>,
}

/// Workspace information
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceInfo {
    pub root_path: String,
    pub worktree_path: Option<String>,
    pub repository_url: Option<String>,
    pub branch: Option<String>,
}
