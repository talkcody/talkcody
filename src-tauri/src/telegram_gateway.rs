use bytes::Bytes;
use rand::Rng;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tokio::sync::{watch, Mutex};
use tokio::time::sleep;
use uuid::Uuid;

const TELEGRAM_CONFIG_FILE: &str = "telegram-remote.json";
const TELEGRAM_STATE_FILE: &str = "telegram-remote-state.json";
const TELEGRAM_ATTACHMENTS_DIR: &str = "attachments";
const TELEGRAM_MEDIA_PREFIX: &str = "telegram";
const DEFAULT_POLL_TIMEOUT_SECS: u64 = 25;
const DEFAULT_ERROR_BACKOFF_MS: u64 = 1500;
const MAX_ERROR_BACKOFF_MS: u64 = 30000;
const TELEGRAM_STATE_VERSION: u8 = 1;
const MAX_TELEGRAM_MEDIA_BYTES: u64 = 20 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramConfig {
    pub enabled: bool,
    pub token: String,
    pub allowed_chat_ids: Vec<i64>,
    pub poll_timeout_secs: u64,
}

impl Default for TelegramConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            token: String::new(),
            allowed_chat_ids: Vec::new(),
            poll_timeout_secs: DEFAULT_POLL_TIMEOUT_SECS,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramRemoteAttachment {
    pub id: String,
    pub attachment_type: String,
    pub file_path: String,
    pub filename: String,
    pub mime_type: String,
    pub size: u64,
    pub duration_seconds: Option<u32>,
    pub caption: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramInboundMessage {
    pub chat_id: i64,
    pub message_id: i64,
    pub text: String,
    pub username: Option<String>,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub date: i64,
    pub attachments: Option<Vec<TelegramRemoteAttachment>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramSendMessageRequest {
    pub chat_id: i64,
    pub text: String,
    pub reply_to_message_id: Option<i64>,
    pub disable_web_page_preview: Option<bool>,
    pub parse_mode: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramSendMessageResponse {
    pub message_id: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramEditMessageRequest {
    pub chat_id: i64,
    pub message_id: i64,
    pub text: String,
    pub disable_web_page_preview: Option<bool>,
    pub parse_mode: Option<String>,
}

#[derive(Debug, Clone)]
pub struct TelegramGateway {
    config: TelegramConfig,
    running: bool,
    last_update_id: Option<i64>,
    stop_tx: Option<watch::Sender<bool>>,
    last_poll_at_ms: Option<i64>,
    last_error: Option<String>,
    last_error_at_ms: Option<i64>,
    backoff_ms: u64,
}

impl TelegramGateway {
    pub fn new() -> Self {
        Self {
            config: TelegramConfig::default(),
            running: false,
            last_update_id: None,
            stop_tx: None,
            last_poll_at_ms: None,
            last_error: None,
            last_error_at_ms: None,
            backoff_ms: DEFAULT_ERROR_BACKOFF_MS,
        }
    }
}

type TelegramGatewayState = Arc<Mutex<TelegramGateway>>;

fn config_path<R: Runtime>(app_handle: &AppHandle<R>) -> Result<PathBuf, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    Ok(app_data_dir.join(TELEGRAM_CONFIG_FILE))
}

fn state_path<R: Runtime>(app_handle: &AppHandle<R>) -> Result<PathBuf, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    Ok(app_data_dir.join(TELEGRAM_STATE_FILE))
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn record_error_state(state: &mut TelegramGateway, message: impl Into<String>) {
    state.last_error = Some(message.into());
    state.last_error_at_ms = Some(now_ms());
}

fn clear_error_state(state: &mut TelegramGateway) {
    state.last_error = None;
    state.last_error_at_ms = None;
    state.backoff_ms = DEFAULT_ERROR_BACKOFF_MS;
}

fn compute_backoff_ms(current: u64, retry_after_ms: Option<u64>) -> u64 {
    if let Some(delay) = retry_after_ms {
        return delay.clamp(DEFAULT_ERROR_BACKOFF_MS, MAX_ERROR_BACKOFF_MS);
    }
    let jitter = rand::thread_rng().gen_range(0..250u64);
    let next = current.saturating_mul(2).saturating_add(jitter);
    next.clamp(DEFAULT_ERROR_BACKOFF_MS, MAX_ERROR_BACKOFF_MS)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TelegramGatewayStateSnapshot {
    version: u8,
    last_update_id: Option<i64>,
}

async fn load_state<R: Runtime>(
    app_handle: &AppHandle<R>,
) -> Result<TelegramGatewayStateSnapshot, String> {
    let path = state_path(app_handle)?;
    if !path.exists() {
        return Ok(TelegramGatewayStateSnapshot {
            version: TELEGRAM_STATE_VERSION,
            last_update_id: None,
        });
    }
    let content = tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| format!("Failed to read telegram state: {}", e))?;
    let parsed = serde_json::from_str::<TelegramGatewayStateSnapshot>(&content)
        .map_err(|e| format!("Failed to parse telegram state: {}", e))?;
    if parsed.version != TELEGRAM_STATE_VERSION {
        return Ok(TelegramGatewayStateSnapshot {
            version: TELEGRAM_STATE_VERSION,
            last_update_id: None,
        });
    }
    Ok(parsed)
}

async fn save_state<R: Runtime>(
    app_handle: &AppHandle<R>,
    snapshot: &TelegramGatewayStateSnapshot,
) -> Result<(), String> {
    let path = state_path(app_handle)?;
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create state dir: {}", e))?;
    }
    let content = serde_json::to_string_pretty(snapshot)
        .map_err(|e| format!("Failed to serialize telegram state: {}", e))?;
    let tmp_path = path.with_file_name(format!(
        "{}.{}.tmp",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("telegram-remote-state.json"),
        Uuid::new_v4()
    ));
    tokio::fs::write(&tmp_path, content)
        .await
        .map_err(|e| format!("Failed to write telegram state temp: {}", e))?;
    tokio::fs::rename(&tmp_path, &path)
        .await
        .map_err(|e| format!("Failed to finalize telegram state: {}", e))?;
    Ok(())
}

pub async fn load_config<R: Runtime>(app_handle: &AppHandle<R>) -> Result<TelegramConfig, String> {
    let path = config_path(app_handle)?;
    if !path.exists() {
        return Ok(TelegramConfig::default());
    }
    let content = tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| format!("Failed to read telegram config: {}", e))?;
    let mut parsed = serde_json::from_str::<TelegramConfig>(&content)
        .map_err(|e| format!("Failed to parse telegram config: {}", e))?;
    sanitize_allowed_chat_ids(&mut parsed.allowed_chat_ids);
    Ok(parsed)
}

pub async fn save_config<R: Runtime>(
    app_handle: &AppHandle<R>,
    config: &TelegramConfig,
) -> Result<(), String> {
    let path = config_path(app_handle)?;
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create config dir: {}", e))?;
    }
    let content = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize telegram config: {}", e))?;
    tokio::fs::write(&path, content)
        .await
        .map_err(|e| format!("Failed to write telegram config: {}", e))?;
    Ok(())
}

