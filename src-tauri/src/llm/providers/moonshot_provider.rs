// Moonshot Provider Implementation
// Handles coding plan endpoint with special User-Agent header

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

pub struct MoonshotProvider {
    base: BaseProvider,
    protocol: OpenAiProtocol,
}

impl MoonshotProvider {
    pub fn new(config: ProviderConfig) -> Self {
        Self {
            base: BaseProvider::new(config),
            protocol: OpenAiProtocol,
        }
    }

    /// Check if using coding plan endpoint
    async fn is_coding_plan(&self, ctx: &ProviderContext<'_>) -> bool {
        let setting_key = format!("use_coding_plan_{}", self.base.config.id);
        if let Ok(Some(use_coding)) = ctx.api_key_manager.get_setting(&setting_key).await {
            if use_coding == "true" {
                if let Some(base_url) = &self.base.config.coding_plan_base_url {
                    if let Ok(resolved) = self.resolve_base_url(ctx).await {
                        return resolved == *base_url;
                    }
                }
            }
        }
        false
    }
}

#[async_trait]
#[async_trait]
impl Provider for MoonshotProvider {
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
        let creds = api_key_manager.get_credentials(&self.base.config).await?;
        match creds {
            crate::llm::auth::api_key_manager::ProviderCredentials::Token(token) => {
                Ok(Creds::ApiKey(token))
            }
            _ => Ok(Creds::None),
        }
    }

    async fn add_provider_headers(
        &self,
        ctx: &ProviderContext<'_>,
        headers: &mut HashMap<String, String>,
    ) -> Result<(), String> {
        // Add KimiCLI User-Agent when using coding plan endpoint
        if self.is_coding_plan(ctx).await {
            headers.insert("User-Agent".to_string(), "KimiCLI/1.3".to_string());
        }
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
