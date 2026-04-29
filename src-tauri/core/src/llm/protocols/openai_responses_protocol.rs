use crate::llm::protocols::stream_parser::StreamParseState;
use crate::llm::protocols::{
    self, parse_openai_usage, request_builder::RequestBuildContext,
    stream_parser::StreamParseContext, LlmProtocol, OpenAiReasoningPartStatus,
    ProtocolRequestBuilder, ProtocolStreamParser, ProtocolStreamState, ToolCallAccum,
};
use crate::llm::types::{
    ContentPart, Message, MessageContent, StreamEvent, ToolDefinition, TransportFallbackSource,
    TransportFallbackTarget,
};
use serde_json::{json, Value};

pub struct OpenAiResponsesProtocol;

impl OpenAiResponsesProtocol {
    fn normalize_model(model_name: &str) -> String {
        // Strip path prefix (e.g. "openai/gpt-4" -> "gpt-4")
        let model_id = if model_name.contains('/') {
            model_name.split('/').next_back().unwrap_or(model_name)
        } else {
            model_name
        };
        // Strip provider suffix (e.g. "gpt-5.1-codex-max@openai" -> "gpt-5.1-codex-max")
        let model_id = model_id.split('@').next().unwrap_or(model_id);
        model_id.to_string()
    }

    fn tool_output_to_string(output: &Value) -> String {
        if let Some(value) = output.get("value").and_then(|v| v.as_str()) {
            return value.to_string();
        }
        output.to_string()
    }

    fn to_input_content(content: &MessageContent) -> Vec<Value> {
        match content {
            MessageContent::Text(text) => {
                if text.trim().is_empty() {
                    Vec::new()
                } else {
                    vec![json!({ "type": "input_text", "text": text })]
                }
            }
            MessageContent::Parts(parts) => {
                let mut mapped = Vec::new();
                for part in parts {
                    match part {
                        ContentPart::Text { text } => {
                            if !text.trim().is_empty() {
                                mapped.push(json!({ "type": "input_text", "text": text }));
                            }
                        }
                        ContentPart::Reasoning { text, .. } => {
                            if !text.trim().is_empty() {
                                mapped.push(json!({ "type": "input_text", "text": text }));
                            }
                        }
                        ContentPart::Image { image } => {
                            mapped.push(json!({
                                "type": "input_image",
                                "image_url": format!("data:image/png;base64,{}", image)
                            }));
                        }
                        _ => {}
                    }
                }
                mapped
            }
        }
    }

    fn append_assistant_items(content: &MessageContent, input_items: &mut Vec<Value>) {
        if let MessageContent::Parts(parts) = content {
            let mut pending_parts: Vec<Value> = Vec::new();

            for part in parts {
                match part {
                    ContentPart::Text { text } => {
                        if !text.trim().is_empty() {
                            pending_parts.push(json!({ "type": "output_text", "text": text }));
                        }
                    }
                    ContentPart::Reasoning { text, .. } => {
                        if !text.trim().is_empty() {
                            pending_parts.push(json!({ "type": "output_text", "text": text }));
                        }
                    }
                    ContentPart::Image { image } => {
                        pending_parts.push(json!({
                            "type": "input_image",
                            "image_url": format!("data:image/png;base64,{}", image)
                        }));
                    }
                    ContentPart::ToolCall {
                        tool_call_id,
                        tool_name,
                        input,
                        provider_metadata: _,
                    } => {
                        if !pending_parts.is_empty() {
                            input_items.push(json!({
                                "type": "message",
                                "role": "assistant",
                                "content": std::mem::take(&mut pending_parts)
                            }));
                        }
                        if tool_name.trim().is_empty() {
                            continue;
                        }

                        let arguments = if input.is_object()
                            || input.is_array()
                            || input.is_string()
                            || input.is_number()
                            || input.is_boolean()
                            || input.is_null()
                        {
                            input.to_string()
                        } else {
                            "{}".to_string()
                        };

                        input_items.push(json!({
                            "type": "function_call",
                            "call_id": tool_call_id,
                            "name": tool_name,
                            "arguments": arguments
                        }));
                    }
                    _ => {}
                }
            }

            if !pending_parts.is_empty() {
                input_items.push(json!({
                    "type": "message",
                    "role": "assistant",
                    "content": pending_parts
                }));
            }
        }
    }
}

impl ProtocolRequestBuilder for OpenAiResponsesProtocol {
    fn build_request(&self, ctx: RequestBuildContext) -> Result<Value, String> {
        let mut input_items: Vec<Value> = Vec::new();

        for msg in ctx.messages {
            match msg {
                Message::System { content, .. } => {
                    if !content.trim().is_empty() {
                        input_items.push(json!({
                            "type": "message",
                            "role": "developer",
                            "content": [{ "type": "input_text", "text": content }]
                        }));
                    }
                }
                Message::User { content, .. } => {
                    let content_parts = Self::to_input_content(content);
                    if !content_parts.is_empty() {
                        input_items.push(json!({
                            "type": "message",
                            "role": "user",
                            "content": content_parts
                        }));
                    }
                }
                Message::Assistant { content, .. } => {
                    Self::append_assistant_items(content, &mut input_items);
                }
                Message::Tool { content, .. } => {
                    for part in content {
                        if let ContentPart::ToolResult {
                            tool_call_id,
                            output,
                            ..
                        } = part
                        {
                            input_items.push(json!({
                                "type": "function_call_output",
                                "call_id": tool_call_id,
                                "output": Self::tool_output_to_string(output)
                            }));
                        }
                    }
                }
            }
        }

        let instructions = include_str!("../../../../../src/services/codex-instructions.md");

        let mut body = json!({
            "model": Self::normalize_model(ctx.model),
            "input": input_items,
            "store": false,
            "stream": true,
            "instructions": instructions,
            "text": { "verbosity": "medium" },
            "reasoning": { "effort": "medium", "summary": "auto" },
            "include": ["reasoning.encrypted_content"]
        });

        if let Some(tools) = ctx.tools {
            let mut mapped_tools = Vec::new();
            for tool in tools {
                mapped_tools.push(json!({
                    "type": "function",
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.parameters
                }));
            }
            body["tools"] = Value::Array(mapped_tools);
        }
        if let Some(temperature) = ctx.temperature {
            body["temperature"] = json!(temperature);
        }
        if let Some(top_p) = ctx.top_p {
            body["top_p"] = json!(top_p);
        }
        if let Some(top_k) = ctx.top_k {
            body["top_k"] = json!(top_k);
        }
        if let Some(previous_response_id) = ctx.previous_response_id {
            if !previous_response_id.trim().is_empty() {
                body["previous_response_id"] = json!(previous_response_id);
            }
        }
        if let Some(provider_options) = ctx.provider_options {
            if let Some(openai_opts) = provider_options.get("openai") {
                if let Some(reasoning_effort) = openai_opts.get("reasoningEffort") {
                    if let Some(reasoning) = body.get_mut("reasoning") {
                        if let Some(obj) = reasoning.as_object_mut() {
                            obj.insert("effort".to_string(), reasoning_effort.clone());
                        }
                    }
                }
            }
            if let Some(openrouter_opts) = provider_options.get("openrouter") {
                if let Some(effort) = openrouter_opts.get("effort") {
                    if let Some(reasoning) = body.get_mut("reasoning") {
                        if let Some(obj) = reasoning.as_object_mut() {
                            obj.insert("effort".to_string(), effort.clone());
                        }
                    }
                }
            }
        }
        if let Some(extra_body) = ctx.extra_body {
            if let Some(obj) = extra_body.as_object() {
                for (k, v) in obj {
                    body[k] = v.clone();
                }
            }
        }

        Ok(body)
    }
}

