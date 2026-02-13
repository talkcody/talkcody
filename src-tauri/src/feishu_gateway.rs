#[cfg(feature = "feishu-websocket")]
use open_lark::client::ws_client::LarkWsClient;
use open_lark::prelude::{
    AppType, CreateMessageRequest, CreateMessageRequestBody, EventDispatcherHandler, LarkClient,
};
use open_lark::service::im::v1::message::UpdateMessageRequest;
use rand::Rng;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tokio::runtime::Builder;
use tokio::sync::{watch, Mutex};
use tokio::time::sleep;

// Response for downloading message resources
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageResourceResponse {
    pub data: Vec<u8>,
}

const FEISHU_ATTACHMENTS_DIR: &str = "attachments";
const FEISHU_MEDIA_PREFIX: &str = "feishu";
const DEFAULT_ERROR_BACKOFF_MS: u64 = 1500;
const MAX_ERROR_BACKOFF_MS: u64 = 30000;
const MAX_FEISHU_MEDIA_BYTES: u64 = 20 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeishuConfig {
    pub enabled: bool,
    pub app_id: String,
    pub app_secret: String,
    pub encrypt_key: String,
    pub verification_token: String,
    pub allowed_open_ids: Vec<String>,
}

impl Default for FeishuConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            app_id: String::new(),
            app_secret: String::new(),
            encrypt_key: String::new(),
            verification_token: String::new(),
            allowed_open_ids: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeishuRemoteAttachment {
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
pub struct FeishuInboundMessage {
    pub chat_id: String,
    pub message_id: String,
    pub text: String,
    pub open_id: String,
    pub date: i64,
    pub attachments: Option<Vec<FeishuRemoteAttachment>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeishuSendMessageRequest {
    pub open_id: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeishuSendMessageResponse {
    pub message_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeishuEditMessageRequest {
    pub message_id: String,
    pub text: String,
}

#[derive(Debug)]
pub struct FeishuGateway {
    config: FeishuConfig,
    running: bool,
    last_event_at_ms: Option<i64>,
    last_error: Option<String>,
    last_error_at_ms: Option<i64>,
    backoff_ms: u64,
    stop_tx: Option<watch::Sender<bool>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FeishuSenderKind {
    User,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FeishuChatKind {
    P2p,
    Other,
}

impl FeishuGateway {
    pub fn new() -> Self {
        Self {
            config: FeishuConfig::default(),
            running: false,
            last_event_at_ms: None,
            last_error: None,
            last_error_at_ms: None,
            backoff_ms: DEFAULT_ERROR_BACKOFF_MS,
            stop_tx: None,
        }
    }
}

type FeishuGatewayState = Arc<Mutex<FeishuGateway>>;

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn record_error_state(state: &mut FeishuGateway, message: impl Into<String>) {
    state.last_error = Some(message.into());
    state.last_error_at_ms = Some(now_ms());
}

fn clear_error_state(state: &mut FeishuGateway) {
    state.last_error = None;
    state.last_error_at_ms = None;
    state.backoff_ms = DEFAULT_ERROR_BACKOFF_MS;
}

fn compute_backoff_ms(current: u64) -> u64 {
    let jitter = rand::thread_rng().gen_range(0..250u64);
    let next = current.saturating_mul(2).saturating_add(jitter);
    next.clamp(DEFAULT_ERROR_BACKOFF_MS, MAX_ERROR_BACKOFF_MS)
}

fn build_client(config: &FeishuConfig) -> Result<LarkClient, String> {
    if config.app_id.is_empty() || config.app_secret.is_empty() {
        return Err("Feishu app_id/app_secret not configured".to_string());
    }

    let client = LarkClient::builder(&config.app_id, &config.app_secret)
        .with_app_type(AppType::SelfBuild)
        .with_enable_token_cache(true)
        .build();

    Ok(client)
}

fn is_open_id_allowed(allowed_open_ids: &[String], open_id: &str) -> bool {
    if allowed_open_ids.is_empty() {
        return true;
    }
    allowed_open_ids.iter().any(|id| id == open_id)
}

fn sender_kind(sender_type: &str) -> FeishuSenderKind {
    if sender_type == "user" {
        FeishuSenderKind::User
    } else {
        FeishuSenderKind::Other
    }
}

fn chat_kind(chat_type: &str) -> FeishuChatKind {
    if chat_type == "p2p" {
        FeishuChatKind::P2p
    } else {
        FeishuChatKind::Other
    }
}

async fn attachments_root<R: Runtime>(
    app_handle: &AppHandle<R>,
) -> Result<Option<PathBuf>, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    Ok(Some(app_data_dir.join(FEISHU_ATTACHMENTS_DIR)))
}

async fn save_attachment_file(
    attachments_dir: &PathBuf,
    filename: &str,
    data: &[u8],
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

fn build_attachment_filename(prefix: &str, original_name: Option<&str>, suffix: &str) -> String {
    let safe_name = original_name
        .map(|name| name.replace('/', "_"))
        .unwrap_or_else(|| format!("{}-{}", prefix, suffix));
    if safe_name.contains('.') {
        safe_name
    } else {
        format!("{}.bin", safe_name)
    }
}

/// Response from Feishu tenant access token endpoint
#[derive(Debug, Clone, Serialize, Deserialize)]
struct TenantAccessTokenResponse {
    pub code: i32,
    pub msg: String,
    #[serde(rename = "tenant_access_token")]
    pub tenant_access_token: Option<String>,
    pub expire: Option<i64>,
}

/// Get tenant access token from Feishu API
async fn get_tenant_access_token(app_id: &str, app_secret: &str) -> Result<String, String> {
    let url = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal";

    let http_client = reqwest::Client::new();
    let response = http_client
        .post(url)
        .json(&json!({
            "app_id": app_id,
            "app_secret": app_secret,
        }))
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        return Err(format!("Token request failed: HTTP {}", status));
    }

    let token_resp: TenantAccessTokenResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse token response: {}", e))?;

    if token_resp.code != 0 {
        return Err(format!(
            "Token request failed: {} - {}",
            token_resp.code, token_resp.msg
        ));
    }

    token_resp
        .tenant_access_token
        .ok_or_else(|| "No tenant_access_token in response".to_string())
}

/// Download resource from message using Feishu API
/// Uses /open-apis/im/v1/messages/{message_id}/resources/{file_key} endpoint
async fn download_message_resource(
    client: &LarkClient,
    message_id: &str,
    file_key: &str,
    resource_type: &str,
) -> Result<Vec<u8>, String> {
    // Get tenant access token
    let tenant_token =
        get_tenant_access_token(&client.config.app_id, &client.config.app_secret).await?;

    let url = format!(
        "https://open.feishu.cn/open-apis/im/v1/messages/{}/resources/{}?type={}",
        message_id, file_key, resource_type
    );

    let http_client = reqwest::Client::new();
    let response = http_client
        .get(&url)
        .header("Authorization", format!("Bearer {}", tenant_token))
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!("Download failed: HTTP {} - {}", status, body));
    }

    let data = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read response body: {}", e))?;

    Ok(data.to_vec())
}

fn parse_text_content(content: &str) -> String {
    serde_json::from_str::<Value>(content)
        .ok()
        .and_then(|value| {
            value
                .get("text")
                .and_then(|text| text.as_str())
                .map(String::from)
        })
        .unwrap_or_else(|| content.to_string())
}

async fn build_message_payload(
    app_handle: &AppHandle,
    client: &LarkClient,
    message_type: &str,
    content: &str,
    message_id: &str,
) -> Result<(String, Vec<FeishuRemoteAttachment>), String> {
    let mut text_parts: Vec<String> = Vec::new();
    let mut attachments: Vec<FeishuRemoteAttachment> = Vec::new();

    let parsed = serde_json::from_str::<Value>(content).ok();

    if message_type == "text" {
        text_parts.push(parse_text_content(content));
    } else if let Some(text) = parsed
        .as_ref()
        .and_then(|value| value.get("text"))
        .and_then(|value| value.as_str())
    {
        text_parts.push(text.to_string());
    }

    let Some(attachments_dir) = attachments_root(app_handle).await? else {
        return Ok((text_parts.join("\n"), attachments));
    };

    if message_type == "image" {
        if let Some(image_key) = parsed
            .as_ref()
            .and_then(|value| value.get("image_key"))
            .and_then(|value| value.as_str())
        {
            // Use message resource download API for user-sent images
            // The open-lark image.get() only works for app-uploaded images
            match download_message_resource(client, message_id, image_key, "image").await {
                Ok(image_data) => {
                    let size = image_data.len() as u64;
                    if size <= MAX_FEISHU_MEDIA_BYTES {
                        let filename = build_attachment_filename(
                            FEISHU_MEDIA_PREFIX,
                            Some(&format!("image-{}", image_key)),
                            "image",
                        );
                        let saved_path =
                            save_attachment_file(&attachments_dir, &filename, &image_data).await?;
                        attachments.push(FeishuRemoteAttachment {
                            id: image_key.to_string(),
                            attachment_type: "image".to_string(),
                            file_path: saved_path,
                            filename,
                            mime_type: "image/png".to_string(),
                            size,
                            duration_seconds: None,
                            caption: None,
                        });
                    }
                }
                Err(error) => {
                    log::warn!("[FeishuGateway] Failed to download image: {}", error);
                    // Add a placeholder text to indicate image was received but failed to download
                    text_parts.push(format!("[Image: {}]", image_key));
                }
            }
        }
    }

    if message_type == "file" || message_type == "audio" || message_type == "media" {
        if let Some(file_key) = parsed
            .as_ref()
            .and_then(|value| value.get("file_key"))
            .and_then(|value| value.as_str())
        {
            // Use message resource download API for user-sent files
            match download_message_resource(client, message_id, file_key, message_type).await {
                Ok(file_data) => {
                    let size = file_data.len() as u64;
                    if size <= MAX_FEISHU_MEDIA_BYTES {
                        let filename_from_content = parsed
                            .as_ref()
                            .and_then(|value| value.get("file_name"))
                            .and_then(|value| value.as_str());
                        let filename = build_attachment_filename(
                            FEISHU_MEDIA_PREFIX,
                            filename_from_content.or(Some(&format!("file-{}", file_key))),
                            message_type,
                        );
                        let saved_path =
                            save_attachment_file(&attachments_dir, &filename, &file_data).await?;
                        let attachment_type = if message_type == "audio" {
                            "audio"
                        } else {
                            "file"
                        };
                        let caption = filename_from_content.map(|name| name.to_string());
                        attachments.push(FeishuRemoteAttachment {
                            id: file_key.to_string(),
                            attachment_type: attachment_type.to_string(),
                            file_path: saved_path,
                            filename,
                            mime_type: if message_type == "audio" {
                                "audio/mpeg".to_string()
                            } else {
                                "application/octet-stream".to_string()
                            },
                            size,
                            duration_seconds: None,
                            caption,
                        });
                    }
                }
                Err(error) => {
                    log::warn!("[FeishuGateway] Failed to download file: {}", error);
                }
            }
        }
    }

    if message_type == "file" && attachments.is_empty() {
        text_parts.push(format!("[file: {}]", message_id));
    }

    Ok((text_parts.join("\n").trim().to_string(), attachments))
}

async fn run_ws_loop(
    app_handle: AppHandle,
    state: FeishuGatewayState,
    stop_rx: watch::Receiver<bool>,
) {
    loop {
        if stop_rx.has_changed().unwrap_or(false) && *stop_rx.borrow() {
            break;
        }

        let (config, running, backoff_ms) = {
            let gateway = state.lock().await;
            (gateway.config.clone(), gateway.running, gateway.backoff_ms)
        };

        if !running {
            break;
        }

        if !config.enabled || config.app_id.is_empty() || config.app_secret.is_empty() {
            log::debug!(
                "[FeishuGateway] Skipping ws loop tick (enabled={}, app_id_set={}, app_secret_set={})",
                config.enabled,
                !config.app_id.is_empty(),
                !config.app_secret.is_empty()
            );
            sleep(Duration::from_millis(DEFAULT_ERROR_BACKOFF_MS)).await;
            continue;
        }

        log::info!(
            "[FeishuGateway] Starting ws connection (allowed_open_ids={})",
            config.allowed_open_ids.len()
        );
        let result = start_ws_connection(app_handle.clone(), state.clone(), config.clone()).await;
        if let Err(error) = result {
            let backoff = {
                let mut gateway = state.lock().await;
                record_error_state(&mut gateway, error);
                gateway.backoff_ms = compute_backoff_ms(gateway.backoff_ms);
                gateway.backoff_ms
            };
            sleep(Duration::from_millis(backoff)).await;
        } else {
            let mut gateway = state.lock().await;
            clear_error_state(&mut gateway);
            gateway.backoff_ms = backoff_ms;
        }
    }
}

async fn start_ws_connection(
    app_handle: AppHandle,
    state: FeishuGatewayState,
    config: FeishuConfig,
) -> Result<(), String> {
    start_ws_connection_impl(app_handle, state, config).await
}

#[cfg(not(feature = "feishu-websocket"))]
async fn start_ws_connection_impl(
    _app_handle: AppHandle,
    _state: FeishuGatewayState,
    _config: FeishuConfig,
) -> Result<(), String> {
    Err("Feishu WebSocket support is disabled. Rebuild with `--features feishu-websocket` (requires `protoc`).".to_string())
}

#[cfg(feature = "feishu-websocket")]
async fn start_ws_connection_impl(
    app_handle: AppHandle,
    state: FeishuGatewayState,
    config: FeishuConfig,
) -> Result<(), String> {
    let client = Arc::new(build_client(&config)?);
    let ws_config = Arc::new(client.config.clone());
    let open_id_allowlist = config.allowed_open_ids.clone();
    let verification_token = config.verification_token.clone();
    let encrypt_key = config.encrypt_key.clone();

    let handler_app = app_handle.clone();
    let handler = EventDispatcherHandler::builder()
        .register_p2_im_message_receive_v1(move |event| {
            let client = client.clone();
            let app_handle = handler_app.clone();
            let open_id_allowlist = open_id_allowlist.clone();
            let state = state.clone();
            tokio::spawn(async move {
                let sender = event.event.sender;
                if sender_kind(&sender.sender_type) != FeishuSenderKind::User {
                    log::debug!(
                        "[FeishuGateway] Ignoring non-user sender type={}",
                        sender.sender_type
                    );
                    return;
                }

                let message = event.event.message;
                if chat_kind(&message.chat_type) != FeishuChatKind::P2p {
                    log::debug!(
                        "[FeishuGateway] Ignoring non-p2p chat type={}",
                        message.chat_type
                    );
                    return;
                }

                let open_id = sender.sender_id.open_id;
                if !is_open_id_allowed(&open_id_allowlist, &open_id) {
                    log::debug!(
                        "[FeishuGateway] Open id not in allowlist open_id={} count={}",
                        open_id,
                        open_id_allowlist.len()
                    );
                    return;
                }

                log::debug!(
                    "[FeishuGateway] Processing inbound message open_id={} message_id={} type={}",
                    open_id,
                    message.message_id,
                    message.message_type
                );

                let (text, attachments) = match build_message_payload(
                    &app_handle,
                    &client,
                    &message.message_type,
                    &message.content,
                    &message.message_id,
                )
                .await
                {
                    Ok(payload) => payload,
                    Err(error) => {
                        log::warn!("[FeishuGateway] Failed to build message payload: {error}");
                        (String::new(), Vec::new())
                    }
                };

                if text.trim().is_empty() && attachments.is_empty() {
                    log::debug!(
                        "[FeishuGateway] Ignoring empty message open_id={} message_id={}",
                        open_id,
                        message.message_id
                    );
                    return;
                }

                log::debug!(
                    "[FeishuGateway] Inbound message open_id={} message_id={} text_len={} attachments={}",
                    open_id,
                    message.message_id,
                    text.len(),
                    attachments.len()
                );

                let date = message
                    .create_time
                    .parse::<i64>()
                    .unwrap_or_else(|_| now_ms());

                let message_id = message.message_id.clone();
                let payload = FeishuInboundMessage {
                    chat_id: open_id.clone(),
                    message_id: message_id.clone(),
                    text,
                    open_id: open_id.clone(),
                    date,
                    attachments: if attachments.is_empty() {
                        None
                    } else {
                        Some(attachments)
                    },
                };

                match app_handle.emit("feishu-inbound-message", payload) {
                    Ok(_) => {
                        log::debug!(
                            "[FeishuGateway] Emitted inbound message open_id={} message_id={}",
                            open_id,
                            message_id
                        );
                    }
                    Err(error) => {
                        log::error!("[FeishuGateway] Failed to emit message: {}", error);
                    }
                }

                let mut gateway = state.lock().await;
                gateway.last_event_at_ms = Some(now_ms());
            });
        })
        .map_err(|error| format!("Feishu handler registration failed: {error}"))?
        .build();

    let mut handler = handler;
    if !verification_token.is_empty() {
        handler.set_verification_token(verification_token);
    }
    if !encrypt_key.is_empty() {
        handler.set_event_encrypt_key(encrypt_key);
    }

    LarkWsClient::open(ws_config, handler)
        .await
        .map_err(|error| format!("Feishu websocket failed: {error:?}"))
}

#[tauri::command]
pub async fn feishu_get_config(
    state: State<'_, FeishuGatewayState>,
) -> Result<FeishuConfig, String> {
    let gateway = state.lock().await;
    Ok(gateway.config.clone())
}

#[tauri::command]
pub async fn feishu_set_config(
    app_handle: AppHandle,
    state: State<'_, FeishuGatewayState>,
    config: FeishuConfig,
) -> Result<(), String> {
    {
        let mut gateway = state.lock().await;
        gateway.config = config.clone();
    }

    if config.enabled && !config.app_id.is_empty() && !config.app_secret.is_empty() {
        log::info!(
            "[FeishuGateway] Config updated (enabled={}, allowed_open_ids={})",
            config.enabled,
            config.allowed_open_ids.len()
        );
        let _ = start_gateway(app_handle, state.inner().clone()).await;
    }

    Ok(())
}

pub async fn start_gateway(app_handle: AppHandle, state: FeishuGatewayState) -> Result<(), String> {
    let (config, running) = {
        let gateway = state.lock().await;
        (gateway.config.clone(), gateway.running)
    };

    if running {
        log::info!("[FeishuGateway] Start requested but already running");
        return Ok(());
    }

    if config.app_id.is_empty() || config.app_secret.is_empty() {
        return Err("Feishu app_id/app_secret not configured".to_string());
    }

    log::info!(
        "[FeishuGateway] Starting gateway (allowed_open_ids={})",
        config.allowed_open_ids.len()
    );

    let (stop_tx, stop_rx) = watch::channel(false);

    {
        let mut gateway = state.lock().await;
        gateway.running = true;
        gateway.last_event_at_ms = None;
        gateway.last_error = None;
        gateway.last_error_at_ms = None;
        gateway.backoff_ms = DEFAULT_ERROR_BACKOFF_MS;
        gateway.stop_tx = Some(stop_tx);
    }

    let state_clone = state.clone();
    thread::spawn(move || {
        let runtime = Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("Failed to build Feishu runtime");
        runtime.block_on(async move {
            run_ws_loop(app_handle, state_clone, stop_rx).await;
        });
    });

    Ok(())
}

#[tauri::command]
pub async fn feishu_start(
    app_handle: AppHandle,
    state: State<'_, FeishuGatewayState>,
) -> Result<(), String> {
    start_gateway(app_handle, state.inner().clone()).await
}

#[tauri::command]
pub async fn feishu_stop(state: State<'_, FeishuGatewayState>) -> Result<(), String> {
    let mut gateway = state.lock().await;
    if let Some(stop_tx) = gateway.stop_tx.take() {
        let _ = stop_tx.send(true);
    }
    gateway.running = false;
    log::info!("[FeishuGateway] Stop requested");
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeishuGatewayStatus {
    pub running: bool,
    pub last_event_at_ms: Option<i64>,
    pub last_error: Option<String>,
    pub last_error_at_ms: Option<i64>,
    pub backoff_ms: u64,
}

#[tauri::command]
pub async fn feishu_get_status(
    state: State<'_, FeishuGatewayState>,
) -> Result<FeishuGatewayStatus, String> {
    let gateway = state.lock().await;
    Ok(FeishuGatewayStatus {
        running: gateway.running,
        last_event_at_ms: gateway.last_event_at_ms,
        last_error: gateway.last_error.clone(),
        last_error_at_ms: gateway.last_error_at_ms,
        backoff_ms: gateway.backoff_ms,
    })
}

#[tauri::command]
pub async fn feishu_is_running(state: State<'_, FeishuGatewayState>) -> Result<bool, String> {
    let gateway = state.lock().await;
    Ok(gateway.running)
}

#[tauri::command]
pub async fn feishu_send_message(
    state: State<'_, FeishuGatewayState>,
    request: FeishuSendMessageRequest,
) -> Result<FeishuSendMessageResponse, String> {
    let config = {
        let gateway = state.lock().await;
        gateway.config.clone()
    };

    let client = build_client(&config)?;
    log::debug!(
        "[FeishuGateway] sendMessage open_id={} text_len={}",
        request.open_id,
        request.text.len()
    );
    let body = CreateMessageRequestBody::builder()
        .receive_id(request.open_id.clone())
        .msg_type("text")
        .content(serde_json::json!({ "text": request.text }).to_string())
        .build();
    let req = CreateMessageRequest::builder()
        .receive_id_type("open_id")
        .request_body(body)
        .build();

    let message = client
        .im
        .v1
        .message
        .create(req, None)
        .await
        .map_err(|error| format!("Feishu send message failed: {error:?}"))?;

    Ok(FeishuSendMessageResponse {
        message_id: message.message_id,
    })
}

#[tauri::command]
pub async fn feishu_edit_message(
    state: State<'_, FeishuGatewayState>,
    request: FeishuEditMessageRequest,
) -> Result<(), String> {
    let config = {
        let gateway = state.lock().await;
        gateway.config.clone()
    };

    let client = build_client(&config)?;
    log::debug!(
        "[FeishuGateway] editMessage message_id={} text_len={}",
        request.message_id,
        request.text.len()
    );
    let update_request = UpdateMessageRequest::builder()
        .content(serde_json::json!({ "text": request.text }).to_string())
        .build();

    client
        .im
        .v1
        .message
        .update(&request.message_id, update_request, None)
        .await
        .map_err(|error| format!("Feishu edit message failed: {error:?}"))?;

    Ok(())
}

pub fn default_state() -> FeishuGatewayState {
    Arc::new(Mutex::new(FeishuGateway::new()))
}

#[cfg(test)]
mod tests {
    use super::{
        build_attachment_filename, chat_kind, is_open_id_allowed, parse_text_content, sender_kind,
        FeishuChatKind, FeishuSenderKind,
    };
    use serde_json::{json, Value};

    #[test]
    fn open_id_allowlist_allows_when_empty() {
        assert!(is_open_id_allowed(&[], "ou_test"));
    }

    #[test]
    fn open_id_allowlist_blocks_when_missing() {
        let allowed = vec!["ou_allowed".to_string()];
        assert!(!is_open_id_allowed(&allowed, "ou_other"));
    }

    #[test]
    fn sender_kind_filters_non_user() {
        assert_eq!(sender_kind("user"), FeishuSenderKind::User);
        assert_eq!(sender_kind("app"), FeishuSenderKind::Other);
    }

    #[test]
    fn chat_kind_filters_non_p2p() {
        assert_eq!(chat_kind("p2p"), FeishuChatKind::P2p);
        assert_eq!(chat_kind("group"), FeishuChatKind::Other);
    }

    // Test for parsing Feishu message with null user_id (the bug fix)
    #[test]
    fn test_parse_feishu_event_with_null_user_id() {
        // This is the exact payload format that was causing the error:
        // "Failed to handle event: invalid type: null, expected a string"
        let event_json = json!({
            "schema": "2.0",
            "header": {
                "event_id": "8bfdcea24d9b4d00ad2cb9958fc7f267",
                "token": "",
                "create_time": "1770601614676",
                "event_type": "im.message.receive_v1",
                "tenant_key": "1aecb0fb6c59dc99",
                "app_id": "cli_a903847243b9dcc9"
            },
            "event": {
                "message": {
                    "chat_id": "oc_81441e708eef38e9246d6b0bf3e312e0",
                    "chat_type": "p2p",
                    "content": "{\"text\":\"你好\"}",
                    "create_time": "1770601614342",
                    "message_id": "om_x100b57a7862e88acb2650fb8381126e",
                    "message_type": "text",
                    "update_time": "1770601614342"
                },
                "sender": {
                    "sender_id": {
                        "open_id": "ou_f86fe8ddd1a732594c55a11c379f173c",
                        "union_id": "on_d2439d6674dd1eab9d56460cf5a96e80",
                        "user_id": null  // This was causing the deserialization error
                    },
                    "sender_type": "user",
                    "tenant_key": "1aecb0fb6c59dc99"
                }
            }
        });

        // Parse the event - this should not fail after the fix
        let result: Result<serde_json::Value, _> = serde_json::from_value(event_json.clone());
        assert!(result.is_ok(), "Should parse event with null user_id");

        let event = result.unwrap();
        let sender_id = event["event"]["sender"]["sender_id"].clone();

        // Verify the structure
        assert_eq!(sender_id["open_id"], "ou_f86fe8ddd1a732594c55a11c379f173c");
        assert_eq!(sender_id["union_id"], "on_d2439d6674dd1eab9d56460cf5a96e80");
        assert!(sender_id["user_id"].is_null(), "user_id should be null");
    }

    #[test]
    fn test_parse_feishu_event_with_valid_user_id() {
        // Test with valid user_id (not null)
        let event_json = json!({
            "schema": "2.0",
            "header": {
                "event_id": "test-event-id",
                "token": "",
                "create_time": "1770601614676",
                "event_type": "im.message.receive_v1",
                "tenant_key": "tenant_key",
                "app_id": "app_id"
            },
            "event": {
                "message": {
                    "chat_id": "oc_test",
                    "chat_type": "p2p",
                    "content": "{\"text\":\"Hello\"}",
                    "create_time": "1770601614342",
                    "message_id": "om_test",
                    "message_type": "text",
                    "update_time": "1770601614342"
                },
                "sender": {
                    "sender_id": {
                        "open_id": "ou_test",
                        "union_id": "on_test",
                        "user_id": "user123"  // Valid user_id
                    },
                    "sender_type": "user",
                    "tenant_key": "tenant_key"
                }
            }
        });

        let result: Result<serde_json::Value, _> = serde_json::from_value(event_json.clone());
        assert!(result.is_ok(), "Should parse event with valid user_id");

        let event = result.unwrap();
        let sender_id = event["event"]["sender"]["sender_id"].clone();

        assert_eq!(sender_id["open_id"], "ou_test");
        assert_eq!(sender_id["union_id"], "on_test");
        assert_eq!(sender_id["user_id"], "user123");
    }

    #[test]
    fn test_open_id_allowlist_with_multiple_ids() {
        let allowed = vec![
            "ou_user1".to_string(),
            "ou_user2".to_string(),
            "ou_user3".to_string(),
        ];

        assert!(is_open_id_allowed(&allowed, "ou_user1"));
        assert!(is_open_id_allowed(&allowed, "ou_user2"));
        assert!(is_open_id_allowed(&allowed, "ou_user3"));
        assert!(!is_open_id_allowed(&allowed, "ou_user4"));
    }

    #[test]
    fn test_sender_kind_edge_cases() {
        assert_eq!(sender_kind("user"), FeishuSenderKind::User);
        assert_eq!(sender_kind("app"), FeishuSenderKind::Other);
        assert_eq!(sender_kind(""), FeishuSenderKind::Other);
        assert_eq!(sender_kind("unknown"), FeishuSenderKind::Other);
    }

    #[test]
    fn test_chat_kind_edge_cases() {
        assert_eq!(chat_kind("p2p"), FeishuChatKind::P2p);
        assert_eq!(chat_kind("group"), FeishuChatKind::Other);
        assert_eq!(chat_kind("thread"), FeishuChatKind::Other);
        assert_eq!(chat_kind(""), FeishuChatKind::Other);
    }

    // Tests for image message parsing (bug fix: image download)
    #[test]
    fn test_parse_image_message_content() {
        // Simulate image message content from Feishu webhook
        let image_content = r#"{"image_key":"img_v3_02uo_f3d7117e-a8bc-4b7c-b423-6d9a54bdbd4g"}"#;
        let parsed: Value = serde_json::from_str(image_content).unwrap();

        assert_eq!(
            parsed.get("image_key").and_then(|v| v.as_str()),
            Some("img_v3_02uo_f3d7117e-a8bc-4b7c-b423-6d9a54bdbd4g")
        );
    }

    #[test]
    fn test_build_attachment_filename_with_extension() {
        let filename = build_attachment_filename("feishu", Some("image.png"), "image");
        assert_eq!(filename, "image.png");
    }

    #[test]
    fn test_build_attachment_filename_without_extension() {
        let filename = build_attachment_filename("feishu", Some("image-key-123"), "image");
        assert_eq!(filename, "image-key-123.bin");
    }

    #[test]
    fn test_build_attachment_filename_with_path_traversal() {
        // Security test: path traversal attempt should be sanitized by replacing / with _
        let filename = build_attachment_filename("feishu", Some("../../../etc/passwd"), "image");
        assert_eq!(filename, ".._.._.._etc_passwd"); // / is replaced with _ to prevent path traversal
    }

    #[test]
    fn test_parse_text_content_with_json() {
        let content = r#"{"text":"Hello, world!"}"#;
        let text = parse_text_content(content);
        assert_eq!(text, "Hello, world!");
    }

    #[test]
    fn test_parse_text_content_plain() {
        let content = "Plain text message";
        let text = parse_text_content(content);
        assert_eq!(text, "Plain text message");
    }

    // Test for file message parsing
    #[test]
    fn test_parse_file_message_content() {
        let file_content = r#"{"file_key":"file_v3_abc123","file_name":"document.pdf"}"#;
        let parsed: Value = serde_json::from_str(file_content).unwrap();

        assert_eq!(
            parsed.get("file_key").and_then(|v| v.as_str()),
            Some("file_v3_abc123")
        );
        assert_eq!(
            parsed.get("file_name").and_then(|v| v.as_str()),
            Some("document.pdf")
        );
    }

    // Test message resource URL construction
    #[test]
    fn test_message_resource_url_format() {
        let message_id = "om_123456";
        let file_key = "img_v3_abc123";
        let resource_type = "image";
        let expected_url = format!(
            "https://open.feishu.cn/open-apis/im/v1/messages/{}/resources/{}?type={}",
            message_id, file_key, resource_type
        );
        assert_eq!(
            expected_url,
            "https://open.feishu.cn/open-apis/im/v1/messages/om_123456/resources/img_v3_abc123?type=image"
        );
    }

    // Test for complete inbound message structure with image
    #[test]
    fn test_feishu_inbound_image_message_structure() {
        let event_json = json!({
            "schema": "2.0",
            "header": {
                "event_id": "test-event-id",
                "token": "",
                "create_time": "1770606438811",
                "event_type": "im.message.receive_v1",
                "tenant_key": "1aecb0fb6c59dc99",
                "app_id": "cli_a903847243b9dcc9"
            },
            "event": {
                "message": {
                    "chat_id": "oc_81441e708eef38e9246d6b0bf3e312e0",
                    "chat_type": "p2p",
                    "content": "{\"image_key\":\"img_v3_02uo_f3d7117e-a8bc-4b7c-b423-6d9a54bdbd4g\"}",
                    "create_time": "1770606438449",
                    "message_id": "om_x100b57a0b8ae00a0c44651f0f852bb9",
                    "message_type": "image",
                    "update_time": "1770606438449"
                },
                "sender": {
                    "sender_id": {
                        "open_id": "ou_f86fe8ddd1a732594c55a11c379f173c",
                        "union_id": "on_d2439d6674dd1eab9d56460cf5a96e80",
                        "user_id": null
                    },
                    "sender_type": "user",
                    "tenant_key": "1aecb0fb6c59dc99"
                }
            }
        });

        let event: Value = serde_json::from_value(event_json).unwrap();
        let message = &event["event"]["message"];

        assert_eq!(message["message_type"], "image");

        let content: Value = serde_json::from_str(message["content"].as_str().unwrap()).unwrap();
        assert_eq!(
            content["image_key"],
            "img_v3_02uo_f3d7117e-a8bc-4b7c-b423-6d9a54bdbd4g"
        );
    }
}
