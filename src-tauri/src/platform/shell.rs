//! Shell Platform Abstraction
//!
//! Provides shell command execution with workspace validation and timeouts.
//! Wraps existing shell utilities from the codebase.

use crate::platform::types::*;
use std::path::Path;

/// Shell operations provider
#[derive(Clone)]
pub struct ShellPlatform;

impl ShellPlatform {
    pub fn new() -> Self {
        Self
    }

    /// Validate that working directory is within workspace
    fn validate_cwd(&self, cwd: &str, ctx: &PlatformContext) -> Result<String, String> {
        let path = Path::new(cwd);
        let canonical_path = path
            .canonicalize()
            .map_err(|e| format!("Invalid working directory: {}", e))?;

        let canonical_root = ctx
            .workspace_root
            .canonicalize()
            .map_err(|e| format!("Invalid workspace root: {}", e))?;

        if !canonical_path.starts_with(&canonical_root) {
            return Err(format!(
                "Working directory '{}' is outside workspace root '{}'",
                canonical_path.display(),
                canonical_root.display()
            ));
        }

        Ok(canonical_path.to_string_lossy().to_string())
    }

    /// Execute a shell command
    pub async fn execute(
        &self,
        command: &str,
        cwd: Option<&str>,
        ctx: &PlatformContext,
    ) -> PlatformResult<ShellResult> {
        // Validate working directory
        let working_dir = match cwd {
            Some(dir) => match self.validate_cwd(dir, ctx) {
                Ok(validated) => Some(validated),
                Err(e) => return PlatformResult::error(e),
            },
            None => Some(ctx.workspace_root.to_string_lossy().to_string()),
        };

        // Check for dangerous commands
        if self.is_dangerous_command(command) {
            return PlatformResult::error(
                "Command contains potentially dangerous operations".to_string(),
            );
        }

        // Execute the command using tokio::process
        use crate::shell_utils::new_async_command;
        use tokio::time::{timeout, Duration};

        let mut cmd = if cfg!(target_os = "windows") {
            let mut c = new_async_command("cmd");
            c.arg("/C").arg(command);
            c
        } else {
            let mut c = new_async_command("sh");
            c.arg("-c").arg(command);
            c
        };

        if let Some(dir) = working_dir {
            cmd.current_dir(dir);
        }

        let timeout_duration = Duration::from_secs(ctx.shell_timeout_secs);

        match timeout(timeout_duration, cmd.output()).await {
            Ok(Ok(output)) => PlatformResult::success(ShellResult {
                stdout: String::from_utf8_lossy(&output.stdout).to_string(),
                stderr: String::from_utf8_lossy(&output.stderr).to_string(),
                exit_code: output.status.code().unwrap_or(-1),
                timed_out: false,
            }),
            Ok(Err(e)) => PlatformResult::error(format!("Failed to execute command: {}", e)),
            Err(_) => PlatformResult::success(ShellResult {
                stdout: String::new(),
                stderr: "Command timed out".to_string(),
                exit_code: -1,
                timed_out: true,
            }),
        }
    }

    /// Execute a script file
    pub async fn execute_script(
        &self,
        script_path: &str,
        args: Vec<String>,
        cwd: Option<&str>,
        ctx: &PlatformContext,
    ) -> PlatformResult<ShellResult> {
        // Validate script path
        let path = Path::new(script_path);
        let canonical_path = match path.canonicalize() {
            Ok(p) => p,
            Err(e) => return PlatformResult::error(format!("Invalid script path: {}", e)),
        };

        let _ = match self.validate_cwd(
            canonical_path
                .parent()
                .map(|p| p.to_string_lossy().to_string())
                .as_deref()
                .unwrap_or("/"),
            ctx,
        ) {
            Ok(p) => p,
            Err(e) => return PlatformResult::error(e),
        };

        // Build command
        let command = format!("{} {}", script_path, args.join(" "));
        self.execute(&command, cwd, ctx).await
    }

    /// Check if a command contains dangerous operations
    fn is_dangerous_command(&self, command: &str) -> bool {
        let dangerous_patterns = [
            "rm -rf /",
            "> /dev/sda",
            "dd if=/dev/zero",
            "mkfs.",
            "format ",
            "del /f /s /q \\\\",
            "rmdir /s /q \\\\",
        ];

        let lower_cmd = command.to_lowercase();
        dangerous_patterns
            .iter()
            .any(|pattern| lower_cmd.contains(pattern))
    }

    /// Get environment variables (filtered)
    pub fn get_env_vars(&self) -> PlatformResult<Vec<(String, String)>> {
        let vars: Vec<(String, String)> = std::env::vars()
            .filter(|(k, _)| !k.starts_with("SECRET") && !k.contains("KEY"))
            .collect();

        PlatformResult::success(vars)
    }

    /// Set environment variable (only for current process)
    pub fn set_env_var(&self, key: &str, value: &str) -> PlatformResult<()> {
        std::env::set_var(key, value);
        PlatformResult::success(())
    }
}

impl Default for ShellPlatform {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[tokio::test]
    async fn test_shell_execution() {
        let shell = ShellPlatform::new();
        let temp_dir = TempDir::new().unwrap();

        let ctx = PlatformContext {
            workspace_root: temp_dir.path().to_path_buf(),
            worktree_path: None,
            max_file_size: 1024 * 1024,
            shell_timeout_secs: 60,
        };

        let result = shell.execute("echo hello", None, &ctx).await;
        assert!(result.success);

        let shell_result = result.data.unwrap();
        assert_eq!(shell_result.exit_code, 0);
    }

    #[tokio::test]
    async fn test_dangerous_command_detection() {
        let shell = ShellPlatform::new();
        let temp_dir = TempDir::new().unwrap();

        let ctx = PlatformContext {
            workspace_root: temp_dir.path().to_path_buf(),
            worktree_path: None,
            max_file_size: 1024 * 1024,
            shell_timeout_secs: 60,
        };

        let result = shell.execute("rm -rf /", None, &ctx).await;
        assert!(!result.success);
        assert!(result.error.unwrap().contains("dangerous"));
    }

    #[test]
    fn test_env_vars() {
        let shell = ShellPlatform::new();
        let result = shell.get_env_vars();
        assert!(result.success);
        assert!(!result.data.unwrap().is_empty());
    }
}
