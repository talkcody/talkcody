use crate::llm::auth::api_key_manager::ApiKeyManager;
use crate::llm::models::model_registry::ModelRegistry;
use crate::llm::providers::provider_registry::ProviderRegistry;
use crate::llm::transcription::google::GoogleTranscriptionClient;
use crate::llm::transcription::groq::GroqTranscriptionClient;
use crate::llm::transcription::openai::OpenAITranscriptionClient;
use crate::llm::transcription::openrouter::OpenRouterTranscriptionClient;
use crate::llm::transcription::types::{
    TranscriptionContext, TranscriptionError, TranscriptionProvider, TranscriptionResult,
};
use crate::llm::types::CustomProvidersConfiguration;
use std::time::Instant;

/// Unified transcription service that routes to appropriate provider
pub struct TranscriptionService;

impl TranscriptionService {
    /// Transcribe audio using the configured provider
    pub async fn transcribe(
        api_keys: &ApiKeyManager,
        registry: &ProviderRegistry,
        custom_providers: &CustomProvidersConfiguration,
        models: &crate::llm::types::ModelsConfiguration,
        model_identifier: &str,
        context: TranscriptionContext,
    ) -> Result<TranscriptionResult, TranscriptionError> {
        let start_time = Instant::now();

        log::info!(
            "Starting audio transcription, audio size: {} bytes, mime type: {}",
            context.audio_base64.len(),
            context.mime_type
        );

        // Load API keys map
        let api_map = api_keys
            .load_api_keys()
            .await
            .map_err(|e| TranscriptionError::RequestFailed(e))?;

        // Parse model identifier and get provider
        let (model_key, provider_id) = ModelRegistry::get_model_provider(
            model_identifier,
            &api_map,
            registry,
            custom_providers,
            models,
        )
        .map_err(|e| {
            if e.contains("No available provider") {
                TranscriptionError::NoAvailableProvider
            } else {
                TranscriptionError::RequestFailed(e)
            }
        })?;

        log::info!(
            "Using transcription model: {}, provider: {}",
            model_key,
            provider_id
        );

        // Get provider-specific model name
        let provider_model_name =
            ModelRegistry::resolve_provider_model_name(&model_key, &provider_id, models);
        log::info!("Provider-specific model name: {}", provider_model_name);

        // Get transcription provider
        let provider = TranscriptionProvider::from_id(&provider_id)
            .ok_or_else(|| TranscriptionError::ProviderNotSupported(provider_id.clone()))?;

        // Route to appropriate provider client
        let result = match provider {
            TranscriptionProvider::OpenRouter => {
                let provider_config = registry
                    .provider(&provider_id)
                    .ok_or_else(|| TranscriptionError::ProviderNotSupported(provider_id.clone()))?;
                let client = OpenRouterTranscriptionClient::new(provider_config.clone());
                client
                    .transcribe(api_keys, &provider_model_name, context)
                    .await
                    .map_err(|e| TranscriptionError::RequestFailed(e))?
            }
            TranscriptionProvider::OpenAI => {
                let provider_config = registry
                    .provider(&provider_id)
                    .ok_or_else(|| TranscriptionError::ProviderNotSupported(provider_id.clone()))?;
                let client = OpenAITranscriptionClient::new(provider_config.clone());
                client
                    .transcribe(api_keys, &provider_model_name, context)
                    .await
                    .map_err(|e| TranscriptionError::RequestFailed(e))?
            }
            TranscriptionProvider::Google => {
                let client = GoogleTranscriptionClient::new();
                client
                    .transcribe(api_keys, &provider_model_name, context)
                    .await
                    .map_err(|e| TranscriptionError::RequestFailed(e))?
            }
            TranscriptionProvider::Groq => {
                let provider_config = registry
                    .provider(&provider_id)
                    .ok_or_else(|| TranscriptionError::ProviderNotSupported(provider_id.clone()))?;
                let client = GroqTranscriptionClient::new(provider_config.clone());
                // Convert TranscriptionContext to GroqTranscriptionRequest
                let groq_request = crate::llm::transcription::groq::GroqTranscriptionRequest {
                    model: provider_model_name,
                    audio_base64: context.audio_base64,
                    mime_type: context.mime_type,
                    language: context.language,
                    prompt: context.prompt,
                    temperature: context.temperature,
                    response_format: context.response_format,
                };
                let response = client
                    .transcribe(api_keys, groq_request)
                    .await
                    .map_err(|e| TranscriptionError::RequestFailed(e))?;
                TranscriptionResult {
                    text: response.text,
                    language: response.language,
                    duration_in_seconds: response.duration,
                }
            }
        };

        let duration = start_time.elapsed();
        log::info!(
            "Transcription completed in {:?}, text length: {}, language: {:?}",
            duration,
            result.text.len(),
            result.language
        );

        // Check for empty result
        if result.text.trim().is_empty() {
            log::warn!("Transcription returned empty text");
            return Err(TranscriptionError::EmptyResult);
        }

        Ok(TranscriptionResult {
            text: result.text.trim().to_string(),
            language: result.language,
            duration_in_seconds: result.duration_in_seconds,
        })
    }

