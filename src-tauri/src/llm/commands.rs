use crate::llm::auth::api_key_manager::LlmState;
use crate::llm::models::model_registry::ModelRegistry;
use crate::llm::streaming::stream_handler::StreamHandler;
use crate::llm::types::{AvailableModel, CustomProviderConfig, StreamResponse, StreamTextRequest};
use tauri::{State, Window};

#[tauri::command]
pub async fn llm_stream_text(
    window: Window,
    request: StreamTextRequest,
    state: State<'_, LlmState>,
) -> Result<StreamResponse, String> {
    log::info!(
        "[llm_stream_text] Received request with trace_context: {:?}",
        request.trace_context
    );

    // Clone data within lock scope to minimize lock duration
    let (registry, api_keys) = {
        let registry = state.registry.lock().await;
        let api_keys = state.api_keys.lock().await;
        (registry.clone(), api_keys.clone())
    }; // Locks released here before long-running stream operation

    let handler = StreamHandler::new(registry, api_keys);
    let request_id = request
        .request_id
        .clone()
        .unwrap_or_else(|| "0".to_string());
    let request_id = handler
        .stream_completion(window, request, request_id)
        .await?;
    Ok(StreamResponse { request_id })
}

#[tauri::command]
pub async fn llm_list_available_models(
    state: State<'_, LlmState>,
) -> Result<Vec<AvailableModel>, String> {
    let registry = state.registry.lock().await;
    let api_keys = state.api_keys.lock().await;
    ModelRegistry::compute_available_models(&api_keys, &registry).await
}

#[tauri::command]
pub async fn llm_register_custom_provider(
    config: CustomProviderConfig,
    state: State<'_, LlmState>,
) -> Result<(), String> {
    let mut registry = state.registry.lock().await;
    let api_keys = state.api_keys.lock().await;
    let mut current = api_keys.load_custom_providers().await?;
    let provider_id = config.id.clone();
    let provider_name = config.name.clone();
    let provider_type = config.provider_type.clone();
    let base_url = config.base_url.clone();
    current.providers.insert(provider_id.clone(), config);
    api_keys.save_custom_providers(&current).await?;
    registry.register_provider(crate::llm::types::ProviderConfig {
        id: provider_id.clone(),
        name: provider_name,
        protocol: match provider_type {
            crate::llm::types::CustomProviderType::Anthropic => {
                crate::llm::types::ProtocolType::Claude
            }
            crate::llm::types::CustomProviderType::OpenAiCompatible => {
                crate::llm::types::ProtocolType::OpenAiCompatible
            }
        },
        base_url,
        api_key_name: format!("custom_{}", provider_id),
        supports_oauth: false,
        supports_coding_plan: false,
        supports_international: false,
        coding_plan_base_url: None,
        international_base_url: None,
        headers: None,
        extra_body: None,
        auth_type: crate::llm::types::AuthType::Bearer,
    });
    Ok(())
}

#[tauri::command]
pub async fn llm_get_provider_configs(
    state: State<'_, LlmState>,
) -> Result<Vec<crate::llm::types::ProviderConfig>, String> {
    let registry = state.registry.lock().await;
    Ok(registry.providers())
}

#[tauri::command]
pub async fn llm_is_model_available(
    model_identifier: String,
    state: State<'_, LlmState>,
) -> Result<bool, String> {
    let registry = state.registry.lock().await;
    let api_keys = state.api_keys.lock().await;
    let api_map = api_keys.load_api_keys().await?;
    let custom_providers = api_keys.load_custom_providers().await?;
    let models =
        crate::llm::models::model_registry::ModelRegistry::load_models_config(&api_keys).await?;
    let (model_key, provider_id) =
        crate::llm::models::model_registry::ModelRegistry::get_model_provider(
            &model_identifier,
            &api_map,
            &registry,
            &custom_providers,
            &models,
        )?;
    Ok(!model_key.is_empty() && !provider_id.is_empty())
}
