use crate::llm::protocols::{
    self,
    header_builder::{HeaderBuildContext, ProtocolHeaderBuilder},
    request_builder::{ProtocolRequestBuilder, RequestBuildContext},
    stream_parser::{self, ProtocolStreamParser, StreamParseContext, StreamParseState},
    LlmProtocol, ProtocolStreamState, ToolCallAccum,
};
use crate::llm::types::{ContentPart, Message, MessageContent, StreamEvent, ToolDefinition};
use serde_json::{json, Value};
use std::collections::HashMap;

pub struct OpenAiProtocol;

impl OpenAiProtocol {
    fn build_messages(&self, messages: &[Message]) -> Vec<Value> {
        let mut result = Vec::new();

        for msg in messages {
            match msg {
                Message::System { content, .. } => {
                    result.push(json!({ "role": "system", "content": content }));
                }
                Message::User { content, .. } => {
                    result.push(json!({
                        "role": "user",
                        "content": self.convert_content(content)
                    }));
                }
                Message::Assistant {
                    content,
                    provider_options,
                } => {
                    result.push(self.build_assistant_message(content, provider_options.as_ref()));
                }
                Message::Tool { content, .. } => {
                    let mut tool_results = Vec::new();
                    for part in content {
                        if let ContentPart::ToolResult {
                            tool_call_id,
                            tool_name: _,
                            output,
                        } = part
                        {
                            tool_results.push(json!({
                                "tool_call_id": tool_call_id,
                                "role": "tool",
                                "content": self.tool_output_to_string(output)
                            }));
                        }
                    }
                    for tool_msg in tool_results {
                        result.push(tool_msg);
                    }
                }
            }
        }

        result
    }

    fn convert_content(&self, content: &MessageContent) -> Value {
        match content {
            MessageContent::Text(text) => json!(text),
            MessageContent::Parts(parts) => {
                let mut mapped = Vec::new();
                for part in parts {
                    match part {
                        ContentPart::Text { text } => {
                            mapped.push(json!({ "type": "text", "text": text }));
                        }
                        ContentPart::Image { image } => {
                            mapped.push(json!({
                                "type": "image_url",
                                "image_url": { "url": format!("data:image/png;base64,{}", image) }
                            }));
                        }
                        ContentPart::ToolCall {
                            tool_call_id,
                            tool_name,
                            input,
                            provider_metadata: _,
                        } => {
                            mapped.push(json!({
                                "type": "tool_call",
                                "id": tool_call_id,
                                "function": {
                                    "name": tool_name,
                                    "arguments": input.to_string()
                                }
                            }));
                        }
                        ContentPart::ToolResult { .. } => {}
                        ContentPart::Reasoning { text, .. } => {
                            if !text.trim().is_empty() {
                                mapped.push(json!({ "type": "text", "text": text }));
                            }
                        }
                    }
                }
                Value::Array(mapped)
            }
        }
    }

    fn build_assistant_message(
        &self,
        content: &MessageContent,
        provider_options: Option<&Value>,
    ) -> Value {
        let mut content_value = Value::Null;

        match content {
            MessageContent::Text(text) => {
                if !text.trim().is_empty() {
                    content_value = json!(text);
                }
            }
            MessageContent::Parts(parts) => {
                let mut text_chunks: Vec<String> = Vec::new();
                let mut rich_parts: Vec<Value> = Vec::new();
                let mut has_image = false;

                for part in parts {
                    match part {
                        ContentPart::Text { text } => {
                            if !text.trim().is_empty() {
                                text_chunks.push(text.clone());
                                rich_parts.push(json!({ "type": "text", "text": text }));
                            }
                        }
                        ContentPart::Reasoning { text, .. } => {
                            if !text.trim().is_empty() {
                                text_chunks.push(text.clone());
                                rich_parts.push(json!({ "type": "text", "text": text }));
                            }
                        }
                        ContentPart::Image { image } => {
                            has_image = true;
                            rich_parts.push(json!({
                                "type": "image_url",
                                "image_url": { "url": format!("data:image/png;base64,{}", image) }
                            }));
                        }
                        ContentPart::ToolCall { .. } => {}
                        ContentPart::ToolResult { .. } => {}
                    }
                }

                if has_image {
                    content_value = Value::Array(rich_parts);
                } else if !text_chunks.is_empty() {
                    content_value = json!(text_chunks.join(""));
                }
            }
        }

        let mut message = json!({
            "role": "assistant",
            "content": content_value
        });

        if let MessageContent::Parts(parts) = content {
            let mut tool_calls: Vec<Value> = Vec::new();
            for part in parts {
                if let ContentPart::ToolCall {
                    tool_call_id,
                    tool_name,
                    input,
                    provider_metadata: _,
                } = part
                {
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

                    tool_calls.push(json!({
                        "id": tool_call_id,
                        "type": "function",
                        "function": {
                            "name": tool_name,
                            "arguments": arguments
                        }
                    }));
                }
            }

            if !tool_calls.is_empty() {
                message["tool_calls"] = Value::Array(tool_calls);
            }
        }

        if let Some(options) = provider_options {
            if let Some(openai_compat) = options.get("openaiCompatible") {
                if let Some(reasoning_content) = openai_compat.get("reasoning_content") {
                    message["reasoning_content"] = reasoning_content.clone();
                }
            }
        }

        message
    }

