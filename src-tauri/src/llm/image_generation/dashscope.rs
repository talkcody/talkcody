use crate::llm::auth::api_key_manager::ApiKeyManager;
use crate::llm::image_generation::types::{GeneratedImage, ImageGenerationRequest};
use crate::llm::providers::provider::BaseProvider;
use crate::llm::types::ProviderConfig;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;

/// Request format for Qwen Image Max (qwen-image-max) generation
/// Uses multimodal chat completion format
#[derive(Debug, Clone, Serialize)]
struct QwenImageRequest {
    model: String,
    input: QwenImageInput,
    #[serde(skip_serializing_if = "Option::is_none")]
    parameters: Option<QwenImageParameters>,
}

#[derive(Debug, Clone, Serialize)]
struct QwenImageInput {
    messages: Vec<QwenImageMessage>,
}

#[derive(Debug, Clone, Serialize)]
struct QwenImageMessage {
    role: String,
    content: Vec<QwenImageContent>,
}

#[derive(Debug, Clone, Serialize)]
struct QwenImageContent {
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct QwenImageParameters {
    #[serde(skip_serializing_if = "Option::is_none")]
    size: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(rename = "negative_prompt")]
    negative_prompt: Option<String>,
    #[serde(rename = "prompt_extend")]
    prompt_extend: bool,
    watermark: bool,
}

/// Response format from Qwen Image Max API
#[derive(Debug, Clone, Deserialize)]
struct QwenImageResponse {
    output: QwenImageOutput,
    #[serde(rename = "request_id")]
    request_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    usage: Option<QwenImageUsage>,
}

#[derive(Debug, Clone, Deserialize)]
struct QwenImageOutput {
    choices: Vec<QwenImageChoice>,
    #[serde(rename = "task_metric")]
    #[serde(skip_serializing_if = "Option::is_none")]
    task_metric: Option<QwenTaskMetric>,
}

#[derive(Debug, Clone, Deserialize)]
struct QwenImageChoice {
    #[serde(rename = "finish_reason")]
    finish_reason: String,
    message: QwenImageMessageResponse,
}

#[derive(Debug, Clone, Deserialize)]
struct QwenImageMessageResponse {
    content: Vec<QwenImageContentResponse>,
    role: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
enum QwenImageContentResponse {
    Image { image: String },
    Text { text: String },
}

#[derive(Debug, Clone, Deserialize)]
struct QwenTaskMetric {
    #[serde(default)]
    failed: i32,
    #[serde(default)]
    succeeded: i32,
    #[serde(default)]
    total: i32,
}

#[derive(Debug, Clone, Deserialize)]
struct QwenImageUsage {
    #[serde(skip_serializing_if = "Option::is_none")]
    height: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    width: Option<i32>,
    #[serde(rename = "image_count")]
    #[serde(skip_serializing_if = "Option::is_none")]
    image_count: Option<i32>,
}

/// Error response from Qwen Image API
#[derive(Debug, Clone, Deserialize)]
struct QwenImageErrorResponse {
    #[serde(rename = "request_id")]
    request_id: String,
    code: String,
    message: String,
}

pub struct DashScopeImageClient {
    config: ProviderConfig,
}

impl DashScopeImageClient {
    pub fn new(config: ProviderConfig) -> Self {
        Self { config }
    }

