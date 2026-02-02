// Protocol-level request building trait
// Handles conversion from internal message types to provider-specific API format
use crate::llm::types::{Message, ToolDefinition};
use serde_json::Value;

/// Context for building a request
#[derive(Debug, Clone)]
pub struct RequestBuildContext<'a> {
    pub model: &'a str,
    pub messages: &'a [Message],
    pub tools: Option<&'a [ToolDefinition]>,
    pub temperature: Option<f32>,
    pub max_tokens: Option<i32>,
    pub top_p: Option<f32>,
    pub top_k: Option<i32>,
    pub provider_options: Option<&'a Value>,
    pub extra_body: Option<&'a Value>,
}

/// Trait for building protocol-specific requests
/// This operates at the protocol level (OpenAI format, Claude format, etc.)
pub trait ProtocolRequestBuilder: Send + Sync {
    /// Build the request body for the API call
    fn build_request(&self, ctx: RequestBuildContext) -> Result<Value, String>;
}

/// Trait for building protocol-specific messages
/// Handles conversion of internal Message types to protocol-specific format
pub trait ProtocolMessageConverter: Send + Sync {
    /// Convert a single message to the protocol format
    fn convert_message(&self, message: &Message) -> Value;

    /// Convert message content to the protocol format
    fn convert_content(&self, content: &crate::llm::types::MessageContent) -> Value;

    /// Build system message (if supported by protocol)
    fn build_system_message(&self, content: &str) -> Option<Value>;
}
