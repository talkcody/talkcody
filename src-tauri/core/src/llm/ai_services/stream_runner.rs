use crate::llm::protocols::stream_parser::StreamParseState;
use crate::llm::providers::provider::{ProviderContext, ProviderTransport};
use crate::llm::providers::provider_registry::ProviderRegistry;
use crate::llm::streaming::openai_responses_ws::{self, OpenAiResponsesWsOutcome};
use crate::llm::streaming::stream_handler::{
    is_transient_provider_retryable_error, should_retry_transient_http_error,
    transient_provider_retry_delay_ms, TRANSIENT_PROVIDER_RETRY_LIMIT,
};
use crate::llm::types::{ResponseTransport, StreamEvent, StreamTextRequest};
use futures_util::StreamExt;
use std::time::Duration;

pub struct StreamRunner {
    registry: ProviderRegistry,
    api_keys: crate::llm::auth::api_key_manager::ApiKeyManager,
}

fn replay_http_sse_transport_state(state: &mut StreamParseState) {
    state.response_metadata_transport = Some(ResponseTransport::HttpSse);
}

fn stream_event_starts_output(event: &StreamEvent) -> bool {
    match event {
        StreamEvent::TextDelta { text } => !text.is_empty(),
        StreamEvent::ReasoningDelta { text, .. } => !text.trim().is_empty(),
        StreamEvent::ToolCall { .. } => true,
        _ => false,
    }
}

fn should_retry_same_model_before_fallback(retry_count: u32, error_message: &str) -> bool {
    retry_count < TRANSIENT_PROVIDER_RETRY_LIMIT
        && is_transient_provider_retryable_error(error_message)
}

impl StreamRunner {
    pub fn new(
        registry: ProviderRegistry,
        api_keys: crate::llm::auth::api_key_manager::ApiKeyManager,
    ) -> Self {
        Self { registry, api_keys }
    }

    pub async fn stream<F>(
        &self,
        request: StreamTextRequest,
        timeout: Duration,
        mut on_event: F,
    ) -> Result<(), String>
    where
        F: FnMut(StreamEvent) + Send,
    {
        let attempt_models = Self::build_attempt_models(&request);
        let mut last_error: Option<String> = None;

        for (attempt_index, attempt_model) in attempt_models.into_iter().enumerate() {
            let mut attempt_request = request.clone();
            attempt_request.model = attempt_model;
            attempt_request.fallback_models = None;
            if attempt_index > 0 {
                attempt_request.previous_response_id = None;
                attempt_request.transport_session_id = None;
            }

            let mut buffered_events: Vec<StreamEvent> = Vec::new();
            match self
                .stream_once(attempt_request, timeout, |event| {
                    buffered_events.push(event)
                })
                .await
            {
                Ok(()) => {
                    for event in buffered_events {
                        on_event(event);
                    }
                    return Ok(());
                }
                Err(err) => {
                    last_error = Some(err);
                }
            }
        }

        Err(last_error.unwrap_or_else(|| "No available model attempts".to_string()))
    }

    fn build_attempt_models(request: &StreamTextRequest) -> Vec<String> {
        let mut attempt_models = vec![request.model.clone()];

        if let Some(fallback_models) = &request.fallback_models {
            for fallback_model in fallback_models {
                if fallback_model.trim().is_empty() || attempt_models.contains(fallback_model) {
                    continue;
                }
                attempt_models.push(fallback_model.clone());
            }
        }

        attempt_models
    }

    async fn stream_once<F>(
        &self,
        request: StreamTextRequest,
        timeout: Duration,
        mut on_event: F,
    ) -> Result<(), String>
    where
        F: FnMut(StreamEvent) + Send,
    {
        let (_model_key, provider_id, provider_model_name) =
            self.resolve_model_info(&request.model).await?;

        let provider = self
            .registry
            .create_provider(&provider_id)
            .ok_or_else(|| format!("Provider not found: {}", provider_id))?;
        let provider_config = provider.config();

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
            conversation_mode: request.conversation_mode,
            input_mode: request.input_mode,
            previous_response_id: request.previous_response_id.as_deref(),
            transport_session_id: request.transport_session_id.as_deref(),
            allow_transport_fallback: request.allow_transport_fallback,
            continuation_context: request.continuation_context.as_ref(),
        };

        let built_request = provider.build_complete_request(&provider_ctx).await?;

        if built_request.transport == ProviderTransport::Websocket
            && openai_responses_ws::should_use_websocket_transport(&built_request)
        {
            match openai_responses_ws::stream_request(
                provider.as_ref(),
                &provider_ctx,
                &built_request,
                &mut on_event,
            )
            .await
            {
                Ok(OpenAiResponsesWsOutcome::Completed { .. }) => return Ok(()),
                Ok(OpenAiResponsesWsOutcome::FallbackToHttpSse) => {}
                Err(err) => return Err(err),
            }
        }