    fn tool_output_to_string(&self, output: &Value) -> String {
        if let Some(value) = output.get("value").and_then(|v| v.as_str()) {
            return value.to_string();
        }
        output.to_string()
    }

    fn build_tools(&self, tools: Option<&[ToolDefinition]>) -> Option<Vec<Value>> {
        let tools = tools?;
        let mut result = Vec::new();
        for tool in tools {
            result.push(json!({
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.parameters
                }
            }));
        }
        Some(result)
    }

    fn parse_tool_delta(&self, delta: &Value, state: &mut StreamParseState) {
        let tool_calls = delta.get("tool_calls").and_then(|v| v.as_array());
        if tool_calls.is_none() {
            return;
        }

        for entry in tool_calls.unwrap_or(&Vec::new()) {
            let index = entry.get("index").and_then(|v| v.as_u64());
            let tool_call_id = entry
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();

            if let (Some(index), true) = (index, !tool_call_id.is_empty()) {
                state
                    .tool_call_index_map
                    .entry(index)
                    .or_insert_with(|| tool_call_id.clone());
            }

            let key = if !tool_call_id.is_empty() {
                tool_call_id.clone()
            } else if let Some(index) = index {
                state
                    .tool_call_index_map
                    .get(&index)
                    .cloned()
                    .or_else(|| {
                        let order_index = index as usize;
                        state.tool_call_order.get(order_index).cloned()
                    })
                    .unwrap_or_else(|| index.to_string())
            } else {
                String::new()
            };

            if key.is_empty() {
                continue;
            }

            let function = entry.get("function");
            let name = function
                .and_then(|f| f.get("name"))
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            let args_value = function.and_then(|f| f.get("arguments"));

            let acc = state
                .tool_calls
                .entry(key.clone())
                .or_insert_with(|| ToolCallAccum {
                    tool_call_id: if tool_call_id.is_empty() {
                        key.clone()
                    } else {
                        tool_call_id.clone()
                    },
                    tool_name: name.to_string(),
                    arguments: String::new(),
                    thought_signature: None,
                });

            if !tool_call_id.is_empty() {
                acc.tool_call_id = tool_call_id.clone();
            }
            if !name.is_empty() {
                acc.tool_name = name.to_string();
            }
            if let Some(args_val) = args_value {
                if let Some(args_str) = args_val.as_str() {
                    if !args_str.is_empty() {
                        acc.arguments.push_str(args_str);
                    }
                } else if acc.arguments.is_empty() {
                    acc.arguments = args_val.to_string();
                }
            }

            // Extract thought_signature for Gemini 3 models if present
            if acc.thought_signature.is_none() {
                if let Some(thought_sig) = entry.get("thought_signature").and_then(|v| v.as_str()) {
                    acc.thought_signature = Some(thought_sig.to_string());
                }
            }

            if let Some(order_index) = index.map(|value| value as usize) {
                if state.tool_call_order.len() <= order_index {
                    state.tool_call_order.resize(order_index + 1, String::new());
                }
                let placeholder = order_index.to_string();
                let slot = &mut state.tool_call_order[order_index];
                if slot.is_empty()
                    || *slot == placeholder
                    || (!tool_call_id.is_empty() && *slot != key)
                {
                    *slot = key.clone();
                }
            } else if !state.tool_call_order.contains(&key) {
                state.tool_call_order.push(key.clone());
            }
        }
    }

    fn emit_tool_calls(&self, state: &mut StreamParseState, force: bool) {
        for key in state.tool_call_order.clone() {
            if state.emitted_tool_calls.contains(&key) {
                continue;
            }
            if let Some(acc) = state.tool_calls.get(&key) {
                if acc.tool_name.is_empty() {
                    continue;
                }
                if !force && acc.arguments.trim().is_empty() {
                    continue;
                }

                let input_value = if acc.arguments.trim().is_empty() {
                    json!({})
                } else {
                    serde_json::from_str(&acc.arguments)
                        .unwrap_or_else(|_| Value::String(acc.arguments.clone()))
                };

                // Build provider_metadata with thought_signature if present (for Gemini 3 models)
                let provider_metadata = acc.thought_signature.as_ref().map(|sig| {
                    json!({
                        "google": {
                            "thoughtSignature": sig
                        }
                    })
                });

                state.pending_events.push(StreamEvent::ToolCall {
                    tool_call_id: acc.tool_call_id.clone(),
                    tool_name: acc.tool_name.clone(),
                    input: input_value,
                    provider_metadata,
                });
                state.emitted_tool_calls.insert(key);
            }
        }
    }
}

