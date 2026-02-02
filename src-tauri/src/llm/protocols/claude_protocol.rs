use crate::llm::protocols::{
    self,
    header_builder::{HeaderBuildContext, ProtocolHeaderBuilder},
    request_builder::{ProtocolRequestBuilder, RequestBuildContext},
    stream_parser::{ProtocolStreamParser, StreamParseContext, StreamParseState},
    LlmProtocol, ProtocolStreamState, ToolCallAccum,
};
use crate::llm::types::{ContentPart, Message, MessageContent, StreamEvent, ToolDefinition};
use serde_json::{json, Value};
use std::collections::HashMap;

pub struct ClaudeProtocol;

impl ClaudeProtocol {
    fn build_messages(&self, messages: &[Message]) -> Vec<Value> {
        let mut result = Vec::new();
        for msg in messages {
            match msg {
                Message::System { .. } => {}
                Message::User { content, .. } => {
                    result.push(json!({
                        "role": "user",
                        "content": self.convert_content(content)
                    }));
                }
                Message::Assistant { content, .. } => {
                    result.push(json!({
                        "role": "assistant",
                        "content": self.convert_content(content)
                    }));
                }
                Message::Tool { content, .. } => {
                    let mut tool_results = Vec::new();
                    for part in content {
                        if let ContentPart::ToolResult {
                            tool_call_id,
                            tool_name,
                            output,
                        } = part
                        {
                            tool_results.push(json!({
                                "type": "tool_result",
                                "tool_use_id": tool_call_id,
                                "content": self.tool_output_to_string(output),
                                "name": tool_name
                            }));
                        }
                    }
                    if !tool_results.is_empty() {
                        result.push(json!({
                            "role": "user",
                            "content": tool_results
                        }));
                    }
                }
            }
        }
        result
    }

    fn convert_content(&self, content: &MessageContent) -> Value {
        match content {
            MessageContent::Text(text) => json!([{"type": "text", "text": text }]),
            MessageContent::Parts(parts) => {
                let mut mapped = Vec::new();
                for part in parts {
                    match part {
                        ContentPart::Text { text } => {
                            mapped.push(json!({ "type": "text", "text": text }));
                        }
                        ContentPart::Image { image } => {
                            mapped.push(json!({
                                "type": "image",
                                "source": {
                                    "type": "base64",
                                    "media_type": "image/png",
                                    "data": image
                                }
                            }));
                        }
                        ContentPart::ToolCall {
                            tool_call_id,
                            tool_name,
                            input,
                            provider_metadata: _,
                        } => {
                            mapped.push(json!({
                                "type": "tool_use",
                                "id": tool_call_id,
                                "name": tool_name,
                                "input": input
                            }));
                        }
                        ContentPart::ToolResult { .. } => {}
                        ContentPart::Reasoning {
                            text,
                            provider_options,
                        } => {
                            let mut thinking = json!({ "type": "thinking", "text": text });
                            if let Some(opts) = provider_options {
                                if let Some(signature) =
                                    opts.get("anthropic").and_then(|v| v.get("signature"))
                                {
                                    thinking["signature"] = signature.clone();
                                }
                            }
                            mapped.push(thinking);
                        }
                    }
                }
                Value::Array(mapped)
            }
        }
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
                "name": tool.name,
                "description": tool.description,
                "input_schema": tool.parameters
            }));
        }
        Some(result)
    }
}

impl LlmProtocol for ClaudeProtocol {
    fn name(&self) -> &str {
        "anthropic"
    }