        let client_timeout =
            if openai_responses_ws::uses_subscription_timeout_budget(&built_request) {
                openai_responses_ws::subscription_http_request_timeout()
            } else {
                Duration::from_secs(300)
            };
        let stream_timeout =
            if openai_responses_ws::uses_subscription_timeout_budget(&built_request) {
                openai_responses_ws::websocket_read_idle_timeout()
            } else {
                timeout
            };

        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(client_timeout)
            .gzip(false)
            .brotli(false)
            .tcp_nodelay(true)
            .pool_max_idle_per_host(5)
            .build()
            .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

        let mut last_error: Option<String> = None;

        for retry_count in 0..=TRANSIENT_PROVIDER_RETRY_LIMIT {
            if retry_count > 0 {
                let delay_ms = transient_provider_retry_delay_ms(retry_count);
                log::warn!(
                    "[LLM StreamRunner {}] Retrying transient provider error attempt {}/{} after {}ms",
                    request.model,
                    retry_count,
                    TRANSIENT_PROVIDER_RETRY_LIMIT,
                    delay_ms
                );
                tokio::time::sleep(Duration::from_millis(delay_ms)).await;
            }

            let mut req_builder = client.post(&built_request.url);
            for (key, value) in &built_request.headers {
                req_builder = req_builder.header(key, value);
            }
            req_builder = req_builder
                .header("Accept", "text/event-stream")
                .json(&built_request.body);

            let response = req_builder
                .send()
                .await
                .map_err(|e| format!("Request failed: {}", e))?;

            let status = response.status().as_u16();
            if status >= 400 {
                let text = response.text().await.unwrap_or_default();
                let err = format!("HTTP error {}: {}", status, text);

                if should_retry_transient_http_error(status, &text)
                    && retry_count < TRANSIENT_PROVIDER_RETRY_LIMIT
                {
                    log::warn!(
                        "[LLM StreamRunner {}] Retrying transient HTTP error attempt {}/{}: {}",
                        request.model,
                        retry_count + 1,
                        TRANSIENT_PROVIDER_RETRY_LIMIT + 1,
                        err
                    );
                    last_error = Some(err);
                    continue;
                }

                return Err(err);
            }

            let mut stream = response.bytes_stream();
            let mut buffer: Vec<u8> = Vec::new();
            let mut state = StreamParseState::default();
            let mut attempt_events: Vec<StreamEvent> = Vec::new();
            let mut saw_output = false;
            let mut should_retry_attempt = false;

            if built_request.transport == ProviderTransport::Websocket
                && openai_responses_ws::should_use_websocket_transport(&built_request)
            {
                replay_http_sse_transport_state(&mut state);
            }

            'stream_loop: while let Some(chunk) =
                tokio::time::timeout(stream_timeout, stream.next())
                    .await
                    .map_err(|_| format!("Stream timeout after {:?}", stream_timeout))?
            {
                let bytes = chunk.map_err(|e| format!("Stream error: {}", e))?;
                if bytes.is_empty() {
                    continue;
                }
                buffer.extend_from_slice(&bytes);

                while let Some((idx, delimiter_len)) = find_sse_delimiter(&buffer) {
                    let event_bytes = buffer[..idx].to_vec();
                    buffer.drain(..idx + delimiter_len);

                    let event_str = String::from_utf8(event_bytes)
                        .map_err(|e| format!("Invalid UTF-8 in SSE event: {}", e))?;

                    if let Some(parsed) = parse_sse_event(&event_str) {
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
                                if let StreamEvent::Error { message } = &event {
                                    if !saw_output
                                        && should_retry_same_model_before_fallback(
                                            retry_count,
                                            message,
                                        )
                                    {
                                        last_error = Some(message.clone());
                                        should_retry_attempt = true;
                                        break 'stream_loop;
                                    }
                                    return Err(format!("Stream error: {}", message));
                                }

                                saw_output |= stream_event_starts_output(&event);
                                attempt_events.push(event);

                                if !state.pending_events.is_empty() {
                                    for pending in state.pending_events.drain(..) {
                                        if let StreamEvent::Error { message } = &pending {
                                            if !saw_output
                                                && should_retry_same_model_before_fallback(
                                                    retry_count,
                                                    message,
                                                )
                                            {
                                                last_error = Some(message.clone());
                                                should_retry_attempt = true;
                                                break 'stream_loop;
                                            }
                                            return Err(format!("Stream error: {}", message));
                                        }

                                        saw_output |= stream_event_starts_output(&pending);
                                        attempt_events.push(pending);
                                    }
                                }
                            }
                            Ok(None) => {
                                if !state.pending_events.is_empty() {
                                    for pending in state.pending_events.drain(..) {
                                        if let StreamEvent::Error { message } = &pending {
                                            if !saw_output
                                                && should_retry_same_model_before_fallback(
                                                    retry_count,
                                                    message,
                                                )
                                            {
                                                last_error = Some(message.clone());
                                                should_retry_attempt = true;
                                                break 'stream_loop;
                                            }
                                            return Err(format!("Stream error: {}", message));
                                        }

                                        saw_output |= stream_event_starts_output(&pending);
                                        attempt_events.push(pending);
                                    }
                                }
                            }
                            Err(err) => return Err(err),
                        }
                    }
                }
            }

            if should_retry_attempt {
                continue;
            }

            for event in attempt_events {
                on_event(event);
            }
            return Ok(());
        }

        Err(last_error.unwrap_or_else(|| "No available model attempts".to_string()))
    }

    async fn resolve_model_info(
        &self,
        model_identifier: &str,
    ) -> Result<(String, String, String), String> {
        let models = self.api_keys.load_models_config().await?;
        let api_keys =
            crate::llm::models::model_registry::ModelRegistry::load_provider_credentials(
                &self.api_keys,
            )
            .await?;
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
}

