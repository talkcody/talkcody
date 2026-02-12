// src-tauri/src/script_executor.rs

use crate::shell_utils::new_async_command;
use serde::{Deserialize, Serialize};
use std::process::Stdio;
use std::time::Duration;
use std::time::Instant;
use tokio::io::{AsyncReadExt, BufReader};

#[derive(Debug, Serialize, Deserialize)]
pub struct ScriptExecutionRequest {
    pub script_path: String,
    pub script_type: String, // "python", "bash", "nodejs"
    pub args: Vec<String>,
    pub working_dir: Option<String>,
    pub timeout_ms: Option<u64>,
    pub environment: Option<std::collections::HashMap<String, String>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ScriptExecutionResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub execution_time_ms: u64,
    pub success: bool,
    pub error: Option<String>,
}

pub struct ScriptExecutor;

impl ScriptExecutor {
    /// Execute a script with the specified parameters
    pub async fn execute(request: ScriptExecutionRequest) -> Result<ScriptExecutionResult, String> {
        let start_time = Instant::now();

        // Determine the command based on script type
        let mut cmd = match request.script_type.as_str() {
            "python" => {
                let mut c = new_async_command("python3");
                c.arg(&request.script_path);
                c
            }
            "bash" | "sh" => {
                let mut c = new_async_command("bash");
                c.arg(&request.script_path);
                c
            }
            "nodejs" | "javascript" => {
                let mut c = new_async_command("node");
                c.arg(&request.script_path);
                c
            }
            _ => {
                return Err(format!("Unsupported script type: {}", request.script_type));
            }
        };

        // Add arguments
        cmd.args(&request.args);

        // Set working directory
        if let Some(working_dir) = &request.working_dir {
            // Validate working directory exists
            if !std::path::Path::new(working_dir).is_dir() {
                return Ok(ScriptExecutionResult {
                    stdout: String::new(),
                    stderr: format!("Working directory does not exist: {}", working_dir),
                    exit_code: -1,
                    execution_time_ms: start_time.elapsed().as_millis() as u64,
                    success: false,
                    error: Some(format!("Invalid working directory: {}", working_dir)),
                });
            }
            cmd.current_dir(working_dir);
        }

        // Set environment variables
        if let Some(env) = &request.environment {
            cmd.envs(env);
        }

        // Configure stdio
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        // Execute with timeout if specified
        let timeout_duration = request.timeout_ms.map(|ms| Duration::from_millis(ms));

        let execution_result = if let Some(timeout) = timeout_duration {
            // Execute with timeout
            match tokio::time::timeout(timeout, Self::run_command(cmd)).await {
                Ok(result) => result,
                Err(_) => {
                    // Timeout occurred
                    return Ok(ScriptExecutionResult {
                        stdout: String::new(),
                        stderr: format!("Script execution timeout after {}ms", timeout.as_millis()),
                        exit_code: -1,
                        execution_time_ms: start_time.elapsed().as_millis() as u64,
                        success: false,
                        error: Some(format!(
                            "Script execution timeout ({}ms)",
                            timeout.as_millis()
                        )),
                    });
                }
            }
        } else {
            // Execute without timeout
            Self::run_command(cmd).await
        };

        let execution_time = start_time.elapsed().as_millis() as u64;

        match execution_result {
            Ok((stdout, stderr, exit_status)) => {
                let success = exit_status.success();
                let exit_code = exit_status.code().unwrap_or(-1);

                Ok(ScriptExecutionResult {
                    stdout,
                    stderr,
                    exit_code,
                    execution_time_ms: execution_time,
                    success,
                    error: if !success {
                        Some(format!("Script exited with code {}", exit_code))
                    } else {
                        None
                    },
                })
            }
            Err(e) => Ok(ScriptExecutionResult {
                stdout: String::new(),
                stderr: format!("Failed to execute script: {}", e),
                exit_code: -1,
                execution_time_ms: execution_time,
                success: false,
                error: Some(format!("Execution error: {}", e)),
            }),
        }
    }

    /// Helper function to run a command and capture output
    async fn run_command(
        mut cmd: tokio::process::Command,
    ) -> Result<(String, String, std::process::ExitStatus), String> {
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn process: {}", e))?;

        // Take stdout and stderr
        let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
        let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;

        // Read outputs concurrently
        let stdout_handle = tokio::spawn(async move {
            let mut reader = BufReader::new(stdout);
            let mut buffer = Vec::new();
            reader.read_to_end(&mut buffer).await.ok();
            String::from_utf8_lossy(&buffer).to_string()
        });

        let stderr_handle = tokio::spawn(async move {
            let mut reader = BufReader::new(stderr);
            let mut buffer = Vec::new();
            reader.read_to_end(&mut buffer).await.ok();
            String::from_utf8_lossy(&buffer).to_string()
        });

        // Wait for process to complete
        let exit_status = child
            .wait()
            .await
            .map_err(|e| format!("Failed to wait for process: {}", e))?;

        // Get outputs
        let stdout = stdout_handle
            .await
            .map_err(|e| format!("Failed to read stdout: {}", e))?;
        let stderr = stderr_handle
            .await
            .map_err(|e| format!("Failed to read stderr: {}", e))?;

        Ok((stdout, stderr, exit_status))
    }

