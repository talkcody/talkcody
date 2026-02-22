use crate::llm::protocols::stream_parser::StreamParseState;
use crate::llm::protocols::{
    self, request_builder::RequestBuildContext, stream_parser::StreamParseContext, LlmProtocol,
    OpenAiReasoningPartStatus, OpenAiReasoningState, ProtocolRequestBuilder, ProtocolStreamParser,
    ProtocolStreamState, ToolCallAccum,
};
use crate::llm::types::{ContentPart, Message, MessageContent, StreamEvent, ToolDefinition};
use serde_json::{json, Value};

pub struct OpenAiResponsesProtocol;

impl OpenAiResponsesProtocol {
    fn normalize_model(model_name: &str) -> String {
        let model_id = if model_name.contains('/') {
            model_name.split('/').last().unwrap_or(model_name)
        } else {
            model_name
        };
        let normalized = model_id.to_lowercase();
        if normalized.contains("gpt-5.1-codex-max") || normalized.contains("gpt 5.1 codex max") {
            return "gpt-5.1-codex-max".to_string();
        }
        "gpt-5.2-codex".to_string()
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

    if payload.get("object").and_then(|v| v.as_str()) == Some("chat.completion.chunk") {
        if let Some(usage) = payload.get("usage") {
            let input_tokens = usage
                .get("prompt_tokens")
                .and_then(|v| v.as_i64())
                .unwrap_or(0);
            let output_tokens = usage
                .get("completion_tokens")
                .and_then(|v| v.as_i64())
                .unwrap_or(0);
            let total_tokens = usage.get("total_tokens").and_then(|v| v.as_i64());
            state.pending_events.push(StreamEvent::Usage {
                input_tokens: input_tokens as i32,
                output_tokens: output_tokens as i32,
                total_tokens: total_tokens.map(|v| v as i32),
                cached_input_tokens: None,
                cache_creation_input_tokens: None,
            });
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

        if let Some(event) = state.pending_events.get(0).cloned() {
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
                        let active = state
                            .openai_reasoning
                            .entry(item_id.clone())
                            .or_insert_with(OpenAiReasoningState::default);
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

            let state_entry = state
                .openai_reasoning
                .entry(item_id.clone())
                .or_insert_with(OpenAiReasoningState::default);

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
            let state_entry = state
                .openai_reasoning
                .entry(item_id.clone())
                .or_insert_with(OpenAiReasoningState::default);

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
                    let input_tokens = usage
                        .get("input_tokens")
                        .and_then(|v| v.as_i64())
                        .unwrap_or(0);
                    let output_tokens = usage
                        .get("output_tokens")
                        .and_then(|v| v.as_i64())
                        .unwrap_or(0);
                    let total_tokens = usage.get("total_tokens").and_then(|v| v.as_i64());
                    state.pending_events.push(StreamEvent::Usage {
                        input_tokens: input_tokens as i32,
                        output_tokens: output_tokens as i32,
                        total_tokens: total_tokens.map(|v| v as i32),
                        cached_input_tokens: None,
                        cache_creation_input_tokens: None,
                    });
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
        "response.failed" => {
            let message = payload
                .get("response")
                .and_then(|r| r.get("error"))
                .and_then(|e| e.get("message"))
                .and_then(|v| v.as_str())
                .unwrap_or("Response failed")
                .to_string();
            log::error!("[OpenAI OAuth] Response failed: {}", message);
            state.pending_events.push(StreamEvent::Error { message });
        }
        _ => {
            log::debug!("[OpenAI OAuth] Unknown event type: {}", event_type);
        }
    }

    if let Some(event) = state.pending_events.get(0).cloned() {
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
