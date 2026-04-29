use crate::llm::auth::api_key_manager::ApiKeyManager;
use crate::llm::providers::provider_registry::ProviderRegistry;
use crate::llm::types::{AvailableModel, CustomProvidersConfiguration, ModelsConfiguration};
use std::collections::HashMap;
#[cfg(test)]
use std::sync::Arc;

pub struct ModelRegistry;

impl ModelRegistry {
    pub async fn load_models_config(
        api_keys: &ApiKeyManager,
    ) -> Result<ModelsConfiguration, String> {
        // Use the cached version from ApiKeyManager if available
        // This avoids redundant parsing and uses the 5-minute cache
        api_keys.load_models_config().await
    }

    /// Load models configuration from raw JSON string using spawn_blocking
    /// to avoid blocking the async runtime during JSON parsing
    #[allow(dead_code)]
    #[cfg(test)]
    async fn parse_models_config(raw: String) -> Result<ModelsConfiguration, String> {
        let raw = Arc::new(raw);
        let result = tokio::task::spawn_blocking(move || {
            serde_json::from_str::<ModelsConfiguration>(&raw)
                .map_err(|e| format!("Failed to parse models config: {}", e))
        })
        .await
        .map_err(|e| format!("Failed to spawn blocking task: {}", e))?;
        result
    }

    /// Load default models configuration using spawn_blocking for JSON parsing
    #[allow(dead_code)]
    #[cfg(test)]
    async fn load_default_models_config() -> Result<ModelsConfiguration, String> {
        let default_config =
            include_str!("../../../../../packages/shared/src/data/models-config.json").to_string();
        Self::parse_models_config(default_config).await
    }

    pub async fn compute_available_models(
        api_keys: &ApiKeyManager,
        registry: &ProviderRegistry,
    ) -> Result<Vec<AvailableModel>, String> {
        let models = Self::load_models_config(api_keys).await?;
        log::info!(
            "[ModelRegistry] Loaded {} models from config",
            models.models.len()
        );

        let custom_providers = api_keys.load_custom_providers().await?;
        log::info!(
            "[ModelRegistry] Loaded {} custom providers",
            custom_providers.providers.len()
        );

        let api_key_map = Self::load_provider_credentials(api_keys).await?;
        log::info!(
            "[ModelRegistry] Loaded {} provider credentials: {:?}",
            api_key_map.len(),
            api_key_map.keys()
        );

        let registered_providers: Vec<_> =
            registry.providers().iter().map(|p| p.id.clone()).collect();
        log::info!(
            "[ModelRegistry] Registered providers in registry: {:?}",
            registered_providers
        );

        let available = Self::compute_available_models_internal(
            &models,
            &api_key_map,
            registry,
            &custom_providers,
        );
        log::info!(
            "[ModelRegistry] Computed {} available models",
            available.len()
        );
        Ok(available)
    }

    pub async fn load_provider_credentials(
        api_keys: &ApiKeyManager,
    ) -> Result<HashMap<String, String>, String> {
        let mut api_key_map = api_keys.load_api_keys().await?;
        let oauth_tokens = api_keys.load_oauth_tokens().await?;
        log::info!(
            "[ModelRegistry] Loaded {} OAuth tokens: {:?}",
            oauth_tokens.len(),
            oauth_tokens.keys()
        );

        for (provider_id, token) in oauth_tokens {
            api_key_map.entry(provider_id).or_insert(token);
        }

        Ok(api_key_map)
    }

