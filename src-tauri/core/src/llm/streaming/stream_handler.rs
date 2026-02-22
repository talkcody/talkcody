use crate::llm::auth::api_key_manager::ApiKeyManager;
use crate::llm::protocols::stream_parser::StreamParseState;
use crate::llm::providers::provider::ProviderContext;
use crate::llm::providers::provider_registry::ProviderRegistry;
use crate::llm::testing::fixtures::FixtureInput;
use crate::llm::testing::{Recorder, RecordingContext, TestConfig, TestMode};
use crate::llm::tracing::types::{float_attr, int_attr};
use crate::llm::tracing::TraceWriter;
use crate::llm::types::{StreamEvent, StreamTextRequest};
use futures_util::StreamExt;
use serde_json;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::Duration;
use tauri::{Emitter, Manager};
use tokio::time::timeout;

static REQUEST_COUNTER: AtomicU32 = AtomicU32::new(1000);
static HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

pub struct StreamHandler {
    registry: ProviderRegistry,
    api_keys: ApiKeyManager,
}

impl StreamHandler {
    pub fn new(registry: ProviderRegistry, api_keys: ApiKeyManager) -> Self {
        Self { registry, api_keys }
    }

    pub async fn stream_completion(
        &self,
        window: tauri::Window,
        request: StreamTextRequest,
        request_id: String,
    ) -> Result<String, String> {
        // Use provided request_id if non-zero, otherwise generate one
        let request_id = if request_id != "0" {
            request_id
        } else {
            REQUEST_COUNTER.fetch_add(1, Ordering::SeqCst).to_string()
        };
        let event_name = format!("llm-stream-{}", request_id);

        log::info!(
            "[LLM Stream {}] Starting stream completion for model: {}",
            request_id,
            request.model
        );

        let (model_key, provider_id, provider_model_name) =
            self.resolve_model_info(&request.model).await?;
        log::info!(
            "[LLM Stream {}] Resolved model: {}, provider: {}",
            request_id,
            model_key,
            provider_id
        );
        let provider = self
            .registry
            .create_provider(&provider_id)
            .ok_or_else(|| format!("Provider not found: {}", provider_id))?;
        let provider_config = provider.config();
        log::info!(
            "[LLM Stream {}] Found provider: {} with protocol: {:?}",
            request_id,
            provider_config.name,
            provider_config.protocol
        );

        let provider_ctx = ProviderContext {
            provider_config,
            api_key_manager: &self.api_keys,
            model: &provider_model_name,
            messages: &request.messages,
            tools: request.tools.as_deref(),
            temperature: request.temperature,
            max_tokens: request.max_tokens,
            top_p: request.top_p,
            top_k: request.top_k,
            provider_options: request.provider_options.as_ref(),
            trace_context: request.trace_context.as_ref(),
        };

        let built_request = provider.build_complete_request(&provider_ctx).await?;
        log::info!(
            "[LLM Stream {}] Resolved base URL: {}",
            request_id,
            built_request.url
        );

        // Initialize tracing span if trace_context is provided
        let mut trace_span_id: Option<String> = None;
        let mut trace_usage: Option<(i32, i32, Option<i32>, Option<i32>, Option<i32>)> = None;
        let mut trace_finish_reason: Option<String> = None;
        let mut trace_client_start_ms: Option<i64> = None;
        let mut trace_ttft_emitted = false;
        let mut done_emitted = false;

        // log::info!(
        //     "[LLM Stream {}] Request trace_context: {:?}",
        //     request_id,
        //     request.trace_context
        // );

        if let Some(ref trace_context) = request.trace_context {
            let trace_writer = window.app_handle().state::<Arc<TraceWriter>>();
            // log::info!("[LLM Stream {}] Received trace_context - trace_id: {:?}, span_name: {:?}, parent_span_id: {:?}",
            //     request_id, trace_context.trace_id, trace_context.span_name, trace_context.parent_span_id);
            let trace_id = trace_context.trace_id.clone().unwrap_or_else(|| {
                let new_id = trace_writer.start_trace();
                log::info!(
                    "[LLM Stream {}] No trace_id provided, generated new trace: {}",
                    request_id,
                    new_id
                );
                new_id
            });
            // log::info!("[LLM Stream {}] Using trace_id: {}", request_id, trace_id);

            let span_name = trace_context
                .span_name
                .as_deref()
                .unwrap_or("llm.stream_completion");

            trace_client_start_ms = trace_context
                .metadata
                .as_ref()
                .and_then(|metadata| metadata.get("client_start_ms"))
                .and_then(|value| value.parse::<i64>().ok());

            let mut attributes = HashMap::new();
            attributes.insert(
                crate::llm::tracing::types::attributes::GEN_AI_REQUEST_MODEL.to_string(),
                crate::llm::tracing::types::string_attr(&provider_model_name),
            );
            attributes.insert(
                crate::llm::tracing::types::attributes::GEN_AI_SYSTEM.to_string(),
                crate::llm::tracing::types::string_attr(&provider_id),
            );

            if let Some(t) = request.temperature {
                attributes.insert(
                    crate::llm::tracing::types::attributes::GEN_AI_REQUEST_TEMPERATURE.to_string(),
                    float_attr(t as f64),
                );
            }
            if let Some(p) = request.top_p {
                attributes.insert(
                    crate::llm::tracing::types::attributes::GEN_AI_REQUEST_TOP_P.to_string(),
                    float_attr(p as f64),
                );
            }
            if let Some(k) = request.top_k {
                attributes.insert(
                    crate::llm::tracing::types::attributes::GEN_AI_REQUEST_TOP_K.to_string(),
                    int_attr(k as i64),
                );
            }
            if let Some(m) = request.max_tokens {
                attributes.insert(
                    crate::llm::tracing::types::attributes::GEN_AI_REQUEST_MAX_TOKENS.to_string(),
                    int_attr(m as i64),
                );
            }

            let span_id = trace_writer.start_span(
                trace_id,
                trace_context.parent_span_id.clone(),
                span_name.to_string(),
                attributes,
            );
            trace_span_id = Some(span_id.clone());

            // let _parent_exists = trace_context
            //     .parent_span_id
            //     .as_deref()
            //     .map(|id| trace_writer.has_span_id(id))
            //     .unwrap_or(true);
            // log::info!(
            //     "[LLM Stream {}] Tracing span created: span_id={}, parent_span_id={:?}, parent_exists={}",
            //     request_id,
            //     span_id,
            //     trace_context.parent_span_id,
            //     parent_exists
            // );
        }

        let headers = built_request.headers.clone();
        let body = built_request.body.clone();

        // Record request event for tracing
        if let Some(ref span_id) = trace_span_id {
            let trace_writer = window.app_handle().state::<Arc<TraceWriter>>();
            trace_writer.add_event(
                span_id.clone(),
                crate::llm::tracing::types::attributes::HTTP_REQUEST_BODY.to_string(),
                Some(body.clone()),
            );
        }

        let test_config = TestConfig::from_env();

        let base_url = if test_config.mode != TestMode::Off {
            test_config
                .base_url_override
                .clone()
                .unwrap_or_else(|| built_request.url.clone())
        } else {
            built_request.url.clone()
        };
        let channel = Self::recording_channel(
            &base_url,
            provider_config,
            built_request.url.contains("/codex/responses"),
            test_config.base_url_override.as_deref(),
        );
        let endpoint_path = reqwest::Url::parse(&built_request.url)
            .ok()
            .map(|url| url.path().trim_start_matches('/').to_string())
            .unwrap_or_default();
        let url = if test_config.mode != TestMode::Off {
            if let Some(override_url) = test_config.base_url_override.as_deref() {
                format!("{}/{}", override_url.trim_end_matches('/'), endpoint_path)
            } else {
                built_request.url.clone()
            }
        } else {
            built_request.url.clone()
        };

        let mut recorder = Recorder::from_test_config(
            &test_config,
            RecordingContext {
                provider_id: provider_config.id.clone(),
                protocol: format!("{:?}", provider_config.protocol),
                model: provider_model_name.clone(),
                endpoint_path: endpoint_path.to_string(),
                url: url.clone(),
                channel: channel.clone(),
                request_headers: headers.clone(),
                request_body: body.clone(),
            },
        );

        if let Some(recorder) = recorder.as_mut() {
            recorder.set_test_input(FixtureInput {
                model: provider_model_name.clone(),
                messages: request.messages.clone(),
                tools: request.tools.clone(),
                temperature: request.temperature,
                max_tokens: request.max_tokens,
                top_p: request.top_p,
                top_k: request.top_k,
                provider_options: request.provider_options.clone(),
                extra_body: provider_config.extra_body.clone(),
            });
        }

        let client = HTTP_CLIENT.get_or_init(|| {
            reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(10))
                .timeout(Duration::from_secs(3000)) // Add overall request timeout
                .gzip(false)
                .brotli(false)
                .tcp_nodelay(true)
                .pool_max_idle_per_host(5)
                .build()
                .expect("Failed to build HTTP client")
        });
        log::debug!("[LLM Stream {}] HTTP client ready", request_id);