    /// Validate that required executables are available
    #[allow(dead_code)]
    pub async fn validate_runtime(script_type: &str) -> Result<(), String> {
        let command = match script_type {
            "python" => "python3",
            "bash" | "sh" => "bash",
            "nodejs" | "javascript" => "node",
            _ => return Err(format!("Unknown script type: {}", script_type)),
        };

        match new_async_command("which").arg(command).output().await {
            Ok(output) => {
                if output.status.success() {
                    Ok(())
                } else {
                    Err(format!("{} is not installed or not in PATH", command))
                }
            }
            Err(e) => Err(format!("Failed to check for {}: {}", command, e)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_validate_runtime_bash() {
        // Bash should be available on all Unix systems
        assert!(ScriptExecutor::validate_runtime("bash").await.is_ok());
    }

    #[tokio::test]
    async fn test_invalid_script_type() {
        let request = ScriptExecutionRequest {
            script_path: "test.unknown".to_string(),
            script_type: "unknown".to_string(),
            args: vec![],
            working_dir: None,
            timeout_ms: None,
            environment: None,
        };

        let result = ScriptExecutor::execute(request).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    #[cfg(not(target_os = "windows"))]
    async fn test_timeout_enforcement() {
        use std::io::Write;
        use tempfile::NamedTempFile;

        // Create a script that sleeps for 5 seconds
        let mut script_file = NamedTempFile::new().unwrap();
        writeln!(script_file, "#!/bin/bash").unwrap();
        writeln!(script_file, "sleep 5").unwrap();
        script_file.flush().unwrap();

        let request = ScriptExecutionRequest {
            script_path: script_file.path().to_string_lossy().to_string(),
            script_type: "bash".to_string(),
            args: vec![],
            working_dir: None,
            timeout_ms: Some(1000), // 1 second timeout
            environment: None,
        };

        let result = ScriptExecutor::execute(request).await;
        assert!(result.is_ok());

        let exec_result = result.unwrap();
        assert!(!exec_result.success);
        assert!(exec_result.error.is_some());
        assert!(exec_result.error.unwrap().contains("timeout"));
    }

    #[tokio::test]
    #[cfg(not(target_os = "windows"))]
    async fn test_successful_execution() {
        use std::io::Write;
        use tempfile::NamedTempFile;

        // Create a simple script that echoes hello
        let mut script_file = NamedTempFile::new().unwrap();
        writeln!(script_file, "#!/bin/bash").unwrap();
        writeln!(script_file, "echo 'Hello, World!'").unwrap();
        script_file.flush().unwrap();

        let request = ScriptExecutionRequest {
            script_path: script_file.path().to_string_lossy().to_string(),
            script_type: "bash".to_string(),
            args: vec![],
            working_dir: None,
            timeout_ms: Some(5000),
            environment: None,
        };

        let result = ScriptExecutor::execute(request).await;
        assert!(result.is_ok());

        let exec_result = result.unwrap();
        assert!(exec_result.success);
        assert!(exec_result.stdout.contains("Hello, World!"));
        assert_eq!(exec_result.exit_code, 0);
    }

    #[tokio::test]
    async fn test_invalid_working_directory() {
        use std::io::Write;
        use tempfile::NamedTempFile;

        let mut script_file = NamedTempFile::new().unwrap();
        writeln!(script_file, "#!/bin/bash").unwrap();
        writeln!(script_file, "echo 'test'").unwrap();
        script_file.flush().unwrap();

        let request = ScriptExecutionRequest {
            script_path: script_file.path().to_string_lossy().to_string(),
            script_type: "bash".to_string(),
            args: vec![],
            working_dir: Some("/this/path/does/not/exist".to_string()),
            timeout_ms: None,
            environment: None,
        };

        let result = ScriptExecutor::execute(request).await;
        assert!(result.is_ok());

        let exec_result = result.unwrap();
        assert!(!exec_result.success);
        assert!(exec_result.error.is_some());
        assert!(exec_result.error.unwrap().contains("working directory"));
    }
}