// ============================================================================
// New Modular Trait Implementations
// ============================================================================

impl ProtocolRequestBuilder for OpenAiProtocol {
    fn build_request(&self, ctx: RequestBuildContext) -> Result<Value, String> {
        let mut body = json!({
            "model": ctx.model,
            "messages": self.build_messages(ctx.messages),
            "stream": true,
            "stream_options": { "include_usage": true }
        });

        if let Some(tools) = self.build_tools(ctx.tools) {
            body["tools"] = Value::Array(tools);
        }
        if let Some(temperature) = ctx.temperature {
            body["temperature"] = json!(temperature);
        }
        if let Some(max_tokens) = ctx.max_tokens {
            body["max_tokens"] = json!(max_tokens);
        }
        if let Some(top_p) = ctx.top_p {
            body["top_p"] = json!(top_p);
        }
        if let Some(top_k) = ctx.top_k {
            body["top_k"] = json!(top_k);
        }

        if let Some(options) = ctx.provider_options {
            if let Some(openai_opts) = options.get("openai") {
                if let Some(reasoning) = openai_opts.get("reasoningEffort") {
                    body["reasoning_effort"] = reasoning.clone();
                }
            }
            if let Some(openrouter_opts) = options.get("openrouter") {
                if let Some(effort) = openrouter_opts.get("effort") {
                    body["reasoning"] = json!({ "effort": effort.clone() });
                }
            }
        }

        let has_reasoning_effort = body.get("reasoning_effort").is_some();
        let has_reasoning = body.get("reasoning").is_some();
        if has_reasoning_effort && has_reasoning {
            body["reasoning"] = Value::Null;
        }

        if let Some(extra) = ctx.extra_body {
            if let Some(obj) = body.as_object_mut() {
                if let Some(extra_obj) = extra.as_object() {
                    for (k, v) in extra_obj {
                        obj.insert(k.to_string(), v.clone());
                    }
                }
            }
        }

        if body.get("reasoning") == Some(&Value::Null) {
            body.as_object_mut().map(|obj| obj.remove("reasoning"));
        }

        Ok(body)
    }
}

impl ProtocolStreamParser for OpenAiProtocol {
    fn parse_stream_event(
        &self,
        ctx: StreamParseContext,
        state: &mut StreamParseState,
    ) -> Result<Option<StreamEvent>, String> {
        if self.is_done_event(ctx.data) {
            self.emit_tool_calls(state, true);
            // Emit ReasoningEnd if reasoning was started
            if state.reasoning_started {
                if let Some(ref id) = state.reasoning_id {
                    state
                        .pending_events
                        .push(StreamEvent::ReasoningEnd { id: id.clone() });
                }
                state.reasoning_started = false;
            }
            if let Some(event) = state.pending_events.get(0).cloned() {
                state.pending_events.remove(0);
                return Ok(Some(event));
            }
            return Ok(Some(StreamEvent::Done {
                finish_reason: state.finish_reason.clone(),
            }));
        }

        let payload: Value = serde_json::from_str(ctx.data).map_err(|e| e.to_string())?;

        // Only emit Usage event when there's meaningful usage data
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

            let has_meaningful_data =
                input_tokens > 0 || output_tokens > 0 || total_tokens.is_some_and(|v| v > 0);

            if has_meaningful_data {
                state.pending_events.push(StreamEvent::Usage {
                    input_tokens: input_tokens as i32,
                    output_tokens: output_tokens as i32,
                    total_tokens: total_tokens.map(|v| v as i32),
                    cached_input_tokens: None,
                    cache_creation_input_tokens: None,
                });
            }
        }

        let choices = payload.get("choices").and_then(|v| v.as_array());
        if let Some(choice) = choices.and_then(|arr| arr.first()) {
            if let Some(finish_reason) = choice.get("finish_reason").and_then(|v| v.as_str()) {
                state.finish_reason = Some(finish_reason.to_string());
            }
            if let Some(delta) = choice.get("delta") {
                // Handle reasoning_content (DeepSeek-style) and reasoning (OpenRouter/MiniMax-style)
                // BEFORE text handling to ensure reasoning events are emitted even without text content
                let reasoning_text = delta
                    .get("reasoning_content")
                    .and_then(|v| v.as_str())
                    .or_else(|| delta.get("reasoning").and_then(|v| v.as_str()));

                if let Some(reasoning) = reasoning_text {
                    if !reasoning.is_empty() {
                        if !state.reasoning_started {
                            state.reasoning_started = true;
                            state.reasoning_id =
                                Some(format!("reasoning_{}", uuid::Uuid::new_v4()));
                            state.pending_events.push(StreamEvent::ReasoningStart {
                                id: state.reasoning_id.clone().unwrap(),
                                provider_metadata: None,
                            });
                        }
                        if let Some(ref id) = state.reasoning_id {
                            state.pending_events.push(StreamEvent::ReasoningDelta {
                                id: id.clone(),
                                text: reasoning.to_string(),
                                provider_metadata: None,
                            });
                        }
                    }
                }

                // Only emit TextStart/TextDelta when there's actual text content
                // Don't emit it for tool_calls-only or reasoning-only deltas
                if let Some(content) = delta.get("content").and_then(|v| v.as_str()) {
                    if !content.is_empty() {
                        if !state.text_started {
                            state.text_started = true;
                            state.pending_events.push(StreamEvent::TextStart);
                        }
                        state.pending_events.push(StreamEvent::TextDelta {
                            text: content.to_string(),
                        });
                    }
                }

                // Handle tool calls (may come without text content)
                self.parse_tool_delta(delta, state);
            }
        }

