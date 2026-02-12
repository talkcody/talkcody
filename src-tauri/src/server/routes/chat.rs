//! Chat API
//!
//! POST /v1/chat - Receive user message and stream response via SSE

use axum::{
    extract::State,
    response::sse::{Event, KeepAlive, Sse},
    Json,
};
use std::convert::Infallible;
use tokio::sync::broadcast;
use tokio_stream::StreamExt;

use crate::core::types::{RuntimeEvent, TaskInput};
use crate::server::state::ServerState;
use crate::server::types::*;
use crate::storage::models::{Message, MessageContent, MessageRole, SessionStatus, TaskSettings};

/// Chat request - OpenAI compatible format
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRequest {
    /// Model identifier (e.g., "claude-sonnet-4-20250514")
    pub model: Option<String>,
    /// Messages array
    pub messages: Vec<ChatMessage>,
    /// Whether to stream response
    pub stream: Option<bool>,
    /// Temperature for sampling
    pub temperature: Option<f32>,
    /// Maximum tokens to generate
    pub max_tokens: Option<i32>,
    /// Optional session ID for continuing conversation
    pub session_id: Option<String>,
    /// Optional project name
    pub project_name: Option<String>,
    /// Optional agent ID
    pub agent_id: Option<String>,
    /// Optional workspace root
    pub workspace: Option<WorkspaceInfoRequest>,
}

/// Chat message - OpenAI compatible format
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    /// Role: "system", "user", "assistant", "tool"
    pub role: String,
    /// Message content (text or array of content parts)
    pub content: serde_json::Value,
    /// Tool call ID (for tool role)
    #[serde(default)]
    pub tool_call_id: Option<String>,
    /// Tool calls (for assistant role)
    #[serde(default)]
    pub tool_calls: Option<Vec<serde_json::Value>>,
    /// Name (for tool role)
    #[serde(default)]
    pub name: Option<String>,
}

/// Chat response - for non-streaming mode
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatResponse {
    pub id: String,
    pub object: String,
    pub created: i64,
    pub model: String,
    pub choices: Vec<ChatChoice>,
    pub usage: Option<Usage>,
}

/// Chat choice
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatChoice {
    pub index: i32,
    pub message: ChatMessageResponse,
    pub finish_reason: Option<String>,
}

/// Chat message response
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessageResponse {
    pub role: String,
    pub content: String,
}

/// Usage information
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub prompt_tokens: i32,
    pub completion_tokens: i32,
    pub total_tokens: i32,
}

