// WebSocket service for Eleven Labs real-time transcription
// Handles WebSocket connections with custom headers that browser WebSocket doesn't support

use futures_util::{SinkExt, StreamExt};
use log::{error, info};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex;
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, Message},
};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WebSocketMessage {
    pub data: String,
}

// WebSocket connection state
pub struct WebSocketState {
    sender: Arc<
        Mutex<
            Option<
                futures_util::stream::SplitSink<
                    tokio_tungstenite::WebSocketStream<
                        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
                    >,
                    Message,
                >,
            >,
        >,
    >,
}

impl WebSocketState {
    pub fn new() -> Self {
        Self {
            sender: Arc::new(Mutex::new(None)),
        }
    }
}

#[tauri::command]
pub async fn ws_connect(
    url: String,
    api_key: String,
    app_handle: AppHandle,
    state: State<'_, Arc<Mutex<WebSocketState>>>,
) -> Result<(), String> {
    info!("[WebSocket] Connecting to: {}", url);

    // Create request with custom headers
    let mut request = url.into_client_request().map_err(|e| {
        error!("[WebSocket] Failed to create request: {}", e);
        format!("Failed to create request: {}", e)
    })?;

    // Add custom headers (this is why we need native WebSocket)
    request.headers_mut().insert(
        "xi-api-key",
        api_key.parse().map_err(|e| {
            error!("[WebSocket] Invalid API key: {}", e);
            format!("Invalid API key: {}", e)
        })?,
    );

    // Connect to WebSocket
    let (ws_stream, response) = connect_async(request).await.map_err(|e| {
        error!("[WebSocket] Connection failed: {}", e);
        format!("Connection failed: {}", e)
    })?;

    info!(
        "[WebSocket] Connected successfully, status: {}",
        response.status()
    );

    // Split stream into sender and receiver
    let (write, mut read) = ws_stream.split();

    // Store sender for sending messages
    {
        let ws_state = state.lock().await;
        let mut sender_guard = ws_state.sender.lock().await;
        *sender_guard = Some(write);
    }

    // Emit connection success event
    if let Err(e) = app_handle.emit("ws-connected", ()) {
        error!("[WebSocket] Failed to emit connection event: {}", e);
    }

    // Spawn task to handle incoming messages
    let app_handle_clone = app_handle.clone();
    tokio::spawn(async move {
        info!("[WebSocket] Starting message receiver loop");

        while let Some(msg) = read.next().await {
            match msg {
                Ok(Message::Text(text)) => {
                    info!("[WebSocket] Received text message: {}", text);
                    let message = WebSocketMessage { data: text };
                    if let Err(e) = app_handle_clone.emit("ws-message", message) {
                        error!("[WebSocket] Failed to emit message: {}", e);
                    }
                }
                Ok(Message::Close(frame)) => {
                    info!("[WebSocket] Connection closed: {:?}", frame);
                    if let Err(e) = app_handle_clone.emit("ws-closed", ()) {
                        error!("[WebSocket] Failed to emit close event: {}", e);
                    }
                    break;
                }
                Err(e) => {
                    error!("[WebSocket] Error receiving message: {}", e);
                    let error_msg = format!("WebSocket error: {}", e);
                    if let Err(emit_err) = app_handle_clone.emit("ws-error", error_msg) {
                        error!("[WebSocket] Failed to emit error event: {}", emit_err);
                    }
                    break;
                }
                _ => {}
            }
        }

        info!("[WebSocket] Message receiver loop ended");
    });

    Ok(())
}

#[tauri::command]
pub async fn ws_send(
    message: String,
    state: State<'_, Arc<Mutex<WebSocketState>>>,
) -> Result<(), String> {
    info!("[WebSocket] Sending message: {}", message.len());

    let ws_state = state.lock().await;
    let mut sender_guard = ws_state.sender.lock().await;

    if let Some(sender) = sender_guard.as_mut() {
        sender.send(Message::Text(message)).await.map_err(|e| {
            error!("[WebSocket] Failed to send message: {}", e);
            format!("Failed to send message: {}", e)
        })?;

        info!("[WebSocket] Message sent successfully");
        Ok(())
    } else {
        error!("[WebSocket] Not connected");
        Err("Not connected".to_string())
    }
}

#[tauri::command]
pub async fn ws_disconnect(state: State<'_, Arc<Mutex<WebSocketState>>>) -> Result<(), String> {
    info!("[WebSocket] Disconnecting...");

    let ws_state = state.lock().await;
    let mut sender_guard = ws_state.sender.lock().await;

    if let Some(mut sender) = sender_guard.take() {
        sender.send(Message::Close(None)).await.map_err(|e| {
            error!("[WebSocket] Failed to send close message: {}", e);
            format!("Failed to send close message: {}", e)
        })?;

        info!("[WebSocket] Disconnected successfully");
        Ok(())
    } else {
        info!("[WebSocket] Already disconnected");
        Ok(())
    }
}
