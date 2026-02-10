//! Core data models for storage layer
//! These models are shared across the core runtime, server API, and storage repositories

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Unique identifier types
pub type SessionId = String;
pub type MessageId = String;
pub type EventId = String;
pub type AgentId = String;
pub type TaskId = String;
pub type AttachmentId = String;
pub type ToolCallId = String;

/// Session status in lifecycle
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SessionStatus {
    /// Session created, waiting for first message
    Created,
    /// Agent is processing/producing response
    Running,
    /// Waiting for user action (approval, tool response)
    WaitingForAction,
    /// Session completed successfully
    Completed,
    /// Session ended with error
    Error,
    /// Session was cancelled by user
    Cancelled,
}

impl SessionStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            SessionStatus::Created => "created",
            SessionStatus::Running => "running",
            SessionStatus::WaitingForAction => "waiting_for_action",
            SessionStatus::Completed => "completed",
            SessionStatus::Error => "error",
            SessionStatus::Cancelled => "cancelled",
        }
    }
}

impl std::str::FromStr for SessionStatus {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "created" => Ok(SessionStatus::Created),
            "running" => Ok(SessionStatus::Running),
            "waiting_for_action" => Ok(SessionStatus::WaitingForAction),
            "completed" => Ok(SessionStatus::Completed),
            "error" => Ok(SessionStatus::Error),
            "cancelled" => Ok(SessionStatus::Cancelled),
            _ => Err(format!("Unknown session status: {}", s)),
        }
    }
}

/// A chat session containing messages and metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: SessionId,
    pub project_id: Option<String>,
    pub title: Option<String>,
    pub status: SessionStatus,
    pub created_at: i64,
    pub updated_at: i64,
    /// Last event ID for SSE resume
    pub last_event_id: Option<EventId>,
    /// Additional metadata as JSON object
    pub metadata: Option<serde_json::Value>,
}

/// Role of a message sender
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MessageRole {
    User,
    Assistant,
    System,
    Tool,
}

impl MessageRole {
    pub fn as_str(&self) -> &'static str {
        match self {
            MessageRole::User => "user",
            MessageRole::Assistant => "assistant",
            MessageRole::System => "system",
            MessageRole::Tool => "tool",
        }
    }
}

impl std::str::FromStr for MessageRole {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "user" => Ok(MessageRole::User),
            "assistant" => Ok(MessageRole::Assistant),
            "system" => Ok(MessageRole::System),
            "tool" => Ok(MessageRole::Tool),
            _ => Err(format!("Unknown message role: {}", s)),
        }
    }
}

/// A message in a session
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: MessageId,
    pub session_id: SessionId,
    pub role: MessageRole,
    pub content: MessageContent,
    pub created_at: i64,
    /// ID of tool call this message responds to (for tool role)
    pub tool_call_id: Option<ToolCallId>,
    /// Parent message ID for threading
    pub parent_id: Option<MessageId>,
}

/// Content of a message - can be text or structured content
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum MessageContent {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "tool_calls")]
    ToolCalls { calls: Vec<ToolCall> },
    #[serde(rename = "tool_result")]
    ToolResult { result: StoredToolResult },
}

/// Stored format for tool call
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredToolCall {
    #[serde(rename = "toolCallId")]
    pub tool_call_id: String,
    #[serde(rename = "toolName")]
    pub tool_name: String,
    pub input: Option<serde_json::Value>,
}

/// Stored format for tool result - matches TS StoredToolResult
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredToolResult {
    #[serde(rename = "toolCallId")]
    pub tool_call_id: String,
    #[serde(rename = "toolName")]
    pub tool_name: String,
    pub input: Option<serde_json::Value>,
    pub output: Option<serde_json::Value>,
    pub status: ToolResultStatus,
    #[serde(rename = "errorMessage")]
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ToolResultStatus {
    Success,
    Error,
}

/// A tool call from the assistant
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCall {
    pub id: ToolCallId,
    pub name: String,
    pub input: serde_json::Value,
}

/// Event types for streaming
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EventType {
    /// Status update
    Status,
    /// Token/chunk from LLM stream
    Token,
    /// Final message content
    MessageFinal,
    /// Tool call requested
    ToolCall,
    /// Tool execution result
    ToolResult,
    /// Error occurred
    Error,
}

impl EventType {
    pub fn as_str(&self) -> &'static str {
        match self {
            EventType::Status => "status",
            EventType::Token => "token",
            EventType::MessageFinal => "message.final",
            EventType::ToolCall => "tool.call",
            EventType::ToolResult => "tool.result",
            EventType::Error => "error",
        }
    }
}