fn find_sse_delimiter(buf: &[u8]) -> Option<(usize, usize)> {
    if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
        return Some((pos, 4));
    }
    if let Some(pos) = buf.windows(2).position(|w| w == b"\n\n") {
        return Some((pos, 2));
    }
    None
}

struct SseEvent {
    event: Option<String>,
    data: String,
}

fn parse_sse_event(raw: &str) -> Option<SseEvent> {
    let mut event: Option<String> = None;
    let mut data_lines = Vec::new();
    for line in raw.lines() {
        if let Some(rest) = line.strip_prefix("event:") {
            event = Some(rest.trim().to_string());
        } else if let Some(rest) = line.strip_prefix("data:") {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replay_http_sse_transport_state_sets_transport_metadata() {
        let mut state = StreamParseState::default();
        replay_http_sse_transport_state(&mut state);
        assert_eq!(
            state.response_metadata_transport,
            Some(ResponseTransport::HttpSse)
        );
    }

    #[test]
    fn build_attempt_models_preserves_order_and_dedupes() {
        let request = StreamTextRequest {
            model: "primary-model".to_string(),
            fallback_models: Some(vec![
                "primary-model".to_string(),
                "backup-model".to_string(),
                "backup-model-2".to_string(),
            ]),
            messages: vec![],
            tools: None,
            stream: Some(true),
            temperature: None,
            max_tokens: None,
            top_p: None,
            top_k: None,
            provider_options: None,
            request_id: None,
            conversation_mode: None,
            input_mode: None,
            previous_response_id: None,
            transport_session_id: None,
            allow_transport_fallback: None,
            continuation_context: None,
            trace_context: None,
        };

        assert_eq!(
            StreamRunner::build_attempt_models(&request),
            vec![
                "primary-model".to_string(),
                "backup-model".to_string(),
                "backup-model-2".to_string(),
            ]
        );
    }

    #[test]
    fn transient_provider_errors_retry_current_model_before_fallback() {
        let processing_error = "An error occurred while processing your request. You can retry your request, or contact us through our help center at help.openai.com if the error persists. Please include the request ID 57d3c258-9704-418d-b87f-9faab1a82bd8 in your message.";

        assert!(should_retry_same_model_before_fallback(
            0,
            "Our servers are currently overloaded. Please try again later."
        ));
        assert!(should_retry_same_model_before_fallback(2, processing_error));
        assert!(!should_retry_same_model_before_fallback(
            3,
            processing_error
        ));
        assert!(!should_retry_same_model_before_fallback(
            0,
            "A required parameter is missing."
        ));
    }

    #[test]
    fn stream_event_output_detection_matches_retry_safety_requirements() {
        assert!(!stream_event_starts_output(
            &StreamEvent::ResponseMetadata {
                response_id: "resp_1".to_string(),
                transport: ResponseTransport::HttpSse,
                provider: crate::llm::types::ResponseMetadataProvider::OpenAiApi,
                continuation_accepted: Some(true),
                transport_session_id: None,
            }
        ));
        assert!(stream_event_starts_output(&StreamEvent::ToolCall {
            tool_call_id: "call_1".to_string(),
            tool_name: "bash".to_string(),
            input: serde_json::json!({}),
            provider_metadata: None,
        }));
        assert!(stream_event_starts_output(&StreamEvent::ReasoningDelta {
            id: "reasoning_1".to_string(),
            text: "thinking".to_string(),
            provider_metadata: None,
        }));
    }
}
