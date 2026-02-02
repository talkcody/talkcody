// Protocol-level stream parsing trait
// Handles conversion from SSE stream data to internal StreamEvent types
use crate::llm::types::StreamEvent;

/// State maintained during stream parsing
#[derive(Default)]
pub struct StreamParseState {
    pub finish_reason: Option<String>,
    pub text_started: bool,
    pub reasoning_started: bool,
    pub reasoning_id: Option<String>,
    pub pending_events: Vec<StreamEvent>,
    // Tool call accumulation state
    pub tool_calls: std::collections::HashMap<String, super::ToolCallAccum>,
    pub tool_call_order: Vec<String>,
    pub emitted_tool_calls: std::collections::HashSet<String>,
    pub tool_call_index_map: std::collections::HashMap<u64, String>,
    // Claude-specific state
    pub content_block_types: std::collections::HashMap<usize, String>,
    pub content_block_ids: std::collections::HashMap<usize, String>,
    pub current_thinking_id: Option<String>,
}

impl StreamParseState {
    pub fn new() -> Self {
        Self::default()
    }
}

/// Context for parsing a stream event
#[derive(Debug, Clone)]
pub struct StreamParseContext<'a> {
    pub event_type: Option<&'a str>,
    pub data: &'a str,
}

/// Trait for parsing protocol-specific stream events
/// This operates at the protocol level (OpenAI format, Claude format, etc.)
pub trait ProtocolStreamParser: Send + Sync {
    /// Parse a stream event from SSE data
    /// Returns None if the event should be ignored (e.g., keep-alive)
    fn parse_stream_event(
        &self,
        ctx: StreamParseContext,
        state: &mut StreamParseState,
    ) -> Result<Option<StreamEvent>, String>;

    /// Check if this is a done/sentinel event
    fn is_done_event(&self, data: &str) -> bool {
        data.trim() == "[DONE]"
    }
}
