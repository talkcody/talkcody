use crate::llm::auth::api_key_manager::ApiKeyManager;
use crate::llm::image_generation::aigateway::AIGatewayImageClient;
use crate::llm::image_generation::dashscope::DashScopeImageClient;
use crate::llm::image_generation::google::GoogleImageClient;
use crate::llm::image_generation::openai::OpenAiImageClient;
use crate::llm::image_generation::types::{ImageGenerationRequest, ImageGenerationResponse};
use crate::llm::image_generation::volcengine::VolcengineImageClient;
use crate::llm::image_generation::zhipu::ZhipuImageClient;
use crate::llm::models::model_registry::ModelRegistry;
use crate::llm::providers::provider_registry::ProviderRegistry;
use crate::llm::types::CustomProvidersConfiguration;
use crate::llm::types::ModelsConfiguration;

/// Settings key for image generator model type
const IMAGE_GENERATOR_MODEL_TYPE_KEY: &str = "model_type_image_generator";
/// Default image generator model
const DEFAULT_IMAGE_GENERATOR_MODEL: &str = "gemini-3-pro-image";

pub struct ImageGenerationService;

impl ImageGenerationService {
    pub async fn generate(
        api_keys: &ApiKeyManager,
        registry: &ProviderRegistry,
        custom_providers: &CustomProvidersConfiguration,
        models: &ModelsConfiguration,
        request: ImageGenerationRequest,
    ) -> Result<ImageGenerationResponse, String> {
        let api_map = ModelRegistry::load_provider_credentials(api_keys).await?;

        // Resolve model: use provided model, or auto-select if empty
        let model_identifier = if request.model.trim().is_empty() {
            Self::resolve_image_generator_model(
                api_keys,
                registry,
                custom_providers,
                models,
                &api_map,
            )
            .await?
        } else {
            request.model.clone()
        };

        let (model_key, provider_id) = ModelRegistry::get_model_provider(
            &model_identifier,
            &api_map,
            registry,
            custom_providers,
            models,
        )?;

        let provider_model_name =
            ModelRegistry::resolve_provider_model_name(&model_key, &provider_id, models);

        // Get provider config for base_url
        let provider = registry.provider(&provider_id).ok_or_else(|| {
            format!(
                "Provider not configured: {} / 供应商未配置: {}",
                provider_id, provider_id
            )
        })?;

        // Select client based on model type (model_key), not provider id or provider_model_name
        // model_key is the canonical model identifier without provider prefixes
        // Gemini/Imagen models use GoogleImageClient with provider's base_url
        // Other models use OpenAI-compatible API
        if Self::is_google_model(&model_key) {
            // Use GoogleImageClient with the appropriate base_url for image generation
            // For zenmux, gemini image generation uses a specific endpoint
            let image_base_url =
                Self::resolve_image_base_url(&provider_id, provider.base_url.clone());
            let client =
                GoogleImageClient::with_base_url_and_provider(image_base_url, provider_id.clone());
            let images = client
                .generate(api_keys, &provider_model_name, request)
                .await?;
            Ok(ImageGenerationResponse {
                provider: provider_id,
                images,
                request_id: None,
            })
        } else {
            // Use provider-specific clients for known providers
            match provider_id.as_str() {
                "aiGateway" => {
                    let client = AIGatewayImageClient::new(provider.clone());
                    let images = client
                        .generate(api_keys, &provider_model_name, request)
                        .await?;
                    Ok(ImageGenerationResponse {
                        provider: provider_id,
                        images,
                        request_id: None,
                    })
                }
                "volcengine" => {
                    let client = VolcengineImageClient::new(provider.clone());
                    let images = client
                        .generate(api_keys, &provider_model_name, request)
                        .await?;
                    Ok(ImageGenerationResponse {
                        provider: provider_id,
                        images,
                        request_id: None,
                    })
                }
                "zhipu" => {
                    let client = ZhipuImageClient::new(provider.clone());
                    let images = client
                        .generate(api_keys, &provider_model_name, request)
                        .await?;
                    Ok(ImageGenerationResponse {
                        provider: provider_id,
                        images,
                        request_id: None,
                    })
                }
                "alibaba" => {
                    let client = DashScopeImageClient::new(provider.clone());
                    let images = client
                        .generate(api_keys, &provider_model_name, request)
                        .await?;
                    Ok(ImageGenerationResponse {
                        provider: provider_id,
                        images,
                        request_id: None,
                    })
                }
                // Default: Use OpenAI-compatible image generation API
                // Most providers (openai, zenmux for non-Gemini models, and custom providers) support this standard
                _ => {
                    let client = OpenAiImageClient::new(provider.clone());
                    let images = client
                        .generate(api_keys, &provider_model_name, request)
                        .await?;
                    Ok(ImageGenerationResponse {
                        provider: provider_id,
                        images,
                        request_id: None,
                    })
                }
            }
        }
    }

