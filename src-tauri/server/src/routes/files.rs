use axum::extract::{Path, State};
use axum::{body::Bytes, Json};

use crate::state::ServerState;
use crate::types::*;
use talkcody_core::storage::models::{Attachment, AttachmentOrigin};

/// Upload a file to a session
pub async fn upload_file(
    State(state): State<ServerState>,
    Path(session_id): Path<String>,
    body: Bytes,
) -> Result<Json<UploadFileResponse>, Json<ErrorResponse>> {
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
    let attachment_id = format!("att_{}", uuid::Uuid::new_v4().to_string().replace("-", ""));

    // Determine mime type from content (simplified)
    let mime_type = "application/octet-stream".to_string();

    let attachment = Attachment {
        id: attachment_id.clone(),
        session_id: session_id.clone(),
        message_id: None,
        filename: "upload.bin".to_string(), // Would extract from multipart in real impl
        mime_type: mime_type.clone(),
        size: body.len() as i64,
        path: String::new(), // Will be set by create_attachment
        created_at: now,
        origin: AttachmentOrigin::UserUpload,
    };

    match state
        .storage()
        .attachments
        .create_attachment(&attachment, &body)
        .await
    {
        Ok(_) => Ok(Json(UploadFileResponse {
            attachment_id,
            filename: attachment.filename,
            mime_type,
            size: body.len() as i64,
            created_at: now,
        })),
        Err(e) => Err(Json(ErrorResponse::new(
            "INTERNAL_ERROR",
            format!("Failed to create attachment: {}", e),
        ))),
    }
}

/// Get file metadata
pub async fn get_file(
    State(state): State<ServerState>,
    Path((session_id, file_id)): Path<(String, String)>,
) -> Result<Json<FileResponse>, Json<ErrorResponse>> {
    match state.storage().attachments.get_attachment(&file_id).await {
        Ok(Some(attachment)) => {
            if attachment.session_id != session_id {
                return Err(Json(ErrorResponse::new(
                    "FORBIDDEN",
                    "Attachment does not belong to this session",
                )));
            }
            Ok(Json(FileResponse::from(attachment)))
        }
        Ok(None) => Err(Json(ErrorResponse::new(
            "NOT_FOUND",
            format!("File '{}' not found", file_id),
        ))),
        Err(e) => Err(Json(ErrorResponse::new(
            "INTERNAL_ERROR",
            format!("Failed to get attachment: {}", e),
        ))),
    }
}

/// Download file data
pub async fn download_file(
    State(state): State<ServerState>,
    Path((session_id, file_id)): Path<(String, String)>,
) -> Result<axum::body::Body, Json<ErrorResponse>> {
    // Verify attachment exists and belongs to session
    match state.storage().attachments.get_attachment(&file_id).await {
        Ok(Some(attachment)) => {
            if attachment.session_id != session_id {
                return Err(Json(ErrorResponse::new(
                    "FORBIDDEN",
                    "Attachment does not belong to this session",
                )));
            }
        }
        Ok(None) => {
            return Err(Json(ErrorResponse::new(
                "NOT_FOUND",
                format!("File '{}' not found", file_id),
            )))
        }
        Err(e) => {
            return Err(Json(ErrorResponse::new(
                "INTERNAL_ERROR",
                format!("Failed to get attachment: {}", e),
            )))
        }
    }

    // Read file data
    match state
        .storage()
        .attachments
        .read_attachment_data(&file_id)
        .await
    {
        Ok(Some(data)) => Ok(axum::body::Body::from(data)),
        Ok(None) => Err(Json(ErrorResponse::new("NOT_FOUND", "File data not found"))),
        Err(e) => Err(Json(ErrorResponse::new(
            "INTERNAL_ERROR",
            format!("Failed to read file: {}", e),
        ))),
    }
}

/// List files for a session
pub async fn list_files(
    State(state): State<ServerState>,
    Path(session_id): Path<String>,
) -> Result<Json<Vec<FileResponse>>, Json<ErrorResponse>> {
    match state
        .storage()
        .attachments
        .list_attachments(&session_id, None)
        .await
    {
        Ok(attachments) => Ok(Json(
            attachments.into_iter().map(FileResponse::from).collect(),
        )),
        Err(e) => Err(Json(ErrorResponse::new(
            "INTERNAL_ERROR",
            format!("Failed to list attachments: {}", e),
        ))),
    }
}
