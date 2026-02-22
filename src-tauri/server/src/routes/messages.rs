use axum::extract::{Path, Query, State};
use axum::Json;

use crate::state::ServerState;
use crate::types::*;
use talkcody_core::storage::models::{Message, MessageContent, MessageRole};

/// Create a new message in a session
pub async fn create_message(
    State(state): State<ServerState>,
    Path(session_id): Path<String>,
    Json(payload): Json<CreateMessageRequest>,
) -> Result<Json<CreateMessageResponse>, Json<ErrorResponse>> {
    // Verify session exists
    match state.storage().chat_history.get_session(&session_id).await {
        Ok(Some(_)) => {}
        Ok(None) => {
            return Err(Json(ErrorResponse::new(
                "NOT_FOUND",
                format!("Session '{}' not found", session_id),
            )));
        }
        Err(e) => {
            return Err(Json(ErrorResponse::new(
                "INTERNAL_ERROR",
                format!("Failed to get session: {}", e),
            )));
        }
    }

    let now = chrono::Utc::now().timestamp();
    let message_id = format!("msg_{}", uuid::Uuid::new_v4().to_string().replace("-", ""));

    let message = Message {
        id: message_id.clone(),
        session_id: session_id.clone(),
        role: payload
            .role
            .as_deref()
            .and_then(|r| r.parse().ok())
            .unwrap_or(MessageRole::User),
        content: MessageContent::Text {
            text: payload.content,
        },
        created_at: now,
        tool_call_id: None,
        parent_id: None,
    };

    match state.storage().chat_history.create_message(&message).await {
        Ok(_) => Ok(Json(CreateMessageResponse {
            message_id,
            created_at: now,
        })),
        Err(e) => Err(Json(ErrorResponse::new(
            "INTERNAL_ERROR",
            format!("Failed to create message: {}", e),
        ))),
    }
}

/// Get messages for a session
pub async fn get_messages(
    State(state): State<ServerState>,
    Path(session_id): Path<String>,
    Query(query): Query<ListMessagesQuery>,
) -> Result<Json<Vec<MessageResponse>>, Json<ErrorResponse>> {
    match state
        .storage()
        .chat_history
        .get_messages(&session_id, query.limit, query.before_id.as_deref())
        .await
    {
        Ok(messages) => Ok(Json(
            messages.into_iter().map(MessageResponse::from).collect(),
        )),
        Err(e) => Err(Json(ErrorResponse::new(
            "INTERNAL_ERROR",
            format!("Failed to get messages: {}", e),
        ))),
    }
}
