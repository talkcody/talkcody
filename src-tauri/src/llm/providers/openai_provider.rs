// OpenAI Provider Implementation
// Handles both standard OpenAI API and OAuth (Codex) modes

use crate::llm::auth::api_key_manager::{ApiKeyManager, ProviderCredentials};
use crate::llm::protocols::header_builder::HeaderBuildContext;
use crate::llm::protocols::openai_protocol::OpenAiProtocol;
use crate::llm::protocols::openai_responses_protocol::OpenAiResponsesProtocol;
use crate::llm::protocols::request_builder::{ProtocolRequestBuilder, RequestBuildContext};
use crate::llm::protocols::stream_parser::{
    ProtocolStreamParser, StreamParseContext, StreamParseState,
};
use crate::llm::protocols::ProtocolHeaderBuilder;
use crate::llm::providers::provider::{
    BaseProvider, Provider, ProviderContext, ProviderCredentials as Creds,
};
use crate::llm::types::ProtocolType;
use crate::llm::types::{ProviderConfig, StreamEvent};
use async_trait::async_trait;
use serde_json::Value;
use std::collections::HashMap;

pub struct OpenAiProvider {
    base: BaseProvider,
    protocol: OpenAiProtocol,
    responses_protocol: OpenAiResponsesProtocol,
}

impl OpenAiProvider {
    pub fn new(config: ProviderConfig) -> Self {
        Self {
            base: BaseProvider::new(config),
            protocol: OpenAiProtocol,
            responses_protocol: OpenAiResponsesProtocol,
        }
    }

    async fn is_oauth_mode(&self, api_key_manager: &ApiKeyManager) -> bool {
        // Check if OAuth token is available
        api_key_manager
            .has_oauth_token("openai")
            .await
            .unwrap_or(false)
    }

    /// Build request for OAuth/Codex API format
    pub(crate) fn build_oauth_request(&self, ctx: &ProviderContext<'_>) -> Result<Value, String> {
        let request_ctx = RequestBuildContext {
            model: ctx.model,
            messages: ctx.messages,
            tools: ctx.tools,
            temperature: ctx.temperature,
            max_tokens: ctx.max_tokens,
            top_p: ctx.top_p,
            top_k: ctx.top_k,
            provider_options: ctx.provider_options,
            extra_body: ctx.provider_config.extra_body.as_ref(),
        };
        self.responses_protocol.build_request(request_ctx)
    }
}

#[async_trait]
impl Provider for OpenAiProvider {
    fn id(&self) -> &str {
        &self.base.config.id
    }

    fn name(&self) -> &str {
        &self.base.config.name
    }

    fn protocol_type(&self) -> ProtocolType {
        self.base.config.protocol
    }

    fn config(&self) -> &ProviderConfig {
        &self.base.config
    }

    async fn resolve_base_url(&self, ctx: &ProviderContext<'_>) -> Result<String, String> {
        // If using OAuth, use ChatGPT backend API
        if self.is_oauth_mode(ctx.api_key_manager).await {
            return Ok("https://chatgpt.com/backend-api".to_string());
        }

        // Otherwise use standard resolution
        self.base
            .resolve_base_url_with_fallback(ctx.api_key_manager)
            .await
    }

    async fn resolve_endpoint_path(&self, ctx: &ProviderContext<'_>) -> String {
        if self.is_oauth_mode(ctx.api_key_manager).await {
            "codex/responses".to_string()
        } else {
            "chat/completions".to_string()
        }
    }

    async fn get_credentials(&self, api_key_manager: &ApiKeyManager) -> Result<Creds, String> {
        if self.is_oauth_mode(api_key_manager).await {
            // Get OAuth token
            let creds = api_key_manager.get_credentials(&self.base.config).await?;
            match creds {
                ProviderCredentials::Token(token) => {
                    let account_id = api_key_manager
                        .get_setting("openai_oauth_account_id")
                        .await?
                        .or(None);
                    Ok(Creds::OAuth { token, account_id })
                }
                _ => Ok(Creds::None),
            }
        } else {
            // Standard API key
            let creds = api_key_manager.get_credentials(&self.base.config).await?;
            match creds {
                ProviderCredentials::Token(token) => Ok(Creds::ApiKey(token)),
                ProviderCredentials::None => Ok(Creds::None),
            }
        }
    }

