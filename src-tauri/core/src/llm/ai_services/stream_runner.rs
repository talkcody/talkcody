use crate::llm::protocols::stream_parser::StreamParseState;
use crate::llm::providers::provider::ProviderContext;
use crate::llm::providers::provider_registry::ProviderRegistry;
use crate::llm::types::{StreamEvent, StreamTextRequest};
use futures_util::StreamExt;
use std::time::Duration;

pub struct StreamRunner {
    registry: ProviderRegistry,
    api_keys: crate::llm::auth::api_key_manager::ApiKeyManager,
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
        let (model_key, provider_id, provider_model_name) =
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
        };

        let built_request = provider.build_complete_request(&provider_ctx).await?;

        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(300))
            .gzip(false)
            .brotli(false)
            .tcp_nodelay(true)
            .pool_max_idle_per_host(5)
            .build()
            .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

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
            return Err(format!("HTTP error {}: {}", status, text));
        }

        let mut stream = response.bytes_stream();
        let mut buffer: Vec<u8> = Vec::new();
        let mut state = StreamParseState::default();

        while let Some(chunk) = tokio::time::timeout(timeout, stream.next())
            .await
            .map_err(|_| format!("Stream timeout after {:?}", timeout))?
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
                            on_event(event);

                            if !state.pending_events.is_empty() {
                                for pending in state.pending_events.drain(..) {
                                    on_event(pending);
                                }
                            }
                        }
                        Ok(None) => {
                            if !state.pending_events.is_empty() {
                                for pending in state.pending_events.drain(..) {
                                    on_event(pending);
                                }
                            }
                        }
                        Err(err) => return Err(err),
                    }
                }
            }
        }

        Ok(())
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
