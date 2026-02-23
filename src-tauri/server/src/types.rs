//! Server API Types
//!
//! Request and response types for the REST API

use serde::{Deserialize, Serialize};

use talkcody_core::storage::models::*;

// ============== Session Types ==============

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionRequest {
    pub project_id: Option<String>,
    pub title: Option<String>,
    pub settings: Option<TaskSettings>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionResponse {
    pub session_id: SessionId,
    pub created_at: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionResponse {
    pub id: SessionId,
    pub project_id: Option<String>,
    pub title: Option<String>,
    pub status: SessionStatus,
    pub created_at: i64,
    pub updated_at: i64,
    pub last_event_id: Option<String>,
    pub metadata: Option<serde_json::Value>,
}

impl From<Session> for SessionResponse {
    fn from(session: Session) -> Self {
        Self {
            id: session.id,
            project_id: session.project_id,
            title: session.title,
            status: session.status,
            created_at: session.created_at,
            updated_at: session.updated_at,
            last_event_id: session.last_event_id,
            metadata: session.metadata,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListSessionsQuery {
    pub project_id: Option<String>,
    pub status: Option<String>,
    pub limit: Option<usize>,
    pub offset: Option<usize>,
}

// ============== Message Types ==============

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateMessageRequest {
    pub content: String,
    pub role: Option<String>, // Defaults to "user"
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateMessageResponse {
    pub message_id: MessageId,
    pub created_at: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageResponse {
    pub id: MessageId,
    pub session_id: SessionId,
    pub role: String,
    pub content: serde_json::Value, // Structured content
    pub created_at: i64,
    pub tool_call_id: Option<String>,
    pub parent_id: Option<String>,
}

impl From<Message> for MessageResponse {
    fn from(message: Message) -> Self {
        Self {
            id: message.id,
            session_id: message.session_id,
            role: message.role.as_str().to_string(),
            content: serde_json::to_value(&message.content).unwrap_or_default(),
            created_at: message.created_at,
            tool_call_id: message.tool_call_id,
            parent_id: message.parent_id,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListMessagesQuery {
    pub limit: Option<usize>,
    pub before_id: Option<String>,
}

// ============== Task Types ==============

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskRequest {
    pub session_id: Option<SessionId>, // If not provided, creates new session
    pub project_id: Option<String>,
    pub agent_id: Option<AgentId>,
    pub initial_message: String,
    pub settings: Option<TaskSettings>,
    pub workspace: Option<WorkspaceInfoRequest>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceInfoRequest {
    pub root_path: String,
    pub worktree_path: Option<String>,
    pub repository_url: Option<String>,
    pub branch: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskResponse {
    pub task_id: String,
    pub session_id: SessionId,
    pub state: String,
    pub created_at: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskResponse {
    pub id: String,
    pub session_id: SessionId,
    pub agent_id: Option<AgentId>,
    pub state: String,
    pub created_at: i64,
    pub started_at: Option<i64>,
    pub completed_at: Option<i64>,
    pub error_message: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchTaskRequest {
    pub settings: Option<TaskSettings>,
    pub action: Option<String>, // "cancel"
}

// ============== Action Types ==============

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateActionRequest {
    pub action_type: String, // "approve", "reject", "tool_result", "cancel"
    pub tool_call_id: Option<String>,
    pub reason: Option<String>,
    pub result: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateActionResponse {
    pub success: bool,
    pub message: String,
}

// ============== File Types ==============

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadFileResponse {
    pub attachment_id: String,
    pub filename: String,
    pub mime_type: String,
    pub size: i64,
    pub created_at: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileResponse {
    pub id: String,
    pub session_id: SessionId,
    pub filename: String,
    pub mime_type: String,
    pub size: i64,
    pub created_at: i64,
    pub origin: String,
}

impl From<Attachment> for FileResponse {
    fn from(attachment: Attachment) -> Self {
        Self {
            id: attachment.id,
            session_id: attachment.session_id,
            filename: attachment.filename,
            mime_type: attachment.mime_type,
            size: attachment.size,
            created_at: attachment.created_at,
            origin: attachment.origin.as_str().to_string(),
        }
    }
}

// ============== Event Types ==============

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum SseEvent {
    #[serde(rename = "status")]
    Status { data: StatusEventData },
    #[serde(rename = "token")]
    Token { data: TokenEventData },
    #[serde(rename = "message.final")]
    MessageFinal { data: MessageFinalEventData },
    #[serde(rename = "tool.call")]
    ToolCall { data: ToolCallEventData },
    #[serde(rename = "tool.result")]
    ToolResult { data: ToolResultEventData },
    #[serde(rename = "error")]
    Error { data: ErrorEventData },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusEventData {
    pub message: String,
    pub session_id: SessionId,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenEventData {
    pub token: String,
    pub session_id: SessionId,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageFinalEventData {
    pub message_id: String,
    pub content: String,
    pub session_id: SessionId,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallEventData {
    pub tool_call_id: String,
    pub name: String,
    pub input: serde_json::Value,
    pub provider_metadata: Option<serde_json::Value>,
    pub session_id: SessionId,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolResultEventData {
    pub tool_call_id: String,
    pub name: Option<String>,
    pub output: serde_json::Value,
    pub session_id: SessionId,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorEventData {
    pub message: String,
    pub session_id: Option<SessionId>,
    pub task_id: Option<String>,
}

// ============== WebSocket Types ==============

#[derive(Debug, Deserialize)]
#[serde(tag = "action", rename_all = "camelCase")]
pub enum WebSocketMessage {
    #[serde(rename = "subscribe")]
    Subscribe { session_id: SessionId },
    #[serde(rename = "unsubscribe")]
    Unsubscribe { session_id: SessionId },
    #[serde(rename = "ping")]
    Ping,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum WebSocketResponse {
    #[serde(rename = "subscribed")]
    Subscribed { session_id: SessionId },
    #[serde(rename = "unsubscribed")]
    Unsubscribed { session_id: SessionId },
    #[serde(rename = "event")]
    Event { event: SseEvent },
    #[serde(rename = "pong")]
    Pong,
    #[serde(rename = "error")]
    Error { message: String },
}

// ============== Error Response ==============

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorResponse {
    pub error: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
}

impl ErrorResponse {
    pub fn new(error: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            error: error.into(),
            message: message.into(),
            details: None,
        }
    }

    pub fn with_details(mut self, details: serde_json::Value) -> Self {
        self.details = Some(details);
        self
    }
}