fn sanitize_allowed_chat_ids(allowed_chat_ids: &mut Vec<i64>) {
    allowed_chat_ids.retain(|id| *id != 0);
}

fn is_chat_allowed(config: &TelegramConfig, chat_id: i64) -> bool {
    if config.allowed_chat_ids.is_empty() {
        return true;
    }
    config.allowed_chat_ids.contains(&chat_id)
}

fn is_group_chat(chat_type: &Option<String>, chat_id: i64) -> bool {
    if chat_id < 0 {
        return true;
    }
    matches!(chat_type.as_deref(), Some("group") | Some("supergroup"))
}

async fn poll_loop(
    app_handle: AppHandle,
    gateway_state: TelegramGatewayState,
    stop_rx: watch::Receiver<bool>,
) {
    let client = Client::builder()
        .timeout(Duration::from_secs(DEFAULT_POLL_TIMEOUT_SECS + 10))
        .build();

    if let Err(error) = client {
        log::error!("[TelegramGateway] Failed to build HTTP client: {}", error);
        return;
    }
    let client = client.unwrap();

    let attachments_dir = match attachments_root(&app_handle).await {
        Ok(path) => path,
        Err(error) => {
            log::warn!(
                "[TelegramGateway] Failed to resolve attachments dir: {}",
                error
            );
            None
        }
    };

    log::info!(
        "[TelegramGateway] Polling loop started (attachments_dir={:?})",
        attachments_dir
    );

    loop {
        if *stop_rx.borrow() {
            break;
        }

        let config = {
            let state = gateway_state.lock().await;
            state.config.clone()
        };

        if !config.enabled || config.token.is_empty() {
            sleep(Duration::from_millis(DEFAULT_ERROR_BACKOFF_MS)).await;
            continue;
        }

        let last_update_id = {
            let state = gateway_state.lock().await;
            state.last_update_id
        };

        let request = TelegramGetUpdatesRequest {
            offset: last_update_id.map(|id| id + 1),
            timeout: Some(config.poll_timeout_secs as i64),
            allowed_updates: Some(vec!["message".to_string()]),
        };

        log::debug!(
            "[TelegramGateway] Polling getUpdates (offset={:?}, timeout_secs={})",
            last_update_id.map(|id| id + 1),
            config.poll_timeout_secs
        );

        let url = format!("https://api.telegram.org/bot{}/getUpdates", config.token);
        let response = client.post(&url).json(&request).send().await;

        let mut retry_after_ms: Option<u64> = None;
        match response {
            Ok(resp) => {
                if let Some(retry_after) = resp
                    .headers()
                    .get("retry-after")
                    .and_then(|value| value.to_str().ok())
                    .and_then(|value| value.parse::<u64>().ok())
                {
                    retry_after_ms = Some(retry_after.saturating_mul(1000));
                }

                let parsed = resp.json::<TelegramGetUpdatesResponse>().await;
                match parsed {
                    Ok(payload) => {
                        if !payload.ok {
                            let description = payload
                                .description
                                .unwrap_or_else(|| "Telegram returned ok=false".to_string());
                            if let Some(parameters) = payload.parameters {
                                if let Some(retry_after) = parameters.retry_after_secs {
                                    retry_after_ms = Some(retry_after.saturating_mul(1000));
                                }
                            }
                            let backoff_ms = {
                                let mut state = gateway_state.lock().await;
                                record_error_state(&mut state, description);
                                state.backoff_ms =
                                    compute_backoff_ms(state.backoff_ms, retry_after_ms);
                                state.backoff_ms
                            };
                            sleep(Duration::from_millis(backoff_ms)).await;
                            continue;
                        }

                        log::debug!(
                            "[TelegramGateway] getUpdates returned {} updates",
                            payload.result.len()
                        );

                        let mut max_update_id = last_update_id.unwrap_or(0);
                        for update in payload.result {
                            if update.update_id > max_update_id {
                                max_update_id = update.update_id;
                            }

                            if let Some(message) = update.message {
                                log::debug!(
                                    "[TelegramGateway] Processing update {} for chat_id={}",
                                    update.update_id,
                                    message.chat.id
                                );

                                if is_group_chat(&message.chat.chat_type, message.chat.id) {
                                    log::debug!(
                                        "[TelegramGateway] Ignoring group chat message chat_id={} chat_type={:?}",
                                        message.chat.id,
                                        message.chat.chat_type
                                    );
                                    continue;
                                }

                                if !is_chat_allowed(&config, message.chat.id) {
                                    log::debug!(
                                        "[TelegramGateway] Chat id {} not in allowlist (count={})",
                                        message.chat.id,
                                        config.allowed_chat_ids.len()
                                    );
                                    continue;
                                }

                                let (text, attachments) = match build_message_payload(
                                    &client,
                                    &config.token,
                                    &message,
                                    attachments_dir.as_ref(),
                                )
                                .await
                                {
                                    Ok(payload) => payload,
                                    Err(error) => {
                                        log::warn!(
                                            "[TelegramGateway] Failed to build message payload: {}",
                                            error
                                        );
                                        (String::new(), Vec::new())
                                    }
                                };

                                if text.trim().is_empty() && attachments.is_empty() {
                                    log::debug!(
                                        "[TelegramGateway] Ignoring empty message chat_id={} message_id={}",
                                        message.chat.id,
                                        message.message_id
                                    );
                                    continue;
                                }

                                log::debug!(
                                    "[TelegramGateway] Inbound message chat_id={} message_id={} text_len={} attachments={}",
                                    message.chat.id,
                                    message.message_id,
                                    text.len(),
                                    attachments.len()
                                );

                                let payload = TelegramInboundMessage {
                                    chat_id: message.chat.id,
                                    message_id: message.message_id,
                                    text,
                                    username: message
                                        .from
                                        .as_ref()
                                        .and_then(|user| user.username.clone()),
                                    first_name: message
                                        .from
                                        .as_ref()
                                        .and_then(|user| user.first_name.clone()),
                                    last_name: message
                                        .from
                                        .as_ref()
                                        .and_then(|user| user.last_name.clone()),
                                    date: message.date,
                                    attachments: if attachments.is_empty() {
                                        None
                                    } else {
                                        Some(attachments)
                                    },
                                };

                                match app_handle.emit("telegram-inbound-message", payload) {
                                    Ok(_) => {
                                        log::debug!(
                                            "[TelegramGateway] Emitted inbound message chat_id={} message_id={}",
                                            message.chat.id,
                                            message.message_id
                                        );
                                    }
                                    Err(error) => {
                                        log::error!(
                                            "[TelegramGateway] Failed to emit message: {}",
                                            error
                                        );
                                    }
                                }
                            }
                        }

                        if max_update_id > last_update_id.unwrap_or(0) {
                            let mut state = gateway_state.lock().await;
                            if max_update_id > state.last_update_id.unwrap_or(0) {
                                state.last_update_id = Some(max_update_id);
                                let snapshot = TelegramGatewayStateSnapshot {
                                    version: TELEGRAM_STATE_VERSION,
                                    last_update_id: state.last_update_id,
                                };
                                if let Err(error) = save_state(&app_handle, &snapshot).await {
                                    log::warn!("[TelegramGateway] Failed to save state: {}", error);
                                }
                            }
                        }
                        {
                            let mut state = gateway_state.lock().await;
                            state.last_poll_at_ms = Some(now_ms());
                            clear_error_state(&mut state);
                        }
                    }
                    Err(error) => {
                        let backoff_ms = {
                            let mut state = gateway_state.lock().await;
                            record_error_state(
                                &mut state,
                                format!("Failed to parse getUpdates: {}", error),
                            );
                            state.backoff_ms = compute_backoff_ms(state.backoff_ms, retry_after_ms);
                            state.backoff_ms
                        };
                        sleep(Duration::from_millis(backoff_ms)).await;
                    }
                }
            }
            Err(error) => {
                let backoff_ms = {
                    let mut state = gateway_state.lock().await;
                    record_error_state(&mut state, format!("getUpdates request failed: {}", error));
                    state.backoff_ms = compute_backoff_ms(state.backoff_ms, retry_after_ms);
                    state.backoff_ms
                };
                sleep(Duration::from_millis(backoff_ms)).await;
            }
        }
    }

    log::info!("[TelegramGateway] Polling loop stopped");
}