        let mut req_builder = client.post(&url);
        for (key, value) in headers {
            req_builder = req_builder.header(&key, &value);
        }
        req_builder = req_builder
            .header("Accept", "text/event-stream")
            .json(&body);

        // log::info!("[LLM Stream {}] Sending HTTP request...", request_id);

        // Retry configuration: exponential backoff with max 3 retries
        const MAX_RETRIES: u32 = 3;
        const BASE_DELAY_MS: u64 = 1000;

        let mut response = None;
        let mut last_error: Option<String> = None;

        for attempt in 0..=MAX_RETRIES {
            if attempt > 0 {
                let delay_ms = BASE_DELAY_MS * (1 << (attempt - 1)); // Exponential backoff: 1s, 2s, 4s
                log::info!(
                    "[LLM Stream {}] Retrying request (attempt {}/{}), waiting {}ms",
                    request_id,
                    attempt,
                    MAX_RETRIES,
                    delay_ms
                );
                tokio::time::sleep(Duration::from_millis(delay_ms)).await;
            }

            match req_builder.try_clone() {
                Some(builder) => match builder.send().await {
                    Ok(resp) => {
                        response = Some(resp);
                        break;
                    }
                    Err(e) => {
                        let err_msg = format!("{}", e);
                        log::warn!(
                            "[LLM Stream {}] Request attempt {}/{} failed: {}",
                            request_id,
                            attempt + 1,
                            MAX_RETRIES + 1,
                            err_msg
                        );
                        last_error = Some(err_msg);
                    }
                },
                None => {
                    // Request body cannot be cloned, try without cloning
                    match req_builder.send().await {
                        Ok(resp) => {
                            response = Some(resp);
                            break;
                        }
                        Err(e) => {
                            let err_msg = format!("{}", e);
                            log::warn!(
                                "[LLM Stream {}] Request attempt {}/{} failed: {}",
                                request_id,
                                attempt + 1,
                                MAX_RETRIES + 1,
                                err_msg
                            );
                            last_error = Some(err_msg);
                            // Cannot retry without cloning
                            break;
                        }
                    }
                }
            }
        }

        let response = response.ok_or_else(|| {
            let err = last_error.unwrap_or_else(|| "Request failed after all retries".to_string());
            log::error!("[LLM Stream {}] Request failed: {}", request_id, err);
            format!("Request failed: {}", err)
        })?;

        let status = response.status().as_u16();
        if status >= 400 {
            let response_headers = response.headers().clone();
            let text = response.text().await.unwrap_or_default();
            log::error!(
                "[LLM Stream {}] HTTP error {}: {}",
                request_id,
                status,
                text
            );
            if let Some(recorder) = recorder.as_mut() {
                let _ = recorder.finish_error(status, &response_headers, &text);
            }
            // Record error in tracing span
            if let Some(ref span_id) = trace_span_id {
                let trace_writer = window.app_handle().state::<Arc<TraceWriter>>();
                trace_writer.add_event(
                    span_id.clone(),
                    crate::llm::tracing::types::attributes::ERROR_TYPE.to_string(),
                    Some(serde_json::json!({
                        "error_type": "http_error",
                        "status_code": status,
                        "message": text,
                    })),
                );
            }
            let error_event = StreamEvent::Error {
                message: format!("HTTP {}: {}", status, text),
            };
            let _ = window.emit(&event_name, &error_event);
            return Err(format!("HTTP error {}", status));
        }

        let response_headers = response.headers().clone();
        let mut stream = response.bytes_stream();
        let mut buffer: Vec<u8> = Vec::new();
        let mut state = StreamParseState::default();
        let mut chunk_count = 0;
        let mut response_text = String::new();
        let stream_timeout = Duration::from_secs(300); // Timeout between chunks
        const STREAM_MAX_RETRIES: u32 = 3;
        const STREAM_BASE_DELAY_MS: u64 = 1000;
        let mut stream_error_retries: u32 = 0;

        'stream_loop: loop {
            // Use timeout to prevent hanging on stream.next().await
            let chunk_result = timeout(stream_timeout, stream.next()).await;

            let chunk = match chunk_result {
                Ok(Some(result)) => result,
                Ok(None) => {
                    log::info!(
                        "[LLM Stream {}] Stream ended normally after {} chunks",
                        request_id,
                        chunk_count
                    );
                    break;
                }
                Err(_) => {
                    log::error!(
                        "[LLM Stream {}] Stream timeout - no data received for {} seconds",
                        request_id,
                        stream_timeout.as_secs()
                    );
                    // Record error in tracing span
                    if let Some(ref span_id) = trace_span_id {
                        let trace_writer = window.app_handle().state::<Arc<TraceWriter>>();
                        trace_writer.add_event(
                            span_id.clone(),
                            crate::llm::tracing::types::attributes::ERROR_TYPE.to_string(),
                            Some(serde_json::json!({
                                "error_type": "stream_timeout",
                                "timeout_seconds": stream_timeout.as_secs(),
                                "message": format!("Stream timeout - no data received for {} seconds", stream_timeout.as_secs()),
                            })),
                        );
                    }
                    let error_event = StreamEvent::Error {
                        message: format!(
                            "Stream timeout - no data received for {} seconds",
                            stream_timeout.as_secs()
                        ),
                    };
                    let _ = window.emit(&event_name, &error_event);
                    return Err(format!(
                        "Stream timeout - no data received for {} seconds",
                        stream_timeout.as_secs()
                    ));
                }
            };

            chunk_count += 1;

            let bytes = match chunk {
                Ok(b) => b,
                Err(e) => {
                    let err_msg = e.to_string();
                    if Self::is_decode_response_body_error(&err_msg)
                        && stream_error_retries < STREAM_MAX_RETRIES
                    {
                        let delay_ms = STREAM_BASE_DELAY_MS * (1u64 << stream_error_retries);
                        log::warn!(
                            "[LLM Stream {}] Stream decode error at chunk {}, retrying {}/{} after {}ms: {}",
                            request_id,
                            chunk_count,
                            stream_error_retries + 1,
                            STREAM_MAX_RETRIES,
                            delay_ms,
                            err_msg
                        );
                        stream_error_retries += 1;
                        tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                        continue;
                    }
                    log::error!(
                        "[LLM Stream {}] Stream error at chunk {}: {}",
                        request_id,
                        chunk_count,
                        err_msg
                    );
                    // Record error in tracing span
                    if let Some(ref span_id) = trace_span_id {
                        let trace_writer = window.app_handle().state::<Arc<TraceWriter>>();
                        trace_writer.add_event(
                            span_id.clone(),
                            crate::llm::tracing::types::attributes::ERROR_TYPE.to_string(),
                            Some(serde_json::json!({
                                "error_type": "stream_error",
                                "chunk_count": chunk_count,
                                "message": format!("Stream error: {}", err_msg),
                            })),
                        );
                    }
                    let error_event = StreamEvent::Error {
                        message: format!("Stream error: {}", err_msg),
                    };
                    let _ = window.emit(&event_name, &error_event);
                    return Err(format!("Stream error: {}", err_msg));
                }
            };

            stream_error_retries = 0;

            if bytes.is_empty() {
                log::debug!("[LLM Stream {}] Received empty chunk", request_id);
                continue;
            }

            buffer.extend_from_slice(&bytes);

