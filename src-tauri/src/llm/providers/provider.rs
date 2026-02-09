// Provider trait and base implementation
// Providers encapsulate provider-specific business logic and configuration

use crate::llm::auth::api_key_manager::ApiKeyManager;
use crate::llm::protocols::{
    header_builder::HeaderBuildContext,
    request_builder::RequestBuildContext,
    stream_parser::{StreamParseContext, StreamParseState},
};
use crate::llm::types::ProtocolType;
use crate::llm::types::{Message, ProviderConfig, StreamEvent, ToolDefinition, TraceContext};
use async_trait::async_trait;
use serde_json::Value;
use std::collections::HashMap;

/// Context for provider operations
#[derive(Clone)]
pub struct ProviderContext<'a> {
    pub provider_config: &'a ProviderConfig,
    pub api_key_manager: &'a ApiKeyManager,
    pub model: &'a str,
    pub messages: &'a [Message],
    pub tools: Option<&'a [ToolDefinition]>,
    pub temperature: Option<f32>,
    pub max_tokens: Option<i32>,
    pub top_p: Option<f32>,
    pub top_k: Option<i32>,
    pub provider_options: Option<&'a Value>,
    #[allow(dead_code)]
    pub trace_context: Option<&'a TraceContext>,
}

/// Credentials for authentication
#[derive(Debug, Clone)]
pub enum ProviderCredentials {
    None,
    Token(String),
    ApiKey(String),
    OAuth {
        token: String,
        #[allow(dead_code)]
        account_id: Option<String>,
    },
}

/// Result of building a request
#[derive(Debug, Clone)]
pub struct BuiltRequest {
    pub url: String,
    pub headers: HashMap<String, String>,
    pub body: Value,
}

/// Trait for provider-specific logic
/// Each provider can override specific behaviors while inheriting defaults from the base protocol
#[async_trait]
#[allow(dead_code)]
pub trait Provider: Send + Sync {
    /// Provider identifier
    fn id(&self) -> &str;

    /// Provider display name
    fn name(&self) -> &str;

    /// Get the protocol type this provider uses
    fn protocol_type(&self) -> ProtocolType;

    /// Get the provider configuration
    fn config(&self) -> &ProviderConfig;