async fn save_attachment_file(
    attachments_dir: &PathBuf,
    filename: &str,
    data: Bytes,
) -> Result<String, String> {
    tokio::fs::create_dir_all(attachments_dir)
        .await
        .map_err(|e| format!("Failed to create attachments dir: {}", e))?;
    let target_path = attachments_dir.join(filename);
    tokio::fs::write(&target_path, data)
        .await
        .map_err(|e| format!("Failed to write attachment: {}", e))?;
    Ok(target_path.to_string_lossy().to_string())
}

async fn attachments_root<R: Runtime>(
    app_handle: &AppHandle<R>,
) -> Result<Option<PathBuf>, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    Ok(Some(app_data_dir.join(TELEGRAM_ATTACHMENTS_DIR)))
}

async fn fetch_file_info(
    client: &Client,
    token: &str,
    file_id: &str,
) -> Result<TelegramFileInfo, String> {
    let url = format!("https://api.telegram.org/bot{}/getFile", token);
    let response = client
        .post(&url)
        .json(&serde_json::json!({ "file_id": file_id }))
        .send()
        .await
        .map_err(|e| format!("Telegram getFile failed: {}", e))?;

    let payload = response
        .json::<TelegramFileInfoResponse>()
        .await
        .map_err(|e| format!("Failed to parse getFile response: {}", e))?;

    if !payload.ok {
        let description = payload
            .description
            .unwrap_or_else(|| "Telegram getFile returned ok=false".to_string());
        return Err(description);
    }

    payload
        .result
        .ok_or_else(|| "Telegram getFile returned empty result".to_string())
}

