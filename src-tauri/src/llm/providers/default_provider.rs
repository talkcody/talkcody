// Default Provider Implementation
// For generic providers that don't have special logic
// Uses standard protocol implementations without overrides

use crate::llm::auth::api_key_manager::ApiKeyManager;
use crate::llm::protocols::{
    claude_protocol::ClaudeProtocol, header_builder::HeaderBuildContext,
    openai_protocol::OpenAiProtocol,
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
        ctx: crate::llm::protocols::request_builder::RequestBuildContext,
    ) -> Result<Value, String> {
        use crate::llm::protocols::LlmProtocol;

        self.0.build_request(
            ctx.model,
            ctx.messages,
            ctx.tools,
            ctx.temperature,
            ctx.max_tokens,
            ctx.top_p,
            ctx.top_k,
            ctx.provider_options,
            ctx.extra_body,
        )
    }
    fn parse_stream_event(
        &self,
        ctx: crate::llm::protocols::stream_parser::StreamParseContext,
        state: &mut crate::llm::protocols::stream_parser::StreamParseState,
    ) -> Result<Option<crate::llm::types::StreamEvent>, String> {
        use crate::llm::protocols::{LlmProtocol, ProtocolStreamState};

        let mut legacy = ProtocolStreamState {
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

        let result = self
            .0
            .parse_stream_event(ctx.event_type, ctx.data, &mut legacy);

        state.finish_reason = legacy.finish_reason;
        state.tool_calls = legacy.tool_calls;
        state.tool_call_order = legacy.tool_call_order;
        state.emitted_tool_calls = legacy.emitted_tool_calls;
        state.tool_call_index_map = legacy.tool_call_index_map;
        state.current_thinking_id = legacy.current_thinking_id;
        state.pending_events = legacy.pending_events;
        state.text_started = legacy.text_started;
        state.content_block_types = legacy.content_block_types;
        state.content_block_ids = legacy.content_block_ids;
        state.reasoning_started = legacy.reasoning_started;
        state.reasoning_id = legacy.reasoning_id;
        state.openai_reasoning = legacy.openai_reasoning;
        state.openai_store = legacy.openai_store;

        result
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
                crate::llm::types::AuthType::Bearer
                | crate::llm::types::AuthType::OAuthBearer
                | crate::llm::types::AuthType::TalkCodyJwt => Ok(Creds::Token(token)),
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::Database;
    use crate::llm::auth::api_key_manager::ApiKeyManager;
    use crate::llm::types::{AuthType, ProtocolType, ProviderConfig};
    use std::sync::Arc;
    use tempfile::TempDir;

    fn create_test_config(auth_type: AuthType) -> ProviderConfig {
        ProviderConfig {
            id: "talkcody".to_string(),
            name: "TalkCody".to_string(),
            protocol: ProtocolType::Claude,
            base_url: "https://api.talkcody.com".to_string(),
            api_key_name: "TALKCODY_ENABLED".to_string(),
            supports_oauth: false,
            supports_coding_plan: false,
            supports_international: false,
            coding_plan_base_url: None,
            international_base_url: None,
            headers: None,
            extra_body: None,
            auth_type,
        }
    }

    #[tokio::test]
    async fn get_credentials_returns_token_for_talkcody_jwt() {
        // Create a temporary directory for the test database
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");

        // Create the database and connect
        let db = Arc::new(Database::new(db_path.to_str().unwrap().to_string()));
        db.connect().await.unwrap();

        // Create the settings table
        db.execute(
            "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER)",
            vec![],
        )
        .await
        .unwrap();

        // Create the API key manager
        let app_data_dir = temp_dir.path().to_path_buf();
        let api_key_manager = ApiKeyManager::new(db.clone(), app_data_dir);

        // Set the talkcody auth token in the database
        api_key_manager
            .set_setting("talkcody_auth_token", "test-jwt-token-12345")
            .await
            .unwrap();

        // Create the provider with TalkCodyJwt auth type
        let config = create_test_config(AuthType::TalkCodyJwt);
        let provider = DefaultProvider::new(config);

        // Get credentials
        let creds = provider.get_credentials(&api_key_manager).await.unwrap();

        // Verify that we get a Token credential
        match creds {
            Creds::Token(token) => {
                assert_eq!(token, "test-jwt-token-12345");
            }
            _ => panic!("Expected Token credential, got {:?}", creds),
        }
    }

    #[tokio::test]
    async fn get_credentials_returns_error_when_talkcody_token_missing() {
        // Create a temporary directory for the test database
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");

        // Create the database and connect
        let db = Arc::new(Database::new(db_path.to_str().unwrap().to_string()));
        db.connect().await.unwrap();

        // Create the settings table
        db.execute(
            "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER)",
            vec![],
        )
        .await
        .unwrap();

        // Create the API key manager (without setting the token)
        let app_data_dir = temp_dir.path().to_path_buf();
        let api_key_manager = ApiKeyManager::new(db.clone(), app_data_dir);

        // Create the provider with TalkCodyJwt auth type
        let config = create_test_config(AuthType::TalkCodyJwt);
        let provider = DefaultProvider::new(config);

        // Get credentials - should fail because token is not set
        let result = provider.get_credentials(&api_key_manager).await;

        // Verify that we get an error about authentication being required
        assert!(result.is_err());
        let error_msg = result.unwrap_err();
        assert!(error_msg.contains("Authentication required"));
    }
}