    /// Resolve the base URL for the request
    /// Provider can override this to select between different endpoints (coding plan, international, etc.)
    async fn resolve_base_url(&self, ctx: &ProviderContext<'_>) -> Result<String, String>;

    /// Resolve the endpoint path
    /// Provider can override this for special endpoints (e.g., OpenAI OAuth uses 'codex/responses')
    async fn resolve_endpoint_path(&self, _ctx: &ProviderContext<'_>) -> String {
        // Default to protocol's standard endpoint
        match self.protocol_type() {
            ProtocolType::OpenAiCompatible => "chat/completions".to_string(),
            ProtocolType::Claude => "messages".to_string(),
        }
    }

    /// Get credentials for the provider
    async fn get_credentials(
        &self,
        api_key_manager: &ApiKeyManager,
    ) -> Result<ProviderCredentials, String>;

    /// Build headers for the request
    /// Provider can override this to add special headers (e.g., GitHub Copilot, Moonshot coding plan)
    async fn build_headers(
        &self,
        ctx: &ProviderContext<'_>,
        credentials: &ProviderCredentials,
    ) -> Result<HashMap<String, String>, String> {
        let (api_key, oauth_token) = match credentials {
            ProviderCredentials::None => (None, None),
            ProviderCredentials::Token(token) => (Some(token.as_str()), Some(token.as_str())),
            ProviderCredentials::ApiKey(key) => (Some(key.as_str()), None),
            ProviderCredentials::OAuth { token, .. } => (None, Some(token.as_str())),
        };

        let header_ctx = HeaderBuildContext {
            api_key,
            oauth_token,
            extra_headers: ctx.provider_config.headers.as_ref(),
        };

        // Start with protocol base headers
        let mut headers = self.build_protocol_headers(header_ctx);

        // Add provider-specific headers
        self.add_provider_headers(ctx, &mut headers).await?;

        Ok(headers)
    }

    /// Build protocol base headers (delegates to protocol)
    fn build_protocol_headers(&self, ctx: HeaderBuildContext) -> HashMap<String, String>;

    /// Add provider-specific headers
    /// Override this to add custom headers
    async fn add_provider_headers(
        &self,
        _ctx: &ProviderContext<'_>,
        _headers: &mut HashMap<String, String>,
    ) -> Result<(), String> {
        // Default: no additional headers
        Ok(())
    }

    /// Build the request body
    /// Provider can override this for special request formats (e.g., OpenAI OAuth/Codex)
    async fn build_request(&self, ctx: &ProviderContext<'_>) -> Result<Value, String> {
        // Google OpenAI-compatible endpoint rejects top_k.
        let drop_top_k = ctx.provider_config.id.eq_ignore_ascii_case("google")
            || ctx
                .provider_config
                .base_url
                .contains("generativelanguage.googleapis.com");
        let top_k = if drop_top_k { None } else { ctx.top_k };
        let request_ctx = RequestBuildContext {
            model: ctx.model,
            messages: ctx.messages,
            tools: ctx.tools,
            temperature: ctx.temperature,
            max_tokens: ctx.max_tokens,
            top_p: ctx.top_p,
            top_k,
            provider_options: ctx.provider_options,
            extra_body: ctx.provider_config.extra_body.as_ref(),
        };

        self.build_protocol_request(request_ctx)
    }

    /// Build protocol request (delegates to protocol)
    fn build_protocol_request(&self, ctx: RequestBuildContext) -> Result<Value, String>;

    /// Parse a stream event
    /// Provider can override this for special stream formats (e.g., OpenAI OAuth)
    fn parse_stream_event(
        &self,
        event_type: Option<&str>,
        data: &str,
        state: &mut StreamParseState,
    ) -> Result<Option<StreamEvent>, String> {
        let ctx = StreamParseContext { event_type, data };
        self.parse_protocol_stream_event(ctx, state)
    }

    /// Parse protocol stream event (delegates to protocol)
    fn parse_protocol_stream_event(
        &self,
        ctx: StreamParseContext,
        state: &mut StreamParseState,
    ) -> Result<Option<StreamEvent>, String>;

    /// Parse a stream event with provider context
    /// Override this to choose parsing based on runtime provider state (e.g., OAuth mode)
    async fn parse_stream_event_with_context(
        &self,
        _ctx: &ProviderContext<'_>,
        event_type: Option<&str>,
        data: &str,
        state: &mut StreamParseState,
    ) -> Result<Option<StreamEvent>, String> {
        self.parse_stream_event(event_type, data, state)
    }

    /// Check if this provider uses OAuth
    fn uses_oauth(&self) -> bool {
        self.config().supports_oauth
    }

    /// Build the complete request
    async fn build_complete_request(
        &self,
        ctx: &ProviderContext<'_>,
    ) -> Result<BuiltRequest, String> {
        let base_url = self.resolve_base_url(ctx).await?;
        let endpoint_path = self.resolve_endpoint_path(ctx).await;
        let normalized_base_url = normalize_provider_base_url(&base_url, ctx.provider_config);
        let credentials = self.get_credentials(ctx.api_key_manager).await?;
        let headers = self.build_headers(ctx, &credentials).await?;
        let body = self.build_request(ctx).await?;

        let url = format!(
            "{}/{}",
            normalized_base_url.trim_end_matches('/'),
            endpoint_path
        );

        Ok(BuiltRequest { url, headers, body })
    }
}

fn normalize_provider_base_url(base_url: &str, provider_config: &ProviderConfig) -> String {
    let trimmed = base_url.trim_end_matches('/');
    if !is_custom_provider_id(&provider_config.id) {
        return trimmed.to_string();
    }

    let without_endpoint = if trimmed.ends_with("/chat/completions") {
        trimmed.trim_end_matches("/chat/completions")
    } else if trimmed.ends_with("/messages") {
        trimmed.trim_end_matches("/messages")
    } else if trimmed.ends_with("/responses") {
        trimmed.trim_end_matches("/responses")
    } else if trimmed.ends_with("/v1/messages") {
        trimmed.trim_end_matches("/messages")
    } else if trimmed.ends_with("/v1/chat/completions") {
        trimmed.trim_end_matches("/chat/completions")
    } else if trimmed.ends_with("/v1/responses") {
        trimmed.trim_end_matches("/responses")
    } else {
        trimmed
    };

    if has_v1_segment(without_endpoint) {
        return without_endpoint.to_string();
    }

    format!("{}/v1", without_endpoint.trim_end_matches('/'))
}

fn is_custom_provider_id(provider_id: &str) -> bool {
    provider_id.starts_with("openai-compatible-") || provider_id.starts_with("anthropic-")
}

fn has_v1_segment(base_url: &str) -> bool {
    base_url.split('/').any(|segment| segment == "v1")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn custom_provider_config(id: &str, protocol: ProtocolType) -> ProviderConfig {
        ProviderConfig {
            id: id.to_string(),
            name: "Custom".to_string(),
            protocol,
            base_url: "https://api.example.com/v1".to_string(),
            api_key_name: "custom_test".to_string(),
            supports_oauth: false,
            supports_coding_plan: false,
            supports_international: false,
            coding_plan_base_url: None,
            international_base_url: None,
            headers: None,
            extra_body: None,
            auth_type: crate::llm::types::AuthType::Bearer,
        }
    }

    #[test]
    fn normalize_custom_provider_base_url_strips_openai_chat_endpoint() {
        let config =
            custom_provider_config("openai-compatible-test", ProtocolType::OpenAiCompatible);
        let normalized =
            normalize_provider_base_url("https://api.example.com/v1/chat/completions", &config);
        assert_eq!(normalized, "https://api.example.com/v1");
    }

    #[test]
    fn normalize_custom_provider_base_url_strips_messages_endpoint() {
        let config = custom_provider_config("anthropic-test", ProtocolType::Claude);
        let normalized =
            normalize_provider_base_url("https://api.example.com/v1/messages", &config);
        assert_eq!(normalized, "https://api.example.com/v1");
    }

    #[test]
    fn normalize_custom_provider_base_url_appends_v1_for_anthropic_root() {
        let config = custom_provider_config("anthropic-test", ProtocolType::Claude);
        let normalized = normalize_provider_base_url("https://api.example.com", &config);
        assert_eq!(normalized, "https://api.example.com/v1");
    }

    #[test]
    fn normalize_custom_provider_base_url_appends_v1_for_openai_root() {
        let config =
            custom_provider_config("openai-compatible-test", ProtocolType::OpenAiCompatible);
        let normalized = normalize_provider_base_url("https://api.example.com", &config);
        assert_eq!(normalized, "https://api.example.com/v1");
    }

    #[test]
    fn normalize_custom_provider_base_url_keeps_root() {
        let config =
            custom_provider_config("openai-compatible-test", ProtocolType::OpenAiCompatible);
        let normalized = normalize_provider_base_url("https://api.example.com/v1", &config);
        assert_eq!(normalized, "https://api.example.com/v1");
    }

    #[test]
    fn normalize_non_custom_provider_base_url_is_unchanged() {
        let mut config = custom_provider_config("openai", ProtocolType::OpenAiCompatible);
        config.id = "openai".to_string();
        let normalized = normalize_provider_base_url("https://api.openai.com/v1", &config);
        assert_eq!(normalized, "https://api.openai.com/v1");
    }
}

/// Base provider implementation with common logic
pub struct BaseProvider {
    pub config: ProviderConfig,
}

impl BaseProvider {
    pub fn new(config: ProviderConfig) -> Self {
        Self { config }
    }