async fn download_file(client: &Client, token: &str, file_path: &str) -> Result<Bytes, String> {
    let url = format!("https://api.telegram.org/file/bot{}/{}", token, file_path);
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Telegram download failed: {}", e))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("Telegram download failed: status {}", status));
    }
    response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read file bytes: {}", e))
}

fn sanitize_filename(value: &str) -> String {
    let mut sanitized = value.replace(['/', '\\'], "_");
    while sanitized.contains("..") {
        sanitized = sanitized.replace("..", "_");
    }
    sanitized
}

fn build_attachment_filename(
    prefix: &str,
    original_name: Option<&str>,
    unique_id: &str,
    suffix: &str,
) -> String {
    let base = original_name
        .map(sanitize_filename)
        .unwrap_or_else(|| format!("{}-{}", prefix, suffix));
    let name = if base.contains('.') {
        format!("{}-{}", base, unique_id)
    } else {
        format!("{}-{}.bin", base, unique_id)
    };
    name
}

async fn build_message_payload(
    client: &Client,
    token: &str,
    message: &TelegramMessage,
    attachments_dir: Option<&PathBuf>,
) -> Result<(String, Vec<TelegramRemoteAttachment>), String> {
    let mut text_parts: Vec<String> = Vec::new();
    let mut attachments: Vec<TelegramRemoteAttachment> = Vec::new();

    if let Some(text) = message.text.as_ref() {
        text_parts.push(text.clone());
    }

    if let Some(caption) = message.caption.as_ref() {
        text_parts.push(caption.clone());
    }

    let Some(attachments_dir) = attachments_dir else {
        return Ok((text_parts.join("\n"), attachments));
    };

    if let Some(photos) = message.photo.as_ref() {
        if let Some(photo) = photos
            .iter()
            .max_by_key(|entry| entry.file_size.unwrap_or(0))
        {
            let file_info = fetch_file_info(client, token, &photo.file_id).await?;
            if let Some(file_path) = file_info.file_path.as_ref() {
                let size = file_info.file_size.unwrap_or(0);
                if size <= MAX_TELEGRAM_MEDIA_BYTES {
                    let bytes = download_file(client, token, file_path).await?;
                    let filename = build_attachment_filename(
                        TELEGRAM_MEDIA_PREFIX,
                        Some(&format!("photo-{}", photo.file_unique_id)),
                        &photo.file_unique_id,
                        "photo",
                    );
                    let saved_path = save_attachment_file(attachments_dir, &filename, bytes).await;
                    if let Ok(path) = saved_path {
                        attachments.push(TelegramRemoteAttachment {
                            id: photo.file_unique_id.clone(),
                            attachment_type: "image".to_string(),
                            file_path: path,
                            filename,
                            mime_type: "image/jpeg".to_string(),
                            size,
                            duration_seconds: None,
                            caption: None,
                        });
                    }
                }
            }
        }
    }

    if let Some(voice) = message.voice.as_ref() {
        let file_info = fetch_file_info(client, token, &voice.file_id).await?;
        if let Some(file_path) = file_info.file_path.as_ref() {
            let size = file_info.file_size.unwrap_or(0);
            if size <= MAX_TELEGRAM_MEDIA_BYTES {
                let bytes = download_file(client, token, file_path).await?;
                let filename = build_attachment_filename(
                    TELEGRAM_MEDIA_PREFIX,
                    Some(&format!("voice-{}", voice.file_unique_id)),
                    &voice.file_unique_id,
                    "voice",
                );
                let saved_path = save_attachment_file(attachments_dir, &filename, bytes).await;
                if let Ok(path) = saved_path {
                    attachments.push(TelegramRemoteAttachment {
                        id: voice.file_unique_id.clone(),
                        attachment_type: "voice".to_string(),
                        file_path: path,
                        filename,
                        mime_type: voice
                            .mime_type
                            .clone()
                            .unwrap_or_else(|| "audio/ogg".to_string()),
                        size,
                        duration_seconds: voice.duration,
                        caption: None,
                    });
                }
            }
        }
    }

    if let Some(audio) = message.audio.as_ref() {
        let file_info = fetch_file_info(client, token, &audio.file_id).await?;
        if let Some(file_path) = file_info.file_path.as_ref() {
            let size = file_info.file_size.unwrap_or(0);
            if size <= MAX_TELEGRAM_MEDIA_BYTES {
                let bytes = download_file(client, token, file_path).await?;
                let filename = build_attachment_filename(
                    TELEGRAM_MEDIA_PREFIX,
                    audio.file_name.as_deref(),
                    &audio.file_unique_id,
                    "audio",
                );
                let saved_path = save_attachment_file(attachments_dir, &filename, bytes).await;
                if let Ok(path) = saved_path {
                    attachments.push(TelegramRemoteAttachment {
                        id: audio.file_unique_id.clone(),
                        attachment_type: "audio".to_string(),
                        file_path: path,
                        filename,
                        mime_type: audio
                            .mime_type
                            .clone()
                            .unwrap_or_else(|| "audio/mpeg".to_string()),
                        size,
                        duration_seconds: audio.duration,
                        caption: None,
                    });
                }
            }
        }
    }

    if let Some(document) = message.document.as_ref() {
        let file_info = fetch_file_info(client, token, &document.file_id).await?;
        if let Some(file_path) = file_info.file_path.as_ref() {
            let size = file_info.file_size.unwrap_or(0);
            if size <= MAX_TELEGRAM_MEDIA_BYTES {
                let bytes = download_file(client, token, file_path).await?;
                let filename = build_attachment_filename(
                    TELEGRAM_MEDIA_PREFIX,
                    document.file_name.as_deref(),
                    &document.file_unique_id,
                    "document",
                );
                let saved_path = save_attachment_file(attachments_dir, &filename, bytes).await;
                if let Ok(path) = saved_path {
                    attachments.push(TelegramRemoteAttachment {
                        id: document.file_unique_id.clone(),
                        attachment_type: "file".to_string(),
                        file_path: path,
                        filename,
                        mime_type: document
                            .mime_type
                            .clone()
                            .unwrap_or_else(|| "application/octet-stream".to_string()),
                        size,
                        duration_seconds: None,
                        caption: None,
                    });
                }
            }
        }
    }

    Ok((text_parts.join("\n"), attachments))
}