    /// Check if a model identifier is available for transcription
    pub async fn is_model_available(
        api_keys: &ApiKeyManager,
        registry: &ProviderRegistry,
        custom_providers: &CustomProvidersConfiguration,
        models: &crate::llm::types::ModelsConfiguration,
        model_identifier: &str,
    ) -> Result<bool, String> {
        let api_map = api_keys.load_api_keys().await?;

        match ModelRegistry::get_model_provider(
            model_identifier,
            &api_map,
            registry,
            custom_providers,
            models,
        ) {
            Ok((_, provider_id)) => {
                // Check if provider supports transcription
                Ok(TranscriptionProvider::from_id(&provider_id).is_some())
            }
            Err(_) => Ok(false),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transcription_provider_from_id() {
        assert_eq!(
            TranscriptionProvider::from_id("openrouter"),
            Some(TranscriptionProvider::OpenRouter)
        );
        assert_eq!(
            TranscriptionProvider::from_id("openai"),
            Some(TranscriptionProvider::OpenAI)
        );
        assert_eq!(
            TranscriptionProvider::from_id("google"),
            Some(TranscriptionProvider::Google)
        );
        assert_eq!(
            TranscriptionProvider::from_id("groq"),
            Some(TranscriptionProvider::Groq)
        );
        assert_eq!(TranscriptionProvider::from_id("unknown"), None);
    }

    #[test]
    fn transcription_provider_as_id() {
        assert_eq!(TranscriptionProvider::OpenRouter.as_id(), "openrouter");
        assert_eq!(TranscriptionProvider::OpenAI.as_id(), "openai");
        assert_eq!(TranscriptionProvider::Google.as_id(), "google");
        assert_eq!(TranscriptionProvider::Groq.as_id(), "groq");
    }

    #[test]
    fn transcription_error_display() {
        assert!(TranscriptionError::NoModelConfigured
            .to_string()
            .contains("No transcription model configured"));
        assert!(TranscriptionError::NoAvailableProvider
            .to_string()
            .contains("No available provider"));
        assert!(TranscriptionError::ProviderNotSupported("test".to_string())
            .to_string()
            .contains("Transcription not supported"));
        assert!(TranscriptionError::ApiKeyNotConfigured("Test".to_string())
            .to_string()
            .contains("Test API key not configured"));
        assert!(TranscriptionError::RequestFailed("error".to_string())
            .to_string()
            .contains("Transcription failed"));
        assert!(TranscriptionError::ParseError("error".to_string())
            .to_string()
            .contains("Failed to parse"));
        assert!(TranscriptionError::EmptyResult
            .to_string()
            .contains("empty text"));
    }

    #[test]
    fn transcription_error_into_string() {
        let err: String = TranscriptionError::NoModelConfigured.into();
        assert!(!err.is_empty());
    }
}
