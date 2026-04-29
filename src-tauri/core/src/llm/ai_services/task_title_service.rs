use crate::llm::ai_services::model_resolver::{resolve_model_identifiers, FallbackStrategy};
use crate::llm::ai_services::stream_collector::StreamCollector;
use crate::llm::ai_services::stream_runner::StreamRunner;
use crate::llm::ai_services::types::{TitleGenerationRequest, TitleGenerationResult};
use crate::llm::auth::api_key_manager::ApiKeyManager;
use crate::llm::providers::provider_registry::ProviderRegistry;
use std::time::Duration;

pub struct TaskTitleService;

impl TaskTitleService {
    pub fn new() -> Self {
        Self
    }

    /// Generate a title from user input
    pub async fn generate_title(
        &self,
        request: TitleGenerationRequest,
        api_keys: &ApiKeyManager,
        registry: &ProviderRegistry,
    ) -> Result<TitleGenerationResult, String> {
        log::info!(
            "generateTitle: userInput length = {}",
            request.user_input.len()
        );

        if request.user_input.trim().is_empty() {
            log::error!("No user input provided for title generation");
            return Err("No user input provided".to_string());
        }

        let language = request.language.as_deref().unwrap_or("en");
        let language_instruction = if language == "zh" {
            "Generate the title in Chinese."
        } else {
            "Generate the title in English."
        };

        let prompt = self.build_prompt(&request.user_input, language_instruction);
        log::info!(
            "Generated prompt for title generation (length: {})",
            prompt.len()
        );

        let preferred_model = request.model.clone();
        let resolved_models = resolve_model_identifiers(
            api_keys,
            registry,
            preferred_model,
            request.fallback_models.clone(),
            FallbackStrategy::AnyAvailable,
        )
        .await?;
        let model_identifier = resolved_models[0].clone();
        let fallback_models = resolved_models[1..].to_vec();

        let request = StreamCollector::create_completion_request(
            model_identifier,
            if fallback_models.is_empty() {
                None
            } else {
                Some(fallback_models)
            },
            prompt,
        );

        let runner = StreamRunner::new(registry.clone(), api_keys.clone());
        let result =
            StreamCollector::collect_with_runner(&runner, request, Duration::from_secs(30)).await?;

        let title = self.post_process_title(&result.text);
        if title.is_empty() {
            return Err("Empty title generated".to_string());
        }

        Ok(TitleGenerationResult { title })
    }

    fn post_process_title(&self, raw: &str) -> String {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return String::new();
        }
        let first_line = trimmed.lines().next().unwrap_or(trimmed).trim();
        let without_quotes = first_line
            .trim_matches('"')
            .trim_matches('“')
            .trim_matches('”');
        without_quotes.to_string()
    }

    /// Build the prompt for title generation
    fn build_prompt(&self, user_input: &str, language_instruction: &str) -> String {
        format!(
            "You are an AI assistant that generates concise, descriptive titles for tasks.\n\n\
             User's message: \"{}\"\n\n\
             Generate a short, clear title (5-10 words) that captures the essence of what the user is asking or discussing.\n\n\
             Guidelines:\n\
             1. Keep it concise (5-10 words maximum)\n\
             2. Use title case (capitalize first letter of main words)\n\
             3. Be specific and descriptive\n\
             4. Avoid generic titles like \"New Chat\" or \"Question\"\n\
             5. Focus on the main topic or intent\n\n\
             Examples:\n\
             - \"Fix Login Bug\"\n\
             - \"Create User Dashboard\"\n\
             - \"Explain React Hooks\"\n\
             - \"Database Schema Design\"\n\
             - \"API Rate Limiting Issue\"\n\n\
             {}\n\n\
             Provide ONLY the title without any quotes, explanations, or additional formatting.",
            user_input, language_instruction
        )
    }

    /// Get the preferred model type for title generation
    pub fn preferred_model_type() -> &'static str {
        "small"
    }
}