    pub async fn generate(
        &self,
        api_keys: &ApiKeyManager,
        model: &str,
        request: ImageGenerationRequest,
    ) -> Result<Vec<GeneratedImage>, String> {
        log::info!(
            "[DashScopeImageClient] Starting image generation for model: {}",
            model
        );

        let credentials = api_keys.get_credentials(&self.config).await?;
        let api_key = match credentials {
            crate::llm::auth::api_key_manager::ProviderCredentials::Token(token) => {
                log::info!(
                    "[DashScopeImageClient] API key found, length: {}",
                    token.len()
                );
                token
            }
            crate::llm::auth::api_key_manager::ProviderCredentials::None => {
                log::error!("[DashScopeImageClient] API key not configured");
                return Err(
                    "API key not configured for Alibaba image generation / Alibaba 图片生成未配置 API 密钥"
                        .to_string(),
                );
            }
        };

        let base = BaseProvider::new(self.config.clone());
        let mut base_url = base.resolve_base_url_with_fallback(api_keys).await?;
        if base_url.contains("dashscope.aliyuncs.com/compatible-mode") {
            base_url = "https://dashscope.aliyuncs.com/api/v1".to_string();
        }
        log::info!("[DashScopeImageClient] Resolved base URL: {}", base_url);

        // Qwen Image Max uses a different endpoint path
        let url = format!(
            "{}/services/aigc/multimodal-generation/generation",
            base_url.trim_end_matches('/')
        );
        log::info!("[DashScopeImageClient] Full request URL: {}", url);

        // Parse size parameter (e.g., "1024x1024" -> "1024*1024")
        let size_param = request.size.map(|s| s.replace('x', "*"));
        log::info!("[DashScopeImageClient] Size parameter: {:?}", size_param);

        let body = QwenImageRequest {
            model: model.to_string(),
            input: QwenImageInput {
                messages: vec![QwenImageMessage {
                    role: "user".to_string(),
                    content: vec![QwenImageContent {
                        text: Some(request.prompt.clone()),
                    }],
                }],
            },
            parameters: Some(QwenImageParameters {
                size: size_param,
                negative_prompt: None, // Can be extended later
                prompt_extend: true,
                watermark: false,
            }),
        };

        // Log request body (truncate prompt for privacy)
        let prompt_preview = if request.prompt.len() > 50 {
            format!("{}...", &request.prompt[..50])
        } else {
            request.prompt.clone()
        };
        log::info!(
            "[DashScopeImageClient] Request body - model: {}, prompt: {}",
            model,
            prompt_preview
        );

        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(120))
            .build()
            .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

        let mut headers = HashMap::new();
        headers.insert("Content-Type".to_string(), "application/json".to_string());
        headers.insert("Authorization".to_string(), format!("Bearer {}", api_key));

        let mut header_map = reqwest::header::HeaderMap::new();
        for (key, value) in headers {
            let header_name = reqwest::header::HeaderName::from_bytes(key.as_bytes())
                .map_err(|e| format!("Invalid header name {}: {}", key, e))?;
            let header_value = reqwest::header::HeaderValue::from_str(&value)
                .map_err(|e| format!("Invalid header value for {}: {}", key, e))?;
            header_map.insert(header_name, header_value);
        }

        log::info!("[DashScopeImageClient] Sending request...");

        let response = client
            .post(&url)
            .headers(header_map)
            .json(&body)
            .send()
            .await
            .map_err(|e| {
                log::error!("[DashScopeImageClient] Request failed: {}", e);
                format!("Alibaba image request failed: {}", e)
            })?;

        let status = response.status();
        log::info!("[DashScopeImageClient] Response status: {}", status);

        if !status.is_success() {
            let body_text = response
                .text()
                .await
                .unwrap_or_else(|_| "Unknown error".to_string());

            log::error!("[DashScopeImageClient] Error response body: {}", body_text);

            // Try to parse error response
            if let Ok(error_resp) = serde_json::from_str::<QwenImageErrorResponse>(&body_text) {
                return Err(format!(
                    "Alibaba image generation failed ({}): {} - {} / Alibaba 图片生成失败: {}",
                    status, error_resp.code, error_resp.message, error_resp.message
                ));
            }

            return Err(format!(
                "Alibaba image generation failed ({}): {} / Alibaba 图片生成失败",
                status, body_text
            ));
        }

        let payload = response
            .json::<QwenImageResponse>()
            .await
            .map_err(|e| format!("Failed to parse Alibaba response: {}", e))?;

        // Extract images from response
        let mut images = Vec::new();

        log::info!(
            "[DashScopeImageClient] Processing {} choices",
            payload.output.choices.len()
        );