    async fn add_provider_headers(
        &self,
        ctx: &ProviderContext<'_>,
        headers: &mut HashMap<String, String>,
    ) -> Result<(), String> {
        if self.is_oauth_mode(ctx.api_key_manager).await {
            headers.insert(
                "OpenAI-Beta".to_string(),
                "responses=experimental".to_string(),
            );
            headers.insert("originator".to_string(), "codex_cli_rs".to_string());

            // Add account header if available
            if let Some(account_id) = ctx
                .api_key_manager
                .get_setting("openai_oauth_account_id")
                .await?
            {
                if !account_id.is_empty() {
                    headers.insert("openai-organization".to_string(), account_id);
                }
            }
        }
        Ok(())
    }

    async fn build_request(&self, ctx: &ProviderContext<'_>) -> Result<Value, String> {
        if self.is_oauth_mode(ctx.api_key_manager).await {
            let request_ctx = RequestBuildContext {
                model: ctx.model,
                messages: ctx.messages,
                tools: ctx.tools,
                temperature: ctx.temperature,
                max_tokens: ctx.max_tokens,
                top_p: ctx.top_p,
                top_k: ctx.top_k,
                provider_options: ctx.provider_options,
                extra_body: ctx.provider_config.extra_body.as_ref(),
            };
            self.responses_protocol.build_request(request_ctx)
        } else {
            // Use standard protocol request building
            let request_ctx = RequestBuildContext {
                model: ctx.model,
                messages: ctx.messages,
                tools: ctx.tools,
                temperature: ctx.temperature,
                max_tokens: ctx.max_tokens,
                top_p: ctx.top_p,
                top_k: ctx.top_k,
                provider_options: ctx.provider_options,
                extra_body: ctx.provider_config.extra_body.as_ref(),
            };
            self.protocol.build_request(request_ctx)
        }
    }

    async fn parse_stream_event_with_context(
        &self,
        ctx: &ProviderContext<'_>,
        event_type: Option<&str>,
        data: &str,
        state: &mut StreamParseState,
    ) -> Result<Option<StreamEvent>, String> {
        if self.is_oauth_mode(ctx.api_key_manager).await {
            let parse_ctx = StreamParseContext { event_type, data };
            self.responses_protocol.parse_stream_event(parse_ctx, state)
        } else {
            self.parse_stream_event(event_type, data, state)
        }
    }

    fn build_protocol_headers(&self, ctx: HeaderBuildContext) -> HashMap<String, String> {
        self.protocol.build_base_headers(ctx)
    }

    fn build_protocol_request(&self, ctx: RequestBuildContext) -> Result<Value, String> {
        self.protocol.build_request(ctx)
    }

