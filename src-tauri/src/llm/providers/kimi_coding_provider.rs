// Kimi Coding Plan Provider Implementation
// Uses the coding plan endpoint with special KimiCLI User-Agent header

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

pub struct KimiCodingProvider {
    base: BaseProvider,
    protocol: OpenAiProtocol,
}

impl KimiCodingProvider {
    pub fn new(config: ProviderConfig) -> Self {
        Self {
            base: BaseProvider::new(config),
            protocol: OpenAiProtocol,
        }
    }
}

#[async_trait]
impl Provider for KimiCodingProvider {
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
        headers: &mut HashMap<String, String>,
    ) -> Result<(), String> {
        // Add KimiCLI User-Agent for coding plan endpoint
        headers.insert("User-Agent".to_string(), "KimiCLI/1.3".to_string());
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
            id: "kimi_coding".to_string(),
            name: "Kimi Coding Plan".to_string(),
            protocol: ProtocolType::OpenAiCompatible,
            base_url: "https://api.moonshot.cn/kimi-cli".to_string(),
            api_key_name: "KIMI_CODING_API_KEY".to_string(),
            supports_oauth: false,
            supports_coding_plan: true,
            supports_international: false,
            coding_plan_base_url: None,
            international_base_url: None,
            headers: None,
            extra_body: None,
            auth_type: crate::llm::types::AuthType::Bearer,
        }
    }

    async fn setup_test_context() -> (TempDir, ApiKeyManager, KimiCodingProvider) {
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
        let provider = KimiCodingProvider::new(create_test_config());

        (dir, api_keys, provider)
    }

    #[tokio::test]
    async fn get_credentials_uses_api_key_provider_id_format() {
        let (_dir, api_keys, provider) = setup_test_context().await;

        // Store API key using the standard format: api_key_{provider_id}
        api_keys
            .set_setting("api_key_kimi_coding", "test-kimi-coding-key")
            .await
            .expect("set api key");

        let creds = provider
            .get_credentials(&api_keys)
            .await
            .expect("get credentials");

        match creds {
            Creds::ApiKey(key) => assert_eq!(key, "test-kimi-coding-key"),
            _ => panic!("Expected ApiKey credential"),
        }
    }

    #[tokio::test]
    async fn get_credentials_falls_back_to_api_key_name() {
        let (_dir, api_keys, provider) = setup_test_context().await;

        // Store API key using the legacy format: api_key_name (KIMI_CODING_API_KEY)
        api_keys
            .set_setting("KIMI_CODING_API_KEY", "legacy-kimi-coding-key")
            .await
            .expect("set api key");

        let creds = provider
            .get_credentials(&api_keys)
            .await
            .expect("get credentials");

        match creds {
            Creds::ApiKey(key) => assert_eq!(key, "legacy-kimi-coding-key"),
            _ => panic!("Expected ApiKey credential"),
        }
    }

    #[tokio::test]
    async fn get_credentials_prefers_provider_id_format_over_api_key_name() {
        let (_dir, api_keys, provider) = setup_test_context().await;

        // Store API keys in both formats
        api_keys
            .set_setting("api_key_kimi_coding", "new-format-key")
            .await
            .expect("set api key");
        api_keys
            .set_setting("KIMI_CODING_API_KEY", "old-format-key")
            .await
            .expect("set legacy api key");

        let creds = provider
            .get_credentials(&api_keys)
            .await
            .expect("get credentials");

        // Should prefer the new format (api_key_kimi_coding)
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
        assert!(error_msg.contains("API key 'KIMI_CODING_API_KEY' not found"));
    }
}
