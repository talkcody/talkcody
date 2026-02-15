use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum ProtocolType {
    OpenAiCompatible,
    Claude,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderConfig {
    pub id: String,
    pub name: String,
    pub protocol: ProtocolType,
    #[serde(rename = "baseUrl")]
    pub base_url: String,
    #[serde(rename = "apiKeyName")]
    pub api_key_name: String,
    #[serde(rename = "supportsOAuth")]
    pub supports_oauth: bool,
    #[serde(rename = "supportsCodingPlan")]
    pub supports_coding_plan: bool,
    #[serde(rename = "supportsInternational")]
    pub supports_international: bool,
    #[serde(rename = "codingPlanBaseUrl")]
    pub coding_plan_base_url: Option<String>,
    #[serde(rename = "internationalBaseUrl")]
    pub international_base_url: Option<String>,
    pub headers: Option<HashMap<String, String>>,
    #[serde(rename = "extraBody")]
    pub extra_body: Option<serde_json::Value>,
    #[serde(rename = "authType")]
    pub auth_type: AuthType,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AuthType {
    None,
    Bearer,
    ApiKey,
    OAuthBearer,
    TalkCodyJwt,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelConfig {
    pub name: String,
    #[serde(default, rename = "imageInput")]
    pub image_input: bool,
    #[serde(default, rename = "imageOutput")]
    pub image_output: bool,
    #[serde(default, rename = "audioInput")]
    pub audio_input: bool,
    #[serde(default, rename = "videoInput")]
    pub video_input: bool,
    #[serde(default)]
    pub interleaved: bool,
    pub providers: Vec<String>,
    #[serde(rename = "providerMappings")]
    pub provider_mappings: Option<HashMap<String, String>>,
    pub pricing: Option<ModelPricing>,
    pub context_length: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelPricing {
    pub input: String,
    pub output: String,
    #[serde(rename = "cachedInput")]
    pub cached_input: Option<String>,
    #[serde(rename = "cacheCreation")]
    pub cache_creation: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelsConfiguration {
    pub version: String,
    pub models: HashMap<String, ModelConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AvailableModel {
    pub key: String,
    pub name: String,
    pub provider: String,
    #[serde(rename = "providerName")]
    pub provider_name: String,
    #[serde(rename = "imageInput")]
    pub image_input: bool,
    #[serde(rename = "imageOutput")]
    pub image_output: bool,
    #[serde(rename = "audioInput")]
    pub audio_input: bool,
    #[serde(rename = "videoInput")]
    pub video_input: bool,
    #[serde(rename = "inputPricing")]
    pub input_pricing: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TraceContext {
    #[serde(rename = "traceId")]
    pub trace_id: Option<String>,
    #[serde(rename = "parentSpanId")]
    pub parent_span_id: Option<String>,
    #[serde(rename = "spanName")]
    pub span_name: Option<String>,
    #[serde(rename = "metadata")]
    pub metadata: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamTextRequest {
    pub model: String,
    pub messages: Vec<Message>,
    pub tools: Option<Vec<ToolDefinition>>,
    pub stream: Option<bool>,
    pub temperature: Option<f32>,
    #[serde(rename = "maxTokens")]
    pub max_tokens: Option<i32>,
    #[serde(rename = "topP")]
    pub top_p: Option<f32>,
    #[serde(rename = "topK")]
    pub top_k: Option<i32>,
    #[serde(rename = "providerOptions")]
    pub provider_options: Option<serde_json::Value>,
    #[serde(rename = "requestId")]
    pub request_id: Option<String>,
    #[serde(rename = "traceContext")]
    pub trace_context: Option<TraceContext>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamResponse {
    pub request_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "role", rename_all = "lowercase")]
pub enum Message {
    System {
        content: String,
        #[serde(default, rename = "providerOptions")]
        provider_options: Option<serde_json::Value>,
    },
    User {
        content: MessageContent,
        #[serde(default, rename = "providerOptions")]
        provider_options: Option<serde_json::Value>,
    },
    Assistant {
        content: MessageContent,
        #[serde(default, rename = "providerOptions")]
        provider_options: Option<serde_json::Value>,
    },
    Tool {
        content: Vec<ContentPart>,
        #[serde(default, rename = "providerOptions")]
        provider_options: Option<serde_json::Value>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum MessageContent {
    Text(String),
    Parts(Vec<ContentPart>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ContentPart {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "image")]
    Image { image: String },
    #[serde(rename = "video")]
    Video {
        video: String,
        #[serde(rename = "mimeType")]
        mime_type: Option<String>,
    },
    #[serde(rename = "tool-call")]
    ToolCall {
        #[serde(rename = "toolCallId")]
        tool_call_id: String,
        #[serde(rename = "toolName")]
        tool_name: String,
        input: serde_json::Value,
        #[serde(default)]
        provider_metadata: Option<serde_json::Value>,
    },
    #[serde(rename = "tool-result")]
    ToolResult {
        #[serde(rename = "toolCallId")]
        tool_call_id: String,
        #[serde(rename = "toolName")]
        tool_name: String,
        output: serde_json::Value,
    },
    #[serde(rename = "reasoning")]
    Reasoning {
        text: String,
        #[serde(default, rename = "providerOptions")]
        provider_options: Option<serde_json::Value>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    #[serde(rename = "type")]
    pub tool_type: String,
    pub name: String,
    pub description: Option<String>,
    pub parameters: serde_json::Value,
    pub strict: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum StreamEvent {
    TextStart,
    TextDelta {
        text: String,
    },
    ToolCall {
        #[serde(rename = "toolCallId")]
        tool_call_id: String,
        #[serde(rename = "toolName")]
        tool_name: String,
        input: serde_json::Value,
        #[serde(default)]
        provider_metadata: Option<serde_json::Value>,
    },
    ReasoningStart {
        id: String,
        #[serde(default)]
        provider_metadata: Option<serde_json::Value>,
    },
    ReasoningDelta {
        id: String,
        text: String,
        #[serde(default)]
        provider_metadata: Option<serde_json::Value>,
    },
    ReasoningEnd {
        id: String,
    },
    Usage {
        input_tokens: i32,
        output_tokens: i32,
        total_tokens: Option<i32>,
        cached_input_tokens: Option<i32>,
        cache_creation_input_tokens: Option<i32>,
    },
    Done {
        finish_reason: Option<String>,
    },
    Error {
        message: String,
    },
    Raw {
        raw_value: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptionRequest {
    pub model: String,
    #[serde(rename = "audioBase64")]
    pub audio_base64: String,
    #[serde(rename = "mimeType")]
    pub mime_type: String,
    pub language: Option<String>,
    pub prompt: Option<String>,
    pub temperature: Option<f32>,
    #[serde(rename = "responseFormat")]
    pub response_format: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptionResponse {
    pub text: String,
    pub language: Option<String>,
    pub duration: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageGenerationRequest {
    pub model: String,
    pub prompt: String,
    pub size: Option<String>,
    pub quality: Option<String>,
    pub n: Option<u32>,
    #[serde(rename = "responseFormat")]
    pub response_format: Option<String>,
    #[serde(rename = "providerOptions")]
    pub provider_options: Option<serde_json::Value>,
    #[serde(rename = "requestId")]
    pub request_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageGenerationResponse {
    pub provider: String,
    #[serde(rename = "images")]
    pub images: Vec<GeneratedImage>,
    #[serde(rename = "requestId")]
    pub request_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneratedImage {
    #[serde(rename = "b64Json")]
    pub b64_json: Option<String>,
    pub url: Option<String>,
    #[serde(rename = "mimeType")]
    pub mime_type: String,
    #[serde(rename = "revisedPrompt")]
    pub revised_prompt: Option<String>,
}

/// Request to download an image from a URL
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageDownloadRequest {
    pub url: String,
}

/// Response containing downloaded image data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageDownloadResponse {
    pub data: Vec<u8>,
    #[serde(rename = "mimeType")]
    pub mime_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomProviderConfig {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub provider_type: CustomProviderType,
    #[serde(rename = "baseUrl")]
    pub base_url: String,
    #[serde(rename = "apiKey")]
    pub api_key: String,
    pub enabled: bool,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum CustomProviderType {
    #[serde(rename = "openai-compatible")]
    OpenAiCompatible,
    #[serde(rename = "anthropic")]
    Anthropic,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomProvidersConfiguration {
    pub version: String,
    pub providers: HashMap<String, CustomProviderConfig>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn custom_provider_type_serializes_to_openai_compatible() {
        let provider_type = CustomProviderType::OpenAiCompatible;
        let serialized = serde_json::to_string(&provider_type).unwrap();
        assert_eq!(serialized, "\"openai-compatible\"");
    }

    #[test]
    fn custom_provider_type_serializes_to_anthropic() {
        let provider_type = CustomProviderType::Anthropic;
        let serialized = serde_json::to_string(&provider_type).unwrap();
        assert_eq!(serialized, "\"anthropic\"");
    }

    #[test]
    fn custom_provider_type_deserializes_from_openai_compatible() {
        let deserialized: CustomProviderType =
            serde_json::from_str("\"openai-compatible\"").unwrap();
        assert!(matches!(deserialized, CustomProviderType::OpenAiCompatible));
    }

    #[test]
    fn custom_provider_type_deserializes_from_anthropic() {
        let deserialized: CustomProviderType = serde_json::from_str("\"anthropic\"").unwrap();
        assert!(matches!(deserialized, CustomProviderType::Anthropic));
    }

    #[test]
    fn custom_provider_config_parses_correctly() {
        let json = r#"{
            "id": "test-provider",
            "name": "Test Provider",
            "type": "openai-compatible",
            "baseUrl": "https://api.test.com",
            "apiKey": "test-key",
            "enabled": true
        }"#;
        let config: CustomProviderConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.id, "test-provider");
        assert_eq!(config.name, "Test Provider");
        assert!(matches!(
            config.provider_type,
            CustomProviderType::OpenAiCompatible
        ));
        assert_eq!(config.base_url, "https://api.test.com");
        assert_eq!(config.api_key, "test-key");
        assert!(config.enabled);
    }

    #[test]
    fn custom_providers_configuration_parses_correctly() {
        let json = r#"{
            "version": "1.0.0",
            "providers": {
                "test-provider": {
                    "id": "test-provider",
                    "name": "Test Provider",
                    "type": "openai-compatible",
                    "baseUrl": "https://api.test.com",
                    "apiKey": "test-key",
                    "enabled": true
                }
            }
        }"#;
        let config: CustomProvidersConfiguration = serde_json::from_str(json).unwrap();
        assert_eq!(config.version, "1.0.0");
        assert!(config.providers.contains_key("test-provider"));
        let provider = config.providers.get("test-provider").unwrap();
        assert!(matches!(
            provider.provider_type,
            CustomProviderType::OpenAiCompatible
        ));
    }
}