            // Process SSE events from buffer, handling both \n\n and \r\n\r\n delimiters
            while let Some((idx, delimiter_len)) = Self::find_sse_delimiter(&buffer) {
                let event_bytes = buffer[..idx].to_vec();
                buffer.drain(..idx + delimiter_len);

                let event_str = match String::from_utf8(event_bytes) {
                    Ok(s) => s,
                    Err(e) => {
                        log::error!(
                            "[LLM Stream {}] Invalid UTF-8 in SSE event: {}",
                            request_id,
                            e
                        );
                        // Record error in tracing span
                        if let Some(ref span_id) = trace_span_id {
                            let trace_writer = window.app_handle().state::<Arc<TraceWriter>>();
                            trace_writer.add_event(
                                span_id.clone(),
                                crate::llm::tracing::types::attributes::ERROR_TYPE.to_string(),
                                Some(serde_json::json!({
                                    "error_type": "utf8_error",
                                    "message": format!("Invalid UTF-8 in SSE event: {}", e),
                                })),
                            );
                        }
                        let error_event = StreamEvent::Error {
                            message: format!("Invalid UTF-8 in SSE event: {}", e),
                        };
                        let _ = window.emit(&event_name, &error_event);
                        return Err(format!("Invalid UTF-8 in SSE event: {}", e));
                    }
                };

                if let Some(parsed) = Self::parse_sse_event(&event_str) {
                    if let Some(recorder) = recorder.as_mut() {
                        recorder.record_sse_event(parsed.event.as_deref(), &parsed.data);
                    }
                    let parsed_result = provider
                        .parse_stream_event_with_context(
                            &provider_ctx,
                            parsed.event.as_deref(),
                            &parsed.data,
                            &mut state,
                        )
                        .await;
                    match parsed_result {
                        Ok(Some(event)) => {
                            // Capture usage and finish_reason for tracing
                            match &event {
                                StreamEvent::Usage {
                                    input_tokens,
                                    output_tokens,
                                    total_tokens,
                                    cached_input_tokens,
                                    cache_creation_input_tokens,
                                } => {
                                    trace_usage = Some((
                                        *input_tokens,
                                        *output_tokens,
                                        *total_tokens,
                                        *cached_input_tokens,
                                        *cache_creation_input_tokens,
                                    ));
                                }
                                StreamEvent::Done { finish_reason } => {
                                    trace_finish_reason = finish_reason.clone();
                                }
                                _ => {}
                            }

                            if let Some(recorder) = recorder.as_mut() {
                                recorder.record_expected_event(&event);
                            }
                            Self::append_text_delta(&mut response_text, &event);
                            self.emit_stream_event(&window, &event_name, &request_id, &event);

                            if !trace_ttft_emitted {
                                if let (Some(ref span_id), Some(client_start_ms)) =
                                    (trace_span_id.as_ref(), trace_client_start_ms)
                                {
                                    let now_ms = chrono::Utc::now().timestamp_millis();
                                    if now_ms >= client_start_ms {
                                        let ttft_ms = now_ms - client_start_ms;
                                        let trace_writer =
                                            window.app_handle().state::<Arc<TraceWriter>>();
                                        trace_writer.add_event(
                                            span_id.to_string(),
                                            crate::llm::tracing::types::attributes::GEN_AI_TTFT_MS
                                                .to_string(),
                                            Some(serde_json::json!({ "ttft_ms": ttft_ms })),
                                        );
                                    }
                                }
                                trace_ttft_emitted = true;
                            }

                            if !state.pending_events.is_empty() {
                                for pending in state.pending_events.drain(..) {
                                    if let Some(recorder) = recorder.as_mut() {
                                        recorder.record_expected_event(&pending);
                                    }
                                    Self::append_text_delta(&mut response_text, &pending);
                                    self.emit_stream_event(
                                        &window,
                                        &event_name,
                                        &request_id,
                                        &pending,
                                    );
                                }
                            }

                            if matches!(event, StreamEvent::Done { .. }) {
                                log::info!(
                                    "[LLM Stream {}] Done event received, ending stream loop",
                                    request_id
                                );
                                done_emitted = true;
                                break 'stream_loop;
                            }
                        }
                        Ok(None) => {
                            log::debug!(
                                "[LLM Stream {}] No event emitted from parsed data",
                                request_id
                            );
                            if !state.pending_events.is_empty() {
                                for pending in state.pending_events.drain(..) {
                                    if let Some(recorder) = recorder.as_mut() {
                                        recorder.record_expected_event(&pending);
                                    }
                                    Self::append_text_delta(&mut response_text, &pending);
                                    self.emit_stream_event(
                                        &window,
                                        &event_name,
                                        &request_id,
                                        &pending,
                                    );
                                }
                            }
                        }
                        Err(err) => {
                            log::error!(
                                "[LLM Stream {}] Error parsing stream event: {}",
                                request_id,
                                err
                            );
                            // Record error in tracing span
                            if let Some(ref span_id) = trace_span_id {
                                let trace_writer = window.app_handle().state::<Arc<TraceWriter>>();
                                trace_writer.add_event(
                                    span_id.clone(),
                                    crate::llm::tracing::types::attributes::ERROR_TYPE.to_string(),
                                    Some(serde_json::json!({
                                        "error_type": "parse_error",
                                        "message": err,
                                    })),
                                );
                            }
                            let _ = window.emit(
                                &event_name,
                                &StreamEvent::Error {
                                    message: err.clone(),
                                },
                            );
                            return Err(err);
                        }
                    }
                } else {
                    log::debug!(
                        "[LLM Stream {}] No SSE event parsed from: {}",
                        request_id,
                        event_str
                    );
                }
            }
        }

        if let Some(recorder) = recorder.as_mut() {
            if state.finish_reason.as_deref() == Some("tool_calls") {
                recorder.record_expected_event(&StreamEvent::Done {
                    finish_reason: state.finish_reason.clone(),
                });
            }
            let _ = recorder.finish_stream(status, &response_headers);
        }

        // Record response event and usage for tracing
        if let Some(ref span_id) = trace_span_id {
            let trace_writer = window.app_handle().state::<Arc<TraceWriter>>();
            // Add usage attributes if available
            if let Some((
                input_tokens,
                output_tokens,
                total_tokens,
                cached_input_tokens,
                cache_creation_input_tokens,
            )) = trace_usage
            {
                let mut usage_attrs = serde_json::Map::new();
                usage_attrs.insert(
                    "input_tokens".to_string(),
                    serde_json::Value::Number(input_tokens.into()),
                );
                usage_attrs.insert(
                    "output_tokens".to_string(),
                    serde_json::Value::Number(output_tokens.into()),
                );
                usage_attrs.insert(
                    "total_tokens".to_string(),
                    total_tokens
                        .map(|value| serde_json::Value::Number(value.into()))
                        .unwrap_or(serde_json::Value::Null),
                );
                usage_attrs.insert(
                    "cached_input_tokens".to_string(),
                    cached_input_tokens
                        .map(|value| serde_json::Value::Number(value.into()))
                        .unwrap_or(serde_json::Value::Null),
                );
                usage_attrs.insert(
                    "cache_creation_input_tokens".to_string(),
                    cache_creation_input_tokens
                        .map(|value| serde_json::Value::Number(value.into()))
                        .unwrap_or(serde_json::Value::Null),
                );
                trace_writer.add_event(
                    span_id.clone(),
                    "gen_ai.usage".to_string(),
                    Some(serde_json::Value::Object(usage_attrs)),
                );
            }

            // Add finish reason if available
            if let Some(ref finish_reason) = trace_finish_reason {
                trace_writer.add_event(
                    span_id.clone(),
                    "gen_ai.finish_reason".to_string(),
                    Some(serde_json::json!({"finish_reason": finish_reason})),
                );
            }

            let ttft_ms = trace_client_start_ms
                .map(|client_start_ms| chrono::Utc::now().timestamp_millis() - client_start_ms)
                .filter(|value| *value >= 0);

            trace_writer.add_event(
                span_id.clone(),
                crate::llm::tracing::types::attributes::HTTP_RESPONSE_BODY.to_string(),
                Some(Self::build_response_payload(
                    trace_finish_reason.as_deref(),
                    ttft_ms,
                    trace_usage,
                    response_text.as_str(),
                )),
            );

            trace_writer.end_span(span_id.clone(), chrono::Utc::now().timestamp_millis());
        }

        if !done_emitted {
            let _ = window.emit(
                &event_name,
                &StreamEvent::Done {
                    finish_reason: state.finish_reason.clone(),
                },
            );
        }

        log::info!(
            "[LLM Stream {}] Stream completion finished successfully",
            request_id
        );
        Ok(request_id)
    }

    async fn resolve_model_info(
        &self,
        model_identifier: &str,
    ) -> Result<(String, String, String), String> {
        let models = self.api_keys.load_models_config().await?;
        let api_keys = self.api_keys.load_api_keys().await?;
        let custom_providers = self.api_keys.load_custom_providers().await?;

        let (model_key, provider_id) =
            crate::llm::models::model_registry::ModelRegistry::get_model_provider(
                model_identifier,
                &api_keys,
                &self.registry,
                &custom_providers,
                &models,
            )?;

        let provider_model_name =
            crate::llm::models::model_registry::ModelRegistry::resolve_provider_model_name(
                &model_key,
                &provider_id,
                &models,
            );

        Ok((model_key, provider_id, provider_model_name))
    }

    /// Find SSE delimiter in buffer, returns (index, delimiter_length)
    /// Handles both \n\n and \r\n\r\n delimiters
    fn find_sse_delimiter(buf: &[u8]) -> Option<(usize, usize)> {
        // First check for \r\n\r\n (4 bytes)
        if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            return Some((pos, 4));
        }
        // Then check for \n\n (2 bytes)
        if let Some(pos) = buf.windows(2).position(|w| w == b"\n\n") {
            return Some((pos, 2));
        }
        None
    }

    fn parse_sse_event(raw: &str) -> Option<SseEvent> {
        let mut event: Option<String> = None;
        let mut data_lines = Vec::new();
        for line in raw.lines() {
            if let Some(rest) = line.strip_prefix("event:") {
                event = Some(rest.trim().to_string());
            } else if let Some(rest) = line.strip_prefix("data:") {
                // Preserve payload exactly, only removing single optional leading space per SSE spec
                let data = rest.strip_prefix(' ').unwrap_or(rest);
                data_lines.push(data.to_string());
            }
        }
        if data_lines.is_empty() {
            return None;
        }
        Some(SseEvent {
            event,
            data: data_lines.join("\n"),
        })
    }

    fn is_decode_response_body_error(error: &str) -> bool {
        let error = error.to_ascii_lowercase();
        error.contains("error decoding response body")
    }

    fn append_text_delta(target: &mut String, event: &StreamEvent) {
        if let StreamEvent::TextDelta { text } = event {
            target.push_str(text);
        }
    }

    fn emit_stream_event(
        &self,
        window: &tauri::Window,
        event_name: &str,
        _request_id: &str,
        event: &StreamEvent,
    ) {
        // log::info!("[LLM Stream {}] Emitting event: {:?}", request_id, event);
        let _ = window.emit(event_name, event);
    }

    fn build_response_payload(
        finish_reason: Option<&str>,
        ttft_ms: Option<i64>,
        trace_usage: Option<(i32, i32, Option<i32>, Option<i32>, Option<i32>)>,
        response_text: &str,
    ) -> serde_json::Value {
        serde_json::json!({
            "finish_reason": finish_reason,
            "ttft_ms": ttft_ms,
            "usage": trace_usage.map(|(i, o, t, c, cc)| serde_json::json!({
                "input_tokens": i,
                "output_tokens": o,
                "total_tokens": t,
                "cached_input_tokens": c,
                "cache_creation_input_tokens": cc,
            })),
            "response_text": response_text,
        })
    }

    fn recording_channel(
        base_url: &str,
        provider: &crate::llm::types::ProviderConfig,
        is_oauth: bool,
        base_url_override: Option<&str>,
    ) -> String {
        if is_oauth {
            return "oauth".to_string();
        }
        if provider.supports_coding_plan {
            if let Some(coding_plan_url) = provider.coding_plan_base_url.as_deref() {
                if coding_plan_url == base_url {
                    return "coding_plan".to_string();
                }
            }
        }
        if provider.supports_international {
            if let Some(international_url) = provider.international_base_url.as_deref() {
                if international_url == base_url {
                    return "international".to_string();
                }
            }
        }
        if let Some(override_url) = base_url_override {
            if override_url == base_url {
                return "custom".to_string();
            }
        }
        if base_url != provider.base_url {
            return "custom".to_string();
        }
        "api".to_string()
    }
}

