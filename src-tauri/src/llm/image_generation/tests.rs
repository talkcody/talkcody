use crate::database::Database;
use crate::llm::auth::api_key_manager::ApiKeyManager;
use crate::llm::image_generation::openai::OpenAiImageClient;
use crate::llm::image_generation::service::ImageGenerationService;
use crate::llm::image_generation::types::GeneratedImage;
use crate::llm::providers::provider_registry::ProviderRegistry;
use crate::llm::types::{
    AuthType, CustomProvidersConfiguration, ModelConfig, ModelsConfiguration, ProtocolType,
    ProviderConfig,
};
use serde_json::json;
use std::collections::HashMap;
use std::sync::Arc;
use tempfile::TempDir;

#[test]
fn openai_image_response_parses_b64_json() {
    let response = json!({
        "data": [
            {
                "b64_json": "abc",
                "revised_prompt": "refined"
            }
        ]
    });

    let parsed: serde_json::Value = response;
    let data = parsed.get("data").and_then(|v| v.as_array()).unwrap();
    let first = data.first().unwrap();
    assert_eq!(first.get("b64_json").and_then(|v| v.as_str()), Some("abc"));
    assert_eq!(
        first.get("revised_prompt").and_then(|v| v.as_str()),
        Some("refined")
    );
}

#[test]
fn openai_image_response_parses_url() {
    let response = json!({
        "data": [
            {
                "url": "https://example.com/image.png"
            }
        ]
    });

    let parsed: serde_json::Value = response;
    let data = parsed.get("data").and_then(|v| v.as_array()).unwrap();
    let first = data.first().unwrap();
    assert_eq!(
        first.get("url").and_then(|v| v.as_str()),
        Some("https://example.com/image.png")
    );
}

#[test]
fn openai_image_client_constructs() {
    let config = ProviderConfig {
        id: "openai".to_string(),
        name: "OpenAI".to_string(),
        protocol: ProtocolType::OpenAiCompatible,
        base_url: "https://api.openai.com/v1".to_string(),
        api_key_name: "OPENAI_API_KEY".to_string(),
        supports_oauth: true,
        supports_coding_plan: false,
        supports_international: false,
        coding_plan_base_url: None,
        international_base_url: None,
        headers: None,
        extra_body: None,
        auth_type: AuthType::Bearer,
    };
    let _client = OpenAiImageClient::new(config);
    let _image: GeneratedImage = GeneratedImage {
        b64_json: None,
        url: None,
        mime_type: "image/png".to_string(),
        revised_prompt: None,
    };
}

async fn setup_test_context() -> (
    TempDir,
    ApiKeyManager,
    ProviderRegistry,
    ModelsConfiguration,
) {
    let dir = TempDir::new().expect("temp dir");
    let db_path = dir.path().join("image-gen-test.db");
    let db = Arc::new(Database::new(db_path.to_string_lossy().to_string()));
    db.connect().await.expect("db connect");
    db.execute(
        "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER)",
        vec![],
    )
    .await
    .expect("create settings");

    let api_keys = ApiKeyManager::new(db, dir.path().join("app-data"));

    // Setup provider registry with image generation providers
    let providers = vec![
        ProviderConfig {
            id: "openai".to_string(),
            name: "OpenAI".to_string(),
            protocol: ProtocolType::OpenAiCompatible,
            base_url: "https://api.openai.com/v1".to_string(),
            api_key_name: "OPENAI_API_KEY".to_string(),
            supports_oauth: false,
            supports_coding_plan: false,
            supports_international: false,
            coding_plan_base_url: None,
            international_base_url: None,
            headers: None,
            extra_body: None,
            auth_type: AuthType::Bearer,
        },
        ProviderConfig {
            id: "google".to_string(),
            name: "Google".to_string(),
            protocol: ProtocolType::OpenAiCompatible,
            base_url: "https://generativelanguage.googleapis.com/v1beta".to_string(),
            api_key_name: "GOOGLE_API_KEY".to_string(),
            supports_oauth: false,
            supports_coding_plan: false,
            supports_international: false,
            coding_plan_base_url: None,
            international_base_url: None,
            headers: None,
            extra_body: None,
            auth_type: AuthType::Bearer,
        },
    ];
    let registry = ProviderRegistry::new(providers);

    // Setup models config with image generation models
    let mut models = HashMap::new();
    models.insert(
        "gemini-3-pro-image".to_string(),
        ModelConfig {
            name: "Gemini 3 Pro Image".to_string(),
            image_input: true,
            image_output: true,
            audio_input: false,
            video_input: false,
            interleaved: false,
            providers: vec!["google".to_string()],
            provider_mappings: None,
            pricing: None,
            context_length: Some(65536),
        },
    );
    models.insert(
        "dall-e-3".to_string(),
        ModelConfig {
            name: "DALL-E 3".to_string(),
            image_input: false,
            image_output: true,
            audio_input: false,
            video_input: false,
            interleaved: false,
            providers: vec!["openai".to_string()],
            provider_mappings: None,
            pricing: None,
            context_length: None,
        },
    );
    models.insert(
        "gpt-4".to_string(),
        ModelConfig {
            name: "GPT-4".to_string(),
            image_input: true,
            image_output: false,
            audio_input: false,
            video_input: false,
            interleaved: false,
            providers: vec!["openai".to_string()],
            provider_mappings: None,
            pricing: None,
            context_length: Some(8192),
        },
    );

    let models_config = ModelsConfiguration {
        version: "1".to_string(),
        models,
    };

    (dir, api_keys, registry, models_config)
}