#[derive(Debug, Deserialize, Serialize)]
struct TelegramGetUpdatesRequest {
    pub offset: Option<i64>,
    pub timeout: Option<i64>,
    pub allowed_updates: Option<Vec<String>>,
}

#[derive(Debug, Deserialize, Serialize)]
struct TelegramGetUpdatesResponse {
    pub ok: bool,
    pub result: Vec<TelegramUpdate>,
    pub description: Option<String>,
    pub error_code: Option<i64>,
    pub parameters: Option<TelegramResponseParameters>,
}

#[derive(Debug, Deserialize, Serialize)]
struct TelegramResponseParameters {
    #[serde(rename = "retry_after")]
    pub retry_after_secs: Option<u64>,
}

#[derive(Debug, Deserialize, Serialize)]
struct TelegramUpdate {
    pub update_id: i64,
    pub message: Option<TelegramMessage>,
}

#[derive(Debug, Deserialize, Serialize)]
struct TelegramMessage {
    pub message_id: i64,
    pub date: i64,
    pub text: Option<String>,
    pub caption: Option<String>,
    pub chat: TelegramChat,
    pub from: Option<TelegramUser>,
    pub photo: Option<Vec<TelegramPhotoSize>>,
    pub voice: Option<TelegramVoice>,
    pub audio: Option<TelegramAudio>,
    pub document: Option<TelegramDocument>,
}