struct SseEvent {
    event: Option<String>,
    data: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::Database;
    use crate::llm::auth::api_key_manager::ApiKeyManager;
    use crate::llm::protocols::openai_responses_protocol::{
        parse_openai_oauth_event_legacy, parse_openai_oauth_function_call_done,
        OpenAiResponsesProtocol,
    };
    use crate::llm::protocols::request_builder::{ProtocolRequestBuilder, RequestBuildContext};
    use crate::llm::protocols::{ProtocolStreamState, ToolCallAccum};
    use crate::llm::providers::provider::Provider;
    use crate::llm::providers::provider_configs::builtin_providers;
    use crate::llm::providers::OpenAiProvider;
    use crate::llm::types::{
        ContentPart, Message, MessageContent, ProtocolType, ProviderConfig, StreamTextRequest,
    };
    use serde_json::json;
    use std::sync::Arc;
    use tempfile::TempDir;

    #[test]
    fn detects_decode_response_body_error() {
        assert!(StreamHandler::is_decode_response_body_error(
            "error decoding response body"
        ));
        assert!(StreamHandler::is_decode_response_body_error(
            "Error decoding response body"
        ));
        assert!(!StreamHandler::is_decode_response_body_error(
            "connection reset by peer"
        ));
    }

    #[tokio::test]
    async fn moonshot_video_input_forces_standard_base_url() {
        let dir = TempDir::new().expect("temp dir");
        let db_path = dir.path().join("talkcody-test.db");
        let db = Arc::new(Database::new(db_path.to_string_lossy().to_string()));
        db.connect().await.expect("db connect");
        db.execute(
            "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER)",
            vec![],
        )
        .await
        .expect("create settings");

        let api_keys = ApiKeyManager::new(db, std::path::PathBuf::from("/tmp"));
        api_keys
            .set_setting("use_coding_plan_moonshot", "true")
            .await
            .expect("set setting");

        let providers = builtin_providers();
        let provider_config = providers
            .iter()
            .find(|item| item.id == "moonshot")
            .expect("moonshot provider")
            .clone();
        let registry = ProviderRegistry::new(providers);
        let provider = registry
            .create_provider("moonshot")
            .expect("provider exists");

        let ctx = ProviderContext {
            provider_config: &provider_config,
            api_key_manager: &api_keys,
            model: "kimi-k2.5",
            messages: &[Message::User {
                content: MessageContent::Parts(vec![ContentPart::Video {
                    video: "BASE64".to_string(),
                    mime_type: Some("video/mp4".to_string()),
                }]),
                provider_options: None,
            }],
            tools: None,
            temperature: None,
            max_tokens: None,
            top_p: None,
            top_k: None,
            provider_options: None,
            trace_context: None,
        };

        let base_url = provider
            .resolve_base_url(&ctx)
            .await
            .expect("resolve base url");
        assert_eq!(base_url, provider_config.base_url);
    }

    #[tokio::test]
    async fn openai_responses_model_routes_to_responses_endpoint() {
        let dir = TempDir::new().expect("temp dir");
        let db_path = dir.path().join("talkcody-test.db");
        let db = Arc::new(Database::new(db_path.to_string_lossy().to_string()));
        db.connect().await.expect("db connect");
        let api_keys = ApiKeyManager::new(db, std::path::PathBuf::from("/tmp"));

        let provider = OpenAiProvider::new(ProviderConfig {
            id: "openai".to_string(),
            name: "OpenAI".to_string(),
            protocol: ProtocolType::OpenAiCompatible,
            base_url: "https://api.openai.com/v1".to_string(),
            api_key_name: "OPENAI_API_KEY".to_string(),
            supports_oauth: true,
            supports_coding_plan: false,
            supports_international: false,
            coding_plan_base_url: None,
            international_base_url: None,
            headers: None,
            extra_body: None,
            auth_type: crate::llm::types::AuthType::Bearer,
        });

        let request = StreamTextRequest {
            model: "gpt-5.1-codex-max@openai".to_string(),
            messages: vec![Message::User {
                content: MessageContent::Text("hi".to_string()),
                provider_options: None,
            }],
            tools: None,
            stream: Some(true),
            temperature: None,
            max_tokens: None,
            top_p: None,
            top_k: None,
            provider_options: None,
            request_id: None,
            trace_context: None,
        };

        let ctx = ProviderContext {
            provider_config: provider.config(),
            api_key_manager: &api_keys,
            model: &request.model,
            messages: &request.messages,
            tools: request.tools.as_deref(),
            temperature: request.temperature,
            max_tokens: request.max_tokens,
            top_p: request.top_p,
            top_k: request.top_k,
            provider_options: request.provider_options.as_ref(),
            trace_context: request.trace_context.as_ref(),
        };

        let endpoint = provider.resolve_endpoint_path(&ctx).await;
        assert_eq!(endpoint, "responses");

        let body = provider.build_request(&ctx).await.expect("build request");
        assert!(body.get("input").is_some());
        assert!(body.get("messages").is_none());
        assert_eq!(
            body.get("model").and_then(|value| value.as_str()),
            Some("gpt-5.1-codex-max")
        );
    }