#[tokio::test]
async fn resolve_image_generator_model_uses_configured_model() {
    let (_dir, api_keys, registry, models_config) = setup_test_context().await;

    // Set up API key for google
    api_keys
        .set_setting("api_key_google", "test-google-key")
        .await
        .expect("set api key");

    // Configure a specific image generator model
    api_keys
        .set_setting("model_type_image_generator", "gemini-3-pro-image")
        .await
        .expect("set model config");

    let api_map = api_keys.load_api_keys().await.expect("load api keys");
    let custom_providers = CustomProvidersConfiguration {
        version: "1".to_string(),
        providers: HashMap::new(),
    };

    let result = ImageGenerationService::resolve_image_generator_model(
        &api_keys,
        &registry,
        &custom_providers,
        &models_config,
        &api_map,
    )
    .await;

    assert!(result.is_ok());
    assert_eq!(result.unwrap(), "gemini-3-pro-image");
}

#[tokio::test]
async fn resolve_image_generator_model_falls_back_to_default() {
    let (_dir, api_keys, registry, models_config) = setup_test_context().await;

    // Set up API key for google (default model provider)
    api_keys
        .set_setting("api_key_google", "test-google-key")
        .await
        .expect("set api key");

    // No configured model - should fall back to default
    let api_map = api_keys.load_api_keys().await.expect("load api keys");
    let custom_providers = CustomProvidersConfiguration {
        version: "1".to_string(),
        providers: HashMap::new(),
    };

    let result = ImageGenerationService::resolve_image_generator_model(
        &api_keys,
        &registry,
        &custom_providers,
        &models_config,
        &api_map,
    )
    .await;

    assert!(result.is_ok());
    // Should use the default model
    assert_eq!(result.unwrap(), "gemini-3-pro-image");
}

#[tokio::test]
async fn resolve_image_generator_model_finds_any_image_output_model() {
    let (_dir, api_keys, registry, models_config) = setup_test_context().await;

    // Only set up OpenAI key (not Google, so default gemini-3-pro-image won't work)
    api_keys
        .set_setting("api_key_openai", "test-openai-key")
        .await
        .expect("set api key");

    // No configured model, default won't work - should find dall-e-3
    let api_map = api_keys.load_api_keys().await.expect("load api keys");
    let custom_providers = CustomProvidersConfiguration {
        version: "1".to_string(),
        providers: HashMap::new(),
    };

    let result = ImageGenerationService::resolve_image_generator_model(
        &api_keys,
        &registry,
        &custom_providers,
        &models_config,
        &api_map,
    )
    .await;

    assert!(result.is_ok());
    // Should find dall-e-3 with openai provider
    let model_id = result.unwrap();
    assert!(model_id.contains("dall-e-3"));
    assert!(model_id.contains("openai"));
}