impl ProtocolStreamParser for OpenAiResponsesProtocol {
    fn parse_stream_event(
        &self,
        ctx: StreamParseContext,
        state: &mut StreamParseState,
    ) -> Result<Option<StreamEvent>, String> {
        parse_openai_oauth_event(ctx.event_type, ctx.data, state)
    }
}

fn build_openai_oauth_tool_input(arguments: &str, force: bool) -> Option<Value> {
    if arguments.trim().is_empty() {
        return if force { Some(json!({})) } else { None };
    }

    match serde_json::from_str(arguments) {
        Ok(value) => Some(value),
        Err(_) => {
            if force {
                Some(Value::String(arguments.to_string()))
            } else {
                None
            }
        }
    }
}

fn extract_response_id(payload: &Value) -> Option<String> {
    payload
        .get("response")
        .and_then(|response| response.get("id"))
        .and_then(|value| value.as_str())
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn push_response_metadata_event(state: &mut ProtocolStreamState) {
    let Some(response_id) = state.response_id.clone() else {
        return;
    };
    let Some(provider) = state.response_metadata_provider else {
        return;
    };
    let Some(transport) = state.response_metadata_transport else {
        return;
    };

    state.pending_events.push(StreamEvent::ResponseMetadata {
        response_id,
        transport,
        provider,
        continuation_accepted: state.response_metadata_continuation_accepted,
        transport_session_id: state.response_metadata_transport_session_id.clone(),
    });
    state.response_metadata_emitted = true;
}

fn queue_response_metadata_if_ready(state: &mut ProtocolStreamState) {
    if state.response_metadata_emitted {
        return;
    }

    if state.response_metadata_continuation_requested
        && state.response_metadata_continuation_accepted.is_none()
    {
        return;
    }

    push_response_metadata_event(state);
}

fn capture_response_metadata(payload: &Value, state: &mut ProtocolStreamState) {
    if state.response_id.is_none() {
        state.response_id = extract_response_id(payload);
    }
    queue_response_metadata_if_ready(state);
}

fn mark_continuation_accepted_if_ready(state: &mut ProtocolStreamState) {
    if state.response_metadata_continuation_requested
        && state.response_metadata_continuation_accepted.is_none()
    {
        state.response_metadata_continuation_accepted = Some(true);
    }
    queue_response_metadata_if_ready(state);
}

fn mark_response_activity_started(state: &mut ProtocolStreamState) {
    state.response_activity_started = true;
    mark_continuation_accepted_if_ready(state);
}

fn extract_response_error(payload: &Value) -> Option<&Value> {
    payload
        .get("response")
        .and_then(|response| response.get("error"))
        .or_else(|| payload.get("error"))
}

fn extract_response_error_message(payload: &Value) -> Option<String> {
    extract_response_error(payload)
        .and_then(|error| error.get("message"))
        .and_then(|value| value.as_str())
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| {
            payload
                .get("message")
                .or_else(|| payload.get("detail"))
                .and_then(|value| value.as_str())
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        })
}

