//! Core Runtime Types
//! Types used by the core runtime for task/session lifecycle and agent loop

use crate::storage::models::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, RwLock};

/// Unique identifier for a runtime task
pub type RuntimeTaskId = String;

/// State of a runtime task
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RuntimeTaskState {
    /// Task is created but not started
    Pending,
    /// Task is actively running
    Running,
    /// Task is waiting for user input/approval
    WaitingForUser,
    /// Task completed successfully
    Completed,
    /// Task failed with an error
    Failed,
    /// Task was cancelled
    Cancelled,
}

impl RuntimeTaskState {
    pub fn is_active(&self) -> bool {
        matches!(
            self,
            RuntimeTaskState::Pending
                | RuntimeTaskState::Running
                | RuntimeTaskState::WaitingForUser
        )
    }

    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            RuntimeTaskState::Completed | RuntimeTaskState::Failed | RuntimeTaskState::Cancelled
        )
    }
}

/// A runtime task representing an agent execution
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeTask {
    pub id: RuntimeTaskId,
    pub session_id: SessionId,
    pub agent_id: Option<AgentId>,
    pub state: RuntimeTaskState,
    pub created_at: i64,
    pub started_at: Option<i64>,
    pub completed_at: Option<i64>,
    pub error_message: Option<String>,
    pub metadata: HashMap<String, serde_json::Value>,
}

/// Input to start a new task
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskInput {
    pub session_id: SessionId,
    pub agent_id: Option<AgentId>,
    pub project_id: Option<String>,
    pub initial_message: String,
    pub settings: Option<TaskSettings>,
    pub workspace: Option<WorkspaceInfo>,
}

/// User action on a waiting task
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TaskAction {
    /// Approve a pending action
    Approve { tool_call_id: ToolCallId },
    /// Reject a pending action
    Reject {
        tool_call_id: ToolCallId,
        reason: Option<String>,
    },
    /// Provide tool result
    ToolResult {
        tool_call_id: ToolCallId,
        result: serde_json::Value,
    },
    /// Cancel the task
    Cancel,
}

/// Request for tool execution
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolRequest {
    pub tool_call_id: ToolCallId,
    pub name: String,
    pub input: serde_json::Value,
    pub provider_metadata: Option<serde_json::Value>,
}

/// Result of tool execution
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolResult {
    pub tool_call_id: ToolCallId,
    pub name: Option<String>,
    pub success: bool,
    pub output: serde_json::Value,
    pub error: Option<String>,
}

/// Tool definition for the tool registry
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value, // JSON Schema
    pub requires_approval: bool,
}

/// Configuration for the agent loop
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentLoopConfig {
    /// Maximum number of iterations in the agent loop
    pub max_iterations: u32,
    /// Maximum tokens per response
    pub max_tokens: Option<u32>,
    /// Temperature for LLM sampling
    pub temperature: f32,
    /// Whether to enable tool use
    pub enable_tools: bool,
    /// Tools available to the agent
    pub available_tools: Vec<String>,
}

impl Default for AgentLoopConfig {
    fn default() -> Self {
        Self {
            max_iterations: 50,
            max_tokens: None,
            temperature: 0.7,
            enable_tools: true,
            available_tools: vec![],
        }
    }
}

/// Event produced by the runtime for streaming
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum RuntimeEvent {
    /// Task state changed
    TaskStateChanged {
        task_id: RuntimeTaskId,
        state: RuntimeTaskState,
        previous_state: RuntimeTaskState,
    },
    /// New message in session
    MessageCreated {
        session_id: SessionId,
        message: Message,
    },
    /// Token from LLM stream
    Token {
        session_id: SessionId,
        token: String,
    },
    /// Reasoning start from LLM (e.g., Claude's thinking)
    ReasoningStart { session_id: SessionId, id: String },
    /// Reasoning delta (thinking content)
    ReasoningDelta {
        session_id: SessionId,
        id: String,
        text: String,
    },
    /// Reasoning end
    ReasoningEnd { session_id: SessionId, id: String },
    /// Tool execution requested
    ToolCallRequested {
        task_id: RuntimeTaskId,
        request: ToolRequest,
    },
    /// Tool execution completed
    ToolCallCompleted {
        task_id: RuntimeTaskId,
        result: ToolResult,
    },
    /// Error occurred
    Error {
        task_id: Option<RuntimeTaskId>,
        session_id: Option<SessionId>,
        message: String,
    },
    /// Task completed
    TaskCompleted {
        task_id: RuntimeTaskId,
        session_id: SessionId,
    },
}

/// Channel sender for runtime events
pub type EventSender = mpsc::UnboundedSender<RuntimeEvent>;

/// Channel receiver for runtime events
pub type EventReceiver = mpsc::UnboundedReceiver<RuntimeEvent>;

/// Handle to a running task for external control
#[derive(Debug, Clone)]
pub struct TaskHandle {
    pub task_id: RuntimeTaskId,
    pub session_id: SessionId,
    pub state: Arc<RwLock<RuntimeTaskState>>,
    pub action_sender: Arc<mpsc::UnboundedSender<TaskAction>>,
}

impl TaskHandle {
    /// Send an action to the task
    pub fn send_action(&self, action: TaskAction) -> Result<(), String> {
        self.action_sender
            .send(action)
            .map_err(|_| "Task channel closed".to_string())
    }

    /// Cancel the task
    pub fn cancel(&self) -> Result<(), String> {
        self.send_action(TaskAction::Cancel)
    }
}

/// Result of task execution
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskExecutionResult {
    pub task_id: RuntimeTaskId,
    pub success: bool,
    pub message_count: usize,
    pub error: Option<String>,
}

/// Validation result for settings
#[derive(Debug, Clone)]
pub struct SettingsValidation {
    pub valid: bool,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
}

impl SettingsValidation {
    pub fn valid() -> Self {
        Self {
            valid: true,
            errors: vec![],
            warnings: vec![],
        }
    }

    pub fn with_error(error: String) -> Self {
        Self {
            valid: false,
            errors: vec![error],
            warnings: vec![],
        }
    }

    pub fn with_warning(warning: String) -> Self {
        Self {
            valid: true,
            errors: vec![],
            warnings: vec![warning],
        }
    }

    pub fn add_error(&mut self, error: String) {
        self.valid = false;
        self.errors.push(error);
    }

    pub fn add_warning(&mut self, warning: String) {
        self.warnings.push(warning);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_runtime_task_state() {
        assert!(RuntimeTaskState::Running.is_active());
        assert!(RuntimeTaskState::WaitingForUser.is_active());
        assert!(!RuntimeTaskState::Completed.is_active());

        assert!(RuntimeTaskState::Completed.is_terminal());
        assert!(RuntimeTaskState::Failed.is_terminal());
        assert!(!RuntimeTaskState::Running.is_terminal());
    }

    #[test]
    fn test_settings_validation() {
        let mut validation = SettingsValidation::valid();
        assert!(validation.valid);

        validation.add_warning("Some warning".to_string());
        assert!(validation.valid);
        assert_eq!(validation.warnings.len(), 1);

        validation.add_error("Some error".to_string());
        assert!(!validation.valid);
        assert_eq!(validation.errors.len(), 1);
    }
}