    fn compute_available_models_internal(
        config: &ModelsConfiguration,
        api_keys: &HashMap<String, String>,
        registry: &ProviderRegistry,
        custom_providers: &CustomProvidersConfiguration,
    ) -> Vec<AvailableModel> {
        let mut model_map: HashMap<String, AvailableModel> = HashMap::new();

        for (model_key, model_cfg) in &config.models {
            let providers = &model_cfg.providers;
            for provider_id in providers {
                if Self::provider_available(provider_id, api_keys, registry, custom_providers) {
                    if let Some(provider) = registry.provider(provider_id) {
                        let key = format!("{}-{}", model_key, provider_id);
                        model_map.entry(key).or_insert(AvailableModel {
                            key: model_key.clone(),
                            name: model_cfg.name.clone(),
                            provider: provider_id.clone(),
                            provider_name: provider.name.clone(),
                            image_input: model_cfg.image_input,
                            image_output: model_cfg.image_output,
                            audio_input: model_cfg.audio_input,
                            video_input: model_cfg.video_input,
                            input_pricing: model_cfg.pricing.as_ref().map(|p| p.input.clone()),
                        });
                    }
                }
            }
        }

        for (model_key, model_cfg) in &config.models {
            let providers = &model_cfg.providers;
            for provider_id in providers {
                if let Some(custom) = custom_providers.providers.get(provider_id) {
                    if custom.enabled && !custom.api_key.trim().is_empty() {
                        let key = format!("{}-{}", model_key, provider_id);
                        model_map.entry(key).or_insert(AvailableModel {
                            key: model_key.clone(),
                            name: model_cfg.name.clone(),
                            provider: provider_id.clone(),
                            provider_name: custom.name.clone(),
                            image_input: model_cfg.image_input,
                            image_output: model_cfg.image_output,
                            audio_input: model_cfg.audio_input,
                            video_input: model_cfg.video_input,
                            input_pricing: model_cfg.pricing.as_ref().map(|p| p.input.clone()),
                        });
                    }
                }
            }
        }

        let mut result: Vec<AvailableModel> = model_map.values().cloned().collect();
        result.sort_by(|a, b| a.name.cmp(&b.name));
        result
    }

    pub fn resolve_provider_model_name(
        model_key: &str,
        provider_id: &str,
        config: &ModelsConfiguration,
    ) -> String {
        if let Some(model_cfg) = config.models.get(model_key) {
            if let Some(mapping) = &model_cfg.provider_mappings {
                if let Some(mapped) = mapping.get(provider_id) {
                    return mapped.clone();
                }
            }
        }
        model_key.to_string()
    }

    pub fn get_model_provider(
        model_identifier: &str,
        api_keys: &HashMap<String, String>,
        registry: &ProviderRegistry,
        custom_providers: &CustomProvidersConfiguration,
        config: &ModelsConfiguration,
    ) -> Result<(String, String), String> {
        let parts: Vec<&str> = model_identifier.split('@').collect();
        if parts.len() == 2 {
            let model_key = parts[0];
            let provider_id = parts[1];

            let model_cfg = config
                .models
                .get(model_key)
                .ok_or_else(|| format!("Unknown model {}", model_key))?;

            if !model_cfg
                .providers
                .iter()
                .any(|provider| provider == provider_id)
            {
                return Err(format!(
                    "Provider {} is not configured for model {}",
                    provider_id, model_key
                ));
            }

            if !Self::provider_available(provider_id, api_keys, registry, custom_providers) {
                return Err(format!(
                    "Provider {} is not available for model {}",
                    provider_id, model_key
                ));
            }

            return Ok((model_key.to_string(), provider_id.to_string()));
        }

        if let Some(model_cfg) = config.models.get(model_identifier) {
            for provider_id in &model_cfg.providers {
                if Self::provider_available(provider_id, api_keys, registry, custom_providers) {
                    return Ok((model_identifier.to_string(), provider_id.clone()));
                }
            }

            return Err(format!(
                "No available provider for model {}",
                model_identifier
            ));
        }

        for provider_id in registry.providers().iter().map(|p| p.id.clone()) {
            if Self::provider_available(&provider_id, api_keys, registry, custom_providers) {
                return Ok((model_identifier.to_string(), provider_id));
            }
        }

        if let Some((provider_id, _)) = custom_providers.providers.iter().find(|(_, p)| p.enabled) {
            return Ok((model_identifier.to_string(), provider_id.to_string()));
        }

        Err(format!(
            "No available provider for model {}",
            model_identifier
        ))
    }

