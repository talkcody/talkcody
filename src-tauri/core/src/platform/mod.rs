//! Platform Abstraction Layer
//!
//! Provides unified interfaces for filesystem, git, shell, and LSP operations.
//! All operations are validated to stay within the workspace root.

pub mod fs;
pub mod git;
pub mod lsp;
pub mod shell;
pub mod types;

pub use fs::FileSystemPlatform;
pub use git::GitPlatform;
pub use lsp::LspPlatform;
pub use shell::ShellPlatform;
pub use types::*;

/// Main platform manager that owns all platform providers
#[derive(Clone)]
pub struct Platform {
    pub filesystem: FileSystemPlatform,
    pub git: GitPlatform,
    pub shell: ShellPlatform,
    pub lsp: LspPlatform,
}

impl Platform {
    pub fn new() -> Self {
        Self {
            filesystem: FileSystemPlatform::new(),
            git: GitPlatform::new(),
            shell: ShellPlatform::new(),
            lsp: LspPlatform::new(),
        }
    }

    /// Create a context for operations
    pub fn create_context(
        &self,
        workspace_root: impl Into<std::path::PathBuf>,
        worktree_path: Option<impl Into<std::path::PathBuf>>,
    ) -> PlatformContext {
        PlatformContext {
            workspace_root: workspace_root.into(),
            worktree_path: worktree_path.map(|p| p.into()),
            max_file_size: 10 * 1024 * 1024, // 10MB default
            shell_timeout_secs: 120,
        }
    }

    /// Execute a tool by name with input parameters
    pub async fn execute_tool(
        &self,
        tool_name: &str,
        input: &serde_json::Value,
        ctx: &PlatformContext,
    ) -> Result<serde_json::Value, String> {
        match tool_name {
            "read_file" => {
                let path = input
                    .get("path")
                    .and_then(|v| v.as_str())
                    .ok_or("Missing 'path' parameter")?;
                let result = self.filesystem.read_file(path, ctx).await;
                Ok(serde_json::json!({
                    "success": result.success,
                    "content": result.data,
                    "error": result.error
                }))
            }
            "write_file" => {
                let path = input
                    .get("path")
                    .and_then(|v| v.as_str())
                    .ok_or("Missing 'path' parameter")?;
                let content = input
                    .get("content")
                    .and_then(|v| v.as_str())
                    .ok_or("Missing 'content' parameter")?;
                let result = self.filesystem.write_file(path, content, ctx).await;
                Ok(serde_json::json!({
                    "success": result.success,
                    "error": result.error
                }))
            }
            "list_directory" => {
                let path = input.get("path").and_then(|v| v.as_str()).unwrap_or(".");
                let result = self.filesystem.list_directory(path, ctx).await;
                Ok(serde_json::json!({
                    "success": result.success,
                    "entries": result.data,
                    "error": result.error
                }))
            }
            "search_files" => {
                let pattern = input
                    .get("pattern")
                    .and_then(|v| v.as_str())
                    .ok_or("Missing 'pattern' parameter")?;
                let path = input
                    .get("path")
                    .and_then(|v| v.as_str())
                    .map(|p| p.to_string())
                    .unwrap_or_else(|| ctx.workspace_root.to_string_lossy().to_string());

                // Use existing search module
                match crate::search::RipgrepSearch::new()
                    .with_max_results(50)
                    .search_content(pattern, &path)
                {
                    Ok(results) => {
                        let search_results: Vec<serde_json::Value> = results
                            .into_iter()
                            .flat_map(|r| {
                                r.matches.into_iter().map(move |m| {
                                    serde_json::json!({
                                        "path": r.file_path.clone(),
                                        "line": m.line_number,
                                        "text": m.line_content,
                                    })
                                })
                            })
                            .collect();
                        Ok(serde_json::json!({
                            "success": true,
                            "results": search_results
                        }))
                    }
                    Err(e) => Ok(serde_json::json!({
                        "success": false,
                        "error": e.to_string()
                    })),
                }
            }
            "execute_shell" => {
                let command = input
                    .get("command")
                    .and_then(|v| v.as_str())
                    .ok_or("Missing 'command' parameter")?;
                let cwd = input.get("cwd").and_then(|v| v.as_str());
                let result = self.shell.execute(command, cwd, ctx).await;
                Ok(serde_json::json!({
                    "success": result.success,
                    "stdout": result.data.as_ref().map(|r| &r.stdout),
                    "stderr": result.data.as_ref().map(|r| &r.stderr),
                    "exit_code": result.data.as_ref().map(|r| r.exit_code),
                    "error": result.error
                }))
            }
            "git_status" => {
                let result = self.git.get_status(ctx).await;
                Ok(serde_json::json!({
                    "success": result.success,
                    "status": result.data,
                    "error": result.error
                }))
            }
            "git_diff" => {
                let file_path = input.get("path").and_then(|v| v.as_str());
                let result = if let Some(path) = file_path {
                    self.git.get_file_diff(path, ctx).await
                } else {
                    // Get all diffs and combine them
                    let all_diffs = self.git.get_all_diffs(ctx).await;
                    PlatformResult {
                        success: all_diffs.success,
                        data: all_diffs.data.map(|diffs| {
                            diffs
                                .into_iter()
                                .map(|(path, diff)| format!("--- {}\n{}", path, diff))
                                .collect::<Vec<_>>()
                                .join("\n")
                        }),
                        error: all_diffs.error,
                    }
                };
                Ok(serde_json::json!({
                    "success": result.success,
                    "diff": result.data,
                    "error": result.error
                }))
            }
            _ => Err(format!("Unknown tool: {}", tool_name)),
        }
    }
}

impl Default for Platform {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_platform_creation() {
        let _platform = Platform::new();
        // Platform created successfully
    }

    #[test]
    fn test_create_context() {
        let platform = Platform::new();
        let temp_dir = std::env::temp_dir();
        let ctx = platform.create_context(&temp_dir, None::<&std::path::Path>);

        assert_eq!(ctx.workspace_root, temp_dir);
        assert!(ctx.worktree_path.is_none());
    }
}
