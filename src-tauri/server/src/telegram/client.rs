//! Telegram Bot API HTTP client
//!
//! Low-level wrapper around the Telegram Bot API. Handles long-polling,
//! sending / editing messages, and file downloads.

use bytes::Bytes;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tokio::time::sleep;

const TELEGRAM_API: &str = "https://api.telegram.org";
const MAX_ATTACHMENT_BYTES: u64 = 20 * 1024 * 1024; // 20 MB
const DEFAULT_POLL_TIMEOUT_SECS: u64 = 25;
pub const MIN_BACKOFF_MS: u64 = 1_500;
pub const MAX_BACKOFF_MS: u64 = 30_000;

// ─── Telegram API wire types ────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct TgResponse<T> {
    pub ok: bool,
    pub result: Option<T>,
    pub description: Option<String>,
    pub error_code: Option<i64>,
    pub parameters: Option<TgResponseParameters>,
}

#[derive(Debug, Deserialize)]
pub struct TgResponseParameters {
    pub retry_after: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub struct TgUpdate {
    pub update_id: i64,
    pub message: Option<TgMessage>,
}

#[derive(Debug, Deserialize)]
pub struct TgMessage {
    pub message_id: i64,
    pub date: i64,
    pub chat: TgChat,
    pub from: Option<TgUser>,
    pub text: Option<String>,
    pub caption: Option<String>,
    pub photo: Option<Vec<TgPhotoSize>>,
    pub voice: Option<TgVoice>,
    pub audio: Option<TgAudio>,
    pub document: Option<TgDocument>,
}

#[derive(Debug, Deserialize)]
pub struct TgChat {
    pub id: i64,
    #[serde(rename = "type")]
    pub chat_type: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct TgUser {
    pub id: Option<i64>,
    pub username: Option<String>,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct TgPhotoSize {
    pub file_id: String,
    pub file_unique_id: String,
    pub file_size: Option<u64>,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Deserialize)]
pub struct TgVoice {
    pub file_id: String,
    pub file_unique_id: String,
    pub file_size: Option<u64>,
    pub duration: Option<u32>,
    pub mime_type: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct TgAudio {
    pub file_id: String,
    pub file_unique_id: String,
    pub file_size: Option<u64>,
    pub duration: Option<u32>,
    pub mime_type: Option<String>,
    pub file_name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct TgDocument {
    pub file_id: String,
    pub file_unique_id: String,
    pub file_size: Option<u64>,
    pub mime_type: Option<String>,
    pub file_name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct TgFile {
    pub file_id: String,
    pub file_path: Option<String>,
    pub file_size: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub struct TgSentMessage {
    pub message_id: i64,
}

// ─── Requests ───────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
struct GetUpdatesReq {
    offset: Option<i64>,
    timeout: u64,
    allowed_updates: Vec<String>,
}

#[derive(Debug, Serialize)]
struct SendMessageReq<'a> {
    chat_id: i64,
    text: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    reply_to_message_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    parse_mode: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    disable_web_page_preview: Option<bool>,
}

#[derive(Debug, Serialize)]
struct EditMessageReq<'a> {
    chat_id: i64,
    message_id: i64,
    text: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    parse_mode: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    disable_web_page_preview: Option<bool>,
}

// ─── Client ─────────────────────────────────────────────────────────────────

/// Thin async wrapper around the Telegram Bot HTTP API.
#[derive(Clone)]
pub struct TelegramClient {
    token: String,
    http: Client,
    poll_timeout_secs: u64,
}

impl TelegramClient {
    pub fn new(token: impl Into<String>) -> Self {
        let poll_timeout_secs = DEFAULT_POLL_TIMEOUT_SECS;
        let http = Client::builder()
            // Long-poll timeout + a small buffer for network overhead
            .timeout(Duration::from_secs(poll_timeout_secs + 10))
            .build()
            .expect("Failed to build reqwest client");
        Self {
            token: token.into(),
            http,
            poll_timeout_secs,
        }
    }

    fn api_url(&self, method: &str) -> String {
        format!("{}/bot{}/{}", TELEGRAM_API, self.token, method)
    }

    fn file_url(&self, file_path: &str) -> String {
        format!("{}/file/bot{}/{}", TELEGRAM_API, self.token, file_path)
    }

    /// Fetch pending updates starting from `offset`.
    /// Returns (updates, retry_after_ms_hint).
    pub async fn get_updates(
        &self,
        offset: Option<i64>,
    ) -> Result<Vec<TgUpdate>, (String, Option<u64>)> {
        let req = GetUpdatesReq {
            offset,
            timeout: self.poll_timeout_secs,
            allowed_updates: vec!["message".to_string()],
        };

        let resp = self
            .http
            .post(self.api_url("getUpdates"))
            .json(&req)
            .send()
            .await
            .map_err(|e| (format!("getUpdates request failed: {}", e), None))?;

        let retry_after = resp
            .headers()
            .get("retry-after")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u64>().ok())
            .map(|s| s * 1_000);

        let body: TgResponse<Vec<TgUpdate>> = resp
            .json()
            .await
            .map_err(|e| (format!("getUpdates parse failed: {}", e), retry_after))?;

        if !body.ok {
            let msg = body
                .description
                .unwrap_or_else(|| "Telegram returned ok=false".into());
            let hint = body
                .parameters
                .and_then(|p| p.retry_after)
                .map(|s| s * 1_000)
                .or(retry_after);
            return Err((msg, hint));
        }

        Ok(body.result.unwrap_or_default())
    }

    /// Send a text message. Returns the sent message_id.
    pub async fn send_message(
        &self,
        chat_id: i64,
        text: &str,
        reply_to: Option<i64>,
    ) -> Result<i64, String> {
        // Telegram max message length is 4096 chars; truncate with notice if needed
        let text = if text.len() > 4096 {
            &text[..4090]
        } else {
            text
        };

        let req = SendMessageReq {
            chat_id,
            text,
            reply_to_message_id: reply_to,
            parse_mode: None, // plain text for MVP
            disable_web_page_preview: Some(true),
        };

        let body: TgResponse<TgSentMessage> = self
            .http
            .post(self.api_url("sendMessage"))
            .json(&req)
            .send()
            .await
            .map_err(|e| format!("sendMessage request failed: {}", e))?
            .json()
            .await
            .map_err(|e| format!("sendMessage parse failed: {}", e))?;

        if !body.ok {
            return Err(body
                .description
                .unwrap_or_else(|| "sendMessage returned ok=false".into()));
        }

        Ok(body.result.map(|m| m.message_id).unwrap_or(0))
    }

    /// Edit an already-sent message in place.
    pub async fn edit_message(
        &self,
        chat_id: i64,
        message_id: i64,
        text: &str,
    ) -> Result<(), String> {
        let text = if text.len() > 4096 {
            &text[..4090]
        } else {
            text
        };

        let req = EditMessageReq {
            chat_id,
            message_id,
            text,
            parse_mode: None,
            disable_web_page_preview: Some(true),
        };

        let body: TgResponse<serde_json::Value> = self
            .http
            .post(self.api_url("editMessageText"))
            .json(&req)
            .send()
            .await
            .map_err(|e| format!("editMessage request failed: {}", e))?
            .json()
            .await
            .map_err(|e| format!("editMessage parse failed: {}", e))?;

        if !body.ok {
            return Err(body
                .description
                .unwrap_or_else(|| "editMessage returned ok=false".into()));
        }
        Ok(())
    }

    /// Send multiple chunks when a message exceeds Telegram's 4096-char limit.
    pub async fn send_chunked(
        &self,
        chat_id: i64,
        text: &str,
        reply_to: Option<i64>,
    ) -> Result<Vec<i64>, String> {
        const CHUNK: usize = 4000;
        let mut ids = Vec::new();
        let chars: Vec<char> = text.chars().collect();
        let total = chars.len();
        let mut offset = 0;
        let mut first_reply = reply_to;

        while offset < total {
            let end = (offset + CHUNK).min(total);
            let chunk: String = chars[offset..end].iter().collect();
            let msg_id = self.send_message(chat_id, &chunk, first_reply).await?;
            ids.push(msg_id);
            first_reply = None; // only reply on first chunk
            offset = end;
        }
        Ok(ids)
    }

    /// Fetch file metadata from Telegram.
    pub async fn get_file(&self, file_id: &str) -> Result<TgFile, String> {
        let body: TgResponse<TgFile> = self
            .http
            .post(self.api_url("getFile"))
            .json(&serde_json::json!({ "file_id": file_id }))
            .send()
            .await
            .map_err(|e| format!("getFile request failed: {}", e))?
            .json()
            .await
            .map_err(|e| format!("getFile parse failed: {}", e))?;

        if !body.ok {
            return Err(body
                .description
                .unwrap_or_else(|| "getFile returned ok=false".into()));
        }
        body.result.ok_or_else(|| "getFile: empty result".into())
    }

    /// Download raw file bytes. Enforces the 20 MB limit.
    pub async fn download_file(
        &self,
        file_path: &str,
        declared_size: Option<u64>,
    ) -> Result<Bytes, String> {
        if let Some(sz) = declared_size {
            if sz > MAX_ATTACHMENT_BYTES {
                return Err(format!(
                    "Attachment too large: {} bytes (max {})",
                    sz, MAX_ATTACHMENT_BYTES
                ));
            }
        }

        let resp = self
            .http
            .get(self.file_url(file_path))
            .send()
            .await
            .map_err(|e| format!("download_file request failed: {}", e))?;

        if !resp.status().is_success() {
            return Err(format!("download_file: HTTP {}", resp.status()));
        }

        resp.bytes()
            .await
            .map_err(|e| format!("download_file read failed: {}", e))
    }
}

// ─── Polling loop helper ─────────────────────────────────────────────────────

/// Compute the next backoff delay with jitter, clamped to [MIN, MAX].
pub fn next_backoff(current_ms: u64, hint_ms: Option<u64>) -> u64 {
    if let Some(h) = hint_ms {
        return h.clamp(MIN_BACKOFF_MS, MAX_BACKOFF_MS);
    }
    let jitter = rand::random::<u64>() % 250;
    (current_ms.saturating_mul(2) + jitter).clamp(MIN_BACKOFF_MS, MAX_BACKOFF_MS)
}

/// Sleep helper used in the polling loop.
pub async fn backoff_sleep(ms: u64) {
    sleep(Duration::from_millis(ms)).await;
}

/// Returns true if the Telegram chat should be treated as a group (blocked by default).
pub fn is_group_chat(chat_type: &Option<String>, chat_id: i64) -> bool {
    if chat_id < 0 {
        return true;
    }
    matches!(
        chat_type.as_deref(),
        Some("group") | Some("supergroup") | Some("channel")
    )
}
