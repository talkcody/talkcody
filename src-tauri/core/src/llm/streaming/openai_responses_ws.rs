use crate::llm::protocols::stream_parser::StreamParseState;
use crate::llm::providers::provider::{
    BuiltRequest, Provider, ProviderContext, ProviderRoute, ProviderTransport,
};
use crate::llm::types::{StreamEvent, TransportFallbackSource, TransportFallbackTarget};
use dashmap::DashMap;
use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use tokio::time::{interval, timeout};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, Message},
    MaybeTlsStream, WebSocketStream,
};
use url::Url;

const SESSION_KEEPALIVE_INTERVAL: Duration = Duration::from_secs(30);
const ACTIVE_RESPONSE_READ_POLL_INTERVAL: Duration = SESSION_KEEPALIVE_INTERVAL;
const SUBSCRIPTION_MAX_CONNECTION_AGE: Duration = Duration::from_secs(55 * 60);
const SUBSCRIPTION_READ_IDLE_TIMEOUT: Duration = Duration::from_secs(60 * 60);
const SUBSCRIPTION_HTTP_REQUEST_TIMEOUT: Duration = Duration::from_secs(65 * 60);
const PRE_OUTPUT_RETRY_BACKOFFS_MS: [u64; 3] = [1_000, 2_000, 4_000];

type OpenAiResponsesWebSocket = WebSocketStream<MaybeTlsStream<TcpStream>>;

static WEBSOCKET_SESSIONS: OnceLock<DashMap<String, Arc<Mutex<WebSocketSessionState>>>> =
    OnceLock::new();

#[derive(Debug, Clone, PartialEq, Eq)]
struct WebSocketSessionKey {
    ws_url: String,
    headers: Vec<(String, String)>,
    model: Option<String>,
}

impl WebSocketSessionKey {
    fn from_request(ws_url: &str, built_request: &BuiltRequest) -> Self {
        let mut headers = built_request
            .headers
            .iter()
            .map(|(key, value)| (key.to_ascii_lowercase(), value.clone()))
            .collect::<Vec<_>>();
        headers.sort_by(|left, right| left.0.cmp(&right.0).then(left.1.cmp(&right.1)));

        Self {
            ws_url: ws_url.to_string(),
            headers,
            model: built_request
                .body
                .get("model")
                .and_then(|value| value.as_str())
                .map(str::to_string),
        }
    }
}

struct WebSocketSessionState {
    key: Option<WebSocketSessionKey>,
    socket: Option<OpenAiResponsesWebSocket>,
    last_used_at: Instant,
    connected_at: Option<Instant>,
}

impl Default for WebSocketSessionState {
    fn default() -> Self {
        Self {
            key: None,
            socket: None,
            last_used_at: Instant::now(),
            connected_at: None,
        }
    }
}

impl WebSocketSessionState {
    fn mark_used(&mut self) {
        self.last_used_at = Instant::now();
    }

    fn connection_age(&self) -> Option<Duration> {
        self.connected_at.map(|connected_at| connected_at.elapsed())
    }

    fn should_rotate_connection(&self) -> bool {
        self.connection_age()
            .map(|age| age >= SUBSCRIPTION_MAX_CONNECTION_AGE)
            .unwrap_or(false)
    }

    async fn reset(&mut self) {
        if let Some(mut socket) = self.socket.take() {
            let _ = socket.send(Message::Close(None)).await;
        }
        self.key = None;
        self.connected_at = None;
        self.mark_used();
    }
}