    fn endpoint_path(&self) -> &'static str {
        "messages"
    }

    fn build_request(
        &self,
        model: &str,
        messages: &[Message],
        tools: Option<&[ToolDefinition]>,
        temperature: Option<f32>,
        max_tokens: Option<i32>,
        top_p: Option<f32>,
        _top_k: Option<i32>,
        provider_options: Option<&Value>,
        extra_body: Option<&Value>,
    ) -> Result<Value, String> {
        let mut system = None;
        for msg in messages {
            if let Message::System { content, .. } = msg {
                system = Some(content.clone());
                break;
            }
        }

        let mut body = json!({
            "model": model,
            "messages": self.build_messages(messages),
            "stream": true,
            "max_tokens": max_tokens.unwrap_or(1024)
        });

        if let Some(system) = system {
            body["system"] = json!(system);
        }
        if let Some(tools) = self.build_tools(tools) {
            body["tools"] = Value::Array(tools);
        }
        if let Some(temperature) = temperature {
            body["temperature"] = json!(temperature);
        }
        if let Some(top_p) = top_p {
            body["top_p"] = json!(top_p);
        }

        if let Some(options) = provider_options {
            if let Some(anthropic) = options.get("anthropic") {
                if let Some(thinking) = anthropic.get("thinking") {
                    body["thinking"] = thinking.clone();
                }
            }
        }

        if let Some(extra) = extra_body {
            if let Some(obj) = body.as_object_mut() {
                if let Some(extra_obj) = extra.as_object() {
                    for (k, v) in extra_obj {
                        obj.insert(k.to_string(), v.clone());
                    }
                }
            }
        }

        Ok(body)
    }

    fn parse_stream_event(
        &self,
        event_type: Option<&str>,
        data: &str,
        state: &mut ProtocolStreamState,
    ) -> Result<Option<StreamEvent>, String> {
        let event_type = event_type.unwrap_or("message");
        let payload: Value = serde_json::from_str(data).map_err(|e| e.to_string())?;

        match event_type {
            "content_block_start" => {
                if let Some(index) = payload.get("index").and_then(|v| v.as_u64()) {
                    if let Some(block) = payload.get("content_block") {
                        if let Some(block_type) = block.get("type").and_then(|v| v.as_str()) {
                            state
                                .content_block_types
                                .insert(index as usize, block_type.to_string());
                            if let Some(block_id) = block.get("id").and_then(|v| v.as_str()) {
                                state
                                    .content_block_ids
                                    .insert(index as usize, block_id.to_string());
                            }

                            if block_type == "thinking" {
                                let id = block
                                    .get("id")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("thinking")
                                    .to_string();
                                state.current_thinking_id = Some(id.clone());
                                return Ok(Some(StreamEvent::ReasoningStart {
                                    id,
                                    provider_metadata: None,
                                }));
                            }
                            if block_type == "tool_use" {
                                let id = block
                                    .get("id")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or_default()
                                    .to_string();
                                let name = block
                                    .get("name")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or_default()
                                    .to_string();
                                let input = block.get("input").cloned().unwrap_or(json!({}));
                                let arguments = if input.is_object()
                                    && input.as_object().map_or(false, |obj| obj.is_empty())
                                {
                                    String::new()
                                } else {
                                    input.to_string()
                                };
                                state.tool_calls.insert(
                                    id.clone(),
                                    ToolCallAccum {
                                        tool_call_id: id.clone(),
                                        tool_name: name,
                                        arguments,
                                        thought_signature: None,
                                    },
                                );
                                state.tool_call_order.push(id);
                            }
                        }
                    }
                }
            }
            "content_block_delta" => {
                if let Some(delta) = payload.get("delta") {
                    let delta_type = delta.get("type").and_then(|v| v.as_str()).unwrap_or("");
                    match delta_type {
                        "text_delta" => {
                            if let Some(text) = delta.get("text").and_then(|v| v.as_str()) {
                                return Ok(Some(StreamEvent::TextDelta {
                                    text: text.to_string(),
                                }));
                            }
                        }
                        "thinking_delta" => {
                            if let Some(text) = delta.get("text").and_then(|v| v.as_str()) {
                                let id = state
                                    .current_thinking_id
                                    .clone()
                                    .unwrap_or_else(|| "thinking".to_string());
                                return Ok(Some(StreamEvent::ReasoningDelta {
                                    id,
                                    text: text.to_string(),
                                    provider_metadata: None,
                                }));
                            }
                        }
                        "signature_delta" => {
                            if let Some(signature) = delta.get("signature") {
                                let id = state
                                    .current_thinking_id
                                    .clone()
                                    .unwrap_or_else(|| "thinking".to_string());
                                return Ok(Some(StreamEvent::ReasoningDelta {
                                    id,
                                    text: String::new(),
                                    provider_metadata: Some(json!({
                                        "anthropic": { "signature": signature }
                                    })),
                                }));
                            }
                        }
                        "input_json_delta" => {
                            let index = payload.get("index").and_then(|v| v.as_u64());
                            let tool_id = payload
                                .get("content_block")
                                .and_then(|v| v.get("id"))
                                .and_then(|v| v.as_str())
                                .map(|v| v.to_string())
                                .or_else(|| {
                                    index.and_then(|i| {
                                        state.content_block_ids.get(&(i as usize)).cloned()
                                    })
                                });
                            if let Some(tool_id) = tool_id {
                                if let Some(acc) = state.tool_calls.get_mut(&tool_id) {
                                    if let Some(chunk) =
                                        delta.get("partial_json").and_then(|v| v.as_str())
                                    {
                                        acc.arguments.push_str(chunk);
                                    }
                                }
                            }
                        }
                        _ => {}
                    }
                }
            }
            "content_block_stop" => {
                let index = payload.get("index").and_then(|v| v.as_u64());
                let tool_id = payload
                    .get("content_block")
                    .and_then(|v| v.get("id"))
                    .and_then(|v| v.as_str())
                    .map(|v| v.to_string())
                    .or_else(|| {
                        index.and_then(|i| state.content_block_ids.get(&(i as usize)).cloned())
                    });

                if let Some(tool_id) = tool_id {
                    if let Some(acc) = state.tool_calls.get(&tool_id) {
                        let input_value = serde_json::from_str(&acc.arguments).unwrap_or(json!({}));
                        return Ok(Some(StreamEvent::ToolCall {
                            tool_call_id: acc.tool_call_id.clone(),
                            tool_name: acc.tool_name.clone(),
                            input: input_value,
                            provider_metadata: None,
                        }));
                    }
                }
            }
            "message_delta" => {
                // Extract stop_reason first before handling usage (which may return early)
                if let Some(stop_reason) = payload
                    .get("delta")
                    .and_then(|v| v.get("stop_reason"))
                    .and_then(|v| v.as_str())
                {
                    state.finish_reason = Some(stop_reason.to_string());
                }
                if let Some(usage) = payload.get("usage") {
                    let input_tokens = usage
                        .get("input_tokens")
                        .and_then(|v| v.as_i64())
                        .unwrap_or(0);
                    let output_tokens = usage
                        .get("output_tokens")
                        .and_then(|v| v.as_i64())
                        .unwrap_or(0);
                    return Ok(Some(StreamEvent::Usage {
                        input_tokens: input_tokens as i32,
                        output_tokens: output_tokens as i32,
                        total_tokens: None,
                        cached_input_tokens: None,
                        cache_creation_input_tokens: None,
                    }));
                }
            }
            "message_stop" => {
                return Ok(Some(StreamEvent::Done {
                    finish_reason: state.finish_reason.clone(),
                }));
            }
            _ => {}
        }

        Ok(None)
    }

    fn build_headers(
        &self,
        api_key: Option<&str>,
        oauth_token: Option<&str>,
        extra_headers: Option<&HashMap<String, String>>,
    ) -> HashMap<String, String> {
        let mut headers = HashMap::new();
        headers.insert("Content-Type".to_string(), "application/json".to_string());
        headers.insert("anthropic-version".to_string(), "2023-06-01".to_string());
        if let Some(token) = oauth_token {
            headers.insert("Authorization".to_string(), format!("Bearer {}", token));
        } else if let Some(key) = api_key {
            headers.insert("x-api-key".to_string(), key.to_string());
        }
        if let Some(extra) = extra_headers {
            for (k, v) in extra {
                headers.insert(k.to_string(), v.to_string());
            }
        }
        headers
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::llm::protocols::ProtocolStreamState;
    use serde_json::json;

    #[test]
    fn emits_tool_call_from_index_when_content_block_stop_has_no_id() {
        let protocol = ClaudeProtocol;
        let mut state = ProtocolStreamState::default();

        let start = json!({
            "type": "content_block_start",
            "index": 4,
            "content_block": {
                "type": "tool_use",
                "id": "call_1",
                "name": "glob",
                "input": {}
            }
        });
        let start_event = protocols::LlmProtocol::parse_stream_event(
            &protocol,
            Some("content_block_start"),
            &start.to_string(),
            &mut state,
        )
        .unwrap();
        assert!(start_event.is_none());

        let delta = json!({
            "type": "content_block_delta",
            "index": 4,
            "delta": {
                "type": "input_json_delta",
                "partial_json": "{\"path\":\"/tmp\",\"pattern\":\"**/*.rs\"}"
            }
        });
        let delta_event = protocols::LlmProtocol::parse_stream_event(
            &protocol,
            Some("content_block_delta"),
            &delta.to_string(),
            &mut state,
        )
        .unwrap();
        assert!(delta_event.is_none());

        let stop = json!({
            "type": "content_block_stop",
            "index": 4
        });
        let stop_event = protocols::LlmProtocol::parse_stream_event(
            &protocol,
            Some("content_block_stop"),
            &stop.to_string(),
            &mut state,
        )
        .unwrap();

        match stop_event {
            Some(StreamEvent::ToolCall {
                tool_call_id,
                tool_name,
                input,
                provider_metadata: _,
            }) => {
                assert_eq!(tool_call_id, "call_1");
                assert_eq!(tool_name, "glob");
                assert_eq!(input.get("path").and_then(|v| v.as_str()), Some("/tmp"));
                assert_eq!(
                    input.get("pattern").and_then(|v| v.as_str()),
                    Some("**/*.rs")
                );
            }
            _ => panic!("Expected tool call event"),
        }
    }

    #[test]
    fn build_request_extracts_system_and_merges_extra_body() {
        let protocol = ClaudeProtocol;
        let messages = vec![
            Message::System {
                content: "system".to_string(),
                provider_options: None,
            },
            Message::User {
                content: MessageContent::Text("hi".to_string()),
                provider_options: None,
            },
        ];

        let body = protocols::LlmProtocol::build_request(
            &protocol,
            "claude-3",
            &messages,
            None,
            Some(0.2),
            Some(256),
            Some(0.9),
            None,
            Some(&json!({ "anthropic": { "thinking": { "type": "enabled" } } })),
            Some(&json!({ "max_output_tokens": 128 })),
        )
        .expect("build request");

        assert_eq!(body.get("system"), Some(&json!("system")));
        assert!(
            body.get("temperature")
                .map(|v| v.as_f64())
                .flatten()
                .map(|v| (v - 0.2).abs() < 0.001)
                .unwrap_or(false),
            "temperature should be approximately 0.2"
        );
        assert!(
            body.get("top_p")
                .map(|v| v.as_f64())
                .flatten()
                .map(|v| (v - 0.9).abs() < 0.001)
                .unwrap_or(false),
            "top_p should be approximately 0.9"
        );
        assert_eq!(body.get("thinking"), Some(&json!({ "type": "enabled" })));
        assert_eq!(body.get("max_output_tokens"), Some(&json!(128)));
    }

    #[test]
    fn parse_stream_emits_reasoning_signature_delta() {
        let protocol = ClaudeProtocol;
        let mut state = ProtocolStreamState::default();

        let start = json!({
            "type": "content_block_start",
            "index": 1,
            "content_block": {
                "type": "thinking",
                "id": "think-1"
            }
        });
        let _ = protocols::LlmProtocol::parse_stream_event(
            &protocol,
            Some("content_block_start"),
            &start.to_string(),
            &mut state,
        )
        .expect("start");

        let delta = json!({
            "type": "content_block_delta",
            "index": 1,
            "delta": {
                "type": "signature_delta",
                "signature": "sig-1"
            }
        });

        let event = protocols::LlmProtocol::parse_stream_event(
            &protocol,
            Some("content_block_delta"),
            &delta.to_string(),
            &mut state,
        )
        .expect("delta")
        .expect("event");

        match event {
            StreamEvent::ReasoningDelta {
                id,
                provider_metadata,
                ..
            } => {
                assert_eq!(id, "think-1");
                let metadata = provider_metadata.expect("metadata");
                assert_eq!(
                    metadata
                        .get("anthropic")
                        .and_then(|value| value.get("signature")),
                    Some(&json!("sig-1"))
                );
            }
            _ => panic!("Unexpected event"),
        }
    }

    #[test]
    fn build_headers_prefers_oauth_token() {
        let protocol = ClaudeProtocol;
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
        assert!(headers.get("x-api-key").is_none());
        assert_eq!(headers.get("X-Test"), Some(&"1".to_string()));
    }
}