/// Handle chat request
pub async fn chat(
    State(state): State<ServerState>,
    Json(payload): Json<ChatRequest>,
) -> Result<Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>>, Json<ErrorResponse>> {
    let stream_enabled = payload.stream.unwrap_or(true);

    if !stream_enabled {
        // Non-streaming mode - not implemented yet
        return Err(Json(ErrorResponse::new(
            "NOT_IMPLEMENTED",
            "Non-streaming mode is not yet supported. Use stream: true".to_string(),
        )));
    }

    // Get or create session
    let session_id = match payload.session_id {
        Some(id) => id,
        None => {
            let new_session_id =
                format!("sess_{}", uuid::Uuid::new_v4().to_string().replace("-", ""));
            let now = chrono::Utc::now().timestamp();

            // Create new session
            let session = crate::storage::models::Session {
                id: new_session_id.clone(),
                project_id: payload.project_name.clone(),
                title: payload
                    .project_name
                    .clone()
                    .or_else(|| Some("New Chat".to_string())),
                status: SessionStatus::Running,
                created_at: now,
                updated_at: now,
                last_event_id: None,
                metadata: None,
            };

            state
                .storage()
                .chat_history
                .create_session(&session)
                .await
                .map_err(|e| {
                    Json(ErrorResponse::new(
                        "INTERNAL_ERROR",
                        format!("Failed to create session: {}", e),
                    ))
                })?;

            new_session_id
        }
    };

    // Get the last user message
    let user_message = payload
        .messages
        .iter()
        .rev()
        .find(|m| m.role == "user")
        .ok_or_else(|| {
            Json(ErrorResponse::new(
                "BAD_REQUEST",
                "No user message found".to_string(),
            ))
        })?;

    let user_content = match &user_message.content {
        serde_json::Value::String(s) => s.clone(),
        _ => user_message.content.to_string(),
    };

    // Save user message to storage
    let now = chrono::Utc::now().timestamp();
    let message_id = format!("msg_{}", uuid::Uuid::new_v4().to_string().replace("-", ""));

    let role = match user_message.role.as_str() {
        "system" => MessageRole::System,
        "assistant" => MessageRole::Assistant,
        "tool" => MessageRole::Tool,
        _ => MessageRole::User,
    };

    let message = Message {
        id: message_id.clone(),
        session_id: session_id.clone(),
        role,
        content: MessageContent::Text {
            text: user_content.clone(),
        },
        created_at: now,
        tool_call_id: user_message.tool_call_id.clone(),
        parent_id: None,
    };

    state
        .storage()
        .chat_history
        .create_message(&message)
        .await
        .map_err(|e| {
            Json(ErrorResponse::new(
                "INTERNAL_ERROR",
                format!("Failed to save message: {}", e),
            ))
        })?;

    // Build task settings with model
    let mut extra = std::collections::HashMap::new();
    if let Some(model) = &payload.model {
        extra.insert(
            "model".to_string(),
            serde_json::Value::String(model.clone()),
        );
    }
    if let Some(temp) = payload.temperature {
        extra.insert(
            "temperature".to_string(),
            serde_json::Value::Number(
                serde_json::Number::from_f64(temp as f64).unwrap_or(serde_json::Number::from(0)),
            ),
        );
    }
    if let Some(max_tok) = payload.max_tokens {
        extra.insert(
            "max_tokens".to_string(),
            serde_json::Value::Number(serde_json::Number::from(max_tok)),
        );
    }

    let settings = TaskSettings {
        auto_approve_edits: None,
        auto_approve_plan: None,
        auto_code_review: None,
        extra,
    };

    // Build workspace info
    let workspace = payload
        .workspace
        .map(|w| crate::storage::models::WorkspaceInfo {
            root_path: w.root_path,
            worktree_path: w.worktree_path,
            repository_url: w.repository_url,
            branch: w.branch,
        });

    // Create task input
    let task_input = TaskInput {
        session_id: session_id.clone(),
        agent_id: payload.agent_id.clone(),
        project_id: payload.project_name.clone(),
        initial_message: user_content,
        settings: Some(settings),
        workspace,
    };

    // Subscribe to broadcast events for this session
    let mut rx = state.event_broadcast.subscribe();

    // Start the task
    state.runtime().start_task(task_input).await.map_err(|e| {
        Json(ErrorResponse::new(
            "INTERNAL_ERROR",
            format!("Failed to start task: {}", e),
        ))
    })?;

    // Create SSE stream using a manual stream implementation
    let session_id_clone = session_id.clone();
    let stream = async_stream::stream! {
        let mut rx = state.event_broadcast.subscribe();
        loop {
            match rx.recv().await {
                Ok(event) => {
                    // Filter events for this session
                    let session_matches = match &event {
                        RuntimeEvent::Token { session_id: s, .. } => s == &session_id_clone,
                        RuntimeEvent::ReasoningStart { session_id: s, .. } => s == &session_id_clone,
                        RuntimeEvent::ReasoningDelta { session_id: s, .. } => s == &session_id_clone,
                        RuntimeEvent::ReasoningEnd { session_id: s, .. } => s == &session_id_clone,
                        RuntimeEvent::MessageCreated { session_id: s, .. } => s == &session_id_clone,
                        RuntimeEvent::ToolCallRequested { task_id: _, .. } => true,
                        RuntimeEvent::ToolCallCompleted { task_id: _, .. } => true,
                        RuntimeEvent::TaskStateChanged { task_id: _, .. } => true,
                        RuntimeEvent::TaskCompleted { session_id: s, .. } => s == &session_id_clone,
                        RuntimeEvent::Error { session_id: s, .. } => {
                            s.as_ref().map(|s| s == &session_id_clone).unwrap_or(false)
                        }
                    };

                    if !session_matches {
                        continue;
                    }

                    // Convert RuntimeEvent to SSE event
                    let sse_event = convert_runtime_event_to_sse(&event);
                    yield Ok::<_, Infallible>(sse_event);

                    // Stop stream on task completion or error
                    if matches!(&event, RuntimeEvent::TaskCompleted { .. }) {
                        break;
                    }
                }
                Err(broadcast::error::RecvError::Lagged(_)) => {
                    // Skip lagged events
                    continue;
                }
                Err(broadcast::error::RecvError::Closed) => {
                    // Channel closed, break the loop
                    break;
                }
            }
        }
    };

    Ok(Sse::new(stream).keep_alive(KeepAlive::new()))
}

