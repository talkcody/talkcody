use crate::llm::protocols::{claude_protocol::ClaudeProtocol, openai_protocol::OpenAiProtocol};
use crate::llm::providers::{
    DefaultProvider, GithubCopilotProvider, KimiCodingProvider, MoonshotProvider, OpenAiProvider,
    Provider,
};
use crate::llm::types::ProtocolType;
use crate::llm::types::ProviderConfig;
use std::collections::HashMap;

pub struct ProviderRegistry {
    providers: HashMap<String, ProviderConfig>,
    // Protocol implementations (kept for backward compatibility during migration)
    #[allow(dead_code)]
    openai_protocol: OpenAiProtocol,
    #[allow(dead_code)]
    claude_protocol: ClaudeProtocol,
}

impl Clone for ProviderRegistry {
    fn clone(&self) -> Self {
        Self {
            providers: self.providers.clone(),
            openai_protocol: OpenAiProtocol,
            claude_protocol: ClaudeProtocol,
        }
    }
}

impl Default for ProviderRegistry {
    fn default() -> Self {
        use crate::llm::providers::provider_configs::builtin_providers;
        Self::new(builtin_providers())
    }
}

impl ProviderRegistry {
    pub fn new(builtin_providers: Vec<ProviderConfig>) -> Self {
        let mut providers = HashMap::new();
        for provider in builtin_providers {
            providers.insert(provider.id.clone(), provider);
        }

        Self {
            providers,
            openai_protocol: OpenAiProtocol,
            claude_protocol: ClaudeProtocol,
        }
    }

    pub fn register_provider(&mut self, config: ProviderConfig) {
        self.providers.insert(config.id.clone(), config);
    }

    pub fn provider(&self, id: &str) -> Option<&ProviderConfig> {
        self.providers.get(id)
    }

    pub fn providers(&self) -> Vec<ProviderConfig> {
        self.providers.values().cloned().collect()
    }

    /// Create a provider instance for the given provider ID
    /// This is the new way to get a provider with its specific logic
    pub fn create_provider(&self, id: &str) -> Option<Box<dyn Provider>> {
        let config = self.providers.get(id)?;

        // Create the appropriate provider based on ID
        let provider: Box<dyn Provider> = match id {
            "openai" => Box::new(OpenAiProvider::new(config.clone())),
            "github_copilot" => Box::new(GithubCopilotProvider::new(config.clone())),
            "moonshot" => Box::new(MoonshotProvider::new(config.clone())),
            "kimi_coding" => Box::new(KimiCodingProvider::new(config.clone())),
            // Use DefaultProvider for all other providers
            _ => Box::new(DefaultProvider::new(config.clone())),
        };

        Some(provider)
    }

    /// Legacy method - kept for backward compatibility
    #[allow(dead_code)]
    pub fn protocol(&self, protocol: ProtocolType) -> Option<LegacyProtocolAdapter<'_>> {
        match protocol {
            ProtocolType::OpenAiCompatible => {
                Some(LegacyProtocolAdapter::new(&self.openai_protocol))
            }
            ProtocolType::Claude => Some(LegacyProtocolAdapter::new(&self.claude_protocol)),
        }
    }
}

/// Adapter for backward compatibility with old protocol system
pub struct LegacyProtocolAdapter<'a> {
    #[allow(dead_code)]
    protocol: &'a dyn crate::llm::protocols::LlmProtocol,
}

impl<'a> LegacyProtocolAdapter<'a> {
    #[allow(dead_code)]
    pub fn new(protocol: &'a dyn crate::llm::protocols::LlmProtocol) -> Self {
        Self { protocol }
    }

    #[allow(dead_code)]
    pub fn name(&self) -> &str {
        self.protocol.name()
    }

    #[allow(dead_code)]
    pub fn endpoint_path(&self) -> &'static str {
        self.protocol.endpoint_path()
    }

    #[allow(dead_code)]
    pub fn build_request(
        &self,
        model: &str,
        messages: &[crate::llm::types::Message],
        tools: Option<&[crate::llm::types::ToolDefinition]>,
        temperature: Option<f32>,
        max_tokens: Option<i32>,
        top_p: Option<f32>,
        top_k: Option<i32>,
        provider_options: Option<&serde_json::Value>,
        extra_body: Option<&serde_json::Value>,
    ) -> Result<serde_json::Value, String> {
        self.protocol.build_request(
            model,
            messages,
            tools,
            temperature,
            max_tokens,
            top_p,
            top_k,
            provider_options,
            extra_body,
        )
    }

    #[allow(dead_code)]
    pub fn parse_stream_event(
        &self,
        event_type: Option<&str>,
        data: &str,
        state: &mut crate::llm::protocols::ProtocolStreamState,
    ) -> Result<Option<crate::llm::types::StreamEvent>, String> {
        self.protocol.parse_stream_event(event_type, data, state)
    }

    #[allow(dead_code)]
    pub fn build_headers(
        &self,
        api_key: Option<&str>,
        oauth_token: Option<&str>,
        extra_headers: Option<&std::collections::HashMap<String, String>>,
    ) -> std::collections::HashMap<String, String> {
        self.protocol
            .build_headers(api_key, oauth_token, extra_headers)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::llm::types::{AuthType, ProviderConfig};

    fn provider_config(id: &str) -> ProviderConfig {
        ProviderConfig {
            id: id.to_string(),
            name: id.to_string(),
            protocol: ProtocolType::OpenAiCompatible,
            base_url: "https://example.com".to_string(),
            api_key_name: "TEST_API_KEY".to_string(),
            supports_oauth: false,
            supports_coding_plan: false,
            supports_international: false,
            coding_plan_base_url: None,
            international_base_url: None,
            headers: None,
            extra_body: None,
            auth_type: AuthType::Bearer,
        }
    }

    #[test]
    fn new_registers_builtin_protocols() {
        let registry = ProviderRegistry::new(Vec::new());
        assert!(registry.protocol(ProtocolType::OpenAiCompatible).is_some());
        assert!(registry.protocol(ProtocolType::Claude).is_some());
    }

    #[test]
    fn register_provider_updates_lookup() {
        let mut registry = ProviderRegistry::new(Vec::new());
        registry.register_provider(provider_config("openai"));
        let provider = registry.provider("openai").expect("provider exists");
        assert_eq!(provider.name, "openai");
    }

    #[test]
    fn create_provider_returns_specific_provider() {
        let mut registry = ProviderRegistry::new(Vec::new());
        registry.register_provider(provider_config("openai"));
        registry.register_provider(provider_config("github_copilot"));

        let openai = registry.create_provider("openai");
        assert!(openai.is_some());
        assert_eq!(openai.unwrap().id(), "openai");

        let copilot = registry.create_provider("github_copilot");
        assert!(copilot.is_some());
        assert_eq!(copilot.unwrap().id(), "github_copilot");
    }
}