#[derive(Debug, Deserialize, Serialize)]
struct TelegramChat {
    pub id: i64,
    #[serde(rename = "type")]
    pub chat_type: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
struct TelegramUser {
    pub username: Option<String>,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
struct TelegramPhotoSize {
    pub file_id: String,
    pub file_unique_id: String,
    pub file_size: Option<u64>,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Deserialize, Serialize)]
struct TelegramVoice {
    pub file_id: String,
    pub file_unique_id: String,
    pub file_size: Option<u64>,
    pub duration: Option<u32>,
    pub mime_type: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
struct TelegramAudio {
    pub file_id: String,
    pub file_unique_id: String,
    pub file_size: Option<u64>,
    pub duration: Option<u32>,
    pub mime_type: Option<String>,
    pub file_name: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
struct TelegramDocument {
    pub file_id: String,
    pub file_unique_id: String,
    pub file_size: Option<u64>,
    pub mime_type: Option<String>,
    pub file_name: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
struct TelegramFileInfo {
    pub file_id: String,
    pub file_unique_id: String,
    pub file_size: Option<u64>,
    pub file_path: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
struct TelegramFileInfoResponse {
    pub ok: bool,
    pub result: Option<TelegramFileInfo>,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
struct TelegramSendMessageResult {
    pub message_id: i64,
}

#[derive(Debug, Deserialize, Serialize)]
struct TelegramSendMessageResponseWrapper {
    pub ok: bool,
    pub result: Option<TelegramSendMessageResult>,
    pub description: Option<String>,
    pub error_code: Option<i64>,
    pub parameters: Option<TelegramResponseParameters>,
}

#[cfg(test)]
mod filename_tests {
    use super::build_attachment_filename;

    #[test]
    fn sanitizes_attachment_filename() {
        let name = build_attachment_filename(
            "telegram",
            Some("..\\..\\secret/evil.txt"),
            "unique",
            "document",
        );
        assert!(!name.contains("/"));
        assert!(!name.contains("\\"));
        assert!(!name.contains(".."));
        assert!(name.contains("unique"));
        assert!(name.ends_with(".txt-unique") || name.ends_with(".txt-unique.bin"));
    }

