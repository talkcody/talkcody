use crate::database::Database;
use crate::llm::auth::api_key_manager::ApiKeyManager;
use crate::llm::providers::provider::{
    Provider, ProviderContext, ProviderRoute, ProviderTransport,
};
use crate::llm::providers::provider_configs::builtin_providers;
use crate::llm::providers::DefaultProvider;
use crate::llm::types::{Message, MessageContent, StreamTextRequest};
use std::sync::Arc;
use tempfile::TempDir;

fn build_test_context(
    provider_id: &str,
    model: &str,
    top_k: Option<i32>,
) -> (DefaultProvider, ApiKeyManager, StreamTextRequest) {
    let provider_config = builtin_providers()
        .into_iter()
        .find(|entry| entry.id.eq_ignore_ascii_case(provider_id))
        .unwrap_or_else(|| panic!("provider not found: {}", provider_id));

    let provider = DefaultProvider::new(provider_config);

    let dir = TempDir::new().expect("temp dir");
    let db_path = dir.path().join("talkcody-test.db");
    let db = Arc::new(Database::new(db_path.to_string_lossy().to_string()));
    let api_keys = ApiKeyManager::new(db, std::path::PathBuf::from("/tmp"));

    let request = StreamTextRequest {
        model: model.to_string(),
        fallback_models: None,
        messages: vec![Message::User {
            content: MessageContent::Text("hi".to_string()),
            provider_options: None,
        }],
        tools: None,
        stream: Some(true),
        temperature: None,
        max_tokens: None,
        top_p: None,
        top_k,
        provider_options: None,
        request_id: None,
        conversation_mode: None,
        input_mode: None,
        previous_response_id: None,
        transport_session_id: None,
        allow_transport_fallback: None,
        continuation_context: None,
        trace_context: None,
    };

    (provider, api_keys, request)
}

#[tokio::test]
async fn google_provider_strips_top_k() {
    let (provider, api_keys, request) =
        build_test_context("google", "google/gemini-2.5-flash-lite", Some(64));

    let ctx = ProviderContext {
        provider_config: provider.config(),
        api_key_manager: &api_keys,
        model: &request.model,
        messages: &request.messages,
        tools: request.tools.as_deref(),
        temperature: request.temperature,
        max_tokens: request.max_tokens,
        top_p: request.top_p,
        top_k: request.top_k,
        provider_options: request.provider_options.as_ref(),
        trace_context: request.trace_context.as_ref(),
        conversation_mode: request.conversation_mode,
        input_mode: request.input_mode,
        previous_response_id: request.previous_response_id.as_deref(),
        transport_session_id: request.transport_session_id.as_deref(),
        allow_transport_fallback: request.allow_transport_fallback,
        continuation_context: request.continuation_context.as_ref(),
    };

    let body = provider.build_request(&ctx).await.expect("build request");
    assert!(body.get("top_k").is_none());
}

#[tokio::test]
async fn non_google_provider_keeps_top_k() {
    let (provider, api_keys, request) = build_test_context("zhipu", "glm-4.7", Some(20));

    let ctx = ProviderContext {
        provider_config: provider.config(),
        api_key_manager: &api_keys,
        model: &request.model,
        messages: &request.messages,
        tools: request.tools.as_deref(),
        temperature: request.temperature,
        max_tokens: request.max_tokens,
        top_p: request.top_p,
        top_k: request.top_k,
        provider_options: request.provider_options.as_ref(),
        trace_context: request.trace_context.as_ref(),
        conversation_mode: request.conversation_mode,
        input_mode: request.input_mode,
        previous_response_id: request.previous_response_id.as_deref(),
        transport_session_id: request.transport_session_id.as_deref(),
        allow_transport_fallback: request.allow_transport_fallback,
        continuation_context: request.continuation_context.as_ref(),
    };

    let body = provider.build_request(&ctx).await.expect("build request");
    assert_eq!(body.get("top_k").and_then(|value| value.as_i64()), Some(20));
}

#[tokio::test]
async fn non_openai_provider_transport_remains_http_sse() {
    let (provider, api_keys, request) = build_test_context("zhipu", "glm-4.7", None);

    let ctx = ProviderContext {
        provider_config: provider.config(),
        api_key_manager: &api_keys,
        model: &request.model,
        messages: &request.messages,
        tools: request.tools.as_deref(),
        temperature: request.temperature,
        max_tokens: request.max_tokens,
        top_p: request.top_p,
        top_k: request.top_k,
        provider_options: request.provider_options.as_ref(),
        trace_context: request.trace_context.as_ref(),
        conversation_mode: request.conversation_mode,
        input_mode: request.input_mode,
        previous_response_id: request.previous_response_id.as_deref(),
        transport_session_id: Some("session-123"),
        allow_transport_fallback: Some(true),
        continuation_context: request.continuation_context.as_ref(),
    };

    assert_eq!(
        provider.transport_for_request(&ctx).await,
        ProviderTransport::HttpSse
    );
    assert_eq!(
        provider.route_for_request(&ctx).await,
        ProviderRoute::Default
    );
}