    /// Check if the model is a Google model (Gemini or Imagen)
    /// Uses model_key which is the canonical model identifier without provider prefixes
    /// e.g., "gemini-3-flash"
    fn is_google_model(model_key: &str) -> bool {
        model_key.starts_with("gemini")
    }

    /// Resolve the base URL for image generation
    /// Some providers have specific endpoints for image generation that differ from chat endpoints
    fn resolve_image_base_url(provider_id: &str, default_base_url: String) -> String {
        match provider_id {
            // zenmux uses /api/vertex-ai/v1 for Gemini image generation
            // The /v1 path is required for Vertex AI API
            "zenmux" => "https://zenmux.ai/api/vertex-ai".to_string(),
            // Default to the provider's standard base_url
            _ => default_base_url,
        }
    }

    /// Automatically resolve an available image generator model
    /// 1. First, check if user has configured a model in settings (model_type_image_generator)
    /// 2. Otherwise, find any available model with image_output capability
    pub(crate) async fn resolve_image_generator_model(
        api_keys: &ApiKeyManager,
        registry: &ProviderRegistry,
        custom_providers: &CustomProvidersConfiguration,
        models: &ModelsConfiguration,
        api_map: &std::collections::HashMap<String, String>,
    ) -> Result<String, String> {
        // Step 1: Try to get configured model from settings
        if let Ok(Some(configured_model)) =
            api_keys.get_setting(IMAGE_GENERATOR_MODEL_TYPE_KEY).await
        {
            let configured_model = configured_model.trim();
            if !configured_model.is_empty() {
                // Check if the configured model is available
                if let Ok((_, _)) = ModelRegistry::get_model_provider(
                    configured_model,
                    api_map,
                    registry,
                    custom_providers,
                    models,
                ) {
                    log::info!(
                        "[ImageGenerationService] Using configured image generator model: {}",
                        configured_model
                    );
                    return Ok(configured_model.to_string());
                }
                log::warn!(
                    "[ImageGenerationService] Configured model {} is not available, falling back",
                    configured_model
                );
            }
        }

        // Step 2: Try default image generator model
        if let Ok((_, _)) = ModelRegistry::get_model_provider(
            DEFAULT_IMAGE_GENERATOR_MODEL,
            api_map,
            registry,
            custom_providers,
            models,
        ) {
            log::info!(
                "[ImageGenerationService] Using default image generator model: {}",
                DEFAULT_IMAGE_GENERATOR_MODEL
            );
            return Ok(DEFAULT_IMAGE_GENERATOR_MODEL.to_string());
        }

        // Step 3: Find any available model with image_output capability
        for (model_key, model_config) in &models.models {
            if model_config.image_output {
                if let Ok((_, provider_id)) = ModelRegistry::get_model_provider(
                    model_key,
                    api_map,
                    registry,
                    custom_providers,
                    models,
                ) {
                    log::info!(
                        "[ImageGenerationService] Auto-selected image generator model: {}@{}",
                        model_key,
                        provider_id
                    );
                    return Ok(format!("{}@{}", model_key, provider_id));
                }
            }
        }

        Err(
            "No available image generation model found. Please configure an image generator model in settings. \
             / 未找到可用的图片生成模型，请在设置中配置图片生成模型。"
                .to_string(),
        )
    }
}
