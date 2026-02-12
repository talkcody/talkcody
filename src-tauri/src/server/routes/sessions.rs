use axum::extract::{Path, Query, State};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::Json;
use serde::{Deserialize, Serialize};
use std::convert::Infallible;
use std::time::Duration;
use tokio_stream::wrappers::IntervalStream;
use tokio_stream::StreamExt;

use crate::core::types::RuntimeEvent;
use crate::server::routes::chat::convert_runtime_event_to_sse;
use crate::server::state::ServerState;
use crate::server::types::*;
use crate::storage::models::{Session, SessionStatus, TaskSettings};

/// Create a new session
pub async fn create_session(
    State(state): State<ServerState>,
    Json(payload): Json<CreateSessionRequest>,
) -> Result<Json<CreateSessionResponse>, Json<ErrorResponse>> {
    let now = chrono::Utc::now().timestamp();
    let session_id = format!("sess_{}", uuid::Uuid::new_v4().to_string().replace("-", ""));

    let session = Session {
        id: session_id.clone(),
        project_id: payload.project_id,
        title: payload.title,
        status: SessionStatus::Created,
        created_at: now,
        updated_at: now,
        last_event_id: None,
        metadata: None,
    };

    match state.storage().chat_history.create_session(&session).await {
        Ok(_) => {
            // Store settings if provided
            if let Some(settings) = payload.settings {
                let _ = state
                    .storage()
                    .settings
                    .set_task_settings(&session_id, &settings)
                    .await;
            }

            Ok(Json(CreateSessionResponse {
                session_id,
                created_at: now,
            }))
        }
        Err(e) => Err(Json(ErrorResponse::new(
            "INTERNAL_ERROR",
            format!("Failed to create session: {}", e),
        ))),
    }
}

/// Get session by ID
pub async fn get_session(
    State(state): State<ServerState>,
    Path(session_id): Path<String>,
) -> Result<Json<SessionResponse>, Json<ErrorResponse>> {
    match state.storage().chat_history.get_session(&session_id).await {
        Ok(Some(session)) => Ok(Json(SessionResponse::from(session))),
        Ok(None) => Err(Json(ErrorResponse::new(
            "NOT_FOUND",
            format!("Session '{}' not found", session_id),
        ))),
        Err(e) => Err(Json(ErrorResponse::new(
            "INTERNAL_ERROR",
            format!("Failed to get session: {}", e),
        ))),
    }
}

/// List sessions with optional filters
pub async fn list_sessions(
    State(state): State<ServerState>,
    Query(query): Query<ListSessionsQuery>,
) -> Result<Json<Vec<SessionResponse>>, Json<ErrorResponse>> {
    let status = query.status.and_then(|s| s.parse().ok());

    match state
        .storage()
        .chat_history
        .list_sessions(
            query.project_id.as_deref(),
            status,
            query.limit,
            query.offset,
        )
        .await
    {
        Ok(sessions) => Ok(Json(
            sessions.into_iter().map(SessionResponse::from).collect(),
        )),
        Err(e) => Err(Json(ErrorResponse::new(
            "INTERNAL_ERROR",
            format!("Failed to list sessions: {}", e),
        ))),
    }
}

/// Delete a session
pub async fn delete_session(
    State(state): State<ServerState>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, Json<ErrorResponse>> {
    // First deactivate in runtime if active
    let _ = state
        .runtime()
        .session_manager()
        .deactivate_session(&session_id)
        .await;

    match state
        .storage()
        .chat_history
        .delete_session(&session_id)
        .await
    {
        Ok(_) => Ok(Json(serde_json::json!({ "success": true }))),
        Err(e) => Err(Json(ErrorResponse::new(
            "INTERNAL_ERROR",
            format!("Failed to delete session: {}", e),
        ))),
    }
}

/// Get session settings
pub async fn get_session_settings(
    State(state): State<ServerState>,
    Path(session_id): Path<String>,
) -> Result<Json<TaskSettings>, Json<ErrorResponse>> {
    match state
        .storage()
        .settings
        .get_task_settings(&session_id)
        .await
    {
        Ok(Some(settings)) => Ok(Json(settings)),
        Ok(None) => Ok(Json(TaskSettings::default())),
        Err(e) => Err(Json(ErrorResponse::new(
            "INTERNAL_ERROR",
            format!("Failed to get settings: {}", e),
        ))),
    }
}

/// Update session settings
pub async fn update_session_settings(
    State(state): State<ServerState>,
    Path(session_id): Path<String>,
    Json(payload): Json<TaskSettings>,
) -> Result<Json<TaskSettings>, Json<ErrorResponse>> {
    match state
        .storage()
        .settings
        .update_task_settings(&session_id, payload)
        .await
    {
        Ok(settings) => Ok(Json(settings)),
        Err(e) => Err(Json(ErrorResponse::new(
            "INTERNAL_ERROR",
            format!("Failed to update settings: {}", e),
        ))),
    }
}

/// SSE endpoint for session events
pub async fn session_events(
    Path(session_id): Path<String>,
    State(state): State<ServerState>,
) -> Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>> {
    use async_stream::stream;
    use tokio::sync::broadcast;

    // Create SSE stream using a manual stream implementation
    let session_id_clone = session_id.clone();
    let stream = stream! {
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
                    let sse_event = convert_runtime_event_to_sse_session(&event);
                    yield Ok::<_, Infallible>(sse_event);
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

    Sse::new(stream).keep_alive(KeepAlive::default())
}

/// Convert RuntimeEvent to SSE Event for session events
fn convert_runtime_event_to_sse_session(event: &RuntimeEvent) -> Event {
    convert_runtime_event_to_sse(event)
}