#[tokio::test]
async fn resolve_image_generator_model_returns_error_when_no_image_model_available() {
    let dir = TempDir::new().expect("temp dir");
    let db_path = dir.path().join("image-gen-test.db");
    let db = Arc::new(Database::new(db_path.to_string_lossy().to_string()));
    db.connect().await.expect("db connect");
    db.execute(
        "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER)",
        vec![],
    )
    .await
    .expect("create settings");

    let api_keys = ApiKeyManager::new(db, dir.path().join("app-data"));

    // Setup registry without any providers that have keys
    let registry = ProviderRegistry::new(vec![]);

    // Setup models config with image generation models but no providers
    let mut models = HashMap::new();
    models.insert(
        "gemini-3-pro-image".to_string(),
        ModelConfig {
            name: "Gemini 3 Pro Image".to_string(),
            image_input: true,
            image_output: true,
            audio_input: false,
            video_input: false,
            interleaved: false,
            providers: vec!["google".to_string()],
            provider_mappings: None,
            pricing: None,
            context_length: Some(65536),
        },
    );

    let models_config = ModelsConfiguration {
        version: "1".to_string(),
        models,
    };

    let api_map = api_keys.load_api_keys().await.expect("load api keys");
    let custom_providers = CustomProvidersConfiguration {
        version: "1".to_string(),
        providers: HashMap::new(),
    };

    let result = ImageGenerationService::resolve_image_generator_model(
        &api_keys,
        &registry,
        &custom_providers,
        &models_config,
        &api_map,
    )
    .await;

    assert!(result.is_err());
    let error = result.unwrap_err();
    assert!(error.contains("No available image generation model"));
}

#[tokio::test]
async fn resolve_image_generator_model_finds_volcengine_model() {
    let dir = TempDir::new().expect("temp dir");
    let db_path = dir.path().join("image-gen-test.db");
    let db = Arc::new(Database::new(db_path.to_string_lossy().to_string()));
    db.connect().await.expect("db connect");
    db.execute(
        "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER)",
        vec![],
    )
    .await
    .expect("create settings");

    let api_keys = ApiKeyManager::new(db, dir.path().join("app-data"));

    // Setup provider registry with volcengine
    let providers = vec![ProviderConfig {
        id: "volcengine".to_string(),
        name: "Volcengine".to_string(),
        protocol: ProtocolType::OpenAiCompatible,
        base_url: "https://ark.cn-beijing.volces.com/api/v3".to_string(),
        api_key_name: "VOLCENGINE_API_KEY".to_string(),
        supports_oauth: false,
        supports_coding_plan: false,
        supports_international: false,
        coding_plan_base_url: None,
        international_base_url: None,
        headers: None,
        extra_body: None,
        auth_type: AuthType::Bearer,
    }];
    let registry = ProviderRegistry::new(providers);

    // Setup models config with volcengine model
    let mut models = HashMap::new();
    models.insert(
        "doubao-seedream-4-5-251128".to_string(),
        ModelConfig {
            name: "Image Doubao Seedream".to_string(),
            image_input: false,
            image_output: true,
            audio_input: false,
            video_input: false,
            interleaved: false,
            providers: vec!["volcengine".to_string()],
            provider_mappings: None,
            pricing: None,
            context_length: None,
        },
    );

    let models_config = ModelsConfiguration {
        version: "1".to_string(),
        models,
    };

    // Set up API key for volcengine
    api_keys
        .set_setting("api_key_volcengine", "test-volcengine-key")
        .await
        .expect("set api key");

    let api_map = api_keys.load_api_keys().await.expect("load api keys");
    let custom_providers = CustomProvidersConfiguration {
        version: "1".to_string(),
        providers: HashMap::new(),
    };

    let result = ImageGenerationService::resolve_image_generator_model(
        &api_keys,
        &registry,
        &custom_providers,
        &models_config,
        &api_map,
    )
    .await;

    assert!(result.is_ok());
    let model_id = result.unwrap();
    // The service returns the first available image_output model
    // Since we only have volcengine configured with an image model, it should be returned
    assert!(!model_id.is_empty());
}

