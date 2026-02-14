use crate::llm::ai_services::model_resolver::{resolve_model_identifier, FallbackStrategy};
use crate::llm::ai_services::stream_collector::StreamCollector;
use crate::llm::ai_services::stream_runner::StreamRunner;
use crate::llm::ai_services::types::{ContextCompactionRequest, ContextCompactionResult};
use crate::llm::auth::api_key_manager::ApiKeyManager;
use crate::llm::providers::provider_registry::ProviderRegistry;
use std::time::{Duration, Instant};

pub struct ContextCompactionService {
    compression_timeout_ms: u64,
}

impl ContextCompactionService {
    pub fn new() -> Self {
        Self {
            compression_timeout_ms: 300_000, // 5 minutes
        }
    }

    pub fn with_timeout(mut self, timeout_ms: u64) -> Self {
        self.compression_timeout_ms = timeout_ms;
        self
    }

    pub fn timeout(&self) -> Duration {
        Duration::from_millis(self.compression_timeout_ms)
    }

    /// Compress conversation history using AI
    pub async fn compact_context(
        &self,
        request: ContextCompactionRequest,
        api_keys: &ApiKeyManager,
        registry: &ProviderRegistry,
    ) -> Result<ContextCompactionResult, String> {
        let start_time = Instant::now();

        log::info!("Starting AI context compaction");

        if request.conversation_history.trim().is_empty() {
            log::error!("No conversation history provided for compaction");
            return Err("Conversation history is required for compaction".to_string());
        }

        let prompt = self.build_compaction_prompt(&request.conversation_history);
        log::info!(
            "Context compaction prompt generated (length: {} chars)",
            prompt.len()
        );

        let model_identifier = resolve_model_identifier(
            api_keys,
            registry,
            request.model.clone(),
            FallbackStrategy::Compaction,
        )
        .await?;

        let stream_request = StreamCollector::create_completion_request(model_identifier, prompt);
        let runner = StreamRunner::new(registry.clone(), api_keys.clone());
        let result = StreamCollector::collect_with_runner(
            &runner,
            stream_request,
            Duration::from_millis(self.compression_timeout_ms),
        )
        .await?;

        let compressed_summary = result.text;
        self.validate_compaction_summary(&compressed_summary)?;
        let duration = start_time.elapsed();

        log::info!(
            "Context compaction completed - Time: {}ms",
            duration.as_millis()
        );
        log::info!(
            "Compressed summary length: {} characters (from {})",
            compressed_summary.len(),
            request.conversation_history.len()
        );

        Ok(ContextCompactionResult { compressed_summary })
    }

    fn validate_compaction_summary(&self, summary: &str) -> Result<(), String> {
        if summary.trim().is_empty() {
            log::error!("Context compaction returned empty summary");
            return Err(
                "Context compaction failed: AI returned an empty summary. Please try again."
                    .to_string(),
            );
        }
        Ok(())
    }

    /// Build the compaction prompt with the 8-section template
    fn build_compaction_prompt(&self, conversation_history: &str) -> String {
        format!(
            "Your task is to create a detailed summary of the conversation so far, paying close attention to the user's explicit requests and your previous actions.\n\
             This summary should be thorough in capturing technical details, code patterns, and architectural decisions that would be essential for continuing development work without losing context.\n\n\
             Before providing your final summary, wrap your analysis in <analysis> tags to organize your thoughts and ensure you've covered all necessary points.\n\n\
             Your summary should include the following sections:\n\n\
             1. Primary Request and Intent: Capture all of the user's explicit requests and intents in detail\n\
             2. Key Technical Concepts: List all important technical concepts, technologies, and frameworks discussed.\n\
             3. Files and Code Sections: Enumerate specific files and code sections examined, modified, or created. Pay special attention to the most recent messages and include full code snippets where applicable.\n\
             4. Errors and fixes: List all errors that you ran into, and how you fixed them. Pay special attention to specific user feedback.\n\
             5. Problem Solving: Document problems solved and any ongoing troubleshooting efforts.\n\
             6. All user messages: List ALL user messages that are not tool results. These are critical for understanding the users' feedback and changing intent.\n\
             7. Pending Tasks: Outline any pending tasks that you have explicitly been asked to work on.\n\
             8. Current Work: Describe in detail precisely what was being worked on immediately before this summary request.\n\n\
             Please be comprehensive and technical in your summary. Include specific file paths, function names, error messages, and code patterns that would be essential for maintaining context.\n\n\
             CONVERSATION HISTORY TO SUMMARIZE:\n\
             {}\n\n\
             Please provide a comprehensive structured summary following the 8-section format above.",
            conversation_history
        )
    }
}

impl Default for ContextCompactionService {
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
    fn new_has_default_timeout() {
        let service = ContextCompactionService::new();
        assert_eq!(service.compression_timeout_ms, 300_000);
    }

    #[test]
    fn with_timeout_changes_timeout() {
        let service = ContextCompactionService::new().with_timeout(60_000);
        assert_eq!(service.compression_timeout_ms, 60_000);
    }

    #[test]
    fn timeout_returns_duration() {
        let service = ContextCompactionService::new().with_timeout(60_000);
        assert_eq!(service.timeout(), Duration::from_secs(60));
    }

    #[test]
    fn build_prompt_contains_all_sections() {
        let service = ContextCompactionService::new();
        let history = "User: Hello\nAI: Hi there!";
        let prompt = service.build_compaction_prompt(history);

        assert!(prompt.contains("Primary Request and Intent"));
        assert!(prompt.contains("Key Technical Concepts"));
        assert!(prompt.contains("Files and Code Sections"));
        assert!(prompt.contains("Errors and fixes"));
        assert!(prompt.contains("Problem Solving"));
        assert!(prompt.contains("All user messages"));
        assert!(prompt.contains("Pending Tasks"));
        assert!(prompt.contains("Current Work"));
    }

    #[test]
    fn build_prompt_contains_analysis_tags() {
        let service = ContextCompactionService::new();
        let prompt = service.build_compaction_prompt("test");

        assert!(prompt.contains("<analysis>"));
    }

    #[test]
    fn build_prompt_includes_conversation_history() {
        let service = ContextCompactionService::new();
        let history = "This is the conversation history";
        let prompt = service.build_compaction_prompt(history);

        assert!(prompt.contains(history));
        assert!(prompt.contains("CONVERSATION HISTORY TO SUMMARIZE:"));
    }

    #[tokio::test]
    async fn compact_fails_with_empty_history() {
        let (api_keys, registry) = setup_context().await;
        let service = ContextCompactionService::new();
        let request = ContextCompactionRequest {
            conversation_history: "   ".to_string(),
            model: None,
        };

        let result = service.compact_context(request, &api_keys, &registry).await;

        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .contains("Conversation history is required"));
    }

    #[test]
    fn validate_compaction_summary_rejects_empty() {
        let service = ContextCompactionService::new();
        let result = service.validate_compaction_summary("   ");

        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .contains("Context compaction failed: AI returned an empty summary"));
    }

    #[test]
    fn validate_compaction_summary_accepts_non_empty() {
        let service = ContextCompactionService::new();
        let result = service.validate_compaction_summary("Summary content");

        assert!(result.is_ok());
    }
}
