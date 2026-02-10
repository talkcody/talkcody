use crate::llm::auth::api_key_manager::LlmState;
use crate::llm::models::model_registry::ModelRegistry;
use crate::llm::transcription::service::TranscriptionService;
use crate::llm::transcription::types::TranscriptionContext;
use crate::storage::models::{AttachmentOrigin, MessageContent};
use crate::storage::{Attachment, Message, MessageRole, Storage};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

use super::types::{RemoteAttachment, RemoteAttachmentType, RemoteInboundMessage};

const MAX_TRANSCRIPTION_BYTES: u64 = 20 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreparedInboundMessage {
    pub text: String,
    pub attachments: Vec<RemotePreparedAttachment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemotePreparedAttachment {
    pub id: String,
    pub attachment_type: RemoteAttachmentType,
    pub filename: String,
    pub file_path: String,
    pub mime_type: String,
    pub size: u64,
    pub content_base64: Option<String>,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

pub async fn prepare_inbound_message(
    inbound: &RemoteInboundMessage,
    llm_state: &State<'_, LlmState>,
) -> Result<PreparedInboundMessage, String> {
    let mut attachments = Vec::new();
    let mut text_parts = Vec::new();

    let base_text = inbound.text.trim();
    if !base_text.is_empty() {
        text_parts.push(base_text.to_string());
    }

    for attachment in &inbound.attachments {
        let (prepared, note) = prepare_attachment(attachment, llm_state).await?;
        if let Some(att) = prepared {
            attachments.push(att);
        }
        if let Some(note) = note {
            text_parts.push(note);
        }
    }

    Ok(PreparedInboundMessage {
        text: text_parts.join("\n").trim().to_string(),
        attachments,
    })
}

async fn prepare_attachment(
    attachment: &RemoteAttachment,
    llm_state: &State<'_, LlmState>,
) -> Result<(Option<RemotePreparedAttachment>, Option<String>), String> {
    match attachment.attachment_type {
        RemoteAttachmentType::Image => prepare_image_attachment(attachment).await,
        RemoteAttachmentType::Audio | RemoteAttachmentType::Voice => {
            prepare_audio_attachment(attachment, llm_state).await
        }
        RemoteAttachmentType::File => Ok((Some(map_attachment_base(attachment, None)),
            attachment
                .caption
                .as_ref()
                .map(|caption| format!("[file: {}] {}", attachment.filename, caption)))),
    }
}

fn map_attachment_base(
    attachment: &RemoteAttachment,
    content_base64: Option<String>,
) -> RemotePreparedAttachment {
    RemotePreparedAttachment {
        id: attachment.id.clone(),
        attachment_type: attachment.attachment_type,
        filename: attachment.filename.clone(),
        file_path: attachment.file_path.clone(),
        mime_type: attachment.mime_type.clone(),
        size: attachment.size,
        content_base64,
    }
}

async fn prepare_image_attachment(
    attachment: &RemoteAttachment,
) -> Result<(Option<RemotePreparedAttachment>, Option<String>), String> {
    match tokio::fs::read(&attachment.file_path).await {
        Ok(data) => {
            let encoded = base64::engine::general_purpose::STANDARD.encode(data);
            Ok((Some(map_attachment_base(attachment, Some(encoded))), None))
        }
        Err(error) => Ok((
            None,
            Some(format!("[image: {} unavailable]", attachment.filename)),
        )),
    }
}

async fn prepare_audio_attachment(
    attachment: &RemoteAttachment,
    llm_state: &State<'_, LlmState>,
) -> Result<(Option<RemotePreparedAttachment>, Option<String>), String> {
    if attachment.size > MAX_TRANSCRIPTION_BYTES {
        return Ok((
            None,
            Some(format!(
                "[voice: {} too large to transcribe]",
                attachment.filename
            )),
        ));
    }

    let data = match tokio::fs::read(&attachment.file_path).await {
        Ok(bytes) => bytes,
        Err(_) => {
            return Ok((
                None,
                Some(format!(
                    "[voice: {} transcription failed]",
                    attachment.filename
                )),
            ))
        }
    };

    let audio_base64 = base64::engine::general_purpose::STANDARD.encode(data);
    let mime_type = if attachment.mime_type.is_empty() {
        "audio/webm".to_string()
    } else {
        attachment.mime_type.clone()
    };

    let model_identifier = llm_state
        .api_keys
        .lock()
        .await
        .get_setting("model_type_transcription")
        .await?
        .unwrap_or_default();

    if model_identifier.trim().is_empty() {
        return Ok((
            None,
            Some("[voice: Please configure the transcription API key in TalkCody settings first]".to_string()),
        ));
    }

    let (registry, api_keys, models) = {
        let registry = llm_state.registry.lock().await;
        let api_keys = llm_state.api_keys.lock().await;
        let models = api_keys.load_models_config().await?;
        (registry.clone(), api_keys.clone(), models)
    };

    let custom_providers = api_keys.load_custom_providers().await?;

    let context = TranscriptionContext {
        audio_base64,
        mime_type,
        language: None,
        prompt: None,
        temperature: None,
        response_format: Some("verbose_json".to_string()),
    };

    match TranscriptionService::transcribe(
        &api_keys,
        &registry,
        &custom_providers,
        &models,
        &model_identifier,
        context,
    )
    .await
    {
        Ok(result) => Ok((None, Some(result.text))),
        Err(error) => {
            let error_message = error.to_string();
            if error_message.contains("No transcription model configured")
                || error_message.contains("No available provider")
                || error_message.contains("Transcription not supported")
                || (error_message.contains("401")
                    && error_message.contains("insufficient permissions"))
            {
                Ok((
                    None,
                    Some("[voice: Please configure the transcription API key in TalkCody settings first]".to_string()),
                ))
            } else {
                Ok((
                    None,
                    Some(format!(
                        "[voice: {} transcription failed]",
                        attachment.filename
                    )),
                ))
            }
        }
    }
}

pub async fn persist_user_message(
    storage: &Storage,
    session_id: &str,
    text: &str,
    attachments: &[RemotePreparedAttachment],
) -> Result<(), String> {
    let message_id = format!("msg_{}", uuid::Uuid::new_v4().to_string().replace('-', ""));
    let now = chrono::Utc::now().timestamp();

    let content = MessageContent::Text {
        text: text.to_string(),
    };

    let message = Message {
        id: message_id.clone(),
        session_id: session_id.to_string(),
        role: MessageRole::User,
        content,
        created_at: now,
        tool_call_id: None,
        parent_id: None,
    };

    storage.chat_history.create_message(&message).await?;

    for attachment in attachments {
        let record = Attachment {
            id: attachment.id.clone(),
            session_id: session_id.to_string(),
            message_id: Some(message_id.clone()),
            filename: attachment.filename.clone(),
            mime_type: attachment.mime_type.clone(),
            size: attachment.size as i64,
            path: attachment.file_path.clone(),
            created_at: now,
            origin: AttachmentOrigin::UserUpload,
        };
        storage
            .attachments
            .create_attachment(&record, &[])
            .await
            .map_err(|e| format!("Failed to store attachment metadata: {}", e))?;
    }

    Ok(())
}