    fn provider_available(
        provider_id: &str,
        api_keys: &HashMap<String, String>,
        registry: &ProviderRegistry,
        custom_providers: &CustomProvidersConfiguration,
    ) -> bool {
        if let Some(custom) = custom_providers.providers.get(provider_id) {
            let has_key = !custom.api_key.trim().is_empty();
            log::debug!(
                "[ModelRegistry] Provider {} is custom, enabled={}, has_key={}",
                provider_id,
                custom.enabled,
                has_key
            );
            return custom.enabled && has_key;
        }

        if let Some(provider) = registry.provider(provider_id) {
            log::debug!(
                "[ModelRegistry] Checking provider {}: auth_type={:?}, supports_oauth={}",
                provider_id,
                provider.auth_type,
                provider.supports_oauth
            );

            if provider.auth_type == crate::llm::types::AuthType::None {
                if provider_id == "ollama" || provider_id == "lmstudio" {
                    let enabled = api_keys
                        .get(provider_id)
                        .map(|v| v == "enabled")
                        .unwrap_or(false);
                    log::debug!(
                        "[ModelRegistry] Provider {} is None auth type, enabled={}",
                        provider_id,
                        enabled
                    );
                    return enabled;
                }
                log::debug!(
                    "[ModelRegistry] Provider {} is None auth type, always available",
                    provider_id
                );
                return true;
            }
            if provider.auth_type == crate::llm::types::AuthType::TalkCodyJwt {
                log::debug!(
                    "[ModelRegistry] Provider {} is TalkCody JWT, available without credentials",
                    provider_id
                );
                return true;
            }
            if let Some(value) = api_keys.get(provider_id) {
                if !value.trim().is_empty() {
                    log::debug!("[ModelRegistry] Provider {} has credentials", provider_id);
                    return true;
                }
            }
            if provider.supports_oauth {
                if let Some(token) = api_keys.get(provider_id) {
                    if !token.trim().is_empty() {
                        log::debug!("[ModelRegistry] Provider {} has OAuth token", provider_id);
                        return true;
                    }
                }
            }
            log::debug!(
                "[ModelRegistry] Provider {} not available - no credentials",
                provider_id
            );
        } else {
            log::debug!(
                "[ModelRegistry] Provider {} not found in registry",
                provider_id
            );
        }

        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::Database;
    use crate::llm::providers::provider_registry::ProviderRegistry;
    use crate::llm::types::{CustomProviderConfig, CustomProviderType, ModelConfig, ModelPricing};
    use crate::llm::types::{ProtocolType, ProviderConfig};
    use std::collections::HashMap;
    use tempfile::TempDir;

    struct TestContext {
        _dir: TempDir,
        app_data_dir: std::path::PathBuf,
        api_keys: ApiKeyManager,
    }

    async fn setup_api_keys() -> TestContext {
        let dir = TempDir::new().expect("temp dir");
        let db_path = dir.path().join("models-test.db");
        let db = std::sync::Arc::new(Database::new(db_path.to_string_lossy().to_string()));
        db.connect().await.expect("db connect");
        db.execute(
            "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER)",
            vec![],
        )
        .await
        .expect("create settings");
        let app_data_dir = dir.path().join("app-data");
        TestContext {
            _dir: dir,
            app_data_dir: app_data_dir.clone(),
            api_keys: ApiKeyManager::new(db, app_data_dir),
        }
    }

    fn provider_config(id: &str, auth_type: crate::llm::types::AuthType) -> ProviderConfig {
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
            auth_type,
        }
    }

    fn build_models_config() -> ModelsConfiguration {
        let mut models = HashMap::new();
        models.insert(
            "gpt-4o".to_string(),
            ModelConfig {
                name: "GPT-4o".to_string(),
                image_input: false,
                image_output: false,
                audio_input: false,
                video_input: false,
                interleaved: false,
                providers: vec![
                    "openai".to_string(),
                    "ollama".to_string(),
                    "custom".to_string(),
                ],
                provider_mappings: Some(HashMap::from([(
                    "ollama".to_string(),
                    "llama3".to_string(),
                )])),
                pricing: Some(ModelPricing {
                    input: "1".to_string(),
                    output: "2".to_string(),
                    cached_input: None,
                    cache_creation: None,
                }),
                context_length: None,
            },
        );
        ModelsConfiguration {
            version: "1".to_string(),
            models,
        }
    }

