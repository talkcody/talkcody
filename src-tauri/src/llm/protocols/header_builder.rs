// Protocol-level header building trait
// Handles base headers for a protocol (e.g., Content-Type, Authorization)
use std::collections::HashMap;

/// Context for building headers
#[derive(Debug, Clone)]
pub struct HeaderBuildContext<'a> {
    pub api_key: Option<&'a str>,
    pub oauth_token: Option<&'a str>,
    pub extra_headers: Option<&'a HashMap<String, String>>,
}

/// Trait for building protocol-specific headers
/// This operates at the protocol level (base headers)
pub trait ProtocolHeaderBuilder: Send + Sync {
    /// Build base headers for the protocol
    fn build_base_headers(&self, ctx: HeaderBuildContext) -> HashMap<String, String>;
}
