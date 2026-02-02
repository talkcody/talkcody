use crate::llm::types::{Message, StreamEvent, ToolDefinition};
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
pub trait LlmProtocol: Send + Sync {
    // Note: This trait no longer requires ProtocolRequestBuilder, ProtocolStreamParser, ProtocolHeaderBuilder
    // to maintain backward compatibility with existing implementations (ClaudeProtocol, OpenAiProtocol).
    // New implementations should implement the modular traits separately.
    fn name(&self) -> &str;
    fn endpoint_path(&self) -> &'static str;

    /// Legacy method
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
}

#[derive(Default, Clone)]
pub struct ToolCallAccum {
    pub tool_call_id: String,
    pub tool_name: String,
    pub arguments: String,
    pub thought_signature: Option<String>,
}

pub mod claude_protocol;
pub mod openai_protocol;
pub mod openai_responses_protocol;