    #[tokio::test]
    async fn load_models_config_prefers_db_override() {
        let ctx = setup_api_keys().await;
        let config = build_models_config();
        let raw = serde_json::to_string(&config).expect("serialize config");
        ctx.api_keys
            .set_setting("models_config_json", &raw)
            .await
            .expect("set config");

        let loaded = ModelRegistry::load_models_config(&ctx.api_keys)
            .await
            .expect("load config");
        assert_eq!(loaded.version, "1");
        assert!(loaded.models.contains_key("gpt-4o"));
    }

    #[tokio::test]
    async fn load_models_config_merges_custom_models() {
        let ctx = setup_api_keys().await;

        let mut base = build_models_config();
        base.models.remove("gpt-4o");
        let raw = serde_json::to_string(&base).expect("serialize config");
        ctx.api_keys
            .set_setting("models_config_json", &raw)
            .await
            .expect("set config");

        let custom_model = ModelConfig {
            name: "Custom Model".to_string(),
            image_input: false,
            image_output: false,
            audio_input: false,
            video_input: false,
            interleaved: false,
            providers: vec!["custom".to_string()],
            provider_mappings: None,
            pricing: Some(ModelPricing {
                input: "1".to_string(),
                output: "2".to_string(),
                cached_input: None,
                cache_creation: None,
            }),
            context_length: None,
        };
        let custom_config = ModelsConfiguration {
            version: "custom".to_string(),
            models: HashMap::from([("custom-model".to_string(), custom_model)]),
        };
        let custom_path = ctx.app_data_dir.join("custom-models.json");
        std::fs::create_dir_all(custom_path.parent().unwrap()).expect("create app dir");
        std::fs::write(
            &custom_path,
            serde_json::to_string_pretty(&custom_config).expect("serialize custom config"),
        )
        .expect("write custom config");

        let loaded = ModelRegistry::load_models_config(&ctx.api_keys)
            .await
            .expect("load config");
        assert!(loaded.models.contains_key("custom-model"));
        assert!(!loaded.models.contains_key("gpt-4o"));
    }

    #[test]
    fn resolve_provider_model_name_uses_mapping() {
        let config = build_models_config();
        let name = ModelRegistry::resolve_provider_model_name("gpt-4o", "ollama", &config);
        assert_eq!(name, "llama3");
    }

    #[test]
    fn resolve_provider_model_name_falls_back_to_key() {
        let config = build_models_config();
        let name = ModelRegistry::resolve_provider_model_name("gpt-4o", "openai", &config);
        assert_eq!(name, "gpt-4o");
    }

    #[test]
    fn get_model_provider_accepts_explicit_provider() {
        let registry = ProviderRegistry::new(vec![provider_config(
            "openai",
            crate::llm::types::AuthType::Bearer,
        )]);
        let api_keys = HashMap::from([("openai".to_string(), "key".to_string())]);
        let custom_providers = CustomProvidersConfiguration {
            version: "1".to_string(),
            providers: HashMap::new(),
        };

        let config = build_models_config();
        let (model, provider) = ModelRegistry::get_model_provider(
            "gpt-4o@openai",
            &api_keys,
            &registry,
            &custom_providers,
            &config,
        )
        .expect("resolve provider");
        assert_eq!(model, "gpt-4o");
        assert_eq!(provider, "openai");
    }

    #[test]
    fn compute_available_models_includes_enabled_custom_provider() {
        let config = build_models_config();
        let registry = ProviderRegistry::new(vec![provider_config(
            "openai",
            crate::llm::types::AuthType::Bearer,
        )]);
        let api_keys = HashMap::from([("openai".to_string(), "key".to_string())]);
        let custom_provider = CustomProviderConfig {
            id: "custom".to_string(),
            name: "Custom".to_string(),
            provider_type: CustomProviderType::OpenAiCompatible,
            base_url: "https://custom".to_string(),
            api_key: "custom-key".to_string(),
            enabled: true,
            description: None,
        };
        let custom_providers = CustomProvidersConfiguration {
            version: "1".to_string(),
            providers: HashMap::from([(custom_provider.id.clone(), custom_provider)]),
        };

        let available = ModelRegistry::compute_available_models_internal(
            &config,
            &api_keys,
            &registry,
            &custom_providers,
        );
        assert!(available.iter().any(|model| model.provider == "openai"));
        assert!(available.iter().any(|model| model.provider == "custom"));
    }