    fn parse_protocol_stream_event(
        &self,
        ctx: StreamParseContext,
        state: &mut StreamParseState,
    ) -> Result<Option<StreamEvent>, String> {
        self.protocol.parse_stream_event(ctx, state)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::Database;
    use crate::llm::auth::api_key_manager::ApiKeyManager;
    use crate::llm::protocols::openai_responses_protocol::{
        parse_openai_oauth_event_legacy, parse_openai_oauth_function_call_done,
        OpenAiResponsesProtocol,
    };
    use crate::llm::protocols::{ProtocolStreamState, ToolCallAccum};
    use crate::llm::types::{ContentPart, Message, MessageContent, StreamTextRequest};
    use serde_json::json;
    use std::sync::Arc;
    use tempfile::TempDir;

    #[tokio::test]
    async fn build_openai_oauth_request_maps_tool_results() {
        let dir = TempDir::new().expect("temp dir");
        let db_path = dir.path().join("talkcody-test.db");
        let db = Arc::new(Database::new(db_path.to_string_lossy().to_string()));
        db.connect().await.expect("db connect");
        let api_keys = ApiKeyManager::new(db, std::path::PathBuf::from("/tmp"));
        let provider = OpenAiProvider::new(ProviderConfig {
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
            auth_type: crate::llm::types::AuthType::Bearer,
        });

        let request = StreamTextRequest {
            model: "gpt-5.2-codex".to_string(),
            messages: vec![
                Message::User {
                    content: MessageContent::Text("hi".to_string()),
                    provider_options: None,
                },
                Message::Assistant {
                    content: MessageContent::Parts(vec![
                        ContentPart::Text {
                            text: "checking".to_string(),
                        },
                        ContentPart::ToolCall {
                            tool_call_id: "call_1".to_string(),
                            tool_name: "webFetch".to_string(),
                            input: json!({ "url": "https://example.com" }),
                            provider_metadata: None,
                        },
                    ]),
                    provider_options: None,
                },
                Message::Tool {
                    content: vec![ContentPart::ToolResult {
                        tool_call_id: "call_1".to_string(),
                        tool_name: "webFetch".to_string(),
                        output: json!({ "type": "text", "value": "ok" }),
                    }],
                    provider_options: None,
                },
            ],
            tools: None,
            stream: Some(true),
            temperature: None,
            max_tokens: None,
            top_p: None,
            top_k: None,
            provider_options: None,
            request_id: None,
            trace_context: None,
        };

        let ctx = ProviderContext {
            provider_config: provider.config(),
            api_key_manager: &api_keys,
            model: "gpt-5.2-codex",
            messages: &request.messages,
            tools: request.tools.as_deref(),
            temperature: request.temperature,
            max_tokens: request.max_tokens,
            top_p: request.top_p,
            top_k: request.top_k,
            provider_options: request.provider_options.as_ref(),
            trace_context: request.trace_context.as_ref(),
        };

        let body = provider.build_oauth_request(&ctx).expect("request body");
        let input = body
            .get("input")
            .and_then(|value| value.as_array())
            .expect("input array");

        let has_tool_result = input.iter().any(|item| {
            item.get("type")
                .and_then(|value| value.as_str())
                .is_some_and(|value| value == "tool_result")
        });
        assert!(!has_tool_result);

        let has_function_call = input.iter().any(|item| {
            item.get("type")
                .and_then(|value| value.as_str())
                .is_some_and(|value| value == "function_call")
        });
        assert!(has_function_call);

        let output_item = input.iter().find(|item| {
            item.get("type")
                .and_then(|value| value.as_str())
                .is_some_and(|value| value == "function_call_output")
        });
        assert!(output_item.is_some());
        assert_eq!(
            output_item
                .and_then(|item| item.get("output"))
                .and_then(|value| value.as_str()),
            Some("ok")
        );
    }

    #[test]
    fn openai_oauth_skips_partial_tool_call_arguments() {
        let mut state = ProtocolStreamState::default();
        state.tool_calls.insert(
            "item_1".to_string(),
            ToolCallAccum {
                tool_call_id: "call_1".to_string(),
                tool_name: "readFile".to_string(),
                arguments: "{".to_string(),
                thought_signature: None,
            },
        );
        state.tool_call_order.push("item_1".to_string());

        let event = parse_openai_oauth_event_legacy(None, "{}", &mut state).expect("parse event");
        assert!(event.is_none());
        assert!(state.pending_events.is_empty());
        assert!(!state.emitted_tool_calls.contains("item_1"));
    }

    #[test]
    fn openai_oauth_emits_tool_call_when_arguments_complete() {
        let mut state = ProtocolStreamState::default();
        state.tool_calls.insert(
            "item_1".to_string(),
            ToolCallAccum {
                tool_call_id: "call_1".to_string(),
                tool_name: "readFile".to_string(),
                arguments: "{\"path\":\"/tmp/a\"}".to_string(),
                thought_signature: None,
            },
        );
        state.tool_call_order.push("item_1".to_string());

        let event = parse_openai_oauth_event_legacy(
            Some("response.function_call_arguments.delta"),
            "{}",
            &mut state,
        )
        .expect("parse event");
        assert!(event.is_some());
        assert!(state.emitted_tool_calls.contains("item_1"));
    }

    #[test]
    fn openai_oauth_function_call_done_emits_once() {
        let mut state = ProtocolStreamState::default();
        let payload = json!({
            "item_id": "item_1",
            "name": "readFile",
            "arguments": "{\"path\":\"/tmp/a\"}"
        });

        let first = parse_openai_oauth_function_call_done(&payload, &mut state);
        assert!(first.is_some());
        assert!(state.emitted_tool_calls.contains("item_1"));

        let second = parse_openai_oauth_function_call_done(&payload, &mut state);
        assert!(second.is_none());
    }

    #[test]
    fn openai_oauth_preserves_tool_call_index_order() {
        let mut state = ProtocolStreamState::default();
        let first = json!({
            "type": "response.output_item.added",
            "item": {
                "type": "function_call",
                "id": "item_b",
                "call_id": "call_b",
                "name": "glob",
                "index": 1
            }
        });
        let second = json!({
            "type": "response.output_item.added",
            "item": {
                "type": "function_call",
                "id": "item_a",
                "call_id": "call_a",
                "name": "readFile",
                "index": 0
            }
        });
        let args_a = json!({
            "type": "response.function_call_arguments.done",
            "item_id": "item_a",
            "name": "readFile",
            "arguments": "{\"file_path\":\"/tmp/a\"}",
            "index": 0
        });
        let args_b = json!({
            "type": "response.function_call_arguments.done",
            "item_id": "item_b",
            "name": "glob",
            "arguments": "{\"pattern\":\"*.rs\"}",
            "index": 1
        });

        let _ = parse_openai_oauth_event_legacy(None, &first.to_string(), &mut state)
            .expect("parse first");
        let _ = parse_openai_oauth_event_legacy(None, &second.to_string(), &mut state)
            .expect("parse second");

        let mut tool_calls: Vec<String> = Vec::new();

        if let Some(event) = parse_openai_oauth_event_legacy(None, &args_b.to_string(), &mut state)
            .expect("parse args b")
        {
            if let StreamEvent::ToolCall { tool_call_id, .. } = event {
                tool_calls.push(tool_call_id);
            }
        }
        while let Some(event) = state.pending_events.get(0).cloned() {
            state.pending_events.remove(0);
            if let StreamEvent::ToolCall { tool_call_id, .. } = event {
                tool_calls.push(tool_call_id);
            }
        }

        if let Some(event) = parse_openai_oauth_event_legacy(None, &args_a.to_string(), &mut state)
            .expect("parse args a")
        {
            if let StreamEvent::ToolCall { tool_call_id, .. } = event {
                tool_calls.push(tool_call_id);
            }
        }
        while let Some(event) = state.pending_events.get(0).cloned() {
            state.pending_events.remove(0);
            if let StreamEvent::ToolCall { tool_call_id, .. } = event {
                tool_calls.push(tool_call_id);
            }
        }

        assert_eq!(tool_calls, vec!["call_b".to_string(), "call_a".to_string()]);
    }

    #[test]
    fn openai_oauth_response_completed_emits_usage_and_done() {
        let mut state = ProtocolStreamState::default();
        let payload = json!({
            "type": "response.completed",
            "response": {
                "usage": { "input_tokens": 10, "output_tokens": 5, "total_tokens": 15 }
            }
        });

        let first = parse_openai_oauth_event_legacy(None, &payload.to_string(), &mut state)
            .expect("parse event")
            .expect("event");
        match first {
            StreamEvent::Usage {
                input_tokens,
                output_tokens,
                total_tokens,
                ..
            } => {
                assert_eq!(input_tokens, 10);
                assert_eq!(output_tokens, 5);
                assert_eq!(total_tokens, Some(15));
            }
            _ => panic!("Unexpected event"),
        }

        let second =
            parse_openai_oauth_event_legacy(Some("response.output_text.done"), "{}", &mut state)
                .expect("parse event")
                .expect("event");
        match second {
            StreamEvent::Done { finish_reason } => {
                assert_eq!(finish_reason, None);
            }
            _ => panic!("Unexpected event"),
        }
    }

    #[tokio::test]
    async fn build_openai_oauth_request_uses_correct_content_types() {
        let dir = TempDir::new().expect("temp dir");
        let db_path = dir.path().join("talkcody-test.db");
        let db = Arc::new(Database::new(db_path.to_string_lossy().to_string()));
        db.connect().await.expect("db connect");
        let api_keys = ApiKeyManager::new(db, std::path::PathBuf::from("/tmp"));
        let provider = OpenAiProvider::new(ProviderConfig {
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
            auth_type: crate::llm::types::AuthType::Bearer,
        });

        let request = StreamTextRequest {
            model: "gpt-5.2-codex".to_string(),
            messages: vec![
                Message::System {
                    content: "You are a helpful assistant.".to_string(),
                    provider_options: None,
                },
                Message::User {
                    content: MessageContent::Text("Hello!".to_string()),
                    provider_options: None,
                },
                Message::Assistant {
                    content: MessageContent::Text("Hi there! How can I help you?".to_string()),
                    provider_options: None,
                },
                Message::User {
                    content: MessageContent::Parts(vec![ContentPart::Text {
                        text: "What's the weather?".to_string(),
                    }]),
                    provider_options: None,
                },
                Message::Assistant {
                    content: MessageContent::Parts(vec![
                        ContentPart::Text {
                            text: "Let me check that for you.".to_string(),
                        },
                        ContentPart::Reasoning {
                            text: "The user wants weather info.".to_string(),
                            provider_options: None,
                        },
                    ]),
                    provider_options: None,
                },
            ],
            tools: None,
            stream: Some(true),
            temperature: None,
            max_tokens: None,
            top_p: None,
            top_k: None,
            provider_options: None,
            request_id: None,
            trace_context: None,
        };

        let ctx = ProviderContext {
            provider_config: provider.config(),
            api_key_manager: &api_keys,
            model: "gpt-5.2-codex",
            messages: &request.messages,
            tools: request.tools.as_deref(),
            temperature: request.temperature,
            max_tokens: request.max_tokens,
            top_p: request.top_p,
            top_k: request.top_k,
            provider_options: request.provider_options.as_ref(),
            trace_context: request.trace_context.as_ref(),
        };

        let body = provider.build_oauth_request(&ctx).expect("request body");
        let input = body
            .get("input")
            .and_then(|value| value.as_array())
            .expect("input array");

        let developer_msg = input
            .iter()
            .find(|item| {
                item.get("role")
                    .and_then(|value| value.as_str())
                    .is_some_and(|value| value == "developer")
            })
            .expect("developer message");
        let user_msg = input
            .iter()
            .find(|item| {
                item.get("role")
                    .and_then(|value| value.as_str())
                    .is_some_and(|value| value == "user")
            })
            .expect("user message");
        let assistant_msgs: Vec<_> = input
            .iter()
            .filter(|item| {
                item.get("role")
                    .and_then(|value| value.as_str())
                    .is_some_and(|value| value == "assistant")
            })
            .collect();

        // Developer message should use input_text
        let dev_content = developer_msg
            .get("content")
            .and_then(|value| value.as_array())
            .expect("developer content array")
            .first()
            .expect("first content item");
        assert_eq!(
            dev_content.get("type").and_then(|value| value.as_str()),
            Some("input_text"),
            "Developer message should use input_text"
        );

        // User message should use input_text
        let user_content = user_msg
            .get("content")
            .and_then(|value| value.as_array())
            .expect("user content array")
            .first()
            .expect("first content item");
        assert_eq!(
            user_content.get("type").and_then(|value| value.as_str()),
            Some("input_text"),
            "User message should use input_text"
        );

        // Assistant messages should use output_text
        assert!(
            !assistant_msgs.is_empty(),
            "Should have at least 1 assistant message"
        );
        for (index, assistant_msg) in assistant_msgs.iter().enumerate() {
            let content_array = assistant_msg
                .get("content")
                .and_then(|value| value.as_array())
                .expect(&format!("assistant {} content array", index));
            for (content_index, content_item) in content_array.iter().enumerate() {
                let content_type = content_item
                    .get("type")
                    .and_then(|value| value.as_str())
                    .expect(&format!(
                        "content type at assistant {} content {}",
                        index, content_index
                    ));
                // Assistant messages should only contain output_text (not input_text)
                assert_eq!(
                    content_type, "output_text",
                    "Assistant message {} content {} should use output_text, not {}",
                    index, content_index, content_type
                );
            }
        }
    }
}