        if state.finish_reason.as_deref() == Some("tool_calls") {
            self.emit_tool_calls(state, false);
        }

        // Emit ReasoningEnd when finish_reason is received and reasoning was started
        if state.finish_reason.is_some() && state.reasoning_started {
            if let Some(ref id) = state.reasoning_id {
                state
                    .pending_events
                    .push(StreamEvent::ReasoningEnd { id: id.clone() });
            }
            state.reasoning_started = false;
        }

        if let Some(event) = state.pending_events.get(0).cloned() {
            state.pending_events.remove(0);
            return Ok(Some(event));
        }

        Ok(None)
    }
}

impl ProtocolHeaderBuilder for OpenAiProtocol {
    fn build_base_headers(&self, ctx: HeaderBuildContext) -> HashMap<String, String> {
        let mut headers = HashMap::new();
        headers.insert("Content-Type".to_string(), "application/json".to_string());
        if let Some(token) = ctx.oauth_token.or(ctx.api_key) {
            headers.insert("Authorization".to_string(), format!("Bearer {}", token));
        }
        if let Some(extra) = ctx.extra_headers {
            for (k, v) in extra {
                headers.insert(k.to_string(), v.to_string());
            }
        }
        headers
    }
}

// ============================================================================
// Legacy Trait Implementation (delegates to modular traits)
// ============================================================================

impl LlmProtocol for OpenAiProtocol {
    fn name(&self) -> &str {
        "openai"
    }

    fn endpoint_path(&self) -> &'static str {
        "chat/completions"
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
        let mut new_state = stream_parser::StreamParseState {
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
        };

        let result = ProtocolStreamParser::parse_stream_event(self, ctx, &mut new_state);

        // Sync state back
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