impl std::str::FromStr for EventType {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "status" => Ok(EventType::Status),
            "token" => Ok(EventType::Token),
            "message.final" => Ok(EventType::MessageFinal),
            "tool.call" => Ok(EventType::ToolCall),
            "tool.result" => Ok(EventType::ToolResult),
            "error" => Ok(EventType::Error),
            _ => Err(format!("Unknown event type: {}", s)),
        }
    }
}

/// A persisted event for streaming and resume
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionEvent {
    pub id: EventId,
    pub session_id: SessionId,
    pub event_type: EventType,
    pub payload: serde_json::Value,
    pub created_at: i64,
}

/// An AI agent configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Agent {
    pub id: AgentId,
    pub name: String,
    pub model: String,
    pub system_prompt: Option<String>,
    /// List of enabled tool names
    pub tools: Vec<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Association between agent and session with settings
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSession {
    pub agent_id: AgentId,
    pub session_id: SessionId,
    pub settings: TaskSettings,
    pub created_at: i64,
}

/// Task/Session settings
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskSettings {
    /// Auto-approve file edits
    pub auto_approve_edits: Option<bool>,
    /// Auto-approve plan steps
    pub auto_approve_plan: Option<bool>,
    /// Enable auto code review
    pub auto_code_review: Option<bool>,
    /// Additional custom settings
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

/// Attachment/file upload metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub id: AttachmentId,
    pub session_id: SessionId,
    pub message_id: Option<MessageId>,
    pub filename: String,
    pub mime_type: String,
    pub size: i64,
    /// Path to stored file on backend filesystem
    pub path: String,
    pub created_at: i64,
    /// Origin/source of attachment (user upload, tool output, etc.)
    pub origin: AttachmentOrigin,
}

/// Origin of an attachment
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AttachmentOrigin {
    UserUpload,
    ToolOutput,
    Generated,
}

impl AttachmentOrigin {
    pub fn as_str(&self) -> &'static str {
        match self {
            AttachmentOrigin::UserUpload => "user_upload",
            AttachmentOrigin::ToolOutput => "tool_output",
            AttachmentOrigin::Generated => "generated",
        }
    }
}

impl std::str::FromStr for AttachmentOrigin {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "user_upload" => Ok(AttachmentOrigin::UserUpload),
            "tool_output" => Ok(AttachmentOrigin::ToolOutput),
            "generated" => Ok(AttachmentOrigin::Generated),
            _ => Err(format!("Unknown attachment origin: {}", s)),
        }
    }
}

/// User action types for session control
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum UserAction {
    Approve,
    Reject,
    Cancel,
}

/// Workspace information for a session
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceInfo {
    pub root_path: String,
    pub worktree_path: Option<String>,
    pub repository_url: Option<String>,
    pub branch: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_session_status_serialization() {
        let status = SessionStatus::Running;
        let json = serde_json::to_string(&status).unwrap();
        assert_eq!(json, "\"running\"");

        let parsed: SessionStatus = serde_json::from_str("\"running\"").unwrap();
        assert_eq!(parsed, SessionStatus::Running);
    }

    #[test]
    fn test_message_content_serialization() {
        let content = MessageContent::Text {
            text: "Hello".to_string(),
        };
        let json = serde_json::to_string(&content).unwrap();
        assert!(json.contains("\"type\":\"text\""));
        assert!(json.contains("\"text\":\"Hello\""));
    }

    #[test]
    fn test_task_settings_with_extra() {
        let mut settings = TaskSettings::default();
        settings.auto_approve_edits = Some(true);
        settings
            .extra
            .insert("custom_key".to_string(), serde_json::json!("custom_value"));

        let json = serde_json::to_string(&settings).unwrap();
        assert!(json.contains("\"autoApproveEdits\":true"));
        assert!(json.contains("\"custom_key\""));
    }
}