    #[test]
    fn adds_unique_suffix_for_named_files() {
        let name =
            build_attachment_filename("telegram", Some("report.pdf"), "file-abc", "document");
        assert!(name.contains("file-abc"));
        assert!(name.ends_with("report.pdf-file-abc"));
    }
}

#[tauri::command]
pub async fn telegram_get_config(
    app_handle: AppHandle,
    state: State<'_, TelegramGatewayState>,
) -> Result<TelegramConfig, String> {
    let config = load_config(&app_handle).await?;
    let state_snapshot = load_state(&app_handle)
        .await
        .unwrap_or(TelegramGatewayStateSnapshot {
            version: TELEGRAM_STATE_VERSION,
            last_update_id: None,
        });
    let mut gateway = state.lock().await;
    gateway.config = config.clone();
    gateway.last_update_id = state_snapshot.last_update_id;

    Ok(config)
}

#[tauri::command]
pub async fn telegram_set_config(
    app_handle: AppHandle,
    state: State<'_, TelegramGatewayState>,
    mut config: TelegramConfig,
) -> Result<(), String> {
    sanitize_allowed_chat_ids(&mut config.allowed_chat_ids);
    save_config(&app_handle, &config).await?;
    let mut gateway = state.lock().await;
    gateway.config = config.clone();
    drop(gateway);

    if config.enabled && !config.token.is_empty() {
        log::info!(
            "[TelegramGateway] Config updated (enabled={}, allowed_chat_ids={}, poll_timeout_secs={})",
            config.enabled,
            config.allowed_chat_ids.len(),
            config.poll_timeout_secs
        );
        let _ = start_gateway(app_handle, state.inner().clone()).await;
    }

    Ok(())
}

pub async fn start_gateway(
    app_handle: AppHandle,
    state: TelegramGatewayState,
) -> Result<(), String> {
    let (config, running, last_update_id) = {
        let gateway = state.lock().await;
        (
            gateway.config.clone(),
            gateway.running,
            gateway.last_update_id,
        )
    };

    if running {
        log::info!("[TelegramGateway] Start requested but already running");
        return Ok(());
    }

    if config.token.is_empty() {
        return Err("Telegram bot token is not configured".to_string());
    }

    log::info!(
        "[TelegramGateway] Starting gateway (allowed_chat_ids={}, poll_timeout_secs={})",
        config.allowed_chat_ids.len(),
        config.poll_timeout_secs
    );

    let (stop_tx, stop_rx) = watch::channel(false);
    let state_snapshot = load_state(&app_handle)
        .await
        .unwrap_or(TelegramGatewayStateSnapshot {
            version: TELEGRAM_STATE_VERSION,
            last_update_id: last_update_id,
        });

    {
        let mut gateway = state.lock().await;
        gateway.running = true;
        gateway.stop_tx = Some(stop_tx);
        gateway.last_update_id = state_snapshot.last_update_id;
        gateway.last_poll_at_ms = None;
        gateway.last_error = None;
        gateway.last_error_at_ms = None;
        gateway.backoff_ms = DEFAULT_ERROR_BACKOFF_MS;
    }

    let state_clone = state.clone();
    tauri::async_runtime::spawn(async move {
        poll_loop(app_handle, state_clone, stop_rx).await;
    });

    Ok(())
}

#[tauri::command]
pub async fn telegram_start(
    app_handle: AppHandle,
    state: State<'_, TelegramGatewayState>,
) -> Result<(), String> {
    start_gateway(app_handle, state.inner().clone()).await
}

#[tauri::command]
pub async fn telegram_stop(state: State<'_, TelegramGatewayState>) -> Result<(), String> {
    let mut gateway = state.lock().await;
    if let Some(stop_tx) = gateway.stop_tx.take() {
        let _ = stop_tx.send(true);
    }
    gateway.running = false;
    log::info!("[TelegramGateway] Stop requested");
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramGatewayStatus {
    pub running: bool,
    pub last_update_id: Option<i64>,
    pub last_poll_at_ms: Option<i64>,
    pub last_error: Option<String>,
    pub last_error_at_ms: Option<i64>,
    pub backoff_ms: u64,
}

#[tauri::command]
pub async fn telegram_get_status(
    state: State<'_, TelegramGatewayState>,
) -> Result<TelegramGatewayStatus, String> {
    let gateway = state.lock().await;
    Ok(TelegramGatewayStatus {
        running: gateway.running,
        last_update_id: gateway.last_update_id,
        last_poll_at_ms: gateway.last_poll_at_ms,
        last_error: gateway.last_error.clone(),
        last_error_at_ms: gateway.last_error_at_ms,
        backoff_ms: gateway.backoff_ms,
    })
}

#[tauri::command]
pub async fn telegram_is_running(state: State<'_, TelegramGatewayState>) -> Result<bool, String> {
    let gateway = state.lock().await;
    Ok(gateway.running)
}

#[tauri::command]
pub async fn telegram_send_message(
    state: State<'_, TelegramGatewayState>,
    request: TelegramSendMessageRequest,
) -> Result<TelegramSendMessageResponse, String> {
    let config = {
        let gateway = state.lock().await;
        gateway.config.clone()
    };

    if config.token.is_empty() {
        return Err("Telegram bot token is not configured".to_string());
    }

    let client = Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| format!("Failed to build http client: {}", e))?;

    let url = format!("https://api.telegram.org/bot{}/sendMessage", config.token);
    // Telegram API doesn't accept 'plain' as parse_mode, so we filter it out
    let parse_mode = request
        .parse_mode
        .filter(|mode| mode != "plain")
        .map(|mode| mode.to_string());

    log::debug!(
        "[TelegramGateway] sendMessage chat_id={} text_len={} reply_to={:?} parse_mode={:?}",
        request.chat_id,
        request.text.len(),
        request.reply_to_message_id,
        parse_mode
    );
    let mut payload = serde_json::json!({
        "chat_id": request.chat_id,
        "text": request.text,
        "reply_to_message_id": request.reply_to_message_id,
        "disable_web_page_preview": request.disable_web_page_preview.unwrap_or(true),
    });

    if let Some(mode) = parse_mode {
        payload
            .as_object_mut()
            .unwrap()
            .insert("parse_mode".to_string(), serde_json::json!(mode));
    }

    let response = client
        .post(&url)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Telegram sendMessage failed: {}", e))?;

    let payload = response
        .json::<TelegramSendMessageResponseWrapper>()
        .await
        .map_err(|e| format!("Failed to parse sendMessage response: {}", e))?;

    if !payload.ok {
        let description = payload
            .description
            .unwrap_or_else(|| "Telegram sendMessage returned ok=false".to_string());
        return Err(description);
    }

    let message_id = payload.result.map(|result| result.message_id).unwrap_or(0);

    Ok(TelegramSendMessageResponse { message_id })
}

#[tauri::command]
pub async fn telegram_edit_message(
    state: State<'_, TelegramGatewayState>,
    request: TelegramEditMessageRequest,
) -> Result<(), String> {
    let config = {
        let gateway = state.lock().await;
        gateway.config.clone()
    };

    if config.token.is_empty() {
        return Err("Telegram bot token is not configured".to_string());
    }

    let client = Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| format!("Failed to build http client: {}", e))?;

