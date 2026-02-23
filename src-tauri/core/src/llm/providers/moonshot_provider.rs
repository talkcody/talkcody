// Moonshot Provider Implementation
// Supports video input on the standard /v1 endpoint

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
use crate::llm::types::{ProtocolType, ProviderConfig};
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
}

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
        // Use standard endpoint resolution
        self.base
            .resolve_base_url_with_fallback(ctx.api_key_manager)
            .await
    }

    async fn get_credentials(&self, api_key_manager: &ApiKeyManager) -> Result<Creds, String> {
        // Try api_key_{provider_id} format first (standard storage format)
        let key_value = api_key_manager
            .get_setting(&format!("api_key_{}", self.base.config.id))
            .await?;

        // Fall back to api_key_name for backward compatibility
        let key_value = match key_value {
            Some(key) if !key.is_empty() => key,
            _ => api_key_manager
                .get_setting(&self.base.config.api_key_name)
                .await?
                .ok_or_else(|| format!("API key '{}' not found", self.base.config.api_key_name))?,
        };

        Ok(Creds::ApiKey(key_value))
    }

    async fn add_provider_headers(
        &self,
        _ctx: &ProviderContext<'_>,
        _headers: &mut HashMap<String, String>,
    ) -> Result<(), String> {
        // No special headers needed for Moonshot
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::Database;
    use crate::llm::auth::api_key_manager::ApiKeyManager;
    use std::sync::Arc;
    use tempfile::TempDir;

    fn create_test_config() -> ProviderConfig {
        ProviderConfig {
            id: "moonshot".to_string(),
            name: "Moonshot".to_string(),
            protocol: ProtocolType::OpenAiCompatible,
            base_url: "https://api.moonshot.cn/v1".to_string(),
            api_key_name: "MOONSHOT_API_KEY".to_string(),
            supports_oauth: false,
            supports_coding_plan: true,
            supports_international: true,
            coding_plan_base_url: Some("https://api.moonshot.cn/kimi-cli".to_string()),
            international_base_url: Some("https://api.moonshot.cn/international".to_string()),
            headers: None,
            extra_body: None,
            auth_type: crate::llm::types::AuthType::Bearer,
        }
    }

    async fn setup_test_context() -> (TempDir, ApiKeyManager, MoonshotProvider) {
        let dir = TempDir::new().expect("temp dir");
        let db_path = dir.path().join("test.db");
        let db = Arc::new(Database::new(db_path.to_string_lossy().to_string()));
        db.connect().await.expect("db connect");
        db.execute(
            "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER)",
            vec![],
        )
        .await
        .expect("create settings");

        let api_keys = ApiKeyManager::new(db, dir.path().to_path_buf());
        let provider = MoonshotProvider::new(create_test_config());

        (dir, api_keys, provider)
    }

    #[tokio::test]
    async fn get_credentials_uses_api_key_provider_id_format() {
        let (_dir, api_keys, provider) = setup_test_context().await;

        // Store API key using the standard format: api_key_{provider_id}
        api_keys
            .set_setting("api_key_moonshot", "test-moonshot-key")
            .await
            .expect("set api key");

        let creds = provider
            .get_credentials(&api_keys)
            .await
            .expect("get credentials");

        match creds {
            Creds::ApiKey(key) => assert_eq!(key, "test-moonshot-key"),
            _ => panic!("Expected ApiKey credential"),
        }
    }

    #[tokio::test]
    async fn get_credentials_falls_back_to_api_key_name() {
        let (_dir, api_keys, provider) = setup_test_context().await;

        // Store API key using the legacy format: api_key_name (MOONSHOT_API_KEY)
        api_keys
            .set_setting("MOONSHOT_API_KEY", "legacy-moonshot-key")
            .await
            .expect("set api key");

        let creds = provider
            .get_credentials(&api_keys)
            .await
            .expect("get credentials");

        match creds {
            Creds::ApiKey(key) => assert_eq!(key, "legacy-moonshot-key"),
            _ => panic!("Expected ApiKey credential"),
        }
    }

    #[tokio::test]
    async fn get_credentials_prefers_provider_id_format_over_api_key_name() {
        let (_dir, api_keys, provider) = setup_test_context().await;

        // Store API keys in both formats
        api_keys
            .set_setting("api_key_moonshot", "new-format-key")
            .await
            .expect("set api key");
        api_keys
            .set_setting("MOONSHOT_API_KEY", "old-format-key")
            .await
            .expect("set legacy api key");

        let creds = provider
            .get_credentials(&api_keys)
            .await
            .expect("get credentials");

        // Should prefer the new format (api_key_moonshot)
        match creds {
            Creds::ApiKey(key) => assert_eq!(key, "new-format-key"),
            _ => panic!("Expected ApiKey credential"),
        }
    }

    #[tokio::test]
    async fn get_credentials_returns_error_when_no_key_found() {
        let (_dir, api_keys, provider) = setup_test_context().await;

        // Don't set any API key
        let result = provider.get_credentials(&api_keys).await;

        assert!(result.is_err());
        let error_msg = result.unwrap_err();
        assert!(error_msg.contains("API key 'MOONSHOT_API_KEY' not found"));
    }
}