        result
    }

    fn build_headers(
        &self,
        api_key: Option<&str>,
        oauth_token: Option<&str>,
        extra_headers: Option<&HashMap<String, String>>,
    ) -> HashMap<String, String> {
        let ctx = HeaderBuildContext {
            api_key,
            oauth_token,
            extra_headers,
        };
        ProtocolHeaderBuilder::build_base_headers(self, ctx)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::llm::protocols::ProtocolStreamState;
    use serde_json::json;
    use std::collections::HashMap;

    #[test]
    fn parse_stream_emits_reasoning_events_from_reasoning_content() {
        let protocol = OpenAiProtocol;
        let mut state = ProtocolStreamState::default();

        let first = json!({
            "choices": [{
                "delta": {
                    "reasoning_content": "Let me think about this..."
                }
            }]
        });
        let second = json!({
            "choices": [{
                "delta": {
                    "reasoning_content": " more reasoning"
                }
            }]
        });
        let done = json!({
            "choices": [{ "finish_reason": "stop", "delta": {} }]
        });

        // Parse first reasoning chunk - ReasoningStart is emitted first (no TextStart for reasoning-only)
        let event = protocols::LlmProtocol::parse_stream_event(
            &protocol,
            None,
            &first.to_string(),
            &mut state,
        )
        .expect("parse first")
        .expect("event");

        match event {
            StreamEvent::ReasoningStart { .. } => {
                // Expected - ReasoningStart is emitted without TextStart for reasoning-only content
            }
            _ => panic!("Expected ReasoningStart, got {:?}", event),
        }

        // ReasoningDelta is in pending_events
        assert!(!state.pending_events.is_empty(), "Expected pending events");
        let delta_event = state.pending_events.remove(0);
        match delta_event {
            StreamEvent::ReasoningDelta { text, .. } => {
                assert_eq!(text, "Let me think about this...");
            }
            _ => panic!("Expected ReasoningDelta, got {:?}", delta_event),
        }

        // Parse second reasoning chunk
        let event = protocols::LlmProtocol::parse_stream_event(
            &protocol,
            None,
            &second.to_string(),
            &mut state,
        )
        .expect("parse second")
        .expect("event");

        match event {
            StreamEvent::ReasoningDelta { text, .. } => {
                assert_eq!(text, " more reasoning");
            }
            _ => panic!("Expected ReasoningDelta, got {:?}", event),
        }

        // Parse done - should emit ReasoningEnd
        let event = protocols::LlmProtocol::parse_stream_event(
            &protocol,
            None,
            &done.to_string(),
            &mut state,
        )
        .expect("parse done")
        .expect("event");

        match event {
            StreamEvent::ReasoningEnd { .. } => {
                // Expected
            }
            _ => panic!("Expected ReasoningEnd, got {:?}", event),
        }
    }

    #[test]
    fn parse_stream_handles_empty_reasoning_content() {
        let protocol = OpenAiProtocol;
        let mut state = ProtocolStreamState::default();

        let data = json!({
            "choices": [{
                "delta": {
                    "reasoning_content": ""
                }
            }]
        });

        let result = protocols::LlmProtocol::parse_stream_event(
            &protocol,
            None,
            &data.to_string(),
            &mut state,
        )
        .expect("parse");

        // Empty reasoning_content with no text content should not emit any event
        assert!(
            result.is_none(),
            "Expected no event for empty reasoning_content without text, got {:?}",
            result
        );
        assert!(
            !state.reasoning_started,
            "Reasoning should not start for empty content"
        );
        assert!(
            !state.text_started,
            "Text should not start for empty content"
        );
    }

    #[test]
    fn parse_stream_emits_reasoning_events_from_reasoning_field() {
        // Tests the "reasoning" field used by OpenRouter/MiniMax providers
        let protocol = OpenAiProtocol;
        let mut state = ProtocolStreamState::default();

        let first = json!({
            "choices": [{
                "delta": {
                    "reasoning": "The"
                }
            }]
        });
        let second = json!({
            "choices": [{
                "delta": {
                    "reasoning": " user"
                }
            }]
        });
        let third = json!({
            "choices": [{
                "delta": {
                    "reasoning": " is"
                }
            }]
        });
        let done = json!({
            "choices": [{ "finish_reason": "stop", "delta": {} }]
        });

        // Parse first reasoning chunk - should emit ReasoningStart
        let event = protocols::LlmProtocol::parse_stream_event(
            &protocol,
            None,
            &first.to_string(),
            &mut state,
        )
        .expect("parse first")
        .expect("event");

        match event {
            StreamEvent::ReasoningStart { .. } => {
                // Expected - ReasoningStart is emitted for reasoning-only content
            }
            _ => panic!("Expected ReasoningStart, got {:?}", event),
        }

        // ReasoningDelta is in pending_events
        assert!(!state.pending_events.is_empty(), "Expected pending events");
        let delta_event = state.pending_events.remove(0);
        match delta_event {
            StreamEvent::ReasoningDelta { text, .. } => {
                assert_eq!(text, "The");
            }
            _ => panic!("Expected ReasoningDelta, got {:?}", delta_event),
        }

        // Parse second reasoning chunk
        let event = protocols::LlmProtocol::parse_stream_event(
            &protocol,
            None,
            &second.to_string(),
            &mut state,
        )
        .expect("parse second")
        .expect("event");

        match event {
            StreamEvent::ReasoningDelta { text, .. } => {
                assert_eq!(text, " user");
            }
            _ => panic!("Expected ReasoningDelta, got {:?}", event),
        }

        // Parse third reasoning chunk
        let event = protocols::LlmProtocol::parse_stream_event(
            &protocol,
            None,
            &third.to_string(),
            &mut state,
        )
        .expect("parse third")
        .expect("event");

        match event {
            StreamEvent::ReasoningDelta { text, .. } => {
                assert_eq!(text, " is");
            }
            _ => panic!("Expected ReasoningDelta, got {:?}", event),
        }

        // Parse done - should emit ReasoningEnd
        let event = protocols::LlmProtocol::parse_stream_event(
            &protocol,
            None,
            &done.to_string(),
            &mut state,
        )
        .expect("parse done")
        .expect("event");

        match event {
            StreamEvent::ReasoningEnd { .. } => {
                // Expected
            }
            _ => panic!("Expected ReasoningEnd, got {:?}", event),
        }
    }

    #[test]
    fn parse_stream_handles_empty_reasoning_field() {
        // Tests empty "reasoning" field used by OpenRouter/MiniMax providers
        let protocol = OpenAiProtocol;
        let mut state = ProtocolStreamState::default();

        let data = json!({
            "choices": [{
                "delta": {
                    "reasoning": "",
                    "content": ""
                }
            }]
        });

        let result = protocols::LlmProtocol::parse_stream_event(
            &protocol,
            None,
            &data.to_string(),
            &mut state,
        )
        .expect("parse");

        // Empty reasoning with no text content should not emit any event
        assert!(
            result.is_none(),
            "Expected no event for empty reasoning without text, got {:?}",
            result
        );
        assert!(
            !state.reasoning_started,
            "Reasoning should not start for empty content"
        );
        assert!(
            !state.text_started,
            "Text should not start for empty content"
        );
    }

    #[test]
    fn parse_stream_handles_reasoning_field_with_regular_content() {
        // Tests mixed "reasoning" field and content used by OpenRouter/MiniMax providers
        let protocol = OpenAiProtocol;
        let mut state = ProtocolStreamState::default();

        let data = json!({
            "choices": [{
                "delta": {
                    "reasoning": "Let me analyze this",
                    "content": "The answer is 42"
                }
            }]
        });

        // Process all events
        let mut events = Vec::new();
        if let Some(event) = protocols::LlmProtocol::parse_stream_event(
            &protocol,
            None,
            &data.to_string(),
            &mut state,
        )
        .expect("parse")
        {
            events.push(event);
        }
        while let Some(pending) = state.pending_events.get(0).cloned() {
            state.pending_events.remove(0);
            events.push(pending);
        }

        // Should have: TextStart, ReasoningStart, ReasoningDelta, TextDelta
        assert!(
            events.iter().any(|e| matches!(e, StreamEvent::TextStart)),
            "Expected TextStart"
        );
        assert!(
            events
                .iter()
                .any(|e| matches!(e, StreamEvent::ReasoningStart { .. })),
            "Expected ReasoningStart"
        );
        assert!(
            events.iter().any(|e| matches!(e, StreamEvent::ReasoningDelta { text, .. } if text == "Let me analyze this")),
            "Expected ReasoningDelta with 'Let me analyze this'"
        );
        assert!(
            events.iter().any(
                |e| matches!(e, StreamEvent::TextDelta { text, .. } if text == "The answer is 42")
            ),
            "Expected TextDelta with 'The answer is 42'"
        );
    }

    #[test]
    fn parse_stream_prefers_reasoning_content_over_reasoning_field() {
        // When both fields are present, reasoning_content should take precedence
        let protocol = OpenAiProtocol;
        let mut state = ProtocolStreamState::default();

        let data = json!({
            "choices": [{
                "delta": {
                    "reasoning_content": "DeepSeek reasoning",
                    "reasoning": "MiniMax reasoning"
                }
            }]
        });

        let event = protocols::LlmProtocol::parse_stream_event(
            &protocol,
            None,
            &data.to_string(),
            &mut state,
        )
        .expect("parse")
        .expect("event");

        match event {
            StreamEvent::ReasoningStart { .. } => {}
            _ => panic!("Expected ReasoningStart, got {:?}", event),
        }

        let delta_event = state.pending_events.remove(0);
        match delta_event {
            StreamEvent::ReasoningDelta { text, .. } => {
                // Should use reasoning_content (DeepSeek) not reasoning (MiniMax)
                assert_eq!(text, "DeepSeek reasoning");
            }
            _ => panic!("Expected ReasoningDelta, got {:?}", delta_event),
        }
    }

    #[test]
    fn parse_stream_handles_reasoning_content_with_regular_content() {
        let protocol = OpenAiProtocol;
        let mut state = ProtocolStreamState::default();

        let data = json!({
            "choices": [{
                "delta": {
                    "reasoning_content": "Let me analyze",
                    "content": "The answer is"
                }
            }]
        });

        // Process all events
        let mut events = Vec::new();
        if let Some(event) = protocols::LlmProtocol::parse_stream_event(
            &protocol,
            None,
            &data.to_string(),
            &mut state,
        )
        .expect("parse")
        {
            events.push(event);
        }
        while let Some(pending) = state.pending_events.get(0).cloned() {
            state.pending_events.remove(0);
            events.push(pending);
        }

        // Should have: TextStart, ReasoningStart, ReasoningDelta, TextDelta
        assert!(
            events.iter().any(|e| matches!(e, StreamEvent::TextStart)),
            "Expected TextStart"
        );
        assert!(
            events
                .iter()
                .any(|e| matches!(e, StreamEvent::ReasoningStart { .. })),
            "Expected ReasoningStart"
        );
        assert!(
            events.iter().any(|e| matches!(e, StreamEvent::ReasoningDelta { text, .. } if text == "Let me analyze")),
            "Expected ReasoningDelta with 'Let me analyze'"
        );
        assert!(
            events.iter().any(
                |e| matches!(e, StreamEvent::TextDelta { text, .. } if text == "The answer is")
            ),
            "Expected TextDelta with 'The answer is'"
        );
    }

    #[test]
    fn includes_reasoning_content_from_provider_options() {
        let protocol = OpenAiProtocol;
        let messages = vec![Message::Assistant {
            content: MessageContent::Parts(vec![ContentPart::ToolCall {
                tool_call_id: "call_1".to_string(),
                tool_name: "webFetch".to_string(),
                input: json!({ "url": "https://example.com" }),
                provider_metadata: None,
            }]),
            provider_options: Some(json!({
                "openaiCompatible": { "reasoning_content": "" }
            })),
        }];

        let built = protocol.build_messages(&messages);
        let assistant = built.first().expect("assistant message");
        assert_eq!(assistant.get("reasoning_content"), Some(&json!("")));
    }

    #[test]
    fn omits_reasoning_content_when_not_provided() {
        let protocol = OpenAiProtocol;
        let messages = vec![Message::Assistant {
            content: MessageContent::Parts(vec![ContentPart::ToolCall {
                tool_call_id: "call_1".to_string(),
                tool_name: "webFetch".to_string(),
                input: json!({ "url": "https://example.com" }),
                provider_metadata: None,
            }]),
            provider_options: None,
        }];

        let built = protocol.build_messages(&messages);
        let assistant = built.first().expect("assistant message");
        assert!(assistant.get("reasoning_content").is_none());
    }

    #[test]
    fn build_request_merges_provider_options_and_extra_body() {
        let protocol = OpenAiProtocol;
        let messages = vec![Message::User {
            content: MessageContent::Text("hi".to_string()),
            provider_options: None,
        }];

        let body = protocols::LlmProtocol::build_request(
            &protocol,
            "gpt-4o",
            &messages,
            None,
            Some(0.2),
            Some(120),
            None,
            None,
            Some(&json!({
                "openai": { "reasoningEffort": "medium" },
                "openrouter": { "effort": "low" }
            })),
            Some(&json!({ "extra_param": true })),
        )
        .expect("build request");

        assert_eq!(body.get("reasoning_effort"), Some(&json!("medium")));
        assert!(body.get("reasoning").is_none());
        assert_eq!(body.get("extra_param"), Some(&json!(true)));
        assert_eq!(body.get("max_tokens"), Some(&json!(120)));
    }

    #[test]
    fn build_request_includes_openrouter_reasoning_when_only_openrouter_is_set() {
        let protocol = OpenAiProtocol;
        let messages = vec![Message::User {
            content: MessageContent::Text("hi".to_string()),
            provider_options: None,
        }];

        let body = protocols::LlmProtocol::build_request(
            &protocol,
            "minimax-m2.1",
            &messages,
            None,
            Some(0.2),
            Some(120),
            None,
            None,
            Some(&json!({
                "openrouter": { "effort": "low" }
            })),
            None,
        )
        .expect("build request");

        assert!(body.get("reasoning_effort").is_none());
        assert_eq!(body.get("reasoning"), Some(&json!({ "effort": "low" })));
    }

    #[test]
    fn parse_stream_emits_tool_call_from_accumulated_arguments() {
        let protocol = OpenAiProtocol;
        let mut state = ProtocolStreamState::default();

        let first = json!({
            "choices": [{
                "delta": {
                    "tool_calls": [{
                        "index": 0,
                        "id": "call_1",
                        "function": { "name": "readFile", "arguments": "{\"path\":\"/tmp" }
                    }]
                }
            }]
        });
        let second = json!({
            "choices": [{
                "delta": {
                    "tool_calls": [{
                        "index": 0,
                        "function": { "arguments": "\",\"pattern\":\"**/*.rs\"}" }
                    }]
                }
            }]
        });
        let done = json!({
            "choices": [{ "finish_reason": "tool_calls", "delta": {} }]
        });

        let _ = protocols::LlmProtocol::parse_stream_event(
            &protocol,
            None,
            &first.to_string(),
            &mut state,
        )
        .expect("parse first");
        let _ = protocols::LlmProtocol::parse_stream_event(
            &protocol,
            None,
            &second.to_string(),
            &mut state,
        )
        .expect("parse second");
        state.text_started = true;
        let event = protocols::LlmProtocol::parse_stream_event(
            &protocol,
            None,
            &done.to_string(),
            &mut state,
        )
        .expect("parse done")
        .expect("event");

        match event {
            StreamEvent::ToolCall {
                tool_call_id,
                tool_name,
                input,
                provider_metadata: _,
            } => {
                assert_eq!(tool_call_id, "call_1");
                assert_eq!(tool_name, "readFile");
                assert_eq!(input.get("path"), Some(&json!("/tmp")));
                assert_eq!(input.get("pattern"), Some(&json!("**/*.rs")));
            }
            _ => panic!("Unexpected event"),
        }
    }

    #[test]
    fn parse_stream_preserves_tool_call_index_order() {
        let protocol = OpenAiProtocol;
        let mut state = ProtocolStreamState::default();

        let first = json!({
            "choices": [{
                "delta": {
                    "tool_calls": [{
                        "index": 1,
                        "id": "call_b",
                        "function": { "name": "glob", "arguments": "{\"pattern\":\"*.rs\"}" }
                    }]
                }
            }]
        });
        let second = json!({
            "choices": [{
                "delta": {
                    "tool_calls": [{
                        "index": 0,
                        "id": "call_a",
                        "function": { "name": "readFile", "arguments": "{\"file_path\":\"/tmp\"}" }
                    }]
                }
            }]
        });
        let done = json!({
            "choices": [{ "finish_reason": "tool_calls", "delta": {} }]
        });

        let mut events: Vec<StreamEvent> = Vec::new();

        let parsed = protocols::LlmProtocol::parse_stream_event(
            &protocol,
            None,
            &first.to_string(),
            &mut state,
        )
        .expect("parse first");
        if let Some(event) = parsed {
            events.push(event);
        }
        while let Some(pending) = state.pending_events.get(0).cloned() {
            state.pending_events.remove(0);
            events.push(pending);
        }

        let parsed = protocols::LlmProtocol::parse_stream_event(
            &protocol,
            None,
            &second.to_string(),
            &mut state,
        )
        .expect("parse second");
        if let Some(event) = parsed {
            events.push(event);
        }
        while let Some(pending) = state.pending_events.get(0).cloned() {
            state.pending_events.remove(0);
            events.push(pending);
        }

        state.text_started = true;
        let parsed = protocols::LlmProtocol::parse_stream_event(
            &protocol,
            None,
            &done.to_string(),
            &mut state,
        )
        .expect("parse done");
        if let Some(event) = parsed {
            events.push(event);
        }
        while let Some(pending) = state.pending_events.get(0).cloned() {
            state.pending_events.remove(0);
            events.push(pending);
        }

        let tool_calls: Vec<String> = events
            .iter()
            .filter_map(|event| match event {
                StreamEvent::ToolCall { tool_call_id, .. } => Some(tool_call_id.clone()),
                _ => None,
            })
            .collect();

        assert_eq!(tool_calls, vec!["call_a".to_string(), "call_b".to_string()]);
    }

    #[test]
    fn build_headers_prefers_oauth_token() {
        let protocol = OpenAiProtocol;
        let headers = protocol.build_headers(
            Some("api"),
            Some("oauth"),
            Some(&HashMap::from([(
                String::from("X-Test"),
                String::from("1"),
            )])),
        );
        assert_eq!(
            headers.get("Authorization"),
            Some(&"Bearer oauth".to_string())
        );
        assert_eq!(headers.get("X-Test"), Some(&"1".to_string()));
    }

    #[test]
    fn parse_stream_emits_tool_call_with_thought_signature() {
        let protocol = OpenAiProtocol;
        let mut state = ProtocolStreamState::default();

        // Simulate Gemini 3 Pro style tool call with thought_signature
        let first = json!({
            "choices": [{
                "delta": {
                    "tool_calls": [{
                        "index": 0,
                        "id": "call_gemini_1",
                        "thought_signature": "test-signature-abc123",
                        "function": { "name": "readFile", "arguments": "{\"path\":\"/tmp/test.rs\"}" }
                    }]
                }
            }]
        });
        let done = json!({
            "choices": [{ "finish_reason": "tool_calls", "delta": {} }]
        });

        let _ = protocols::LlmProtocol::parse_stream_event(
            &protocol,
            None,
            &first.to_string(),
            &mut state,
        )
        .expect("parse first");
        state.text_started = true;
        let event = protocols::LlmProtocol::parse_stream_event(
            &protocol,
            None,
            &done.to_string(),
            &mut state,
        )
        .expect("parse done")
        .expect("event");

        match event {
            StreamEvent::ToolCall {
                tool_call_id,
                tool_name,
                input,
                provider_metadata,
            } => {
                assert_eq!(tool_call_id, "call_gemini_1");
                assert_eq!(tool_name, "readFile");
                assert_eq!(input.get("path"), Some(&json!("/tmp/test.rs")));
                // Verify thought_signature is passed in provider_metadata
                let metadata = provider_metadata.expect("provider_metadata should be present");
                let google = metadata.get("google").expect("google field should exist");
                assert_eq!(
                    google.get("thoughtSignature"),
                    Some(&json!("test-signature-abc123"))
                );
            }
            _ => panic!(
                "Expected ToolCall event with thought_signature, got {:?}",
                event
            ),
        }
    }

    #[test]
    fn parse_stream_handles_tool_call_without_thought_signature() {
        let protocol = OpenAiProtocol;
        let mut state = ProtocolStreamState::default();

        // Simulate standard OpenAI style tool call without thought_signature
        let first = json!({
            "choices": [{
                "delta": {
                    "tool_calls": [{
                        "index": 0,
                        "id": "call_std_1",
                        "function": { "name": "glob", "arguments": "{\"pattern\":\"*.rs\"}" }
                    }]
                }
            }]
        });
        let done = json!({
            "choices": [{ "finish_reason": "tool_calls", "delta": {} }]
        });

        let _ = protocols::LlmProtocol::parse_stream_event(
            &protocol,
            None,
            &first.to_string(),
            &mut state,
        )
        .expect("parse first");
        state.text_started = true;
        let event = protocols::LlmProtocol::parse_stream_event(
            &protocol,
            None,
            &done.to_string(),
            &mut state,
        )
        .expect("parse done")
        .expect("event");

        match event {
            StreamEvent::ToolCall {
                tool_call_id,
                tool_name,
                provider_metadata,
                ..
            } => {
                assert_eq!(tool_call_id, "call_std_1");
                assert_eq!(tool_name, "glob");
                // provider_metadata should be None when no thought_signature
                assert!(provider_metadata.is_none());
            }
            _ => panic!(
                "Expected ToolCall event without thought_signature, got {:?}",
                event
            ),
        }
    }
}
