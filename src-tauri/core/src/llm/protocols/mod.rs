use crate::llm::types::{
    Message, ResponseMetadataProvider, ResponseTransport, StreamEvent, ToolDefinition,
};
use serde_json::Value;
use std::collections::{HashMap, HashSet};

// Re-export new modular traits
pub mod header_builder;
pub mod request_builder;
pub mod stream_parser;

pub use header_builder::ProtocolHeaderBuilder;
pub use request_builder::ProtocolRequestBuilder;
pub use stream_parser::ProtocolStreamParser;

/// Legacy protocol trait - kept for backward compatibility during migration
/// New code should use the modular traits: ProtocolRequestBuilder, ProtocolStreamParser, ProtocolHeaderBuilder
#[allow(dead_code)]
pub trait LlmProtocol: Send + Sync {
    // Note: This trait no longer requires ProtocolRequestBuilder, ProtocolStreamParser, ProtocolHeaderBuilder
    // to maintain backward compatibility with existing implementations (ClaudeProtocol, OpenAiProtocol).
    // New implementations should implement the modular traits separately.
    fn name(&self) -> &str;
    fn endpoint_path(&self) -> &'static str;

    /// Legacy method
    #[allow(clippy::too_many_arguments)]
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
    ) -> Result<Value, String>;

    /// Legacy method
    fn parse_stream_event(
        &self,
        event_type: Option<&str>,
        data: &str,
        state: &mut ProtocolStreamState,
    ) -> Result<Option<StreamEvent>, String>;

    /// Legacy method
    fn build_headers(
        &self,
        api_key: Option<&str>,
        oauth_token: Option<&str>,
        extra_headers: Option<&HashMap<String, String>>,
    ) -> HashMap<String, String>;
}

#[derive(Default)]
pub struct ProtocolStreamState {
    pub finish_reason: Option<String>,
    pub tool_calls: HashMap<String, ToolCallAccum>,
    pub tool_call_order: Vec<String>,
    pub emitted_tool_calls: HashSet<String>,
    pub tool_call_index_map: HashMap<u64, String>,
    pub current_thinking_id: Option<String>,
    pub pending_events: Vec<StreamEvent>,
    pub text_started: bool,
    pub content_block_types: HashMap<usize, String>,
    pub content_block_ids: HashMap<usize, String>,
    pub reasoning_started: bool,
    pub reasoning_id: Option<String>,
    pub openai_reasoning: HashMap<String, OpenAiReasoningState>,
    pub openai_store: Option<bool>,
    pub response_id: Option<String>,
    pub response_metadata_emitted: bool,
    pub response_metadata_provider: Option<ResponseMetadataProvider>,
    pub response_metadata_transport: Option<ResponseTransport>,
    pub response_metadata_transport_session_id: Option<String>,
    pub response_metadata_continuation_requested: bool,
    pub response_activity_started: bool,
    pub response_metadata_continuation_accepted: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OpenAiReasoningPartStatus {
    Active,
    CanConclude,
    Concluded,
}

#[derive(Debug, Clone, Default)]
pub struct OpenAiReasoningState {
    pub encrypted_content: Option<String>,
    pub summary_parts: HashMap<u64, OpenAiReasoningPartStatus>,
}

#[derive(Default, Clone)]
pub struct ToolCallAccum {
    pub tool_call_id: String,
    pub tool_name: String,
    pub arguments: String,
    pub thought_signature: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ParsedUsage {
    pub input_tokens: i32,
    pub output_tokens: i32,
    pub total_tokens: Option<i32>,
    pub cached_input_tokens: Option<i32>,
    pub cache_creation_input_tokens: Option<i32>,
}

impl ParsedUsage {
    pub fn has_meaningful_data(&self) -> bool {
        self.input_tokens > 0
            || self.output_tokens > 0
            || self.total_tokens.is_some_and(|value| value > 0)
    }
}

pub(crate) fn parse_openai_usage(usage: &Value) -> ParsedUsage {
    ParsedUsage {
        input_tokens: usage_i32(usage, &["prompt_tokens", "input_tokens"]).unwrap_or(0),
        output_tokens: usage_i32(usage, &["completion_tokens", "output_tokens"]).unwrap_or(0),
        total_tokens: usage_i32(usage, &["total_tokens"]),
        cached_input_tokens: usage_positive_i32(
            usage,
            &[
                "cached_input_tokens",
                "prompt_cache_hit_tokens",
                "cache_read_input_tokens",
                "cache_read_tokens",
                "cached_tokens",
            ],
        )
        .or_else(|| usage_nested_positive_i32(usage, &["prompt_tokens_details", "cached_tokens"]))
        .or_else(|| usage_nested_positive_i32(usage, &["input_tokens_details", "cached_tokens"])),
        cache_creation_input_tokens: usage_positive_i32(
            usage,
            &["cache_creation_input_tokens", "cache_write_tokens"],
        ),
    }
}

fn usage_i32(usage: &Value, keys: &[&str]) -> Option<i32> {
    keys.iter()
        .find_map(|key| usage.get(*key).and_then(json_value_to_i32))
}

fn usage_positive_i32(usage: &Value, keys: &[&str]) -> Option<i32> {
    usage_i32(usage, keys).filter(|value| *value > 0)
}

fn usage_nested_positive_i32(usage: &Value, path: &[&str]) -> Option<i32> {
    let mut current = usage;
    for key in path {
        current = current.get(*key)?;
    }
    json_value_to_i32(current).filter(|value| *value > 0)
}

fn json_value_to_i32(value: &Value) -> Option<i32> {
    let number = value.as_i64()?;
    if !(i32::MIN as i64..=i32::MAX as i64).contains(&number) {
        return None;
    }
    Some(number as i32)
}

pub mod claude_protocol;
pub mod openai_protocol;
pub mod openai_responses_protocol;
