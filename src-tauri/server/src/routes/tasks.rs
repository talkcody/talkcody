use axum::extract::{Path, State};
use axum::Json;

use crate::state::ServerState;
use crate::types::*;
use talkcody_core::core::types::TaskInput;
use talkcody_core::storage::models::SessionStatus;
use talkcody_core::storage::models::WorkspaceInfo;

/// Create a new task (starts agent execution)
pub async fn create_task(
    State(state): State<ServerState>,
    Json(payload): Json<CreateTaskRequest>,
) -> Result<Json<CreateTaskResponse>, Json<ErrorResponse>> {
    // Create or use existing session
    let session_id = match payload.session_id {
        Some(id) => id,
        None => {
            // Create new session
            let new_session_id =
                format!("sess_{}", uuid::Uuid::new_v4().to_string().replace("-", ""));
            match state
                .storage()
                .chat_history
                .create_session(&talkcody_core::storage::models::Session {
                    id: new_session_id.clone(),
                    project_id: payload.project_id.clone(),
                    title: Some("New Task".to_string()),
                    status: SessionStatus::Running,
                    created_at: chrono::Utc::now().timestamp(),
                    updated_at: chrono::Utc::now().timestamp(),
                    last_event_id: None,
                    metadata: None,
                })
                .await
            {
                Ok(_) => new_session_id,
                Err(e) => {
                    return Err(Json(ErrorResponse::new(
                        "INTERNAL_ERROR",
                        format!("Failed to create session: {}", e),
                    )))
                }
            }
        }
    };

    // Build task input
    let workspace = payload.workspace.map(|w| WorkspaceInfo {
        root_path: w.root_path,
        worktree_path: w.worktree_path,
        repository_url: w.repository_url,
        branch: w.branch,
    });

    let task_input = TaskInput {
        session_id: session_id.clone(),
        agent_id: payload.agent_id,
        project_id: payload.project_id,
        initial_message: payload.initial_message,
        settings: payload.settings,
        workspace,
    };

    // Start the task
    match state.runtime().start_task(task_input).await {
        Ok(handle) => Ok(Json(CreateTaskResponse {
            task_id: handle.task_id.clone(),
            session_id,
            state: "pending".to_string(),
            created_at: chrono::Utc::now().timestamp(),
        })),
        Err(e) => Err(Json(ErrorResponse::new(
            "INTERNAL_ERROR",
            format!("Failed to start task: {}", e),
        ))),
    }
}

/// Get task by ID
pub async fn get_task(
    State(state): State<ServerState>,
    Path(task_id): Path<String>,
) -> Result<Json<TaskResponse>, Json<ErrorResponse>> {
    match state.runtime().get_task(&task_id).await {
        Some(handle) => {
            let state_guard = handle.state.read().await;
            Ok(Json(TaskResponse {
                id: handle.task_id.clone(),
                session_id: handle.session_id.clone(),
                agent_id: None, // Would need to get from task storage
                state: format!("{:?}", *state_guard).to_lowercase(),
                created_at: chrono::Utc::now().timestamp(),
                started_at: None,
                completed_at: None,
                error_message: None,
            }))
        }
        None => Err(Json(ErrorResponse::new(
            "NOT_FOUND",
            format!("Task '{}' not found", task_id),
        ))),
    }
}

/// Patch/update task (e.g., cancel, update settings)
pub async fn patch_task(
    State(state): State<ServerState>,
    Path(task_id): Path<String>,
    Json(payload): Json<PatchTaskRequest>,
) -> Result<Json<TaskResponse>, Json<ErrorResponse>> {
    // Handle cancel action
    if let Some(action) = payload.action {
        if action == "cancel" {
            match state.runtime().cancel_task(&task_id).await {
                Ok(_) => {}
                Err(e) => {
                    return Err(Json(ErrorResponse::new(
                        "INTERNAL_ERROR",
                        format!("Failed to cancel task: {}", e),
                    )));
                }
            }
        }
    }

    // Get updated task info
    match state.runtime().get_task(&task_id).await {
        Some(handle) => {
            let state_guard = handle.state.read().await;
            Ok(Json(TaskResponse {
                id: handle.task_id.clone(),
                session_id: handle.session_id.clone(),
                agent_id: None,
                state: format!("{:?}", *state_guard).to_lowercase(),
                created_at: chrono::Utc::now().timestamp(),
                started_at: None,
                completed_at: None,
                error_message: None,
            }))
        }
        None => Err(Json(ErrorResponse::new(
            "NOT_FOUND",
            format!("Task '{}' not found", task_id),
        ))),
    }
}

/// List active tasks
pub async fn list_tasks(
    State(state): State<ServerState>,
) -> Result<Json<Vec<TaskResponse>>, Json<ErrorResponse>> {
    let tasks = state.runtime().list_active_tasks().await;

    let responses: Vec<TaskResponse> = tasks
        .into_iter()
        .map(|handle| {
            let state_guard = handle.state.try_read().ok();
            TaskResponse {
                id: handle.task_id.clone(),
                session_id: handle.session_id.clone(),
                agent_id: None,
                state: state_guard
                    .map(|s| format!("{:?}", *s).to_lowercase())
                    .unwrap_or_else(|| "unknown".to_string()),
                created_at: chrono::Utc::now().timestamp(),
                started_at: None,
                completed_at: None,
                error_message: None,
            }
        })
        .collect();

    Ok(Json(responses))
}