fn extract_response_error_code(payload: &Value) -> Option<String> {
    extract_response_error(payload)
        .and_then(|error| error.get("code").or_else(|| error.get("error_code")))
        .or_else(|| payload.get("code").or_else(|| payload.get("error_code")))
        .and_then(|value| value.as_str())
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn extract_response_error_param(payload: &Value) -> Option<String> {
    extract_response_error(payload)
        .and_then(|error| error.get("param"))
        .or_else(|| payload.get("param"))
        .and_then(|value| value.as_str())
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn continuation_rejection_reason(payload: &Value, state: &ProtocolStreamState) -> Option<String> {
    if !state.response_metadata_continuation_requested {
        return None;
    }

    let code = extract_response_error_code(payload);
    let message = extract_response_error_message(payload);
    let param = extract_response_error_param(payload);

    let matches_continuation = |value: &str| {
        let normalized = value.to_ascii_lowercase();
        normalized.contains("previous_response") || normalized.contains("continuation")
    };

    if code.as_deref().is_some_and(matches_continuation) {
        return code;
    }
    if param
        .as_deref()
        .is_some_and(|value| value.eq_ignore_ascii_case("previous_response_id"))
    {
        return code.or(param).or(message);
    }
    if message.as_deref().is_some_and(matches_continuation) {
        return code.or(message);
    }

    None
}

pub(crate) fn classify_continuation_rejection(
    payload: &Value,
    continuation_requested: bool,
) -> Option<String> {
    let state = ProtocolStreamState {
        response_metadata_continuation_requested: continuation_requested,
        ..Default::default()
    };
    continuation_rejection_reason(payload, &state)
}

fn queue_continuation_rejection_events(payload: &Value, state: &mut ProtocolStreamState) {
    let Some(reason) = continuation_rejection_reason(payload, state) else {
        return;
    };

    state.response_metadata_continuation_accepted = Some(false);
    if state.response_metadata_emitted {
        push_response_metadata_event(state);
    } else {
        queue_response_metadata_if_ready(state);
    }

    if !state.response_activity_started {
        let fallback_target = if state.response_metadata_transport
            == Some(crate::llm::types::ResponseTransport::Websocket)
        {
            TransportFallbackTarget::FreshWebsocketBaseline
        } else {
            TransportFallbackTarget::Stateless
        };
        state.pending_events.push(StreamEvent::TransportFallback {
            reason,
            from: TransportFallbackSource::ResponsesChained,
            to: fallback_target,
        });
    }
}

pub(crate) fn parse_openai_oauth_event(
    event_type: Option<&str>,
    data: &str,
    state: &mut StreamParseState,
) -> Result<Option<StreamEvent>, String> {
    let mut legacy_state = ProtocolStreamState {
        finish_reason: state.finish_reason.clone(),
        tool_calls: std::mem::take(&mut state.tool_calls),
        tool_call_order: std::mem::take(&mut state.tool_call_order),
        emitted_tool_calls: std::mem::take(&mut state.emitted_tool_calls),
        tool_call_index_map: std::mem::take(&mut state.tool_call_index_map),
        current_thinking_id: state.current_thinking_id.clone(),
        pending_events: std::mem::take(&mut state.pending_events),
        text_started: state.text_started,
        content_block_types: std::mem::take(&mut state.content_block_types),
        content_block_ids: std::mem::take(&mut state.content_block_ids),
        reasoning_started: state.reasoning_started,
        reasoning_id: state.reasoning_id.clone(),
        openai_reasoning: std::mem::take(&mut state.openai_reasoning),
        openai_store: state.openai_store,
        response_id: state.response_id.clone(),
        response_metadata_emitted: state.response_metadata_emitted,
        response_metadata_provider: state.response_metadata_provider,
        response_metadata_transport: state.response_metadata_transport,
        response_metadata_transport_session_id: state
            .response_metadata_transport_session_id
            .clone(),
        response_metadata_continuation_requested: state.response_metadata_continuation_requested,
        response_activity_started: state.response_activity_started,
        response_metadata_continuation_accepted: state.response_metadata_continuation_accepted,
    };

    let result = parse_openai_oauth_event_legacy(event_type, data, &mut legacy_state);

    state.finish_reason = legacy_state.finish_reason;
    state.text_started = legacy_state.text_started;
    state.reasoning_started = legacy_state.reasoning_started;
    state.reasoning_id = legacy_state.reasoning_id;
    state.pending_events = legacy_state.pending_events;
    state.tool_calls = legacy_state.tool_calls;
    state.tool_call_order = legacy_state.tool_call_order;
    state.emitted_tool_calls = legacy_state.emitted_tool_calls;
    state.tool_call_index_map = legacy_state.tool_call_index_map;
    state.content_block_types = legacy_state.content_block_types;
    state.content_block_ids = legacy_state.content_block_ids;
    state.current_thinking_id = legacy_state.current_thinking_id;
    state.openai_reasoning = legacy_state.openai_reasoning;
    state.openai_store = legacy_state.openai_store;
    state.response_id = legacy_state.response_id;
    state.response_metadata_emitted = legacy_state.response_metadata_emitted;
    state.response_metadata_provider = legacy_state.response_metadata_provider;
    state.response_metadata_transport = legacy_state.response_metadata_transport;
    state.response_metadata_transport_session_id =
        legacy_state.response_metadata_transport_session_id;
    state.response_metadata_continuation_requested =
        legacy_state.response_metadata_continuation_requested;
    state.response_activity_started = legacy_state.response_activity_started;
    state.response_metadata_continuation_accepted =
        legacy_state.response_metadata_continuation_accepted;

    result
}

pub(crate) fn parse_openai_oauth_event_legacy(
    event_type: Option<&str>,
    data: &str,
    state: &mut ProtocolStreamState,
) -> Result<Option<StreamEvent>, String> {
    let emit_tool_calls = |state: &mut ProtocolStreamState, force: bool| {
        for key in state.tool_call_order.clone() {
            if state.emitted_tool_calls.contains(&key) {
                continue;
            }
            if let Some(acc) = state.tool_calls.get(&key) {
                if acc.tool_name.is_empty() {
                    continue;
                }

                let input_value = match build_openai_oauth_tool_input(&acc.arguments, force) {
                    Some(value) => value,
                    None => continue,
                };

                state.pending_events.push(StreamEvent::ToolCall {
                    tool_call_id: acc.tool_call_id.clone(),
                    tool_name: acc.tool_name.clone(),
                    input: input_value,
                    provider_metadata: None,
                });
                state.emitted_tool_calls.insert(key);
            }
        }
    };

    let payload: Value = serde_json::from_str(data).map_err(|e| e.to_string())?;
    capture_response_metadata(&payload, state);

    if payload.get("object").and_then(|v| v.as_str()) == Some("chat.completion.chunk") {
        mark_response_activity_started(state);
        if let Some(usage) = payload.get("usage") {
            let parsed_usage = parse_openai_usage(usage);
            if parsed_usage.has_meaningful_data() {
                state.pending_events.push(StreamEvent::Usage {
                    input_tokens: parsed_usage.input_tokens,
                    output_tokens: parsed_usage.output_tokens,
                    total_tokens: parsed_usage.total_tokens,
                    cached_input_tokens: parsed_usage.cached_input_tokens,
                    cache_creation_input_tokens: parsed_usage.cache_creation_input_tokens,
                });
            }
        }

        if let Some(choices) = payload.get("choices").and_then(|v| v.as_array()) {
            if let Some(choice) = choices.first() {
                if let Some(finish_reason) = choice.get("finish_reason").and_then(|v| v.as_str()) {
                    state.finish_reason = Some(finish_reason.to_string());
                }
                if let Some(delta) = choice.get("delta") {
                    if !state.text_started {
                        state.text_started = true;
                        state.pending_events.push(StreamEvent::TextStart);
                    }
                    if let Some(content) = delta.get("content").and_then(|v| v.as_str()) {
                        if !content.is_empty() {
                            state.pending_events.push(StreamEvent::TextDelta {
                                text: content.to_string(),
                            });
                        }
                    }
                }
            }
        }

        if let Some(event) = state.pending_events.first().cloned() {
            state.pending_events.remove(0);
            return Ok(Some(event));
        }
        return Ok(None);
    }

    if event_type.is_none() {
        if let Some(store) = payload.get("response").and_then(|r| r.get("store")) {
            if let Some(store_value) = store.as_bool() {
                state.openai_store = Some(store_value);
            }
        }
    }

    let mut resolved_event = event_type.map(|value| value.to_string());
    if resolved_event.as_deref() == Some("message") {
        resolved_event = None;
    }
    if resolved_event.is_none() {
        resolved_event = payload
            .get("type")
            .and_then(|v| v.as_str())
            .map(|v| v.to_string())
            .or_else(|| {
                payload
                    .get("event")
                    .and_then(|v| v.as_str())
                    .map(|v| v.to_string())
            })
            .or_else(|| {
                payload
                    .get("kind")
                    .and_then(|v| v.as_str())
                    .map(|v| v.to_string())
            });
    }

    let event_type = match resolved_event {
        Some(value) => value,
        None => return Ok(None),
    };

    if matches!(
        event_type.as_str(),
        "response.output_item.added"
            | "response.content_part.added"
            | "response.output_text.delta"
            | "response.output_text.done"
            | "response.function_call_arguments.delta"
            | "response.function_call_arguments.done"
            | "response.reasoning_summary_part.added"
            | "response.reasoning_summary_text.delta"
            | "response.reasoning_summary_part.done"
            | "response.output_item.done"
            | "response.reasoning_text.delta"
            | "response.reasoning_text.done"
            | "response.reasoning_part.added"
            | "response.reasoning_content.delta"
            | "response.reasoning_part.done"
            | "response.completed"
    ) {
        mark_response_activity_started(state);
    }

    match event_type.as_str() {
        "response.created" | "response.in_progress" => {
            log::debug!("[OpenAI OAuth] Response lifecycle event: {}", event_type);
            if let Some(store) = payload.get("response").and_then(|r| r.get("store")) {
                if let Some(store_value) = store.as_bool() {
                    state.openai_store = Some(store_value);
                }
            }
        }
        "response.output_item.added" => {
            log::debug!("[OpenAI OAuth] Output item added: {:?}", payload);
            if let Some(item) = payload.get("item") {
                match item.get("type").and_then(|v| v.as_str()) {
                    Some("function_call") => {
                        // Avoid TextStart here so tool messages stay ordered before the next assistant reply.

                        let item_id = item
                            .get("id")
                            .and_then(|v| v.as_str())
                            .unwrap_or_default()
                            .to_string();
                        let call_id = item
                            .get("call_id")
                            .and_then(|v| v.as_str())
                            .unwrap_or_default()
                            .to_string();
                        let name = item
                            .get("name")
                            .and_then(|v| v.as_str())
                            .unwrap_or_default()
                            .to_string();

                        if !item_id.is_empty() {
                            let acc =
                                state.tool_calls.entry(item_id.clone()).or_insert_with(|| {
                                    ToolCallAccum {
                                        tool_call_id: if call_id.is_empty() {
                                            item_id.clone()
                                        } else {
                                            call_id.clone()
                                        },
                                        tool_name: name.clone(),
                                        arguments: String::new(),
                                        thought_signature: None,
                                    }
                                });
                            if !call_id.is_empty() {
                                acc.tool_call_id = call_id;
                            }
                            if !name.is_empty() {
                                acc.tool_name = name;
                            }
                            let index = item
                                .get("index")
                                .and_then(|v| v.as_u64())
                                .map(|value| value as usize);
                            if let Some(order_index) = index {
                                if state.tool_call_order.len() <= order_index {
                                    state.tool_call_order.resize(order_index + 1, String::new());
                                }
                                let slot = &mut state.tool_call_order[order_index];
                                if slot.is_empty() || *slot == item_id {
                                    *slot = item_id.clone();
                                }
                            } else if !state.tool_call_order.contains(&item_id) {
                                state.tool_call_order.push(item_id.clone());
                            }
                        }
                    }
                    Some("reasoning") => {
                        let item_id = item
                            .get("id")
                            .and_then(|v| v.as_str())
                            .unwrap_or("reasoning")
                            .to_string();
                        let encrypted_content = item
                            .get("encrypted_content")
                            .and_then(|v| v.as_str())
                            .map(|value| value.to_string());
                        let active = state.openai_reasoning.entry(item_id.clone()).or_default();
                        if encrypted_content.is_some() {
                            active.encrypted_content = encrypted_content.clone();
                        }
                        active
                            .summary_parts
                            .entry(0)
                            .or_insert(OpenAiReasoningPartStatus::Active);

                        let provider_metadata = serde_json::json!({
                            "openai": {
                                "itemId": item_id,
                                "reasoningEncryptedContent": encrypted_content
                            }
                        });

                        state.pending_events.push(StreamEvent::ReasoningStart {
                            id: format!("{}:0", item_id),
                            provider_metadata: Some(provider_metadata),
                        });

                        if let Some(summary) = item.get("summary").and_then(|v| v.as_array()) {
                            for (index, summary_item) in summary.iter().enumerate() {
                                let text = summary_item
                                    .get("text")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("");
                                if text.is_empty() {
                                    continue;
                                }
                                let summary_index = index as u64;
                                let entry = active
                                    .summary_parts
                                    .entry(summary_index)
                                    .or_insert(OpenAiReasoningPartStatus::Active);
                                if summary_index != 0 && *entry == OpenAiReasoningPartStatus::Active
                                {
                                    let provider_metadata = serde_json::json!({
                                        "openai": {
                                            "itemId": item_id,
                                            "reasoningEncryptedContent": active.encrypted_content
                                        }
                                    });
                                    state.pending_events.push(StreamEvent::ReasoningStart {
                                        id: format!("{}:{}", item_id, summary_index),
                                        provider_metadata: Some(provider_metadata),
                                    });
                                }

                                state.pending_events.push(StreamEvent::ReasoningDelta {
                                    id: format!("{}:{}", item_id, summary_index),
                                    text: text.to_string(),
                                    provider_metadata: Some(serde_json::json!({
                                        "openai": {
                                            "itemId": item_id
                                        }
                                    })),
                                });

                                let store = state.openai_store.unwrap_or(true);
                                if store {
                                    state.pending_events.push(StreamEvent::ReasoningEnd {
                                        id: format!("{}:{}", item_id, summary_index),
                                    });
                                    active.summary_parts.insert(
                                        summary_index,
                                        OpenAiReasoningPartStatus::Concluded,
                                    );
                                } else {
                                    active.summary_parts.insert(
                                        summary_index,
                                        OpenAiReasoningPartStatus::CanConclude,
                                    );
                                }
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
        "response.content_part.added" => {
            log::debug!("[OpenAI OAuth] Content part added: {:?}", payload);
            if let Some(part) = payload.get("part") {
                let part_type = part.get("type").and_then(|v| v.as_str());

                match part_type {
                    Some("text") | Some("output_text") => {
                        if let Some(text) = part.get("text").and_then(|v| v.as_str()) {
                            if !state.text_started {
                                state.text_started = true;
                                state.pending_events.push(StreamEvent::TextStart);
                            }
                            state.pending_events.push(StreamEvent::TextDelta {
                                text: text.to_string(),
                            });
                        }
                    }
                    _ => {
                        // Unknown part type, ignore
                        log::debug!("[OpenAI OAuth] Unknown content part type: {:?}", part_type);
                    }
                }
            }
        }
        "response.output_text.delta" => {
            log::debug!("[OpenAI OAuth] Output text delta: {:?}", payload);
            if !state.text_started {
                state.text_started = true;
                state.pending_events.push(StreamEvent::TextStart);
            }
            if let Some(delta) = payload.get("delta").and_then(|v| v.as_str()) {
                if !delta.is_empty() {
                    state.pending_events.push(StreamEvent::TextDelta {
                        text: delta.to_string(),
                    });
                }
            }
        }
        "response.output_text.done" => {
            log::debug!("[OpenAI OAuth] Output text done");
        }
        "response.function_call_arguments.delta" => {
            log::debug!("[OpenAI OAuth] Function call args delta");
            parse_openai_oauth_function_call_delta(&payload, state);
            emit_tool_calls(state, false);
        }
        "response.function_call_arguments.done" => {
            log::debug!("[OpenAI OAuth] Function call args done");
            if let Some(event) = parse_openai_oauth_function_call_done(&payload, state) {
                state.pending_events.push(event);
            }
            emit_tool_calls(state, true);
        }
        "response.reasoning_summary_part.added" => {
            log::debug!("[OpenAI OAuth] Reasoning summary part added: {:?}", payload);
            let item_id = payload
                .get("item_id")
                .and_then(|v| v.as_str())
                .unwrap_or("reasoning")
                .to_string();
            let summary_index = payload
                .get("summary_index")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);

            let state_entry = state.openai_reasoning.entry(item_id.clone()).or_default();

            state_entry
                .summary_parts
                .entry(summary_index)
                .or_insert(OpenAiReasoningPartStatus::Active);

            if summary_index > 0 {
                let can_conclude: Vec<u64> = state_entry
                    .summary_parts
                    .iter()
                    .filter_map(|(index, status)| {
                        if *status == OpenAiReasoningPartStatus::CanConclude {
                            Some(*index)
                        } else {
                            None
                        }
                    })
                    .collect();
                for index in can_conclude {
                    state.pending_events.push(StreamEvent::ReasoningEnd {
                        id: format!("{}:{}", item_id, index),
                    });
                    state_entry
                        .summary_parts
                        .insert(index, OpenAiReasoningPartStatus::Concluded);
                }

                let provider_metadata = serde_json::json!({
                    "openai": {
                        "itemId": item_id,
                        "reasoningEncryptedContent": state_entry.encrypted_content
                    }
                });
                state.pending_events.push(StreamEvent::ReasoningStart {
                    id: format!("{}:{}", item_id, summary_index),
                    provider_metadata: Some(provider_metadata),
                });
            }
        }
        "response.reasoning_summary_text.delta" => {
            let item_id = payload
                .get("item_id")
                .and_then(|v| v.as_str())
                .unwrap_or("reasoning")
                .to_string();
            let summary_index = payload
                .get("summary_index")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            let delta = payload.get("delta").and_then(|v| v.as_str()).unwrap_or("");
            if !delta.is_empty() {
                state.pending_events.push(StreamEvent::ReasoningDelta {
                    id: format!("{}:{}", item_id, summary_index),
                    text: delta.to_string(),
                    provider_metadata: Some(serde_json::json!({
                        "openai": {
                            "itemId": item_id
                        }
                    })),
                });
            }
        }
        "response.reasoning_summary_part.done" => {
            log::debug!("[OpenAI OAuth] Reasoning summary part done: {:?}", payload);
            let item_id = payload
                .get("item_id")
                .and_then(|v| v.as_str())
                .unwrap_or("reasoning")
                .to_string();
            let summary_index = payload
                .get("summary_index")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);

            let store = state.openai_store.unwrap_or(true);
            if let Some(active) = state.openai_reasoning.get_mut(&item_id) {
                if store {
                    state.pending_events.push(StreamEvent::ReasoningEnd {
                        id: format!("{}:{}", item_id, summary_index),
                    });
                    active
                        .summary_parts
                        .insert(summary_index, OpenAiReasoningPartStatus::Concluded);
                } else {
                    active
                        .summary_parts
                        .insert(summary_index, OpenAiReasoningPartStatus::CanConclude);
                }
            }
        }
        "response.output_item.done" => {
            log::debug!("[OpenAI OAuth] Output item done: {:?}", payload);
            if let Some(item) = payload.get("item") {
                if item.get("type").and_then(|v| v.as_str()) == Some("reasoning") {
                    let item_id = item
                        .get("id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("reasoning")
                        .to_string();
                    let encrypted_content = item
                        .get("encrypted_content")
                        .and_then(|v| v.as_str())
                        .map(|value| value.to_string());

                    if let Some(active) = state.openai_reasoning.get_mut(&item_id) {
                        if encrypted_content.is_some() {
                            active.encrypted_content = encrypted_content.clone();
                        }
                        let provider_metadata = serde_json::json!({
                            "openai": {
                                "itemId": item_id,
                                "reasoningEncryptedContent": active.encrypted_content
                            }
                        });
                        let to_close: Vec<u64> = active
                            .summary_parts
                            .iter()
                            .filter_map(|(index, status)| {
                                if *status == OpenAiReasoningPartStatus::Active
                                    || *status == OpenAiReasoningPartStatus::CanConclude
                                {
                                    Some(*index)
                                } else {
                                    None
                                }
                            })
                            .collect();
                        for index in to_close {
                            state.pending_events.push(StreamEvent::ReasoningDelta {
                                id: format!("{}:{}", item_id, index),
                                text: String::new(),
                                provider_metadata: Some(provider_metadata.clone()),
                            });
                            state.pending_events.push(StreamEvent::ReasoningEnd {
                                id: format!("{}:{}", item_id, index),
                            });
                            active
                                .summary_parts
                                .insert(index, OpenAiReasoningPartStatus::Concluded);
                        }
                    }
                    state.openai_reasoning.remove(&item_id);
                }
            }
        }
        "response.reasoning_text.delta" => {
            log::debug!(
                "[OpenAI OAuth] Ignoring legacy reasoning text delta: {:?}",
                payload
            );
        }
        "response.reasoning_text.done" => {
            log::debug!(
                "[OpenAI OAuth] Ignoring legacy reasoning text done: {:?}",
                payload
            );
        }
        "response.reasoning_part.added" => {
            log::debug!(
                "[OpenAI OAuth] Ignoring legacy reasoning part added: {:?}",
                payload
            );
        }
        "response.reasoning_content.delta" => {
            log::debug!("[OpenAI OAuth] Reasoning content delta: {:?}", payload);
            let item_id = payload
                .get("item_id")
                .and_then(|v| v.as_str())
                .unwrap_or("reasoning")
                .to_string();
            let delta = payload.get("delta").and_then(|v| v.as_str()).unwrap_or("");

            // Get or create reasoning state
            let state_entry = state.openai_reasoning.entry(item_id.clone()).or_default();

            // Mark part 0 as active and check if this is the first start
            let first_start = state_entry
                .summary_parts
                .insert(0, OpenAiReasoningPartStatus::Active)
                .is_none();

            let reasoning_id = format!("{}:0", item_id);

            let provider_metadata = serde_json::json!({
                "openai": {
                    "itemId": item_id.clone()
                }
            });

            // Push ReasoningStart event only on first start
            if first_start {
                state.pending_events.push(StreamEvent::ReasoningStart {
                    id: reasoning_id.clone(),
                    provider_metadata: Some(provider_metadata.clone()),
                });
            }

            // Push ReasoningDelta event
            if !delta.is_empty() {
                state.pending_events.push(StreamEvent::ReasoningDelta {
                    id: reasoning_id,
                    text: delta.to_string(),
                    provider_metadata: Some(provider_metadata),
                });
            }
        }
        "response.reasoning_part.done" => {
            log::debug!("[OpenAI OAuth] Reasoning part done: {:?}", payload);
            let item_id = payload
                .get("item_id")
                .and_then(|v| v.as_str())
                .unwrap_or("reasoning")
                .to_string();

            if let Some(active) = state.openai_reasoning.get_mut(&item_id) {
                active
                    .summary_parts
                    .insert(0, OpenAiReasoningPartStatus::Concluded);
            }

            // Push ReasoningEnd event
            state.pending_events.push(StreamEvent::ReasoningEnd {
                id: format!("{}:0", item_id),
            });
        }
        "response.completed" => {
            log::debug!("[OpenAI OAuth] Response completed");
            if let Some(response) = payload.get("response") {
                if let Some(store) = response.get("store").and_then(|v| v.as_bool()) {
                    state.openai_store = Some(store);
                }
                if let Some(usage) = response.get("usage") {
                    let parsed_usage = parse_openai_usage(usage);
                    if parsed_usage.has_meaningful_data() {
                        state.pending_events.push(StreamEvent::Usage {
                            input_tokens: parsed_usage.input_tokens,
                            output_tokens: parsed_usage.output_tokens,
                            total_tokens: parsed_usage.total_tokens,
                            cached_input_tokens: parsed_usage.cached_input_tokens,
                            cache_creation_input_tokens: parsed_usage.cache_creation_input_tokens,
                        });
                    }
                }
                // Only emit text from response.completed if no text was streamed
                // via response.output_text.delta events (prevents duplicate messages)
                if !state.text_started {
                    if let Some(output) = response.get("output").and_then(|v| v.as_array()) {
                        for item in output {
                            if let Some(content) = item.get("content").and_then(|v| v.as_array()) {
                                for part in content {
                                    if let Some(text) = part.get("text").and_then(|v| v.as_str()) {
                                        if !state.text_started {
                                            state.text_started = true;
                                            state.pending_events.push(StreamEvent::TextStart);
                                        }
                                        state.pending_events.push(StreamEvent::TextDelta {
                                            text: text.to_string(),
                                        });
                                    }
                                    if let Some(delta) = part.get("delta").and_then(|v| v.as_str())
                                    {
                                        if !delta.is_empty() {
                                            if !state.text_started {
                                                state.text_started = true;
                                                state.pending_events.push(StreamEvent::TextStart);
                                            }
                                            state.pending_events.push(StreamEvent::TextDelta {
                                                text: delta.to_string(),
                                            });
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                if let Some(output) = response.get("output").and_then(|v| v.as_array()) {
                    for item in output {
                        if item.get("type").and_then(|v| v.as_str()) == Some("reasoning") {
                            let item_id = item
                                .get("id")
                                .and_then(|v| v.as_str())
                                .unwrap_or("reasoning")
                                .to_string();
                            let encrypted_content = item
                                .get("encrypted_content")
                                .and_then(|v| v.as_str())
                                .map(|value| value.to_string());

                            if let Some(active) = state.openai_reasoning.get_mut(&item_id) {
                                if encrypted_content.is_some() {
                                    active.encrypted_content = encrypted_content.clone();
                                }
                                let provider_metadata = serde_json::json!({
                                    "openai": {
                                        "itemId": item_id,
                                        "reasoningEncryptedContent": active.encrypted_content
                                    }
                                });
                                let to_close: Vec<u64> = active
                                    .summary_parts
                                    .iter()
                                    .filter_map(|(index, status)| {
                                        if *status == OpenAiReasoningPartStatus::Active
                                            || *status == OpenAiReasoningPartStatus::CanConclude
                                        {
                                            Some(*index)
                                        } else {
                                            None
                                        }
                                    })
                                    .collect();
                                for index in to_close {
                                    state.pending_events.push(StreamEvent::ReasoningDelta {
                                        id: format!("{}:{}", item_id, index),
                                        text: String::new(),
                                        provider_metadata: Some(provider_metadata.clone()),
                                    });
                                    state.pending_events.push(StreamEvent::ReasoningEnd {
                                        id: format!("{}:{}", item_id, index),
                                    });
                                    active
                                        .summary_parts
                                        .insert(index, OpenAiReasoningPartStatus::Concluded);
                                }
                            }
                            state.openai_reasoning.remove(&item_id);
                        }
                    }
                }
            }
            state.pending_events.push(StreamEvent::Done {
                finish_reason: state.finish_reason.clone(),
            });
        }
        "response.failed" | "error" => {
            queue_continuation_rejection_events(&payload, state);
            let message = extract_response_error_message(&payload)
                .unwrap_or_else(|| "Response failed".to_string());
            log::error!("[OpenAI OAuth] Response failed: {}", message);
            state.pending_events.push(StreamEvent::Error { message });
        }
        _ => {
            log::debug!("[OpenAI OAuth] Unknown event type: {}", event_type);
        }
    }

    if let Some(event) = state.pending_events.first().cloned() {
        state.pending_events.remove(0);
        return Ok(Some(event));
    }

    Ok(None)
}

fn parse_openai_oauth_function_call_delta(payload: &Value, state: &mut ProtocolStreamState) {
    let item_id = payload
        .get("item_id")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    if item_id.is_empty() {
        return;
    }
    let delta = payload.get("delta").and_then(|v| v.as_str()).unwrap_or("");
    let acc = state
        .tool_calls
        .entry(item_id.clone())
        .or_insert_with(|| ToolCallAccum {
            tool_call_id: item_id.clone(),
            tool_name: String::new(),
            arguments: String::new(),
            thought_signature: None,
        });
    if !delta.is_empty() {
        acc.arguments.push_str(delta);
    }
    let index = payload
        .get("index")
        .and_then(|v| v.as_u64())
        .map(|value| value as usize);
    if let Some(order_index) = index {
        if state.tool_call_order.len() <= order_index {
            state.tool_call_order.resize(order_index + 1, String::new());
        }
        let slot = &mut state.tool_call_order[order_index];
        if slot.is_empty() || *slot == item_id {
            *slot = item_id.clone();
        }
    } else if !state.tool_call_order.contains(&item_id) {
        state.tool_call_order.push(item_id.clone());
    }
}

pub(crate) fn parse_openai_oauth_function_call_done(
    payload: &Value,
    state: &mut ProtocolStreamState,
) -> Option<StreamEvent> {
    let item_id = payload
        .get("item_id")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    if item_id.is_empty() {
        return None;
    }

    if state.emitted_tool_calls.contains(&item_id) {
        return None;
    }

    let name = payload
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    let args = payload
        .get("arguments")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();

    let acc = state
        .tool_calls
        .entry(item_id.clone())
        .or_insert_with(|| ToolCallAccum {
            tool_call_id: item_id.clone(),
            tool_name: name.clone(),
            arguments: String::new(),
            thought_signature: None,
        });

    if !name.is_empty() {
        acc.tool_name = name;
    }
    if !args.is_empty() {
        acc.arguments = args;
    }

    if acc.tool_name.trim().is_empty() {
        return None;
    }

    let index = payload
        .get("index")
        .and_then(|v| v.as_u64())
        .map(|value| value as usize);
    if let Some(order_index) = index {
        if state.tool_call_order.len() <= order_index {
            state.tool_call_order.resize(order_index + 1, String::new());
        }
        let slot = &mut state.tool_call_order[order_index];
        if slot.is_empty() || *slot == item_id {
            *slot = item_id.clone();
        }
    } else if !state.tool_call_order.contains(&item_id) {
        state.tool_call_order.push(item_id.clone());
    }
    state.emitted_tool_calls.insert(item_id.clone());

    let input_value = match build_openai_oauth_tool_input(&acc.arguments, true) {
        Some(value) => value,
        None => json!({}),
    };

    Some(StreamEvent::ToolCall {
        tool_call_id: acc.tool_call_id.clone(),
        tool_name: acc.tool_name.clone(),
        input: input_value,
        provider_metadata: None,
    })
}

// ============================================================================
// Legacy Trait Implementation (delegates to modular traits)
// ============================================================================

impl LlmProtocol for OpenAiResponsesProtocol {
    fn name(&self) -> &str {
        "openai_responses"
    }

    fn endpoint_path(&self) -> &'static str {
        "codex/responses"
    }

    fn build_request(
        &self,
        model: &str,
        messages: &[Message],
        tools: Option<&[ToolDefinition]>,
        temperature: Option<f32>,
        max_tokens: Option<i32>,
        top_p: Option<f32>,
        top_k: Option<i32>,
        provider_options: Option<&Value>,
        extra_body: Option<&Value>,
    ) -> Result<Value, String> {
        let ctx = RequestBuildContext {
            model,
            messages,
            tools,
            temperature,
            max_tokens,
            top_p,
            top_k,
            provider_options,
            extra_body,
            conversation_mode: None,
            input_mode: None,
            previous_response_id: None,
            transport_session_id: None,
            allow_transport_fallback: None,
            continuation_context: None,
        };
        ProtocolRequestBuilder::build_request(self, ctx)
    }

    fn parse_stream_event(
        &self,
        event_type: Option<&str>,
        data: &str,
        state: &mut ProtocolStreamState,
    ) -> Result<Option<StreamEvent>, String> {
        let ctx = StreamParseContext { event_type, data };
        let mut new_state = protocols::stream_parser::StreamParseState {
            finish_reason: state.finish_reason.clone(),
            text_started: state.text_started,
            reasoning_started: state.reasoning_started,
            reasoning_id: state.reasoning_id.clone(),
            pending_events: std::mem::take(&mut state.pending_events),
            tool_calls: std::mem::take(&mut state.tool_calls),
            tool_call_order: std::mem::take(&mut state.tool_call_order),
            emitted_tool_calls: std::mem::take(&mut state.emitted_tool_calls),
            tool_call_index_map: std::mem::take(&mut state.tool_call_index_map),
            content_block_types: std::mem::take(&mut state.content_block_types),
            content_block_ids: std::mem::take(&mut state.content_block_ids),
            current_thinking_id: state.current_thinking_id.clone(),
            openai_reasoning: std::mem::take(&mut state.openai_reasoning),
            openai_store: state.openai_store,
            response_id: state.response_id.clone(),
            response_metadata_emitted: state.response_metadata_emitted,
            response_metadata_provider: state.response_metadata_provider,
            response_metadata_transport: state.response_metadata_transport,
            response_metadata_transport_session_id: state
                .response_metadata_transport_session_id
                .clone(),
            response_metadata_continuation_requested: state
                .response_metadata_continuation_requested,
            response_activity_started: state.response_activity_started,
            response_metadata_continuation_accepted: state.response_metadata_continuation_accepted,
        };

        let result = ProtocolStreamParser::parse_stream_event(self, ctx, &mut new_state);

        state.finish_reason = new_state.finish_reason;
        state.text_started = new_state.text_started;
        state.reasoning_started = new_state.reasoning_started;
        state.reasoning_id = new_state.reasoning_id;
        state.pending_events = new_state.pending_events;
        state.tool_calls = new_state.tool_calls;
        state.tool_call_order = new_state.tool_call_order;
        state.emitted_tool_calls = new_state.emitted_tool_calls;
        state.tool_call_index_map = new_state.tool_call_index_map;
        state.content_block_types = new_state.content_block_types;
        state.content_block_ids = new_state.content_block_ids;
        state.current_thinking_id = new_state.current_thinking_id;
        state.openai_reasoning = new_state.openai_reasoning;
        state.openai_store = new_state.openai_store;
        state.response_id = new_state.response_id;
        state.response_metadata_emitted = new_state.response_metadata_emitted;
        state.response_metadata_provider = new_state.response_metadata_provider;
        state.response_metadata_transport = new_state.response_metadata_transport;
        state.response_metadata_transport_session_id =
            new_state.response_metadata_transport_session_id;
        state.response_metadata_continuation_requested =
            new_state.response_metadata_continuation_requested;
        state.response_activity_started = new_state.response_activity_started;
        state.response_metadata_continuation_accepted =
            new_state.response_metadata_continuation_accepted;

        result
    }

    fn build_headers(
        &self,
        api_key: Option<&str>,
        oauth_token: Option<&str>,
        extra_headers: Option<&std::collections::HashMap<String, String>>,
    ) -> std::collections::HashMap<String, String> {
        let ctx = crate::llm::protocols::header_builder::HeaderBuildContext {
            api_key,
            oauth_token,
            extra_headers,
        };
        crate::llm::protocols::header_builder::ProtocolHeaderBuilder::build_base_headers(
            &crate::llm::protocols::openai_protocol::OpenAiProtocol,
            ctx,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::llm::types::{ResponseMetadataProvider, ResponseTransport};
    use serde_json::json;

    #[test]
    fn build_request_includes_previous_response_id() {
        let protocol = OpenAiResponsesProtocol;
        let messages = vec![Message::User {
            content: MessageContent::Text("follow up".to_string()),
            provider_options: None,
        }];
        let ctx = RequestBuildContext {
            model: "gpt-5.2-codex",
            messages: &messages,
            tools: None,
            temperature: None,
            max_tokens: None,
            top_p: None,
            top_k: None,
            provider_options: None,
            extra_body: None,
            conversation_mode: None,
            input_mode: None,
            previous_response_id: Some("resp_prev_123"),
            transport_session_id: None,
            allow_transport_fallback: None,
            continuation_context: None,
        };

        let body = ProtocolRequestBuilder::build_request(&protocol, ctx).expect("build request");
        assert_eq!(
            body.get("previous_response_id")
                .and_then(|value| value.as_str()),
            Some("resp_prev_123")
        );
    }

    #[test]
    fn parse_response_created_defers_metadata_until_continuation_is_accepted() {
        let mut state = ProtocolStreamState {
            response_metadata_provider: Some(ResponseMetadataProvider::OpenAiSubscription),
            response_metadata_transport: Some(ResponseTransport::Websocket),
            response_metadata_transport_session_id: Some("sess_chain".to_string()),
            response_metadata_continuation_requested: true,
            ..Default::default()
        };
        let created = json!({
            "type": "response.created",
            "response": {
                "id": "resp_chain_123",
                "store": false
            }
        });

        let created_event = parse_openai_oauth_event_legacy(None, &created.to_string(), &mut state)
            .expect("parse created event");
        assert!(created_event.is_none());
        assert!(!state.response_metadata_emitted);
        assert_eq!(state.response_metadata_continuation_accepted, None);

        let delta = json!({
            "type": "response.output_text.delta",
            "delta": "continued output"
        });
        let first = parse_openai_oauth_event_legacy(None, &delta.to_string(), &mut state)
            .expect("parse delta")
            .expect("metadata event");
        match first {
            StreamEvent::ResponseMetadata {
                response_id,
                transport,
                provider,
                continuation_accepted,
                transport_session_id,
            } => {
                assert_eq!(response_id, "resp_chain_123");
                assert_eq!(transport, ResponseTransport::Websocket);
                assert_eq!(provider, ResponseMetadataProvider::OpenAiSubscription);
                assert_eq!(continuation_accepted, Some(true));
                assert_eq!(transport_session_id.as_deref(), Some("sess_chain"));
            }
            _ => panic!("Expected ResponseMetadata, got {:?}", first),
        }

        let second = state.pending_events.remove(0);
        assert!(matches!(second, StreamEvent::TextStart));
        let third = state.pending_events.remove(0);
        assert!(matches!(third, StreamEvent::TextDelta { .. }));
    }

    #[test]
    fn parse_response_failed_emits_continuation_rejection_metadata_and_stateless_fallback() {
        let mut state = ProtocolStreamState {
            response_metadata_provider: Some(ResponseMetadataProvider::OpenAiSubscription),
            response_metadata_transport: Some(ResponseTransport::HttpSse),
            response_metadata_transport_session_id: Some("sess_chain".to_string()),
            response_metadata_continuation_requested: true,
            ..Default::default()
        };
        let created = json!({
            "type": "response.created",
            "response": {
                "id": "resp_chain_456",
                "store": false
            }
        });
        let created_event = parse_openai_oauth_event_legacy(None, &created.to_string(), &mut state)
            .expect("parse created event");
        assert!(created_event.is_none());

        let failed = json!({
            "type": "response.failed",
            "response": {
                "id": "resp_chain_456",
                "error": {
                    "code": "previous_response_not_found",
                    "message": "The previous_response_id was not found"
                }
            }
        });
        let first = parse_openai_oauth_event_legacy(None, &failed.to_string(), &mut state)
            .expect("parse failed event")
            .expect("metadata event");
        match first {
            StreamEvent::ResponseMetadata {
                response_id,
                continuation_accepted,
                ..
            } => {
                assert_eq!(response_id, "resp_chain_456");
                assert_eq!(continuation_accepted, Some(false));
            }
            _ => panic!("Expected ResponseMetadata, got {:?}", first),
        }

        let second = state.pending_events.remove(0);
        match second {
            StreamEvent::TransportFallback { reason, from, to } => {
                assert_eq!(reason, "previous_response_not_found");
                assert_eq!(
                    from,
                    crate::llm::types::TransportFallbackSource::ResponsesChained
                );
                assert_eq!(to, crate::llm::types::TransportFallbackTarget::Stateless);
            }
            _ => panic!("Expected TransportFallback, got {:?}", second),
        }

        let third = state.pending_events.remove(0);
        match third {
            StreamEvent::Error { message } => {
                assert!(message.contains("previous_response_id was not found"));
            }
            _ => panic!("Expected Error, got {:?}", third),
        }
    }

    #[test]
    fn parse_response_failed_after_activity_skips_stateless_fallback() {
        let mut state = ProtocolStreamState {
            response_metadata_provider: Some(ResponseMetadataProvider::OpenAiSubscription),
            response_metadata_transport: Some(ResponseTransport::Websocket),
            response_metadata_transport_session_id: Some("sess_chain".to_string()),
            response_metadata_continuation_requested: true,
            response_activity_started: true,
            ..Default::default()
        };
        let created = json!({
            "type": "response.created",
            "response": {
                "id": "resp_chain_789",
                "store": false
            }
        });
        let _ = parse_openai_oauth_event_legacy(None, &created.to_string(), &mut state)
            .expect("parse created event");

        let failed = json!({
            "type": "error",
            "code": "previous_response_not_found",
            "message": "The previous response could not be found",
            "param": "previous_response_id"
        });
        let first = parse_openai_oauth_event_legacy(None, &failed.to_string(), &mut state)
            .expect("parse failed event")
            .expect("metadata event");
        match first {
            StreamEvent::ResponseMetadata {
                response_id,
                continuation_accepted,
                ..
            } => {
                assert_eq!(response_id, "resp_chain_789");
                assert_eq!(continuation_accepted, Some(false));
            }
            _ => panic!("Expected ResponseMetadata, got {:?}", first),
        }

        let second = state.pending_events.remove(0);
        assert!(matches!(second, StreamEvent::Error { .. }));
        assert!(state.pending_events.is_empty());
    }

    #[test]
    fn parse_response_created_emits_response_metadata_once() {
        let mut state = ProtocolStreamState {
            response_metadata_provider: Some(ResponseMetadataProvider::OpenAiSubscription),
            response_metadata_transport: Some(ResponseTransport::HttpSse),
            response_metadata_transport_session_id: Some("sess_123".to_string()),
            response_metadata_continuation_accepted: Some(true),
            ..Default::default()
        };
        let created = json!({
            "type": "response.created",
            "response": {
                "id": "resp_123",
                "store": false
            }
        });

        let first = parse_openai_oauth_event_legacy(None, &created.to_string(), &mut state)
            .expect("parse")
            .expect("metadata event");
        match first {
            StreamEvent::ResponseMetadata {
                response_id,
                transport,
                provider,
                continuation_accepted,
                transport_session_id,
            } => {
                assert_eq!(response_id, "resp_123");
                assert_eq!(transport, ResponseTransport::HttpSse);
                assert_eq!(provider, ResponseMetadataProvider::OpenAiSubscription);
                assert_eq!(continuation_accepted, Some(true));
                assert_eq!(transport_session_id.as_deref(), Some("sess_123"));
            }
            _ => panic!("Expected ResponseMetadata, got {:?}", first),
        }
        assert!(state.response_metadata_emitted);

        let completed = json!({
            "type": "response.completed",
            "response": {
                "id": "resp_123",
                "usage": {
                    "input_tokens": 3,
                    "output_tokens": 2,
                    "total_tokens": 5
                }
            }
        });
        let second = parse_openai_oauth_event_legacy(None, &completed.to_string(), &mut state)
            .expect("parse")
            .expect("usage event");
        assert!(matches!(second, StreamEvent::Usage { .. }));
        assert!(!state
            .pending_events
            .iter()
            .any(|event| matches!(event, StreamEvent::ResponseMetadata { .. })));
    }

    #[test]
    fn parse_response_completed_can_emit_metadata_when_first_known() {
        let mut state = ProtocolStreamState {
            response_metadata_provider: Some(ResponseMetadataProvider::OpenAiApi),
            response_metadata_transport: Some(ResponseTransport::HttpSse),
            ..Default::default()
        };
        let completed = json!({
            "type": "response.completed",
            "response": {
                "id": "resp_completed",
                "usage": {
                    "input_tokens": 1,
                    "output_tokens": 1,
                    "total_tokens": 2
                }
            }
        });

        let first = parse_openai_oauth_event_legacy(None, &completed.to_string(), &mut state)
            .expect("parse")
            .expect("metadata event");
        match first {
            StreamEvent::ResponseMetadata {
                response_id,
                provider,
                ..
            } => {
                assert_eq!(response_id, "resp_completed");
                assert_eq!(provider, ResponseMetadataProvider::OpenAiApi);
            }
            _ => panic!("Expected ResponseMetadata, got {:?}", first),
        }

        let second = state.pending_events.remove(0);
        assert!(matches!(second, StreamEvent::Usage { .. }));
        let third = state.pending_events.remove(0);
        assert!(matches!(third, StreamEvent::Done { .. }));
    }

    #[test]
    fn parse_chat_completion_chunk_emits_deepseek_cached_usage_tokens() {
        let mut state = ProtocolStreamState::default();
        let payload = json!({
            "object": "chat.completion.chunk",
            "usage": {
                "prompt_tokens": 9622,
                "completion_tokens": 623,
                "total_tokens": 10245,
                "prompt_tokens_details": { "cached_tokens": 8448 },
                "prompt_cache_hit_tokens": 8448,
                "prompt_cache_miss_tokens": 1174
            },
            "choices": [{ "finish_reason": "stop", "delta": {} }]
        });

        let event = parse_openai_oauth_event_legacy(None, &payload.to_string(), &mut state)
            .expect("parse")
            .expect("usage event");

        match event {
            StreamEvent::Usage {
                input_tokens,
                output_tokens,
                total_tokens,
                cached_input_tokens,
                cache_creation_input_tokens,
            } => {
                assert_eq!(input_tokens, 9622);
                assert_eq!(output_tokens, 623);
                assert_eq!(total_tokens, Some(10245));
                assert_eq!(cached_input_tokens, Some(8448));
                assert_eq!(cache_creation_input_tokens, None);
            }
            _ => panic!("Expected Usage event, got {:?}", event),
        }
    }

    #[test]
    fn parse_response_completed_emits_cached_usage_from_input_token_details() {
        let mut state = ProtocolStreamState::default();
        let payload = json!({
            "type": "response.completed",
            "response": {
                "usage": {
                    "input_tokens": 16927,
                    "input_tokens_details": { "cached_tokens": 9216 },
                    "output_tokens": 322,
                    "total_tokens": 17249
                }
            }
        });

        let event = parse_openai_oauth_event_legacy(None, &payload.to_string(), &mut state)
            .expect("parse")
            .expect("usage event");

        match event {
            StreamEvent::Usage {
                input_tokens,
                output_tokens,
                total_tokens,
                cached_input_tokens,
                cache_creation_input_tokens,
            } => {
                assert_eq!(input_tokens, 16927);
                assert_eq!(output_tokens, 322);
                assert_eq!(total_tokens, Some(17249));
                assert_eq!(cached_input_tokens, Some(9216));
                assert_eq!(cache_creation_input_tokens, None);
            }
            _ => panic!("Expected Usage event, got {:?}", event),
        }
    }
}
