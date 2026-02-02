// GitHub Copilot Provider Implementation
// Handles special headers required by GitHub Copilot API

use crate::llm::auth::api_key_manager::ApiKeyManager;
use crate::llm::protocols::{
    header_builder::{HeaderBuildContext, ProtocolHeaderBuilder},
    openai_protocol::OpenAiProtocol,
    request_builder::ProtocolRequestBuilder,
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

pub struct GithubCopilotProvider {
    base: BaseProvider,
    protocol: OpenAiProtocol,
}

impl GithubCopilotProvider {
    pub fn new(config: ProviderConfig) -> Self {
        Self {
            base: BaseProvider::new(config),
            protocol: OpenAiProtocol,
        }
    }
}

#[async_trait]
impl Provider for GithubCopilotProvider {
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

    async fn resolve_base_url(&self, _ctx: &ProviderContext<'_>) -> Result<String, String> {
        // GitHub Copilot uses a fixed base URL
        Ok("https://api.githubcopilot.com".to_string())
    }

    async fn resolve_endpoint_path(&self, _ctx: &ProviderContext<'_>) -> String {
        // GitHub Copilot uses standard chat completions endpoint
        "chat/completions".to_string()
    }

    async fn get_credentials(&self, api_key_manager: &ApiKeyManager) -> Result<Creds, String> {
        let creds = api_key_manager.get_credentials(&self.base.config).await?;
        match creds {
            crate::llm::auth::api_key_manager::ProviderCredentials::Token(token) => {
                Ok(Creds::Token(token))
            }
            _ => Ok(Creds::None),
        }
    }

    async fn add_provider_headers(
        &self,
        _ctx: &ProviderContext<'_>,
        headers: &mut HashMap<String, String>,
    ) -> Result<(), String> {
        // GitHub Copilot requires special headers
        headers.insert(
            "User-Agent".to_string(),
            "GitHubCopilotChat/0.35.0".to_string(),
        );
        headers.insert("Editor-Version".to_string(), "vscode/1.105.1".to_string());
        headers.insert(
            "Editor-Plugin-Version".to_string(),
            "copilot-chat/0.35.0".to_string(),
        );
        headers.insert(
            "Copilot-Integration-Id".to_string(),
            "vscode-chat".to_string(),
        );

        Ok(())
    }

    fn build_protocol_headers(&self, ctx: HeaderBuildContext) -> HashMap<String, String> {
        self.protocol.build_base_headers(ctx)
    }

    fn build_protocol_request(
        &self,
        ctx: crate::llm::protocols::request_builder::RequestBuildContext,
    ) -> Result<Value, String> {
        self.protocol.build_request(ctx)
    }

    fn parse_protocol_stream_event(
        &self,
        ctx: crate::llm::protocols::stream_parser::StreamParseContext,
        state: &mut crate::llm::protocols::stream_parser::StreamParseState,
    ) -> Result<Option<crate::llm::types::StreamEvent>, String> {
        self.protocol.parse_stream_event(ctx, state)
    }
}
