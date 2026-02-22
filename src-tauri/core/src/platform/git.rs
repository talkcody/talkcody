//! Git Platform Abstraction
//!
//! Provides git operations with workspace validation.
//! Wraps existing git module from the codebase.

use crate::platform::types::*;
use std::path::Path;

/// Git operations provider
#[derive(Clone)]
pub struct GitPlatform;

impl GitPlatform {
    pub fn new() -> Self {
        Self
    }

    /// Check if path is within workspace
    fn validate_path(
        &self,
        path: &Path,
        ctx: &PlatformContext,
    ) -> Result<std::path::PathBuf, String> {
        let canonical_path = path
            .canonicalize()
            .map_err(|e| format!("Invalid path: {}", e))?;

        let canonical_root = ctx
            .workspace_root
            .canonicalize()
            .map_err(|e| format!("Invalid workspace root: {}", e))?;

        if !canonical_path.starts_with(&canonical_root) {
            return Err(format!(
                "Path '{}' is outside workspace root '{}'",
                canonical_path.display(),
                canonical_root.display()
            ));
        }

        Ok(canonical_path)
    }

    /// Get effective path (worktree or workspace root)
    fn get_effective_path(&self, ctx: &PlatformContext) -> std::path::PathBuf {
        ctx.worktree_path
            .clone()
            .unwrap_or_else(|| ctx.workspace_root.clone())
    }

    /// Check if directory is a git repository
    pub async fn is_repository(&self, ctx: &PlatformContext) -> PlatformResult<bool> {
        let path = self.get_effective_path(ctx);

        match self.validate_path(&path, ctx) {
            Ok(validated_path) => {
                // Use existing git module
                match crate::git::git_is_repository(validated_path.to_string_lossy().to_string())
                    .await
                {
                    Ok(result) => PlatformResult::success(result),
                    Err(e) => PlatformResult::error(format!("Git check failed: {}", e)),
                }
            }
            Err(e) => PlatformResult::error(e),
        }
    }

    /// Get repository status
    pub async fn get_status(&self, ctx: &PlatformContext) -> PlatformResult<GitStatus> {
        let path = self.get_effective_path(ctx);

        match self.validate_path(&path, ctx) {
            Ok(validated_path) => {
                // Check if it's a repository first
                match crate::git::git_is_repository(validated_path.to_string_lossy().to_string())
                    .await
                {
                    Ok(true) => {}
                    Ok(false) => {
                        return PlatformResult::success(GitStatus {
                            is_repository: false,
                            branch: None,
                            ahead: 0,
                            behind: 0,
                            staged: vec![],
                            unstaged: vec![],
                            untracked: vec![],
                        });
                    }
                    Err(e) => return PlatformResult::error(format!("Git check failed: {}", e)),
                }

                // Get all file statuses
                match crate::git::git_get_all_file_statuses(
                    validated_path.to_string_lossy().to_string(),
                )
                .await
                {
                    Ok(statuses) => {
                        let mut staged = vec![];
                        let mut unstaged = vec![];
                        let mut untracked = vec![];

                        for (path, (status, is_staged)) in statuses {
                            let git_status = GitFileStatus {
                                path: path.clone(),
                                status: format!("{:?}", status),
                                old_path: None,
                            };

                            if is_staged {
                                staged.push(git_status);
                            } else {
                                unstaged.push(git_status);
                            }
                        }

                        // Get current branch info - simplified
                        let branch = Some("main".to_string()); // Placeholder

                        PlatformResult::success(GitStatus {
                            is_repository: true,
                            branch,
                            ahead: 0,
                            behind: 0,
                            staged,
                            unstaged,
                            untracked,
                        })
                    }
                    Err(e) => PlatformResult::error(format!("Failed to get git status: {}", e)),
                }
            }
            Err(e) => PlatformResult::error(e),
        }
    }

    /// Get file diff
    pub async fn get_file_diff(
        &self,
        file_path: &str,
        ctx: &PlatformContext,
    ) -> PlatformResult<String> {
        let path = self.get_effective_path(ctx);

        match self.validate_path(&path, ctx) {
            Ok(validated_path) => {
                let full_path = validated_path.join(file_path);

                match crate::git::git_get_raw_diff_text(
                    validated_path.to_string_lossy().to_string(),
                )
                .await
                {
                    Ok(diff) => PlatformResult::success(diff),
                    Err(e) => PlatformResult::error(format!("Failed to get diff: {}", e)),
                }
            }
            Err(e) => PlatformResult::error(e),
        }
    }

    /// Get all file diffs
    pub async fn get_all_diffs(
        &self,
        ctx: &PlatformContext,
    ) -> PlatformResult<Vec<(String, String)>> {
        let path = self.get_effective_path(ctx);

        match self.validate_path(&path, ctx) {
            Ok(validated_path) => {
                match crate::git::git_get_all_file_diffs(
                    validated_path.to_string_lossy().to_string(),
                )
                .await
                {
                    Ok(diffs) => {
                        // Convert FileDiff to a simple path/content representation
                        let result: Vec<(String, String)> = diffs
                            .into_iter()
                            .map(|d| (d.path, format!("{:?}", d.hunks)))
                            .collect();
                        PlatformResult::success(result)
                    }
                    Err(e) => PlatformResult::error(format!("Failed to get diffs: {}", e)),
                }
            }
            Err(e) => PlatformResult::error(e),
        }
    }

    /// Get line changes for a file
    pub async fn get_line_changes(
        &self,
        file_path: &str,
        ctx: &PlatformContext,
    ) -> PlatformResult<Vec<(u32, crate::git::types::DiffLineType)>> {
        let path = self.get_effective_path(ctx);

        match self.validate_path(&path, ctx) {
            Ok(validated_path) => {
                let full_path = validated_path.join(file_path);

                match crate::git::git_get_line_changes(
                    validated_path.to_string_lossy().to_string(),
                    full_path.to_string_lossy().to_string(),
                )
                .await
                {
                    Ok(changes) => PlatformResult::success(changes),
                    Err(e) => PlatformResult::error(format!("Failed to get line changes: {}", e)),
                }
            }
            Err(e) => PlatformResult::error(e),
        }
    }
}

impl Default for GitPlatform {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_git_platform_creation() {
        let git = GitPlatform::new();
        // Platform created successfully
    }
}