    #[tokio::test]
    async fn openai_chat_model_routes_to_chat_completions() {
        let dir = TempDir::new().expect("temp dir");
        let db_path = dir.path().join("talkcody-test.db");
        let db = Arc::new(Database::new(db_path.to_string_lossy().to_string()));
        db.connect().await.expect("db connect");
        let api_keys = ApiKeyManager::new(db, std::path::PathBuf::from("/tmp"));

        let provider = OpenAiProvider::new(ProviderConfig {
            id: "openai".to_string(),
            name: "OpenAI".to_string(),
            protocol: ProtocolType::OpenAiCompatible,
            base_url: "https://api.openai.com/v1".to_string(),
            api_key_name: "OPENAI_API_KEY".to_string(),
            supports_oauth: true,
            supports_coding_plan: false,
            supports_international: false,
            coding_plan_base_url: None,
            international_base_url: None,
            headers: None,
            extra_body: None,
            auth_type: crate::llm::types::AuthType::Bearer,
        });

        let request = StreamTextRequest {
            model: "gpt-4o@openai".to_string(),
            messages: vec![Message::User {
                content: MessageContent::Text("hi".to_string()),
                provider_options: None,
            }],
            tools: None,
            stream: Some(true),
            temperature: None,
            max_tokens: None,
            top_p: None,
            top_k: None,
            provider_options: None,
            request_id: None,
            trace_context: None,
        };

        let ctx = ProviderContext {
            provider_config: provider.config(),
            api_key_manager: &api_keys,
            model: &request.model,
            messages: &request.messages,
            tools: request.tools.as_deref(),
            temperature: request.temperature,
            max_tokens: request.max_tokens,
            top_p: request.top_p,
            top_k: request.top_k,
            provider_options: request.provider_options.as_ref(),
            trace_context: request.trace_context.as_ref(),
        };

        let endpoint = provider.resolve_endpoint_path(&ctx).await;
        assert_eq!(endpoint, "chat/completions");

        let body = provider.build_request(&ctx).await.expect("build request");
        assert!(body.get("messages").is_some());
        assert!(body.get("input").is_none());
        assert_eq!(
            body.get("model").and_then(|value| value.as_str()),
            Some("gpt-4o@openai")
        );
    }

    #[tokio::test]
    async fn build_openai_oauth_request_maps_tool_results() {
        let dir = TempDir::new().expect("temp dir");
        let db_path = dir.path().join("talkcody-test.db");
        let db = Arc::new(Database::new(db_path.to_string_lossy().to_string()));
        db.connect().await.expect("db connect");
        let _api_keys = ApiKeyManager::new(db, std::path::PathBuf::from("/tmp"));
        let provider = OpenAiProvider::new(ProviderConfig {
            id: "openai".to_string(),
            name: "OpenAI".to_string(),
            protocol: ProtocolType::OpenAiCompatible,
            base_url: "https://api.openai.com/v1".to_string(),
            api_key_name: "OPENAI_API_KEY".to_string(),
            supports_oauth: true,
            supports_coding_plan: false,
            supports_international: false,
            coding_plan_base_url: None,
            international_base_url: None,
            headers: None,
            extra_body: None,
            auth_type: crate::llm::types::AuthType::Bearer,
        });

        let request = StreamTextRequest {
            model: "gpt-5.2-codex".to_string(),
            messages: vec![
                Message::User {
                    content: MessageContent::Text("hi".to_string()),
                    provider_options: None,
                },
                Message::Assistant {
                    content: MessageContent::Parts(vec![
                        ContentPart::Text {
                            text: "checking".to_string(),
                        },
                        ContentPart::ToolCall {
                            tool_call_id: "call_1".to_string(),
                            tool_name: "webFetch".to_string(),
                            input: json!({ "url": "https://example.com" }),
                            provider_metadata: None,
                        },
                    ]),
                    provider_options: None,
                },
                Message::Tool {
                    content: vec![ContentPart::ToolResult {
                        tool_call_id: "call_1".to_string(),
                        tool_name: "webFetch".to_string(),
                        output: json!({ "type": "text", "value": "ok" }),
                    }],
                    provider_options: None,
                },
            ],
            tools: None,
            stream: Some(true),
            temperature: None,
            max_tokens: None,
            top_p: None,
            top_k: None,
            provider_options: None,
            request_id: None,
            trace_context: None,
        };

        let request_ctx = RequestBuildContext {
            model: "gpt-5.2-codex",
            messages: &request.messages,
            tools: request.tools.as_deref(),
            temperature: request.temperature,
            max_tokens: request.max_tokens,
            top_p: request.top_p,
            top_k: request.top_k,
            provider_options: request.provider_options.as_ref(),
            extra_body: provider.config().extra_body.as_ref(),
        };
        let body = OpenAiResponsesProtocol
            .build_request(request_ctx)
            .expect("request body");
        let input = body
            .get("input")
            .and_then(|value| value.as_array())
            .expect("input array");

        let has_tool_result = input.iter().any(|item| {
            item.get("type")
                .and_then(|value| value.as_str())
                .is_some_and(|value| value == "tool_result")
        });
        assert!(!has_tool_result);

        let has_function_call = input.iter().any(|item| {
            item.get("type")
                .and_then(|value| value.as_str())
                .is_some_and(|value| value == "function_call")
        });
        assert!(has_function_call);

        let output_item = input.iter().find(|item| {
            item.get("type")
                .and_then(|value| value.as_str())
                .is_some_and(|value| value == "function_call_output")
        });
        assert!(output_item.is_some());
        assert_eq!(
            output_item
                .and_then(|item| item.get("output"))
                .and_then(|value| value.as_str()),
            Some("ok")
        );
    }

    #[test]
    fn openai_oauth_skips_partial_tool_call_arguments() {
        let mut state = ProtocolStreamState::default();
        state.tool_calls.insert(
            "item_1".to_string(),
            ToolCallAccum {
                tool_call_id: "call_1".to_string(),
                tool_name: "readFile".to_string(),
                arguments: "{".to_string(),
                thought_signature: None,
            },
        );
        state.tool_call_order.push("item_1".to_string());

        let event = parse_openai_oauth_event_legacy(None, "{}", &mut state).expect("parse event");
        assert!(event.is_none());
        assert!(state.pending_events.is_empty());
        assert!(!state.emitted_tool_calls.contains("item_1"));
    }

    #[test]
    fn openai_oauth_emits_tool_call_when_arguments_complete() {
        let mut state = ProtocolStreamState::default();
        state.tool_calls.insert(
            "item_1".to_string(),
            ToolCallAccum {
                tool_call_id: "call_1".to_string(),
                tool_name: "readFile".to_string(),
                arguments: "{\"path\":\"/tmp/a\"}".to_string(),
                thought_signature: None,
            },
        );
        state.tool_call_order.push("item_1".to_string());

        // Trigger the tool call emission with function_call_arguments.delta event
        let event = parse_openai_oauth_event_legacy(
            Some("response.function_call_arguments.delta"),
            "{}",
            &mut state,
        )
        .expect("parse event");
        assert!(event.is_some());
        assert!(state.emitted_tool_calls.contains("item_1"));
    }

    #[test]
    fn openai_oauth_function_call_done_emits_once() {
        let mut legacy_state = ProtocolStreamState::default();
        let payload = json!({
            "item_id": "item_1",
            "name": "readFile",
            "arguments": "{\"path\":\"/tmp/a\"}"
        });

        let first = parse_openai_oauth_function_call_done(&payload, &mut legacy_state);
        assert!(first.is_some());
        assert!(legacy_state.emitted_tool_calls.contains("item_1"));

        let second = parse_openai_oauth_function_call_done(&payload, &mut legacy_state);
        assert!(second.is_none());
    }