#[tokio::test]
async fn resolve_image_generator_model_finds_alibaba_model() {
    let dir = TempDir::new().expect("temp dir");
    let db_path = dir.path().join("image-gen-test.db");
    let db = Arc::new(Database::new(db_path.to_string_lossy().to_string()));
    db.connect().await.expect("db connect");
    db.execute(
        "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER)",
        vec![],
    )
    .await
    .expect("create settings");

    let api_keys = ApiKeyManager::new(db, dir.path().join("app-data"));

    // Setup provider registry with alibaba
    let providers = vec![ProviderConfig {
        id: "alibaba".to_string(),
        name: "Alibaba".to_string(),
        protocol: ProtocolType::OpenAiCompatible,
        base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1".to_string(),
        api_key_name: "DASHSCOPE_API_KEY".to_string(),
        supports_oauth: false,
        supports_coding_plan: false,
        supports_international: false,
        coding_plan_base_url: None,
        international_base_url: None,
        headers: None,
        extra_body: None,
        auth_type: AuthType::Bearer,
    }];
    let registry = ProviderRegistry::new(providers);

    // Setup models config with alibaba model
    let mut models = HashMap::new();
    models.insert(
        "qwen-image-max".to_string(),
        ModelConfig {
            name: "Qwen Image Max".to_string(),
            image_input: false,
            image_output: true,
            audio_input: false,
            video_input: false,
            interleaved: false,
            providers: vec!["alibaba".to_string()],
            provider_mappings: None,
            pricing: None,
            context_length: None,
        },
    );

    let models_config = ModelsConfiguration {
        version: "1".to_string(),
        models,
    };

    // Set up API key for alibaba
    api_keys
        .set_setting("api_key_alibaba", "test-alibaba-key")
        .await
        .expect("set api key");

    let api_map = api_keys.load_api_keys().await.expect("load api keys");
    let custom_providers = CustomProvidersConfiguration {
        version: "1".to_string(),
        providers: HashMap::new(),
    };

    let result = ImageGenerationService::resolve_image_generator_model(
        &api_keys,
        &registry,
        &custom_providers,
        &models_config,
        &api_map,
    )
    .await;

    assert!(result.is_ok());
    let model_id = result.unwrap();
    // The service returns the first available image_output model
    // Since we only have dashscope configured with an image model, it should be returned
    assert!(!model_id.is_empty());
}

#[tokio::test]
async fn resolve_image_generator_model_finds_zhipu_image_model() {
    let dir = TempDir::new().expect("temp dir");
    let db_path = dir.path().join("image-gen-test.db");
    let db = Arc::new(Database::new(db_path.to_string_lossy().to_string()));
    db.connect().await.expect("db connect");
    db.execute(
        "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER)",
        vec![],
    )
    .await
    .expect("create settings");

    let api_keys = ApiKeyManager::new(db, dir.path().join("app-data"));

    // Setup provider registry with zhipu
    let providers = vec![ProviderConfig {
        id: "zhipu".to_string(),
        name: "Zhipu AI".to_string(),
        protocol: ProtocolType::OpenAiCompatible,
        base_url: "https://open.bigmodel.cn/api/paas/v4".to_string(),
        api_key_name: "ZHIPU_API_KEY".to_string(),
        supports_oauth: false,
        supports_coding_plan: false,
        supports_international: false,
        coding_plan_base_url: None,
        international_base_url: None,
        headers: None,
        extra_body: None,
        auth_type: AuthType::Bearer,
    }];
    let registry = ProviderRegistry::new(providers);

    // Setup models config with zhipu image model
    let mut models = HashMap::new();
    models.insert(
        "glm-image".to_string(),
        ModelConfig {
            name: "Image GLM".to_string(),
            image_input: false,
            image_output: true,
            audio_input: false,
            video_input: false,
            interleaved: false,
            providers: vec!["zhipu".to_string()],
            provider_mappings: None,
            pricing: None,
            context_length: None,
        },
    );

    let models_config = ModelsConfiguration {
        version: "1".to_string(),
        models,
    };

    // Set up API key for zhipu
    api_keys
        .set_setting("api_key_zhipu", "test-zhipu-key")
        .await
        .expect("set api key");

    let api_map = api_keys.load_api_keys().await.expect("load api keys");
    let custom_providers = CustomProvidersConfiguration {
        version: "1".to_string(),
        providers: HashMap::new(),
    };

    let result = ImageGenerationService::resolve_image_generator_model(
        &api_keys,
        &registry,
        &custom_providers,
        &models_config,
        &api_map,
    )
    .await;

    assert!(result.is_ok());
    let model_id = result.unwrap();
    // The service returns the first available image_output model
    // Since we only have zhipu configured with an image model, it should be returned
    assert!(!model_id.is_empty());
}
