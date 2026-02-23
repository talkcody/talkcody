use axum::extract::{Path, State};
use axum::Json;

use crate::state::ServerState;
use crate::types::*;
use talkcody_core::core::types::TaskAction;

/// Create an action on a session (approve, reject, tool_result, cancel)
pub async fn create_action(
    State(state): State<ServerState>,
    Path(session_id): Path<String>,
    Json(payload): Json<CreateActionRequest>,
) -> Result<Json<CreateActionResponse>, Json<ErrorResponse>> {
    // Find the active task for this session
    let tasks = state.runtime().list_active_tasks().await;
    let task_handle = tasks.into_iter().find(|t| t.session_id == session_id);

    let task_handle = match task_handle {
        Some(handle) => handle,
        None => {
            return Err(Json(ErrorResponse::new(
                "NOT_FOUND",
                format!("No active task found for session '{}'", session_id),
            )));
        }
    };

    // Convert action type to TaskAction
    let action = match payload.action_type.as_str() {
        "approve" => {
            let tool_call_id = payload.tool_call_id.ok_or_else(|| {
                Json(ErrorResponse::new(
                    "BAD_REQUEST",
                    "tool_call_id required for approve action",
                ))
            })?;
            TaskAction::Approve { tool_call_id }
        }
        "reject" => {
            let tool_call_id = payload.tool_call_id.ok_or_else(|| {
                Json(ErrorResponse::new(
                    "BAD_REQUEST",
                    "tool_call_id required for reject action",
                ))
            })?;
            TaskAction::Reject {
                tool_call_id,
                reason: payload.reason,
            }
        }
        "tool_result" => {
            let tool_call_id = payload.tool_call_id.ok_or_else(|| {
                Json(ErrorResponse::new(
                    "BAD_REQUEST",
                    "tool_call_id required for tool_result action",
                ))
            })?;
            let result = payload.result.ok_or_else(|| {
                Json(ErrorResponse::new(
                    "BAD_REQUEST",
                    "result required for tool_result action",
                ))
            })?;
            TaskAction::ToolResult {
                tool_call_id,
                result,
            }
        }
        "cancel" => TaskAction::Cancel,
        _ => {
            return Err(Json(ErrorResponse::new(
                "BAD_REQUEST",
                format!("Unknown action type: {}", payload.action_type),
            )));
        }
    };

    // Send action to the task
    match task_handle.send_action(action) {
        Ok(_) => Ok(Json(CreateActionResponse {
            success: true,
            message: "Action sent successfully".to_string(),
        })),
        Err(e) => Err(Json(ErrorResponse::new(
            "INTERNAL_ERROR",
            format!("Failed to send action: {}", e),
        ))),
    }
}
