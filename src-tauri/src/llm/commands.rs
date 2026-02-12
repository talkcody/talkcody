use crate::llm::ai_services::completion_service::CompletionService;
use crate::llm::ai_services::context_compaction_service::ContextCompactionService;
use crate::llm::ai_services::git_message_service::GitMessageService;
use crate::llm::ai_services::pricing_service::PricingService;
use crate::llm::ai_services::prompt_enhancement_service::PromptEnhancementService;
use crate::llm::ai_services::task_title_service::TaskTitleService;
use crate::llm::ai_services::types::{
    CalculateCostRequest, CalculateCostResult, CompletionContext, CompletionResult,
    ContextCompactionRequest, ContextCompactionResult, GitMessageContext, GitMessageResult,
    PromptEnhancementRequest, PromptEnhancementResult, TitleGenerationRequest,
    TitleGenerationResult,
};
use crate::llm::auth::api_key_manager::LlmState;
use crate::llm::models::model_registry::ModelRegistry;
use crate::llm::models::model_sync;
use crate::llm::streaming::stream_handler::StreamHandler;
use crate::llm::transcription::service::TranscriptionService;
use crate::llm::transcription::types::TranscriptionContext;
use crate::llm::types::{
    AvailableModel, CustomProviderConfig, ModelsConfiguration, StreamResponse, StreamTextRequest,
    TranscriptionRequest, TranscriptionResponse,
};
use tauri::{Manager, State, Window};

#[tauri::command]
pub async fn llm_get_provider_configs(
    state: State<'_, LlmState>,
) -> Result<Vec<crate::llm::types::ProviderConfig>, String> {
    let registry = state.registry.lock().await;
    Ok(registry.providers())
}

#[tauri::command]
pub async fn llm_get_models_config(
    state: State<'_, LlmState>,
) -> Result<ModelsConfiguration, String> {
    let api_keys = state.api_keys.lock().await;
    api_keys.load_models_config().await
}

#[tauri::command]
pub async fn llm_stream_text(
    window: Window,
    request: StreamTextRequest,
    state: State<'_, LlmState>,
) -> Result<StreamResponse, String> {
    // log::info!(
    //     "[llm_stream_text] Received request with trace_context: {:?}",
    //     request.trace_context
    // );

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

    let request_id_clone = request_id.clone();
    // Spawn the streaming process in a background task so the command returns immediately
    tauri::async_runtime::spawn(async move {
        if let Err(e) = handler
            .stream_completion(window, request, request_id_clone)
            .await
        {
            log::error!("[llm_stream_text] Stream error: {}", e);
        }
    });

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
pub async fn llm_check_model_updates(
    app: tauri::AppHandle,
    state: State<'_, LlmState>,
) -> Result<bool, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let api_keys = state.api_keys.lock().await;
    model_sync::check_for_updates(&app, &api_keys, &app_data_dir).await
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

#[tauri::command]
pub async fn llm_transcribe_audio(
    request: TranscriptionRequest,
    state: State<'_, LlmState>,
) -> Result<TranscriptionResponse, String> {
    let (registry, api_keys, models) = {
        let registry = state.registry.lock().await;
        let api_keys = state.api_keys.lock().await;
        let models = api_keys.load_models_config().await?;
        (registry.clone(), api_keys.clone(), models)
    };

    let custom_providers = api_keys.load_custom_providers().await?;

    // Convert request to context
    let context = TranscriptionContext {
        audio_base64: request.audio_base64,
        mime_type: request.mime_type,
        language: request.language,
        prompt: request.prompt,
        temperature: request.temperature,
        response_format: request.response_format,
    };

    // Use unified transcription service
    let result = TranscriptionService::transcribe(
        &api_keys,
        &registry,
        &custom_providers,
        &models,
        &request.model,
        context,
    )
    .await?;

    Ok(TranscriptionResponse {
        text: result.text,
        language: result.language,
        duration: result.duration_in_seconds,
    })
}

// AI Services Commands

/// Calculate token cost for a model
#[tauri::command]
pub fn llm_calculate_cost(request: CalculateCostRequest) -> Result<CalculateCostResult, String> {
    let service = PricingService::new();
    service.calculate_cost_request(request)
}

/// Get AI code completion
#[tauri::command]
pub async fn llm_get_completion(
    context: CompletionContext,
    state: State<'_, LlmState>,
) -> Result<CompletionResult, String> {
    let (registry, api_keys) = {
        let registry = state.registry.lock().await;
        let api_keys = state.api_keys.lock().await;
        (registry.clone(), api_keys.clone())
    };

    let service = CompletionService::new();
    service.get_completion(context, &api_keys, &registry).await
}

/// Generate git commit message
#[tauri::command]
pub async fn llm_generate_commit_message(
    context: GitMessageContext,
    state: State<'_, LlmState>,
) -> Result<GitMessageResult, String> {
    let (registry, api_keys) = {
        let registry = state.registry.lock().await;
        let api_keys = state.api_keys.lock().await;
        (registry.clone(), api_keys.clone())
    };

    let service = GitMessageService::new();
    service
        .generate_commit_message(context, &api_keys, &registry)
        .await
}

/// Generate task title
#[tauri::command]
pub async fn llm_generate_title(
    request: TitleGenerationRequest,
    state: State<'_, LlmState>,
) -> Result<TitleGenerationResult, String> {
    let (registry, api_keys) = {
        let registry = state.registry.lock().await;
        let api_keys = state.api_keys.lock().await;
        (registry.clone(), api_keys.clone())
    };

    let service = TaskTitleService::new();
    service.generate_title(request, &api_keys, &registry).await
}

/// Compact conversation context
#[tauri::command]
pub async fn llm_compact_context(
    request: ContextCompactionRequest,
    state: State<'_, LlmState>,
) -> Result<ContextCompactionResult, String> {
    let (registry, api_keys) = {
        let registry = state.registry.lock().await;
        let api_keys = state.api_keys.lock().await;
        (registry.clone(), api_keys.clone())
    };

    let service = ContextCompactionService::new();
    service.compact_context(request, &api_keys, &registry).await
}

/// Enhance user prompt with context
#[tauri::command]
pub async fn llm_enhance_prompt(
    request: PromptEnhancementRequest,
    state: State<'_, LlmState>,
) -> Result<PromptEnhancementResult, String> {
    let (registry, api_keys) = {
        let registry = state.registry.lock().await;
        let api_keys = state.api_keys.lock().await;
        (registry.clone(), api_keys.clone())
    };

    let service = PromptEnhancementService::new();
    service.enhance_prompt(request, &api_keys, &registry).await
}