/// Convert RuntimeEvent to SSE Event
pub fn convert_runtime_event_to_sse(event: &RuntimeEvent) -> Event {
    match event {
        RuntimeEvent::Token { session_id, token } => Event::default().event("token").data(
            serde_json::json!({
                "type": "token",
                "data": {
                    "token": token,
                    "sessionId": session_id
                }
            })
            .to_string(),
        ),
        RuntimeEvent::ReasoningStart { session_id, id } => {
            Event::default().event("reasoning.start").data(
                serde_json::json!({
                    "type": "reasoning.start",
                    "data": {
                        "id": id,
                        "sessionId": session_id
                    }
                })
                .to_string(),
            )
        }
        RuntimeEvent::ReasoningDelta {
            session_id,
            id,
            text,
        } => Event::default().event("reasoning.delta").data(
            serde_json::json!({
                "type": "reasoning.delta",
                "data": {
                    "id": id,
                    "text": text,
                    "sessionId": session_id
                }
            })
            .to_string(),
        ),
        RuntimeEvent::ReasoningEnd { session_id, id } => {
            Event::default().event("reasoning.end").data(
                serde_json::json!({
                    "type": "reasoning.end",
                    "data": {
                        "id": id,
                        "sessionId": session_id
                    }
                })
                .to_string(),
            )
        }
        RuntimeEvent::MessageCreated {
            session_id,
            message,
        } => {
            let content = match &message.content {
                MessageContent::Text { text } => text.clone(),
                _ => serde_json::to_string(&message.content).unwrap_or_default(),
            };

            Event::default().event("message.created").data(
                serde_json::json!({
                    "type": "message.created",
                    "data": {
                        "messageId": message.id,
                        "role": message.role.as_str(),
                        "content": content,
                        "sessionId": session_id
                    }
                })
                .to_string(),
            )
        }
        RuntimeEvent::ToolCallRequested { task_id, request } => {
            Event::default().event("tool.call").data(
                serde_json::json!({
                    "type": "tool.call",
                    "data": {
                        "toolCallId": request.tool_call_id,
                        "name": request.name,
                        "input": request.input,
                        "taskId": task_id
                    }
                })
                .to_string(),
            )
        }
        RuntimeEvent::ToolCallCompleted { task_id, result } => {
            Event::default().event("tool.result").data(
                serde_json::json!({
                    "type": "tool.result",
                    "data": {
                        "toolCallId": result.tool_call_id,
                        "name": result.name,
                        "success": result.success,
                        "output": result.output,
                        "error": result.error,
                        "taskId": task_id
                    }
                })
                .to_string(),
            )
        }
        RuntimeEvent::TaskStateChanged {
            task_id,
            state,
            previous_state,
        } => Event::default().event("task.state_changed").data(
            serde_json::json!({
                "type": "task.state_changed",
                "data": {
                    "taskId": task_id,
                    "state": format!("{:?}", state).to_lowercase(),
                    "previousState": format!("{:?}", previous_state).to_lowercase()
                }
            })
            .to_string(),
        ),
        RuntimeEvent::TaskCompleted {
            task_id,
            session_id,
        } => Event::default().event("task.completed").data(
            serde_json::json!({
                "type": "task.completed",
                "data": {
                    "taskId": task_id,
                    "sessionId": session_id
                }
            })
            .to_string(),
        ),
        RuntimeEvent::Error {
            task_id,
            session_id,
            message,
        } => Event::default().event("error").data(
            serde_json::json!({
                "type": "error",
                "data": {
                    "message": message,
                    "taskId": task_id,
                    "sessionId": session_id
                }
            })
            .to_string(),
        ),
    }
}
