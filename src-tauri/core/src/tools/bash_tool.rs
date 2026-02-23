//! Bash Tool
//!
//! Execute shell commands safely on the system.
//! Matches TypeScript bash-tool.tsx logic.

use crate::core::tools::ToolContext;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BashResult {
    pub success: bool,
    pub message: String,
    pub command: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_file_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_file_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timed_out: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub idle_timed_out: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_background: Option<bool>,
}

/// Check if command contains dangerous patterns
fn is_dangerous_command(command: &str) -> bool {
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

/// Execute bash tool
pub async fn execute(command: &str, run_in_background: bool, ctx: &ToolContext) -> BashResult {
    // Check for dangerous commands
    if is_dangerous_command(command) {
        return BashResult {
            success: false,
            message: "Command contains potentially dangerous operations".to_string(),
            command: command.to_string(),
            output: None,
            error: Some("Dangerous command detected".to_string()),
            output_file_path: None,
            error_file_path: None,
            exit_code: None,
            timed_out: None,
            idle_timed_out: None,
            pid: None,
            task_id: None,
            is_background: Some(false),
        };
    }

    if run_in_background {
        // Spawn background task
        let request = crate::background_tasks::SpawnBackgroundTaskRequest {
            command: command.to_string(),
            cwd: Some(ctx.workspace_root.clone()),
            max_timeout_ms: Some(7_200_000), // 2 hours default
        };

        match crate::background_tasks::spawn_background_task(request).await {
            Ok(response) => BashResult {
                success: true,
                message: format!(
                    "Command running in background. Task ID: {}",
                    response.task_id
                ),
                command: command.to_string(),
                output: None,
                error: None,
                output_file_path: Some(response.output_file),
                error_file_path: Some(response.error_file),
                exit_code: None,
                timed_out: None,
                idle_timed_out: None,
                pid: Some(response.pid),
                task_id: Some(response.task_id),
                is_background: Some(true),
            },
            Err(e) => BashResult {
                success: false,
                message: format!("Failed to start background task: {}", e),
                command: command.to_string(),
                output: None,
                error: Some(e),
                output_file_path: None,
                error_file_path: None,
                exit_code: None,
                timed_out: None,
                idle_timed_out: None,
                pid: None,
                task_id: None,
                is_background: Some(false),
            },
        }
    } else {
        // Execute synchronously using platform shell
        let platform = crate::platform::Platform::new();
        let platform_ctx =
            platform.create_context(&ctx.workspace_root, ctx.worktree_path.as_deref());

        let result = platform.shell.execute(command, None, &platform_ctx).await;

        match result.data {
            Some(shell_result) => BashResult {
                success: result.success && shell_result.exit_code == 0,
                message: if result.success {
                    "Command executed successfully".to_string()
                } else {
                    format!("Command failed with exit code: {}", shell_result.exit_code)
                },
                command: command.to_string(),
                output: Some(shell_result.stdout),
                error: if shell_result.stderr.is_empty() {
                    None
                } else {
                    Some(shell_result.stderr)
                },
                output_file_path: None,
                error_file_path: None,
                exit_code: Some(shell_result.exit_code),
                timed_out: Some(shell_result.timed_out),
                idle_timed_out: None,
                pid: None,
                task_id: None,
                is_background: Some(false),
            },
            None => BashResult {
                success: false,
                message: result
                    .error
                    .clone()
                    .unwrap_or_else(|| "Unknown error".to_string()),
                command: command.to_string(),
                output: None,
                error: result.error,
                output_file_path: None,
                error_file_path: None,
                exit_code: None,
                timed_out: None,
                idle_timed_out: None,
                pid: None,
                task_id: None,
                is_background: Some(false),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_echo_command() {
        let ctx = ToolContext {
            session_id: "test".to_string(),
            task_id: "test".to_string(),
            workspace_root: std::env::current_dir()
                .unwrap()
                .to_string_lossy()
                .to_string(),
            worktree_path: None,
            settings: crate::storage::models::TaskSettings::default(),
            llm_state: None,
        };

        let result = execute("echo Hello", false, &ctx).await;

        assert!(result.success);
        assert!(result.output.unwrap().contains("Hello"));
    }

    #[tokio::test]
    async fn test_dangerous_command_blocked() {
        let ctx = ToolContext {
            session_id: "test".to_string(),
            task_id: "test".to_string(),
            workspace_root: std::env::current_dir()
                .unwrap()
                .to_string_lossy()
                .to_string(),
            worktree_path: None,
            settings: crate::storage::models::TaskSettings::default(),
            llm_state: None,
        };

        let result = execute("rm -rf /", false, &ctx).await;

        assert!(!result.success);
        assert!(result.message.contains("dangerous"));
    }
}
