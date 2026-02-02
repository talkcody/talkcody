// Default Provider Implementation
// For generic providers that don't have special logic
// Uses standard protocol implementations without overrides

use crate::llm::auth::api_key_manager::ApiKeyManager;
use crate::llm::protocols::{
    claude_protocol::ClaudeProtocol, header_builder::HeaderBuildContext,
    openai_protocol::OpenAiProtocol, request_builder::ProtocolRequestBuilder,
    stream_parser::ProtocolStreamParser,
};
use crate::llm::providers::provider::{
    BaseProvider, Provider, ProviderContext, ProviderCredentials as Creds,
};
use crate::llm::types::ProtocolType;
use crate::llm::types::ProviderConfig;
use async_trait::async_trait;
use serde_json::Value;
use std::collections::HashMap;

/// Default provider that uses standard protocol implementations
pub struct DefaultProvider {
    base: BaseProvider,
    protocol: Box<dyn ProtocolImpl>,
}

/// Trait to abstract over different protocol implementations
trait ProtocolImpl: Send + Sync {
    fn build_base_headers(&self, ctx: HeaderBuildContext) -> HashMap<String, String>;
    fn build_request(
        &self,
        ctx: crate::llm::protocols::request_builder::RequestBuildContext,
    ) -> Result<Value, String>;
    fn parse_stream_event(
        &self,
        ctx: crate::llm::protocols::stream_parser::StreamParseContext,
        state: &mut crate::llm::protocols::stream_parser::StreamParseState,
    ) -> Result<Option<crate::llm::types::StreamEvent>, String>;
}

struct OpenAiProtocolWrapper(OpenAiProtocol);
impl ProtocolImpl for OpenAiProtocolWrapper {
    fn build_base_headers(&self, ctx: HeaderBuildContext) -> HashMap<String, String> {
        use crate::llm::protocols::ProtocolHeaderBuilder;
        ProtocolHeaderBuilder::build_base_headers(&self.0, ctx)
    }
    fn build_request(
        &self,
        ctx: crate::llm::protocols::request_builder::RequestBuildContext,
    ) -> Result<Value, String> {
        use crate::llm::protocols::ProtocolRequestBuilder;
        ProtocolRequestBuilder::build_request(&self.0, ctx)
    }
    fn parse_stream_event(
        &self,
        ctx: crate::llm::protocols::stream_parser::StreamParseContext,
        state: &mut crate::llm::protocols::stream_parser::StreamParseState,
    ) -> Result<Option<crate::llm::types::StreamEvent>, String> {
        use crate::llm::protocols::ProtocolStreamParser;
        ProtocolStreamParser::parse_stream_event(&self.0, ctx, state)
    }
}

struct ClaudeProtocolWrapper(ClaudeProtocol);
impl ProtocolImpl for ClaudeProtocolWrapper {
    fn build_base_headers(&self, ctx: HeaderBuildContext) -> HashMap<String, String> {
        // Claude uses custom header building logic
        let mut headers = HashMap::new();
        headers.insert("Content-Type".to_string(), "application/json".to_string());
        headers.insert("anthropic-version".to_string(), "2023-06-01".to_string());
        if let Some(token) = ctx.oauth_token {
            headers.insert("Authorization".to_string(), format!("Bearer {}", token));
        } else if let Some(key) = ctx.api_key {
            headers.insert("x-api-key".to_string(), key.to_string());
        }
        if let Some(extra) = ctx.extra_headers {
            for (k, v) in extra {
                headers.insert(k.to_string(), v.to_string());
            }
        }
        headers
    }
    fn build_request(
        &self,
        _ctx: crate::llm::protocols::request_builder::RequestBuildContext,
    ) -> Result<Value, String> {
        // ClaudeProtocol implements LlmProtocol which has different signatures
        // For now, return empty object - this should be implemented properly
        Ok(serde_json::json!({}))
    }
    fn parse_stream_event(
        &self,
        _ctx: crate::llm::protocols::stream_parser::StreamParseContext,
        _state: &mut crate::llm::protocols::stream_parser::StreamParseState,
    ) -> Result<Option<crate::llm::types::StreamEvent>, String> {
        // ClaudeProtocol implements LlmProtocol which has different signatures
        Ok(None)
    }
}

impl DefaultProvider {
    pub fn new(config: ProviderConfig) -> Self {
        let protocol: Box<dyn ProtocolImpl> = match config.protocol {
            ProtocolType::OpenAiCompatible => Box::new(OpenAiProtocolWrapper(OpenAiProtocol)),
            ProtocolType::Claude => Box::new(ClaudeProtocolWrapper(ClaudeProtocol)),
        };

        Self {
            base: BaseProvider::new(config),
            protocol,
        }
    }
}

#[async_trait]
impl Provider for DefaultProvider {
    fn id(&self) -> &str {
        &self.base.config.id
    }

    fn name(&self) -> &str {
        &self.base.config.name
    }

    fn protocol_type(&self) -> ProtocolType {
        self.base.config.protocol
    }

    fn config(&self) -> &ProviderConfig {
        &self.base.config
    }

    async fn resolve_base_url(&self, ctx: &ProviderContext<'_>) -> Result<String, String> {
        self.base
            .resolve_base_url_with_fallback(ctx.api_key_manager)
            .await
    }

    async fn get_credentials(&self, api_key_manager: &ApiKeyManager) -> Result<Creds, String> {
        use crate::llm::auth::api_key_manager::ProviderCredentials as AkmCreds;

        let creds = api_key_manager.get_credentials(&self.base.config).await?;
        match creds {
            AkmCreds::None => Ok(Creds::None),
            AkmCreds::Token(token) => match self.base.config.auth_type {
                crate::llm::types::AuthType::Bearer | crate::llm::types::AuthType::OAuthBearer => {
                    Ok(Creds::Token(token))
                }
                crate::llm::types::AuthType::ApiKey => Ok(Creds::ApiKey(token)),
                _ => Ok(Creds::None),
            },
        }
    }

    fn build_protocol_headers(&self, ctx: HeaderBuildContext) -> HashMap<String, String> {
        self.protocol.build_base_headers(ctx)
    }

    fn build_protocol_request(
        &self,
        ctx: crate::llm::protocols::request_builder::RequestBuildContext,
    ) -> Result<Value, String> {
        ProtocolImpl::build_request(&*self.protocol, ctx)
    }

    fn parse_protocol_stream_event(
        &self,
        ctx: crate::llm::protocols::stream_parser::StreamParseContext,
        state: &mut crate::llm::protocols::stream_parser::StreamParseState,
    ) -> Result<Option<crate::llm::types::StreamEvent>, String> {
        ProtocolImpl::parse_stream_event(&*self.protocol, ctx, state)
    }
}