    #[test]
    fn openai_oauth_preserves_tool_call_index_order() {
        let mut state = ProtocolStreamState::default();
        let first = json!({
            "type": "response.output_item.added",
            "item": {
                "type": "function_call",
                "id": "item_b",
                "call_id": "call_b",
                "name": "glob",
                "index": 1
            }
        });
        let second = json!({
            "type": "response.output_item.added",
            "item": {
                "type": "function_call",
                "id": "item_a",
                "call_id": "call_a",
                "name": "readFile",
                "index": 0
            }
        });
        let args_a = json!({
            "type": "response.function_call_arguments.done",
            "item_id": "item_a",
            "name": "readFile",
            "arguments": "{\"file_path\":\"/tmp/a\"}",
            "index": 0
        });
        let args_b = json!({
            "type": "response.function_call_arguments.done",
            "item_id": "item_b",
            "name": "glob",
            "arguments": "{\"pattern\":\"*.rs\"}",
            "index": 1
        });

        // Parse output_item.added events (no tool calls yet, just setup)
        let _ = parse_openai_oauth_event_legacy(None, &first.to_string(), &mut state)
            .expect("parse first");
        let _ = parse_openai_oauth_event_legacy(None, &second.to_string(), &mut state)
            .expect("parse second");

        // Collect tool calls from return values (not pending_events)
        let mut tool_calls: Vec<String> = Vec::new();

        // Parse args_b - should emit call_b via emit_tool_calls
        if let Some(event) = parse_openai_oauth_event_legacy(None, &args_b.to_string(), &mut state)
            .expect("parse args b")
        {
            if let StreamEvent::ToolCall { tool_call_id, .. } = event {
                tool_calls.push(tool_call_id);
            }
        }
        // Drain any pending events
        while let Some(event) = state.pending_events.get(0).cloned() {
            state.pending_events.remove(0);
            if let StreamEvent::ToolCall { tool_call_id, .. } = event {
                tool_calls.push(tool_call_id);
            }
        }

        // Parse args_a - should emit call_a via emit_tool_calls
        if let Some(event) = parse_openai_oauth_event_legacy(None, &args_a.to_string(), &mut state)
            .expect("parse args a")
        {
            if let StreamEvent::ToolCall { tool_call_id, .. } = event {
                tool_calls.push(tool_call_id);
            }
        }
        // Drain any pending events
        while let Some(event) = state.pending_events.get(0).cloned() {
            state.pending_events.remove(0);
            if let StreamEvent::ToolCall { tool_call_id, .. } = event {
                tool_calls.push(tool_call_id);
            }
        }

        // Tool calls are emitted in order of when their arguments become complete
        // call_b completes first (args_b processed before args_a)
        assert_eq!(tool_calls, vec!["call_b".to_string(), "call_a".to_string()]);
    }

    #[test]
    fn find_sse_delimiter_prefers_crlf() {
        let data = b"event: ping\r\n\r\n";
        let delimiter = StreamHandler::find_sse_delimiter(data);
        assert_eq!(delimiter, Some((11, 4)));
    }

    #[test]
    fn build_response_payload_includes_response_text() {
        let payload = StreamHandler::build_response_payload(
            Some("stop"),
            Some(12),
            Some((10, 20, Some(30), None, Some(5))),
            "final response",
        );

        assert_eq!(payload["finish_reason"], json!("stop"));
        assert_eq!(payload["ttft_ms"], json!(12));
        assert_eq!(payload["usage"]["input_tokens"], json!(10));
        assert_eq!(payload["usage"]["output_tokens"], json!(20));
        assert_eq!(payload["usage"]["total_tokens"], json!(30));
        assert_eq!(
            payload["usage"]["cached_input_tokens"],
            serde_json::Value::Null
        );
        assert_eq!(payload["usage"]["cache_creation_input_tokens"], json!(5));
        assert_eq!(payload["response_text"], json!("final response"));
    }

    #[test]
    fn parse_sse_event_preserves_data_lines() {
        let raw = "event: message\ndata: first\ndata: second\n";
        let event = StreamHandler::parse_sse_event(raw).expect("parsed");
        assert_eq!(event.event.as_deref(), Some("message"));
        assert_eq!(event.data, "first\nsecond");
    }

    #[tokio::test]
    async fn resolve_base_url_prefers_coding_plan_setting() {
        let dir = TempDir::new().expect("temp dir");
        let db_path = dir.path().join("talkcody-base-url.db");
        let db = Arc::new(Database::new(db_path.to_string_lossy().to_string()));
        db.connect().await.expect("db connect");
        db.execute(
            "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER)",
            vec![],
        )
        .await
        .expect("create settings");

        let api_keys = ApiKeyManager::new(db, std::path::PathBuf::from("/tmp"));
        api_keys
            .set_setting("use_coding_plan_zhipu", "true")
            .await
            .expect("set setting");

        let providers = builtin_providers();
        let provider_config = providers
            .iter()
            .find(|item| item.id == "zhipu")
            .expect("zhipu provider")
            .clone();
        let registry = ProviderRegistry::new(providers);
        let provider = registry.create_provider("zhipu").expect("provider exists");

        let ctx = ProviderContext {
            provider_config: &provider_config,
            api_key_manager: &api_keys,
            model: "glm-4",
            messages: &[],
            tools: None,
            temperature: None,
            max_tokens: None,
            top_p: None,
            top_k: None,
            provider_options: None,
            trace_context: None,
        };

        let base_url = provider
            .resolve_base_url(&ctx)
            .await
            .expect("resolve base url");
        assert_eq!(
            &base_url,
            provider_config
                .coding_plan_base_url
                .as_ref()
                .expect("coding plan url")
        );
    }

    #[test]
    fn openai_oauth_response_completed_emits_usage_and_done() {
        let mut state = ProtocolStreamState::default();
        let payload = json!({
            "type": "response.completed",
            "response": {
                "usage": { "input_tokens": 10, "output_tokens": 5, "total_tokens": 15 }
            }
        });

        let first = parse_openai_oauth_event_legacy(None, &payload.to_string(), &mut state)
            .expect("parse event")
            .expect("event");
        match first {
            StreamEvent::Usage {
                input_tokens,
                output_tokens,
                total_tokens,
                ..
            } => {
                assert_eq!(input_tokens, 10);
                assert_eq!(output_tokens, 5);
                assert_eq!(total_tokens, Some(15));
            }
            _ => panic!("Unexpected event"),
        }

        let second =
            parse_openai_oauth_event_legacy(Some("response.output_text.done"), "{}", &mut state)
                .expect("parse event")
                .expect("event");
        match second {
            StreamEvent::Done { finish_reason } => {
                assert_eq!(finish_reason, None);
            }
            _ => panic!("Unexpected event"),
        }
    }

    #[test]
    fn openai_oauth_response_completed_does_not_duplicate_text() {
        // Regression test: response.completed should NOT re-emit text content
        // that was already streamed via response.output_text.delta events.
        // This prevents the last message from appearing twice in the UI.
        let mut state = ProtocolStreamState::default();

        // Simulate text being streamed via delta events
        let delta1 = json!({
            "type": "response.output_text.delta",
            "delta": "Hello"
        });
        let delta2 = json!({
            "type": "response.output_text.delta",
            "delta": " World"
        });

        let event1 = parse_openai_oauth_event_legacy(None, &delta1.to_string(), &mut state)
            .expect("parse delta1")
            .expect("event1");
        assert!(matches!(event1, StreamEvent::TextStart));

        let event2 = parse_openai_oauth_event_legacy(None, &delta2.to_string(), &mut state)
            .expect("parse delta2")
            .expect("event2");
        match event2 {
            StreamEvent::TextDelta { text } => assert_eq!(text, "Hello"),
            _ => panic!("Expected TextDelta for 'Hello'"),
        }

        // Drain remaining pending events
        while let Some(event) = state.pending_events.get(0).cloned() {
            state.pending_events.remove(0);
            if let StreamEvent::TextDelta { text } = event {
                assert_eq!(text, " World");
            }
        }

        // Now simulate response.completed - it should NOT emit the text again
        let completed = json!({
            "type": "response.completed",
            "response": {
                "usage": { "input_tokens": 10, "output_tokens": 5, "total_tokens": 15 },
                "output": [
                    {
                        "type": "message",
                        "content": [
                            { "type": "output_text", "text": "Hello World" }
                        ]
                    }
                ]
            }
        });

        let completed_event =
            parse_openai_oauth_event_legacy(None, &completed.to_string(), &mut state)
                .expect("parse completed")
                .expect("completed event");

        // Should only get Usage event, not TextStart/TextDelta
        match completed_event {
            StreamEvent::Usage { .. } => {
                // Correct: only Usage event, no duplicate text
            }
            StreamEvent::TextStart | StreamEvent::TextDelta { .. } => {
                panic!("response.completed should NOT emit text events - this causes duplicate messages!");
            }
            _ => panic!("Unexpected event type: {:?}", completed_event),
        }

        // The next event from pending_events should be Done
        let done_event = state.pending_events.get(0).cloned();
        assert!(
            matches!(done_event, Some(StreamEvent::Done { .. })),
            "Expected Done event after Usage, got {:?}",
            done_event
        );
    }