        for (choice_idx, choice) in payload.output.choices.iter().enumerate() {
            log::info!(
                "[DashScopeImageClient] Choice {} has {} content items",
                choice_idx,
                choice.message.content.len()
            );
            for (content_idx, content) in choice.message.content.iter().enumerate() {
                match content {
                    QwenImageContentResponse::Image { image } => {
                        log::info!(
                            "[DashScopeImageClient] Found image URL at choice {}, content {}: {}",
                            choice_idx,
                            content_idx,
                            if image.len() > 60 {
                                &image[..60]
                            } else {
                                image
                            }
                        );
                        images.push(GeneratedImage {
                            b64_json: None,
                            url: Some(image.clone()),
                            mime_type: "image/png".to_string(),
                            revised_prompt: None,
                        });
                    }
                    QwenImageContentResponse::Text { text } => {
                        log::info!("[DashScopeImageClient] Found text content at choice {}, content {}: {}", 
                                  choice_idx, content_idx,
                                  if text.len() > 50 { &text[..50] } else { text });
                    }
                }
            }
        }

        log::info!(
            "[DashScopeImageClient] Total images extracted: {}",
            images.len()
        );

        if images.is_empty() {
            return Err("No images generated / 未生成图片".to_string());
        }

        Ok(images)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_qwen_image_response() {
        let json = r#"{
            "output": {
                "choices": [
                    {
                        "finish_reason": "stop",
                        "message": {
                            "content": [
                                {"image": "https://dashscope-result-sh.oss-cn-shanghai.aliyuncs.com/xxx.png"}
                            ],
                            "role": "assistant"
                        }
                    }
                ],
                "task_metric": {
                    "FAILED": 0,
                    "SUCCEEDED": 1,
                    "TOTAL": 1
                }
            },
            "usage": {
                "height": 928,
                "image_count": 1,
                "width": 1664
            },
            "request_id": "d0250a3d-b07f-49e1-bdc8-6793f4929xxx"
        }"#;
        let parsed: QwenImageResponse = serde_json::from_str(json).expect("parse response");
        assert_eq!(parsed.output.choices.len(), 1);
        assert_eq!(parsed.output.choices[0].finish_reason, "stop");
        assert_eq!(parsed.request_id, "d0250a3d-b07f-49e1-bdc8-6793f4929xxx");

        // Extract image URL
        if let QwenImageContentResponse::Image { image } =
            &parsed.output.choices[0].message.content[0]
        {
            assert_eq!(
                image,
                "https://dashscope-result-sh.oss-cn-shanghai.aliyuncs.com/xxx.png"
            );
        } else {
            panic!("Expected image content");
        }
    }

    #[test]
    fn parses_qwen_image_error_response() {
        let json = r#"{
            "request_id": "a4d78a5f-655f-9639-8437-xxxxxx",
            "code": "InvalidParameter",
            "message": "num_images_per_prompt must be 1"
        }"#;
        let parsed: QwenImageErrorResponse =
            serde_json::from_str(json).expect("parse error response");
        assert_eq!(parsed.code, "InvalidParameter");
        assert_eq!(parsed.message, "num_images_per_prompt must be 1");
    }

    #[test]
    fn dashscope_image_client_constructs() {
        let config = ProviderConfig {
            id: "alibaba".to_string(),
            name: "Alibaba".to_string(),
            protocol: crate::llm::types::ProtocolType::OpenAiCompatible,
            base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1".to_string(),
            api_key_name: "ALIBABA_API_KEY".to_string(),
            supports_oauth: false,
            supports_coding_plan: false,
            supports_international: false,
            coding_plan_base_url: None,
            international_base_url: None,
            headers: None,
            extra_body: None,
            auth_type: crate::llm::types::AuthType::Bearer,
        };
        let _client = DashScopeImageClient::new(config);
    }

    #[test]
    fn test_size_parameter_conversion() {
        // Test that 1024x1024 is converted to 1024*1024
        let size = "1024x1024".to_string();
        let converted = size.replace('x', "*");
        assert_eq!(converted, "1024*1024");

        // Test with different size
        let size2 = "1664x928".to_string();
        let converted2 = size2.replace('x', "*");
        assert_eq!(converted2, "1664*928");
    }
}