    let url = format!(
        "https://api.telegram.org/bot{}/editMessageText",
        config.token
    );
    log::debug!(
        "[TelegramGateway] editMessage chat_id={} message_id={} text_len={}",
        request.chat_id,
        request.message_id,
        request.text.len()
    );
    // Telegram API doesn't accept 'plain' as parse_mode, so we filter it out
    let parse_mode = request
        .parse_mode
        .filter(|mode| mode != "plain")
        .map(|mode| mode.to_string());
    let mut payload = serde_json::json!({
        "chat_id": request.chat_id,
        "message_id": request.message_id,
        "text": request.text,
        "disable_web_page_preview": request.disable_web_page_preview.unwrap_or(true),
    });

    if let Some(mode) = parse_mode {
        payload
            .as_object_mut()
            .unwrap()
            .insert("parse_mode".to_string(), serde_json::json!(mode));
    }

    let response = client
        .post(&url)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Telegram editMessageText failed: {}", e))?;

    let payload = response
        .json::<TelegramSendMessageResponseWrapper>()
        .await
        .map_err(|e| format!("Failed to parse editMessageText response: {}", e))?;

    if !payload.ok {
        let description = payload
            .description
            .unwrap_or_else(|| "Telegram editMessageText returned ok=false".to_string());
        return Err(description);
    }

    Ok(())
}

pub fn default_state() -> TelegramGatewayState {
    Arc::new(Mutex::new(TelegramGateway::new()))
}

#[cfg(test)]
mod tests {
    use super::{
        load_state, sanitize_allowed_chat_ids, save_state, TelegramGatewayStateSnapshot,
        TELEGRAM_STATE_VERSION,
    };
    use tauri::test::mock_app;

    /// This test uses Tauri test infrastructure that may not work on Windows CI
    #[tokio::test]
    #[cfg(not(target_os = "windows"))]
    async fn state_persists_last_update_id() {
        let app = mock_app();
        let snapshot = TelegramGatewayStateSnapshot {
            version: TELEGRAM_STATE_VERSION,
            last_update_id: Some(42),
        };

        save_state(&app.handle(), &snapshot)
            .await
            .expect("save_state should succeed");

        let reloaded = load_state(&app.handle())
            .await
            .expect("load_state should succeed");

        assert_eq!(reloaded.last_update_id, Some(42));
    }

    #[test]
    fn sanitize_allowed_chat_ids_drops_zero() {
        let mut ids = vec![0, 123, 0, 456];
        sanitize_allowed_chat_ids(&mut ids);
        assert_eq!(ids, vec![123, 456]);
    }
}