    #[test]
    fn openai_oauth_message_event_uses_payload_type_for_text_deltas() {
        let mut state = ProtocolStreamState::default();
        let delta1 = json!({
            "type": "response.output_text.delta",
            "delta": "Hello"
        });

        let event1 =
            parse_openai_oauth_event_legacy(Some("message"), &delta1.to_string(), &mut state)
                .expect("parse delta1")
                .expect("event1");
        assert!(matches!(event1, StreamEvent::TextStart));

        let event2 =
            parse_openai_oauth_event_legacy(Some("message"), &delta1.to_string(), &mut state)
                .expect("parse delta1 repeat")
                .expect("event2");
        match event2 {
            StreamEvent::TextDelta { text } => assert_eq!(text, "Hello"),
            _ => panic!("Expected TextDelta for 'Hello'"),
        }

        let delta2 = json!({
            "type": "response.output_text.delta",
            "delta": " World"
        });
        let event3 =
            parse_openai_oauth_event_legacy(Some("message"), &delta2.to_string(), &mut state)
                .expect("parse delta2")
                .expect("event3");
        match event3 {
            StreamEvent::TextDelta { text } => assert_eq!(text, "Hello"),
            _ => panic!("Expected TextDelta for pending 'Hello'"),
        }

        let pending = state.pending_events.get(0).cloned();
        match pending {
            Some(StreamEvent::TextDelta { text }) => assert_eq!(text, " World"),
            _ => panic!("Expected pending TextDelta for ' World'"),
        }
    }

    #[test]
    fn openai_oauth_message_event_infers_response_completed() {
        let mut state = ProtocolStreamState::default();
        let payload = json!({
            "type": "response.completed",
            "response": {
                "usage": { "input_tokens": 7, "output_tokens": 11, "total_tokens": 18 }
            }
        });

        let first =
            parse_openai_oauth_event_legacy(Some("message"), &payload.to_string(), &mut state)
                .expect("parse completed")
                .expect("event");
        match first {
            StreamEvent::Usage {
                input_tokens,
                output_tokens,
                total_tokens,
                ..
            } => {
                assert_eq!(input_tokens, 7);
                assert_eq!(output_tokens, 11);
                assert_eq!(total_tokens, Some(18));
            }
            _ => panic!("Unexpected event"),
        }

        let pending = state.pending_events.get(0).cloned();
        assert!(
            matches!(pending, Some(StreamEvent::Done { .. })),
            "Expected Done event after Usage"
        );
    }

    #[tokio::test]
    async fn build_openai_oauth_request_uses_correct_content_types() {
        // Test that user/developer messages use input_text and assistant messages use output_text
        // This is required by the ChatGPT Codex API
        let dir = TempDir::new().expect("temp dir");
        let db_path = dir.path().join("talkcody-test.db");
        let db = Arc::new(Database::new(db_path.to_string_lossy().to_string()));
        db.connect().await.expect("db connect");
        let _api_keys = ApiKeyManager::new(db, std::path::PathBuf::from("/tmp"));
        let provider = OpenAiProvider::new(ProviderConfig {
            id: "openai".to_string(),
            name: "OpenAI".to_string(),
            protocol: ProtocolType::OpenAiCompatible,
            base_url: "https://api.openai.com/v1".to_string(),
            api_key_name: "OPENAI_API_KEY".to_string(),
            supports_oauth: true,
            supports_coding_plan: false,
            supports_international: false,
            coding_plan_base_url: None,
            international_base_url: None,
            headers: None,
            extra_body: None,
            auth_type: crate::llm::types::AuthType::Bearer,
        });

        let request = StreamTextRequest {
            model: "gpt-5.2-codex".to_string(),
            messages: vec![
                Message::System {
                    content: "You are a helpful assistant.".to_string(),
                    provider_options: None,
                },
                Message::User {
                    content: MessageContent::Text("Hello!".to_string()),
                    provider_options: None,
                },
                Message::Assistant {
                    content: MessageContent::Text("Hi there! How can I help you?".to_string()),
                    provider_options: None,
                },
                Message::User {
                    content: MessageContent::Parts(vec![ContentPart::Text {
                        text: "What's the weather?".to_string(),
                    }]),
                    provider_options: None,
                },
                Message::Assistant {
                    content: MessageContent::Parts(vec![
                        ContentPart::Text {
                            text: "Let me check that for you.".to_string(),
                        },
                        ContentPart::Reasoning {
                            text: "The user wants weather info.".to_string(),
                            provider_options: None,
                        },
                    ]),
                    provider_options: None,
                },
            ],
            tools: None,
            stream: Some(true),
            temperature: None,
            max_tokens: None,
            top_p: None,
            top_k: None,
            provider_options: None,
            request_id: None,
            trace_context: None,
        };

        let request_ctx = RequestBuildContext {
            model: "gpt-5.2-codex",
            messages: &request.messages,
            tools: request.tools.as_deref(),
            temperature: request.temperature,
            max_tokens: request.max_tokens,
            top_p: request.top_p,
            top_k: request.top_k,
            provider_options: request.provider_options.as_ref(),
            extra_body: provider.config().extra_body.as_ref(),
        };
        let body = OpenAiResponsesProtocol
            .build_request(request_ctx)
            .expect("request body");
        let input = body
            .get("input")
            .and_then(|value| value.as_array())
            .expect("input array");

        // Find messages by role
        let developer_msg = input
            .iter()
            .find(|item| {
                item.get("role")
                    .and_then(|value| value.as_str())
                    .is_some_and(|value| value == "developer")
            })
            .expect("developer message");
        let user_msg = input
            .iter()
            .find(|item| {
                item.get("role")
                    .and_then(|value| value.as_str())
                    .is_some_and(|value| value == "user")
            })
            .expect("user message");
        let assistant_msgs: Vec<_> = input
            .iter()
            .filter(|item| {
                item.get("role")
                    .and_then(|value| value.as_str())
                    .is_some_and(|value| value == "assistant")
            })
            .collect();

        // Developer message should use input_text
        let dev_content = developer_msg
            .get("content")
            .and_then(|value| value.as_array())
            .expect("developer content array")
            .first()
            .expect("first content item");
        assert_eq!(
            dev_content.get("type").and_then(|value| value.as_str()),
            Some("input_text"),
            "Developer message should use input_text"
        );

        // User message should use input_text
        let user_content = user_msg
            .get("content")
            .and_then(|value| value.as_array())
            .expect("user content array")
            .first()
            .expect("first content item");
        assert_eq!(
            user_content.get("type").and_then(|value| value.as_str()),
            Some("input_text"),
            "User message should use input_text"
        );

        // Assistant messages should use output_text
        assert!(
            !assistant_msgs.is_empty(),
            "Should have at least 1 assistant message"
        );
        for (index, assistant_msg) in assistant_msgs.iter().enumerate() {
            let content_array = assistant_msg
                .get("content")
                .and_then(|value| value.as_array())
                .expect(&format!("assistant {} content array", index));
            for (content_index, content_item) in content_array.iter().enumerate() {
                let content_type = content_item
                    .get("type")
                    .and_then(|value| value.as_str())
                    .expect(&format!(
                        "content type at assistant {} content {}",
                        index, content_index
                    ));
                // Assistant messages should only contain output_text (not input_text)
                assert_eq!(
                    content_type, "output_text",
                    "Assistant message {} content {} should use output_text, not {}",
                    index, content_index, content_type
                );
            }
        }
    }

