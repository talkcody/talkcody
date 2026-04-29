use crate::llm::ai_services::model_resolver::{resolve_model_identifiers, FallbackStrategy};
use crate::llm::ai_services::stream_collector::StreamCollector;
use crate::llm::ai_services::stream_runner::StreamRunner;
use crate::llm::ai_services::types::{GitMessageContext, GitMessageResult};
use crate::llm::auth::api_key_manager::ApiKeyManager;
use crate::llm::providers::provider_registry::ProviderRegistry;
use std::time::Duration;

pub struct GitMessageService;

impl GitMessageService {
    pub fn new() -> Self {
        Self
    }

    /// Generate a commit message from git diff
    pub async fn generate_commit_message(
        &self,
        context: GitMessageContext,
        api_keys: &ApiKeyManager,
        registry: &ProviderRegistry,
    ) -> Result<GitMessageResult, String> {
        log::info!(
            "generateCommitMessage: diffText length = {}",
            context.diff_text.len()
        );

        if context.diff_text.trim().is_empty() {
            log::error!("No diff text provided for commit message generation");
            return Err("No diff text provided".to_string());
        }

        let prompt = self.build_prompt(&context);
        log::info!(
            "Generated prompt for git commit message (length: {})",
            prompt.len()
        );

        let resolved_models = resolve_model_identifiers(
            api_keys,
            registry,
            context.model.clone(),
            context.fallback_models.clone(),
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

        let message = self.post_process_message(&result.text);
        if message.is_empty() {
            return Err("Empty commit message generated".to_string());
        }

        Ok(GitMessageResult {
            message,
            suggestions: None,
        })
    }

    /// Build the prompt for commit message generation
    fn build_prompt(&self, context: &GitMessageContext) -> String {
        let user_input_section = context
            .user_input
            .as_ref()
            .map(|input| format!("User task description: \"{}\"\n", input))
            .unwrap_or_default();

        format!(
            "You are an AI assistant that generates concise and meaningful git commit messages following conventional commit format.\n\n\
             {}\
             File changes (git diff):\n\
             {}\n\n\
             Generate a concise git commit message that follows these guidelines:\n\
             1. Use conventional commit format: type(scope): description\n\
             2. Types: feat, fix, docs, style, refactor, test, chore\n\
             3. Keep the message under 72 characters for the subject line\n\
             4. Be specific about what was changed based on the actual diff content\n\
             5. Use imperative mood (e.g., \"add\", \"fix\", \"update\")\n\n\
             Examples:\n\
             - feat(auth): add user authentication system\n\
             - fix(api): resolve data validation error\n\
             - docs: update installation instructions\n\
             - refactor: simplify user service logic\n\n\
             Provide ONLY the commit message without any explanations or formatting.",
            user_input_section, context.diff_text
        )
    }

    fn post_process_message(&self, raw: &str) -> String {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return String::new();
        }
        trimmed.lines().next().unwrap_or(trimmed).trim().to_string()
    }

    /// Get the preferred model for git message generation
    pub fn preferred_model() -> &'static str {
        "gemini-2.5-flash-lite"
    }
}

impl Default for GitMessageService {
    fn default() -> Self {
        Self::new()
    }
}