impl Default for TaskTitleService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::Database;
    use crate::llm::auth::api_key_manager::ApiKeyManager;
    use crate::llm::providers::provider_registry::ProviderRegistry;
    use crate::llm::types::{
        AuthType, ModelConfig, ModelPricing, ModelsConfiguration, ProtocolType, ProviderConfig,
    };
    use std::collections::HashMap;
    use std::sync::Arc;
    use tempfile::TempDir;

    async fn setup_context() -> (ApiKeyManager, ProviderRegistry) {
        let dir = TempDir::new().expect("temp dir");
        let db_path = dir.path().join("models-test.db");
        let db = Arc::new(Database::new(db_path.to_string_lossy().to_string()));
        db.connect().await.expect("db connect");
        db.execute(
            "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER)",
            vec![],
        )
        .await
        .expect("create settings");

        let api_keys = ApiKeyManager::new(db, dir.path().join("app-data"));
        api_keys
            .set_setting("api_key_openai", "test-key")
            .await
            .expect("set api key");

        let provider_config = ProviderConfig {
            id: "openai".to_string(),
            name: "openai".to_string(),
            protocol: ProtocolType::OpenAiCompatible,
            base_url: "http://localhost".to_string(),
            api_key_name: "TEST_API_KEY".to_string(),
            supports_oauth: false,
            supports_coding_plan: false,
            supports_international: false,
            coding_plan_base_url: None,
            international_base_url: None,
            headers: None,
            extra_body: None,
            auth_type: AuthType::Bearer,
        };
        let registry = ProviderRegistry::new(vec![provider_config]);

        let models_config = ModelsConfiguration {
            version: "1".to_string(),
            models: HashMap::from([(
                "test-model".to_string(),
                ModelConfig {
                    name: "Test Model".to_string(),
                    image_input: false,
                    image_output: false,
                    audio_input: false,
                    video_input: false,
                    interleaved: false,
                    providers: vec!["openai".to_string()],
                    provider_mappings: None,
                    pricing: Some(ModelPricing {
                        input: "0.0001".to_string(),
                        output: "0.0002".to_string(),
                        cached_input: None,
                        cache_creation: None,
                    }),
                    context_length: Some(8192),
                },
            )]),
        };

        api_keys
            .set_setting(
                "models_config_json",
                &serde_json::to_string(&models_config).expect("serialize config"),
            )
            .await
            .expect("set models config");

        (api_keys, registry)
    }

    #[test]
    fn build_prompt_includes_user_input() {
        let service = TaskTitleService::new();
        let prompt = service.build_prompt(
            "How do I use React hooks?",
            "Generate the title in English.",
        );

        assert!(prompt.contains("How do I use React hooks?"));
        assert!(prompt.contains("User's message"));
    }

    #[test]
    fn build_prompt_contains_guidelines() {
        let service = TaskTitleService::new();
        let prompt = service.build_prompt("test", "Generate the title in English.");

        assert!(prompt.contains("5-10 words maximum"));
        assert!(prompt.contains("title case"));
        assert!(prompt.contains("specific and descriptive"));
    }

    #[test]
    fn build_prompt_contains_examples() {
        let service = TaskTitleService::new();
        let prompt = service.build_prompt("test", "Generate the title in English.");

        assert!(prompt.contains("Fix Login Bug"));
        assert!(prompt.contains("Create User Dashboard"));
        assert!(prompt.contains("Explain React Hooks"));
    }

    #[test]
    fn build_prompt_uses_english_instruction() {
        let service = TaskTitleService::new();
        let prompt = service.build_prompt("test", "Generate the title in English.");

        assert!(prompt.contains("Generate the title in English."));
    }

    #[test]
    fn build_prompt_uses_chinese_instruction() {
        let service = TaskTitleService::new();
        let prompt = service.build_prompt("test", "Generate the title in Chinese.");

        assert!(prompt.contains("Generate the title in Chinese."));
    }

    #[tokio::test]
    async fn generate_fails_with_empty_input() {
        let (api_keys, registry) = setup_context().await;
        let service = TaskTitleService::new();
        let request = TitleGenerationRequest {
            user_input: "   ".to_string(),
            language: None,
            model: None,
            fallback_models: None,
        };

        let result = service.generate_title(request, &api_keys, &registry).await;

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("No user input"));
    }

    #[test]
    fn preferred_model_type_returns_small() {
        assert_eq!(TaskTitleService::preferred_model_type(), "small");
    }
}