    // ============================================================================
    // Tests for reasoning and tool call display fixes
    // ============================================================================

    #[test]
    fn openai_oauth_does_not_emit_text_start_on_tool_call() {
        // Tool calls should not create an assistant message before tool results
        // to keep tool messages before the assistant reply in the UI.
        let mut state = ProtocolStreamState::default();
        let payload = json!({
            "type": "response.output_item.added",
            "item": {
                "type": "function_call",
                "id": "call_123",
                "call_id": "call_123",
                "name": "readFile",
                "index": 0
            }
        });

        let event = parse_openai_oauth_event_legacy(None, &payload.to_string(), &mut state)
            .expect("parse event");

        assert!(event.is_none());
        assert!(!state.text_started);
        assert!(state.pending_events.is_empty());
    }

    #[test]
    fn openai_oauth_emits_reasoning_events_from_content_part() {
        // Content part reasoning events are not part of OpenAI Responses, ensure no reasoning events emitted.
        let mut state = ProtocolStreamState::default();
        let payload = json!({
            "type": "response.content_part.added",
            "part": {
                "type": "reasoning",
                "id": "reasoning_123",
                "text": "Let me think about this..."
            }
        });

        let event = parse_openai_oauth_event_legacy(None, &payload.to_string(), &mut state)
            .expect("parse event");
        assert!(event.is_none());
        assert!(state.pending_events.is_empty());
    }

    #[test]
    fn openai_oauth_emits_reasoning_events_from_output_item() {
        // Test that reasoning events are emitted from response.output_item.added
        let mut state = ProtocolStreamState::default();
        let payload = json!({
            "type": "response.output_item.added",
            "item": {
                "type": "reasoning",
                "id": "reasoning_456"
            }
        });

        let event = parse_openai_oauth_event_legacy(None, &payload.to_string(), &mut state)
            .expect("parse event")
            .expect("event");

        match event {
            StreamEvent::ReasoningStart {
                id,
                provider_metadata,
            } => {
                assert_eq!(id, "reasoning_456:0");
                let metadata = provider_metadata.expect("provider metadata");
                assert_eq!(
                    metadata
                        .get("openai")
                        .and_then(|value| value.get("itemId"))
                        .and_then(|value| value.as_str()),
                    Some("reasoning_456")
                );
            }
            _ => panic!("Expected ReasoningStart from output_item, got {:?}", event),
        }
    }

    #[test]
    fn openai_oauth_emits_reasoning_summary_deltas() {
        let mut state = ProtocolStreamState::default();
        let item_added = json!({
            "type": "response.output_item.added",
            "item": {
                "type": "reasoning",
                "id": "rs_1",
                "encrypted_content": "enc"
            }
        });
        let summary_added = json!({
            "type": "response.reasoning_summary_part.added",
            "item_id": "rs_1",
            "summary_index": 0
        });
        let summary_delta = json!({
            "type": "response.reasoning_summary_text.delta",
            "item_id": "rs_1",
            "summary_index": 0,
            "delta": "Hello"
        });
        let summary_done = json!({
            "type": "response.reasoning_summary_part.done",
            "item_id": "rs_1",
            "summary_index": 0
        });

        let event = parse_openai_oauth_event_legacy(None, &item_added.to_string(), &mut state)
            .expect("parse event")
            .expect("event");
        match event {
            StreamEvent::ReasoningStart {
                id,
                provider_metadata,
            } => {
                assert_eq!(id, "rs_1:0");
                let metadata = provider_metadata.expect("provider metadata");
                assert_eq!(
                    metadata
                        .get("openai")
                        .and_then(|value| value.get("reasoningEncryptedContent"))
                        .and_then(|value| value.as_str()),
                    Some("enc")
                );
            }
            _ => panic!("Expected ReasoningStart for summary, got {:?}", event),
        }

        let _ = parse_openai_oauth_event_legacy(None, &summary_added.to_string(), &mut state)
            .expect("parse event");
        let event = parse_openai_oauth_event_legacy(None, &summary_delta.to_string(), &mut state)
            .expect("parse event")
            .expect("event");
        match event {
            StreamEvent::ReasoningDelta { id, text, .. } => {
                assert_eq!(id, "rs_1:0");
                assert_eq!(text, "Hello");
            }
            _ => panic!("Expected ReasoningDelta, got {:?}", event),
        }

        let event = parse_openai_oauth_event_legacy(None, &summary_done.to_string(), &mut state)
            .expect("parse event")
            .expect("event");
        match event {
            StreamEvent::ReasoningEnd { id } => {
                assert_eq!(id, "rs_1:0");
            }
            _ => panic!("Expected ReasoningEnd, got {:?}", event),
        }
    }

    #[test]
    fn openai_oauth_emits_reasoning_end_with_encrypted_content_on_output_done() {
        let mut state = ProtocolStreamState::default();
        state.openai_store = Some(false);
        let item_added = json!({
            "type": "response.output_item.added",
            "item": {
                "type": "reasoning",
                "id": "rs_2"
            }
        });
        let summary_done = json!({
            "type": "response.reasoning_summary_part.done",
            "item_id": "rs_2",
            "summary_index": 0
        });
        let output_done = json!({
            "type": "response.output_item.done",
            "item": {
                "type": "reasoning",
                "id": "rs_2",
                "encrypted_content": "enc_final"
            }
        });

        let _ = parse_openai_oauth_event_legacy(None, &item_added.to_string(), &mut state)
            .expect("parse event");
        let _ = parse_openai_oauth_event_legacy(None, &summary_done.to_string(), &mut state)
            .expect("parse event");
        let event = parse_openai_oauth_event_legacy(None, &output_done.to_string(), &mut state)
            .expect("parse event")
            .expect("event");
        match event {
            StreamEvent::ReasoningDelta {
                id,
                provider_metadata,
                ..
            } => {
                assert_eq!(id, "rs_2:0");
                let metadata = provider_metadata.expect("provider metadata");
                assert_eq!(
                    metadata
                        .get("openai")
                        .and_then(|value| value.get("reasoningEncryptedContent"))
                        .and_then(|value| value.as_str()),
                    Some("enc_final")
                );
            }
            _ => panic!(
                "Expected ReasoningDelta with encrypted content, got {:?}",
                event
            ),
        }

        assert!(state.pending_events.iter().any(|pending| {
            matches!(pending, StreamEvent::ReasoningEnd { id } if id == "rs_2:0")
        }));
    }

    #[test]
    fn openai_oauth_handles_reasoning_content_delta() {
        // Test handling of response.reasoning_content.delta
        let mut state = ProtocolStreamState::default();
        let payload = json!({
            "type": "response.reasoning_content.delta",
            "item_id": "reasoning_abc",
            "delta": "More reasoning content"
        });

        let event = parse_openai_oauth_event_legacy(None, &payload.to_string(), &mut state)
            .expect("parse event")
            .expect("event");

        match event {
            StreamEvent::ReasoningStart { id, .. } => {
                assert_eq!(id, "reasoning_abc:0");
            }
            _ => panic!(
                "Expected ReasoningStart from content delta, got {:?}",
                event
            ),
        }

        // Next event should be ReasoningDelta
        assert!(!state.pending_events.is_empty());
        let delta_event = state.pending_events.remove(0);
        match delta_event {
            StreamEvent::ReasoningDelta { id, text, .. } => {
                assert_eq!(id, "reasoning_abc:0");
                assert_eq!(text, "More reasoning content");
            }
            _ => panic!(
                "Expected ReasoningDelta from content delta, got {:?}",
                delta_event
            ),
        }
    }

    #[test]
    fn openai_oauth_handles_reasoning_part_done() {
        // Test handling of response.reasoning_part.done
        let mut state = ProtocolStreamState::default();
        let payload = json!({
            "type": "response.reasoning_part.done",
            "item_id": "reasoning_xyz"
        });

        let event = parse_openai_oauth_event_legacy(None, &payload.to_string(), &mut state)
            .expect("parse event")
            .expect("event");

        match event {
            StreamEvent::ReasoningEnd { id } => {
                assert_eq!(id, "reasoning_xyz:0");
            }
            _ => panic!("Expected ReasoningEnd, got {:?}", event),
        }
    }
}