    /// Helper to resolve base URL with common logic (coding plan, international, custom)
    pub async fn resolve_base_url_with_fallback(
        &self,
        api_key_manager: &ApiKeyManager,
    ) -> Result<String, String> {
        // Check for custom base URL setting
        let setting_key = format!("base_url_{}", self.config.id);
        if let Some(base_url) = api_key_manager.get_setting(&setting_key).await? {
            if !base_url.is_empty() {
                return Ok(base_url);
            }
        }

        // Check for coding plan
        if self.config.supports_coding_plan {
            let coding_plan_key = format!("use_coding_plan_{}", self.config.id);
            if let Some(use_coding) = api_key_manager.get_setting(&coding_plan_key).await? {
                if use_coding == "true" {
                    if let Some(url) = &self.config.coding_plan_base_url {
                        return Ok(url.clone());
                    }
                }
            }
        }

        // Check for international
        if self.config.supports_international {
            let international_key = format!("use_international_{}", self.config.id);
            if let Some(use_intl) = api_key_manager.get_setting(&international_key).await? {
                if use_intl == "true" {
                    if let Some(url) = &self.config.international_base_url {
                        return Ok(url.clone());
                    }
                }
            }
        }

        // Default to standard base URL
        Ok(self.config.base_url.clone())
    }
}