#[derive(Debug, Clone)]
pub(crate) enum PreOutputFailureAction {
    FallbackToHttpSse(StreamEvent),
    SurfaceError { event: StreamEvent, message: String },
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct StreamActivityState {
    saw_visible_output: bool,
    saw_tool_call: bool,
    saw_stateless_fallback: bool,
    saw_error: bool,
}

impl StreamActivityState {
    fn observe(&mut self, event: &StreamEvent) {
        match event {
            StreamEvent::TextDelta { text } => {
                if !text.is_empty() {
                    self.saw_visible_output = true;
                }
            }
            StreamEvent::ReasoningDelta { text, .. } => {
                if !text.trim().is_empty() {
                    self.saw_visible_output = true;
                }
            }
            StreamEvent::ToolCall { .. } => {
                self.saw_tool_call = true;
            }
            StreamEvent::TransportFallback {
                to: TransportFallbackTarget::Stateless,
                ..
            } => {
                self.saw_stateless_fallback = true;
            }
            StreamEvent::Error { .. } => {
                self.saw_error = true;
            }
            _ => {}
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OpenAiResponsesWsOutcome {
    Completed { finish_reason: Option<String> },
    FallbackToHttpSse,
}

pub(crate) fn uses_subscription_timeout_budget(built_request: &BuiltRequest) -> bool {
    built_request.route == ProviderRoute::OpenAiSubscription
        && built_request.url.contains("/codex/responses")
}

pub(crate) fn websocket_read_idle_timeout() -> Duration {
    SUBSCRIPTION_READ_IDLE_TIMEOUT
}

pub(crate) fn subscription_http_request_timeout() -> Duration {
    SUBSCRIPTION_HTTP_REQUEST_TIMEOUT
}

pub fn should_use_websocket_transport(built_request: &BuiltRequest) -> bool {
    built_request.transport == ProviderTransport::Websocket
        && uses_subscription_timeout_budget(built_request)
}

pub(crate) fn derive_websocket_url(http_url: &str) -> Result<String, String> {
    let mut url = Url::parse(http_url).map_err(|err| format!("Invalid websocket URL: {}", err))?;
    match url.scheme() {
        "https" => url
            .set_scheme("wss")
            .map_err(|_| "Failed to convert HTTPS URL to WSS".to_string())?,
        "http" => url
            .set_scheme("ws")
            .map_err(|_| "Failed to convert HTTP URL to WS".to_string())?,
        "wss" | "ws" => {}
        scheme => {
            return Err(format!("Unsupported websocket URL scheme: {}", scheme));
        }
    }

    Ok(url.to_string())
}

pub(crate) fn classify_pre_output_failure(
    reason: impl Into<String>,
    allow_transport_fallback: Option<bool>,
    continuation_requested: bool,
) -> PreOutputFailureAction {
    let reason = reason.into();
    let fallback_target = if continuation_requested {
        TransportFallbackTarget::FreshWebsocketBaseline
    } else {
        TransportFallbackTarget::HttpSse
    };
    let fallback_source = if continuation_requested {
        TransportFallbackSource::ResponsesChained
    } else {
        TransportFallbackSource::Websocket
    };
    let event = StreamEvent::TransportFallback {
        reason: reason.clone(),
        from: fallback_source,
        to: fallback_target,
    };

    if continuation_requested {
        return PreOutputFailureAction::SurfaceError {
            event,
            message: reason,
        };
    }

    if allow_transport_fallback == Some(false) {
        PreOutputFailureAction::SurfaceError {
            event,
            message: format!(
                "WebSocket transport failed before stream output and HTTP fallback is disabled: {}",
                reason
            ),
        }
    } else {
        PreOutputFailureAction::FallbackToHttpSse(event)
    }
}

pub async fn stream_request<F>(
    provider: &dyn Provider,
    provider_ctx: &ProviderContext<'_>,
    built_request: &BuiltRequest,
    mut on_event: F,
) -> Result<OpenAiResponsesWsOutcome, String>
where
    F: FnMut(StreamEvent),
{
    if !should_use_websocket_transport(built_request) {
        return Err(
            "OpenAI Responses websocket transport is not available for this request".to_string(),
        );
    }

    let ws_url = derive_websocket_url(&built_request.url)?;
    let session_key = WebSocketSessionKey::from_request(&ws_url, built_request);
    let session_id = normalized_session_id(provider_ctx.transport_session_id);

    match session_id {
        Some(session_id) => {
            let session = get_or_create_session(session_id);
            let mut session = session.lock().await;
            log::debug!(
                "[OpenAI WS] Using reusable websocket session id={}, continuation_requested={}",
                session_id,
                provider_ctx.previous_response_id.is_some()
            );
            run_request_with_retry(
                Some(session_id),
                &mut session,
                &session_key,
                provider,
                provider_ctx,
                built_request,
                &mut on_event,
            )
            .await
        }
        None => {
            let mut session = WebSocketSessionState::default();
            let outcome = run_request_with_retry(
                None,
                &mut session,
                &session_key,
                provider,
                provider_ctx,
                built_request,
                &mut on_event,
            )
            .await;
            session.reset().await;
            outcome
        }
    }
}

async fn run_request_with_retry<F>(
    session_label: Option<&str>,
    session: &mut WebSocketSessionState,
    session_key: &WebSocketSessionKey,
    provider: &dyn Provider,
    provider_ctx: &ProviderContext<'_>,
    built_request: &BuiltRequest,
    on_event: &mut F,
) -> Result<OpenAiResponsesWsOutcome, String>
where
    F: FnMut(StreamEvent),
{
    let continuation_requested = provider_ctx.previous_response_id.is_some();
    let max_attempts = PRE_OUTPUT_RETRY_BACKOFFS_MS.len() + 1;

    for (attempt_index, retry_delay_ms) in PRE_OUTPUT_RETRY_BACKOFFS_MS
        .iter()
        .copied()
        .map(Some)
        .chain(std::iter::once(None))
        .enumerate()
    {
        let attempt_number = attempt_index + 1;
        let mut activity = StreamActivityState::default();
        let outcome = run_single_request_attempt(
            session,
            session_key,
            provider,
            provider_ctx,
            built_request,
            on_event,
            &mut activity,
        )
        .await;

        match outcome {
            Ok(result) => {
                if activity.saw_error {
                    session.reset().await;
                }
                return Ok(result);
            }
            Err(err) => {
                if let Some(retry_delay_ms) = retry_delay_ms {
                    log::warn!(
                        "[OpenAI WS] Websocket request attempt {}/{} failed; retrying session_id={}, continuation_requested={}, connection_age_ms={:?}, retry_delay_ms={}, saw_visible_output={}, saw_tool_call={}, saw_stateless_fallback={}, reason={}",
                        attempt_number,
                        max_attempts,
                        session_label.unwrap_or("transient"),
                        continuation_requested,
                        session.connection_age().map(|age| age.as_millis()),
                        retry_delay_ms,
                        activity.saw_visible_output,
                        activity.saw_tool_call,
                        activity.saw_stateless_fallback,
                        err
                    );
                    session.reset().await;
                    tokio::time::sleep(Duration::from_millis(retry_delay_ms)).await;
                    continue;
                }

                log::warn!(
                    "[OpenAI WS] Exhausted websocket retries for request attempt; session_id={}, continuation_requested={}, connection_age_ms={:?}, saw_visible_output={}, saw_tool_call={}, saw_stateless_fallback={}, reason={}",
                    session_label.unwrap_or("transient"),
                    continuation_requested,
                    session.connection_age().map(|age| age.as_millis()),
                    activity.saw_visible_output,
                    activity.saw_tool_call,
                    activity.saw_stateless_fallback,
                    err
                );
                session.reset().await;
                return emit_pre_output_failure(
                    err,
                    provider_ctx.allow_transport_fallback,
                    continuation_requested,
                    on_event,
                );
            }
        }
    }

    unreachable!("websocket retry loop must return an outcome")
}

async fn run_single_request_attempt<F>(
    session: &mut WebSocketSessionState,
    session_key: &WebSocketSessionKey,
    provider: &dyn Provider,
    provider_ctx: &ProviderContext<'_>,
    built_request: &BuiltRequest,
    on_event: &mut F,
    activity: &mut StreamActivityState,
) -> Result<OpenAiResponsesWsOutcome, String>
where
    F: FnMut(StreamEvent),
{
    ensure_socket_connected(session, session_key, built_request).await?;
    send_response_create(session, built_request).await?;
    read_response_stream(session, provider, provider_ctx, on_event, activity).await
}

fn websocket_sessions() -> &'static DashMap<String, Arc<Mutex<WebSocketSessionState>>> {
    WEBSOCKET_SESSIONS.get_or_init(DashMap::new)
}

fn get_or_create_session(session_id: &str) -> Arc<Mutex<WebSocketSessionState>> {
    use dashmap::mapref::entry::Entry;

    match websocket_sessions().entry(session_id.to_string()) {
        Entry::Occupied(entry) => entry.get().clone(),
        Entry::Vacant(entry) => {
            let session = Arc::new(Mutex::new(WebSocketSessionState::default()));
            spawn_session_keepalive(session_id.to_string(), session.clone());
            entry.insert(session.clone());
            session
        }
    }
}

fn spawn_session_keepalive(session_id: String, session: Arc<Mutex<WebSocketSessionState>>) {
    tokio::spawn(async move {
        let mut ticker = interval(SESSION_KEEPALIVE_INTERVAL);
        loop {
            ticker.tick().await;

            if !websocket_sessions().contains_key(session_id.as_str()) {
                break;
            }

            let Ok(mut state) = session.try_lock() else {
                continue;
            };

            if state.socket.is_none() || state.last_used_at.elapsed() < SESSION_KEEPALIVE_INTERVAL {
                continue;
            }

            if let Some(socket) = state.socket.as_mut() {
                log::debug!(
                    "[OpenAI WS] Sending keepalive ping for session {}",
                    session_id
                );
                match socket.send(Message::Ping(Vec::new())).await {
                    Ok(_) => state.mark_used(),
                    Err(err) => {
                        log::warn!(
                            "[OpenAI WS] Keepalive ping failed for session {}: {}",
                            session_id,
                            err
                        );
                        state.reset().await;
                    }
                }
            }
        }
    });
}

pub async fn close_session(session_id: &str) {
    let trimmed = session_id.trim();
    if trimmed.is_empty() {
        return;
    }

    if let Some((_, session)) = websocket_sessions().remove(trimmed) {
        session.lock().await.reset().await;
    }
}

fn normalized_session_id(session_id: Option<&str>) -> Option<&str> {
    session_id.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}

fn active_response_read_poll_interval() -> Duration {
    ACTIVE_RESPONSE_READ_POLL_INTERVAL
}

fn active_response_has_exceeded_idle_timeout(last_frame_received_at: Instant) -> bool {
    last_frame_received_at.elapsed() >= websocket_read_idle_timeout()
}

fn active_response_timeout_error() -> String {
    format!(
        "WebSocket timeout - no data received for {} seconds",
        websocket_read_idle_timeout().as_secs()
    )
}

async fn send_active_response_keepalive(
    session: &mut WebSocketSessionState,
    idle_for: Duration,
) -> Result<(), String> {
    log::debug!(
        "[OpenAI WS] Active response idle for {}s; sending keepalive ping",
        idle_for.as_secs()
    );

    let socket = session
        .socket
        .as_mut()
        .ok_or_else(|| "Missing websocket connection".to_string())?;
    socket
        .send(Message::Ping(Vec::new()))
        .await
        .map_err(|err| {
            format!(
                "WebSocket keepalive ping failed during active response: {}",
                err
            )
        })?;
    session.mark_used();
    Ok(())
}

async fn ensure_socket_connected(
    session: &mut WebSocketSessionState,
    session_key: &WebSocketSessionKey,
    built_request: &BuiltRequest,
) -> Result<(), String> {
    if session.key.as_ref() == Some(session_key) && session.socket.is_some() {
        if session.should_rotate_connection() {
            log::info!(
                "[OpenAI WS] Rotating websocket session before next turn due to age: connection_age_ms={:?}, max_age_ms={}",
                session.connection_age().map(|age| age.as_millis()),
                SUBSCRIPTION_MAX_CONNECTION_AGE.as_millis()
            );
        } else {
            session.mark_used();
            return Ok(());
        }
    }

    session.reset().await;

    let mut request = session_key
        .ws_url
        .as_str()
        .into_client_request()
        .map_err(|err| format!("Failed to build websocket handshake request: {}", err))?;
    for (name, value) in &built_request.headers {
        let header_name = http::header::HeaderName::from_bytes(name.as_bytes())
            .map_err(|err| format!("Invalid websocket header name {}: {}", name, err))?;
        let header_value = http::HeaderValue::from_str(value)
            .map_err(|err| format!("Invalid websocket header value for {}: {}", name, err))?;
        request.headers_mut().insert(header_name, header_value);
    }

    let (socket, response) = connect_async(request)
        .await
        .map_err(|err| format!("WebSocket connection failed: {}", err))?;

    if response.status() != http::StatusCode::SWITCHING_PROTOCOLS {
        return Err(format!(
            "WebSocket handshake failed with HTTP {}",
            response.status()
        ));
    }

    session.key = Some(session_key.clone());
    session.socket = Some(socket);
    session.connected_at = Some(Instant::now());
    session.mark_used();
    Ok(())
}

async fn send_response_create(
    session: &mut WebSocketSessionState,
    built_request: &BuiltRequest,
) -> Result<(), String> {
    let payload = build_response_create_payload(&built_request.body)?.to_string();

    let socket = session
        .socket
        .as_mut()
        .ok_or_else(|| "Missing websocket connection".to_string())?;
    socket
        .send(Message::Text(payload))
        .await
        .map_err(|err| format!("WebSocket send failed: {}", err))?;
    session.mark_used();
    Ok(())
}

fn build_response_create_payload(body: &Value) -> Result<Value, String> {
    let mut payload = body.clone();
    let payload_object = payload
        .as_object_mut()
        .ok_or_else(|| "OpenAI websocket payload must be a JSON object".to_string())?;

    payload_object.remove("stream");
    payload_object.remove("background");
    payload_object.insert(
        "type".to_string(),
        Value::String("response.create".to_string()),
    );

    Ok(payload)
}

async fn read_response_stream<F>(
    session: &mut WebSocketSessionState,
    provider: &dyn Provider,
    provider_ctx: &ProviderContext<'_>,
    on_event: &mut F,
    activity: &mut StreamActivityState,
) -> Result<OpenAiResponsesWsOutcome, String>
where
    F: FnMut(StreamEvent),
{
    let mut state = StreamParseState::default();
    let mut done_emitted = false;
    let mut last_frame_received_at = Instant::now();

    loop {
        let next_message = {
            let socket = session
                .socket
                .as_mut()
                .ok_or_else(|| "Missing websocket connection".to_string())?;
            timeout(active_response_read_poll_interval(), socket.next()).await
        };

        let message = match next_message {
            Ok(Some(message)) => message,
            Ok(None) => {
                return Err("WebSocket connection closed before response completed".to_string());
            }
            Err(_) => {
                let idle_for = last_frame_received_at.elapsed();
                if active_response_has_exceeded_idle_timeout(last_frame_received_at) {
                    return Err(active_response_timeout_error());
                }
                send_active_response_keepalive(session, idle_for).await?;
                continue;
            }
        };

        last_frame_received_at = Instant::now();

        match message {
            Ok(Message::Text(text)) => {
                session.mark_used();
                let done = process_raw_json_event(
                    provider,
                    provider_ctx,
                    text.as_ref(),
                    &mut state,
                    on_event,
                    activity,
                )
                .await?;
                done_emitted |= done;
                if done {
                    break;
                }
            }
            Ok(Message::Binary(bytes)) => {
                session.mark_used();
                let text = String::from_utf8(bytes.to_vec())
                    .map_err(|err| format!("Invalid UTF-8 websocket frame: {}", err))?;
                let done = process_raw_json_event(
                    provider,
                    provider_ctx,
                    &text,
                    &mut state,
                    on_event,
                    activity,
                )
                .await?;
                done_emitted |= done;
                if done {
                    break;
                }
            }
            Ok(Message::Ping(payload)) => {
                session
                    .socket
                    .as_mut()
                    .ok_or_else(|| "Missing websocket connection".to_string())?
                    .send(Message::Pong(payload))
                    .await
                    .map_err(|err| format!("WebSocket pong failed: {}", err))?;
                session.mark_used();
            }
            Ok(Message::Pong(_)) => {
                session.mark_used();
            }
            Ok(Message::Close(frame)) => {
                if state.finish_reason.is_some() {
                    if !done_emitted {
                        on_event(StreamEvent::Done {
                            finish_reason: state.finish_reason.clone(),
                        });
                    }
                    break;
                }
                let detail = frame
                    .map(|item| format!("{} ({})", item.reason, item.code))
                    .unwrap_or_else(|| "without a close frame".to_string());
                return Err(format!(
                    "WebSocket closed before response completed: {}",
                    detail
                ));
            }
            Ok(Message::Frame(_)) => {}
            Err(err) => {
                return Err(format!("WebSocket stream error: {}", err));
            }
        }
    }

    Ok(OpenAiResponsesWsOutcome::Completed {
        finish_reason: state.finish_reason.clone(),
    })
}

async fn process_raw_json_event<F>(
    provider: &dyn Provider,
    provider_ctx: &ProviderContext<'_>,
    raw_json: &str,
    state: &mut StreamParseState,
    on_event: &mut F,
    activity: &mut StreamActivityState,
) -> Result<bool, String>
where
    F: FnMut(StreamEvent),
{
    if raw_json.trim().is_empty() {
        return Ok(false);
    }

    let mut done_emitted = false;
    match provider
        .parse_stream_event_with_context(provider_ctx, None, raw_json, state)
        .await
    {
        Ok(Some(event)) => {
            done_emitted |= matches!(event, StreamEvent::Done { .. } | StreamEvent::Error { .. });
            activity.observe(&event);
            on_event(event);
        }
        Ok(None) => {}
        Err(err) => return Err(err),
    }

    while let Some(event) = state.pending_events.first().cloned() {
        state.pending_events.remove(0);
        done_emitted |= matches!(event, StreamEvent::Done { .. } | StreamEvent::Error { .. });
        activity.observe(&event);
        on_event(event);
    }

    Ok(done_emitted)
}

fn emit_pre_output_failure<F>(
    reason: String,
    allow_transport_fallback: Option<bool>,
    continuation_requested: bool,
    on_event: &mut F,
) -> Result<OpenAiResponsesWsOutcome, String>
where
    F: FnMut(StreamEvent),
{
    log::warn!(
        "[OpenAI WS] Pre-output websocket failure: continuation_requested={}, reason={}",
        continuation_requested,
        reason
    );
    match classify_pre_output_failure(reason, allow_transport_fallback, continuation_requested) {
        PreOutputFailureAction::FallbackToHttpSse(event) => {
            on_event(event);
            Ok(OpenAiResponsesWsOutcome::FallbackToHttpSse)
        }
        PreOutputFailureAction::SurfaceError { event, message } => {
            on_event(event);
            Err(message)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::HashMap;

    fn built_request(
        url: &str,
        transport: ProviderTransport,
        route: ProviderRoute,
    ) -> BuiltRequest {
        BuiltRequest {
            url: url.to_string(),
            headers: HashMap::new(),
            body: json!({ "model": "gpt-5.2-codex" }),
            transport,
            route,
        }
    }

    #[test]
    fn websocket_response_create_payload_uses_flat_request_shape() {
        let payload = build_response_create_payload(&json!({
            "model": "gpt-5.5",
            "stream": true,
            "background": false,
            "input": [],
            "store": false
        }))
        .expect("response.create payload");

        assert_eq!(
            payload.get("type").and_then(|value| value.as_str()),
            Some("response.create")
        );
        assert_eq!(
            payload.get("model").and_then(|value| value.as_str()),
            Some("gpt-5.5")
        );
        assert!(payload.get("response").is_none());
        assert!(payload.get("stream").is_none());
        assert!(payload.get("background").is_none());
    }

    #[test]
    fn derive_websocket_url_converts_https_codex_endpoint() {
        let url =
            derive_websocket_url("https://chatgpt.com/backend-api/codex/responses?stream=true")
                .expect("websocket url");
        assert_eq!(
            url,
            "wss://chatgpt.com/backend-api/codex/responses?stream=true"
        );
    }

    #[test]
    fn websocket_transport_selection_is_scoped_to_openai_subscription_requests() {
        let subscription_request = built_request(
            "https://chatgpt.com/backend-api/codex/responses",
            ProviderTransport::Websocket,
            ProviderRoute::OpenAiSubscription,
        );
        assert!(should_use_websocket_transport(&subscription_request));
        assert!(uses_subscription_timeout_budget(&subscription_request));

        let api_request = built_request(
            "https://api.openai.com/v1/responses",
            ProviderTransport::Websocket,
            ProviderRoute::OpenAiApi,
        );
        assert!(!should_use_websocket_transport(&api_request));
        assert!(!uses_subscription_timeout_budget(&api_request));

        let unrelated_request = built_request(
            "https://example.com/v1/responses",
            ProviderTransport::Websocket,
            ProviderRoute::Default,
        );
        assert!(!should_use_websocket_transport(&unrelated_request));
        assert!(!uses_subscription_timeout_budget(&unrelated_request));
    }

    #[test]
    fn subscription_timeout_helpers_match_long_lived_session_contract() {
        assert_eq!(
            active_response_read_poll_interval(),
            Duration::from_secs(30)
        );
        assert_eq!(websocket_read_idle_timeout(), Duration::from_secs(60 * 60));
        assert_eq!(
            subscription_http_request_timeout(),
            Duration::from_secs(65 * 60)
        );
    }

    #[test]
    fn active_response_idle_timeout_uses_the_long_lived_budget() {
        let fresh_frame = Instant::now() - Duration::from_secs(45);
        assert!(!active_response_has_exceeded_idle_timeout(fresh_frame));

        let stale_frame = Instant::now() - Duration::from_secs(60 * 60 + 1);
        assert!(active_response_has_exceeded_idle_timeout(stale_frame));
        assert_eq!(
            active_response_timeout_error(),
            "WebSocket timeout - no data received for 3600 seconds"
        );
    }

    #[test]
    fn websocket_session_rotation_uses_connection_age() {
        let mut fresh_session = WebSocketSessionState::default();
        fresh_session.connected_at = Some(Instant::now() - Duration::from_secs(60));
        assert!(!fresh_session.should_rotate_connection());

        let mut stale_session = WebSocketSessionState::default();
        stale_session.connected_at = Some(Instant::now() - Duration::from_secs(56 * 60));
        assert!(stale_session.should_rotate_connection());
    }

    #[test]
    fn pre_output_failures_default_to_http_fallback() {
        let action = classify_pre_output_failure("handshake failed", None, false);
        match action {
            PreOutputFailureAction::FallbackToHttpSse(StreamEvent::TransportFallback {
                reason,
                from,
                to,
            }) => {
                assert_eq!(reason, "handshake failed");
                assert_eq!(from, TransportFallbackSource::Websocket);
                assert_eq!(to, TransportFallbackTarget::HttpSse);
            }
            other => panic!("expected websocket fallback event, got {:?}", other),
        }
    }

    #[test]
    fn pre_output_failures_respect_explicit_fallback_opt_out() {
        let action = classify_pre_output_failure("send failed", Some(false), false);
        match action {
            PreOutputFailureAction::SurfaceError {
                event: StreamEvent::TransportFallback { reason, from, to },
                message,
            } => {
                assert_eq!(reason, "send failed");
                assert_eq!(from, TransportFallbackSource::Websocket);
                assert_eq!(to, TransportFallbackTarget::HttpSse);
                assert!(message.contains("HTTP fallback is disabled"));
            }
            other => panic!("expected surfaced websocket failure, got {:?}", other),
        }
    }

    #[test]
    fn pre_output_failures_for_chained_turns_signal_fresh_websocket_baseline_retry() {
        let action = classify_pre_output_failure("socket expired", None, true);
        match action {
            PreOutputFailureAction::SurfaceError {
                event: StreamEvent::TransportFallback { reason, from, to },
                message,
            } => {
                assert_eq!(reason, "socket expired");
                assert_eq!(from, TransportFallbackSource::ResponsesChained);
                assert_eq!(to, TransportFallbackTarget::FreshWebsocketBaseline);
                assert_eq!(message, "socket expired");
            }
            other => panic!(
                "expected fresh websocket baseline retry signal, got {:?}",
                other
            ),
        }
    }
}