    #[test]
    fn compute_available_models_excludes_custom_provider_without_key() {
        let config = build_models_config();
        let registry = ProviderRegistry::new(vec![provider_config(
            "openai",
            crate::llm::types::AuthType::Bearer,
        )]);
        let api_keys = HashMap::from([("openai".to_string(), "key".to_string())]);
        let custom_provider = CustomProviderConfig {
            id: "custom".to_string(),
            name: "Custom".to_string(),
            provider_type: CustomProviderType::OpenAiCompatible,
            base_url: "https://custom".to_string(),
            api_key: "".to_string(),
            enabled: true,
            description: None,
        };
        let custom_providers = CustomProvidersConfiguration {
            version: "1".to_string(),
            providers: HashMap::from([(custom_provider.id.clone(), custom_provider)]),
        };

        let available = ModelRegistry::compute_available_models_internal(
            &config,
            &api_keys,
            &registry,
            &custom_providers,
        );
        assert!(available.iter().all(|model| model.provider != "custom"));
    }

    #[test]
    fn compute_available_models_includes_talkcody_without_token() {
        let mut config = build_models_config();
        if let Some(model_cfg) = config.models.get_mut("gpt-4o") {
            model_cfg.providers.push("talkcody".to_string());
        }
        let registry = ProviderRegistry::new(vec![
            provider_config("openai", crate::llm::types::AuthType::Bearer),
            provider_config("talkcody", crate::llm::types::AuthType::TalkCodyJwt),
        ]);
        let api_keys = HashMap::new();
        let custom_providers = CustomProvidersConfiguration {
            version: "1".to_string(),
            providers: HashMap::new(),
        };

        let available = ModelRegistry::compute_available_models_internal(
            &config,
            &api_keys,
            &registry,
            &custom_providers,
        );
        assert!(available.iter().any(|model| model.provider == "talkcody"));
    }

    #[test]
    fn provider_available_requires_enable_flag_for_ollama() {
        let config = build_models_config();
        let registry = ProviderRegistry::new(vec![provider_config(
            "ollama",
            crate::llm::types::AuthType::None,
        )]);
        let api_keys = HashMap::new();
        let custom_providers = CustomProvidersConfiguration {
            version: "1".to_string(),
            providers: HashMap::new(),
        };

        let available = ModelRegistry::compute_available_models_internal(
            &config,
            &api_keys,
            &registry,
            &custom_providers,
        );
        assert!(available.is_empty());

        let api_keys = HashMap::from([("ollama".to_string(), "enabled".to_string())]);
        let available = ModelRegistry::compute_available_models_internal(
            &config,
            &api_keys,
            &registry,
            &custom_providers,
        );
        assert!(!available.is_empty());
    }

    #[test]
    fn get_model_provider_prefers_model_config_providers_over_registry_order() {
        let mut config = build_models_config();
        if let Some(model_cfg) = config.models.get_mut("gpt-4o") {
            model_cfg.providers = vec!["openai".to_string()];
        }

        let registry = ProviderRegistry::new(vec![
            provider_config("deepseek", crate::llm::types::AuthType::Bearer),
            provider_config("openai", crate::llm::types::AuthType::Bearer),
        ]);
        let api_keys = HashMap::from([
            ("deepseek".to_string(), "key".to_string()),
            ("openai".to_string(), "key".to_string()),
        ]);
        let custom_providers = CustomProvidersConfiguration {
            version: "1".to_string(),
            providers: HashMap::new(),
        };

        let (model, provider) = ModelRegistry::get_model_provider(
            "gpt-4o",
            &api_keys,
            &registry,
            &custom_providers,
            &config,
        )
        .expect("resolve provider");

        assert_eq!(model, "gpt-4o");
        assert_eq!(provider, "openai");
    }
}
