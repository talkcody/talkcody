use crate::llm::auth::api_key_manager::ApiKeyManager;
use crate::llm::image_generation::openai::OpenAiImageClient;
use crate::llm::image_generation::types::{GeneratedImage, ImageGenerationRequest};
use crate::llm::providers::provider::BaseProvider;
use crate::llm::types::ProviderConfig;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;

/// Request format for multimodal LLM image generation via chat completions
#[derive(Debug, Clone, Serialize)]
struct ChatCompletionsRequest {
    model: String,
    messages: Vec<Message>,
}

#[derive(Debug, Clone, Serialize)]
struct Message {
    role: String,
    content: String,
}

/// Response format from chat completions with image generation
/// Based on Vercel AI Gateway documentation
#[derive(Debug, Clone, Deserialize)]
struct ChatCompletionsResponse {
    choices: Vec<Choice>,
}

#[derive(Debug, Clone, Deserialize)]
struct Choice {
    message: ResponseMessage,
}

#[derive(Debug, Clone, Deserialize)]
struct ResponseMessage {
    #[serde(rename = "content")]
    _content: Option<String>,
    /// Images are returned in this array for non-streaming responses
    /// Format: [{"type": "image_url", "image_url": {"url": "data:image/png;base64,..."}}]
    images: Option<Vec<ResponseImage>>,
}

/// AI Gateway returns images in OpenAI-compatible format
/// See: https://vercel.com/docs/ai-gateway/capabilities/image-generation/openai
#[derive(Debug, Clone, Deserialize)]
struct ResponseImage {
    #[serde(rename = "type")]
    _image_type: Option<String>,
    #[serde(rename = "image_url")]
    image_url: Option<ImageUrl>,
}

#[derive(Debug, Clone, Deserialize)]
struct ImageUrl {
    /// Can be a data URL (data:image/png;base64,...) or a regular URL
    url: String,
}

pub struct AIGatewayImageClient {
    config: ProviderConfig,
}

impl AIGatewayImageClient {
    pub fn new(config: ProviderConfig) -> Self {
        Self { config }
    }

    pub async fn generate(
        &self,
        api_keys: &ApiKeyManager,
        model: &str,
        request: ImageGenerationRequest,
    ) -> Result<Vec<GeneratedImage>, String> {
        // Check if this is a multimodal LLM that supports image output
        // These models use chat completions API instead of images/generations
        if self.is_multimodal_image_model(model) {
            self.generate_via_chat_completions(api_keys, model, request)
                .await
        } else {
            // Use standard OpenAI images/generations API for image-only models
            let client = OpenAiImageClient::new(self.config.clone());
            client.generate(api_keys, model, request).await
        }
    }

    /// Check if the model is a multimodal LLM that supports image generation
    /// Examples: google/gemini-2.5-flash-image, google/gemini-3-pro-image
    fn is_multimodal_image_model(&self, model: &str) -> bool {
        let model_lower = model.to_lowercase();
        // Multimodal image models typically have "-image" suffix and are Gemini models
        model_lower.contains("gemini") && model_lower.ends_with("-image")
    }

    /// Parse a data URL and extract the base64 data and mime type
    /// Format: data:image/png;base64,iVBORw0KGgo...
    fn parse_data_url(&self, url: &str) -> Option<(String, String)> {
        if !url.starts_with("data:") {
            return None;
        }

        // data:image/png;base64,xxx or data:image/jpeg;base64,xxx
        let without_prefix = url.strip_prefix("data:")?;
        let parts: Vec<&str> = without_prefix.splitn(2, ',').collect();
        if parts.len() != 2 {
            return None;
        }

        let meta = parts[0];
        let data = parts[1];

        // Parse mime type from meta (e.g., "image/png;base64")
        let mime_type = meta.split(';').next().unwrap_or("image/png");

        Some((data.to_string(), mime_type.to_string()))
    }

    /// Generate images using chat completions API for multimodal LLMs
    /// According to Vercel AI Gateway docs, multimodal LLMs like Nano Banana Pro
    /// use /v1/chat/completions endpoint and return images in the response's images array
    async fn generate_via_chat_completions(
        &self,
        api_keys: &ApiKeyManager,
        model: &str,
        request: ImageGenerationRequest,
    ) -> Result<Vec<GeneratedImage>, String> {
        let credentials = api_keys.get_credentials(&self.config).await?;
        let api_key = match credentials {
            crate::llm::auth::api_key_manager::ProviderCredentials::Token(token) => token,
            crate::llm::auth::api_key_manager::ProviderCredentials::None => {
                return Err(
                    "API key not configured for AI Gateway image generation / AI Gateway 图片生成未配置 API 密钥"
                        .to_string(),
                )
            }
        };

        let base = BaseProvider::new(self.config.clone());
        let base_url = base.resolve_base_url_with_fallback(api_keys).await?;
        let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));

        let body = ChatCompletionsRequest {
            model: model.to_string(),
            messages: vec![Message {
                role: "user".to_string(),
                content: request.prompt,
            }],
        };

        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(120))
            .build()
            .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

        let mut headers = HashMap::new();
        headers.insert("Content-Type".to_string(), "application/json".to_string());
        headers.insert("Authorization".to_string(), format!("Bearer {}", api_key));
        api_keys
            .maybe_set_openai_account_header(&self.config.id, &mut headers)
            .await?;

        let mut header_map = reqwest::header::HeaderMap::new();
        for (key, value) in headers {
            let header_name = reqwest::header::HeaderName::from_bytes(key.as_bytes())
                .map_err(|e| format!("Invalid header name {}: {}", key, e))?;
            let header_value = reqwest::header::HeaderValue::from_str(&value)
                .map_err(|e| format!("Invalid header value for {}: {}", key, e))?;
            header_map.insert(header_name, header_value);
        }

        let response = client
            .post(&url)
            .headers(header_map)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("AI Gateway chat completions request failed: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response
                .text()
                .await
                .unwrap_or_else(|_| "Unknown error".to_string());
            return Err(format!(
                "AI Gateway image generation failed ({}): {} / AI Gateway 图片生成失败",
                status, body
            ));
        }

        let payload = response
            .json::<ChatCompletionsResponse>()
            .await
            .map_err(|e| format!("Failed to parse AI Gateway response: {}", e))?;

        let mut images = Vec::new();

        if let Some(choice) = payload.choices.first() {
            // Extract images from message.images field
            // Format per AI Gateway docs: [{"type": "image_url", "image_url": {"url": "data:image/png;base64,..."}}]
            if let Some(response_images) = &choice.message.images {
                for img in response_images {
                    if let Some(image_url) = &img.image_url {
                        let url = &image_url.url;

                        // Check if it's a data URL
                        if let Some((b64_data, mime_type)) = self.parse_data_url(url) {
                            images.push(GeneratedImage {
                                b64_json: Some(b64_data),
                                url: None,
                                mime_type,
                                revised_prompt: None,
                            });
                        } else {
                            // It's a regular URL
                            images.push(GeneratedImage {
                                b64_json: None,
                                url: Some(url.clone()),
                                mime_type: "image/png".to_string(),
                                revised_prompt: None,
                            });
                        }
                    }
                }
            }
        }

        if images.is_empty() {
            return Err(
                "No images generated by multimodal model / 多模态模型未生成图片".to_string(),
            );
        }

        Ok(images)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifies_multimodal_image_models() {
        let config = ProviderConfig {
            id: "aiGateway".to_string(),
            name: "AI Gateway".to_string(),
            protocol: crate::llm::types::ProtocolType::OpenAiCompatible,
            base_url: "https://ai-gateway.vercel.sh".to_string(),
            api_key_name: "AI_GATEWAY_API_KEY".to_string(),
            supports_oauth: false,
            supports_coding_plan: false,
            supports_international: false,
            coding_plan_base_url: None,
            international_base_url: None,
            headers: None,
            extra_body: None,
            auth_type: crate::llm::types::AuthType::Bearer,
        };
        let client = AIGatewayImageClient::new(config);

        assert!(client.is_multimodal_image_model("google/gemini-2.5-flash-image"));
        assert!(client.is_multimodal_image_model("google/gemini-3-pro-image"));
        assert!(!client.is_multimodal_image_model("dall-e-3"));
        assert!(!client.is_multimodal_image_model("google/imagen-3.0-generate-002"));
    }

    #[test]
    fn parses_data_url() {
        let config = ProviderConfig {
            id: "aiGateway".to_string(),
            name: "AI Gateway".to_string(),
            protocol: crate::llm::types::ProtocolType::OpenAiCompatible,
            base_url: "https://ai-gateway.vercel.sh".to_string(),
            api_key_name: "AI_GATEWAY_API_KEY".to_string(),
            supports_oauth: false,
            supports_coding_plan: false,
            supports_international: false,
            coding_plan_base_url: None,
            international_base_url: None,
            headers: None,
            extra_body: None,
            auth_type: crate::llm::types::AuthType::Bearer,
        };
        let client = AIGatewayImageClient::new(config);

        // Test data URL parsing
        let (data, mime) = client
            .parse_data_url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA")
            .unwrap();
        assert_eq!(data, "iVBORw0KGgoAAAANSUhEUgAA");
        assert_eq!(mime, "image/png");

        // Test JPEG data URL
        let (data, mime) = client
            .parse_data_url("data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ")
            .unwrap();
        assert_eq!(data, "/9j/4AAQSkZJRgABAQ");
        assert_eq!(mime, "image/jpeg");

        // Test non-data URL returns None
        assert!(client
            .parse_data_url("https://example.com/image.png")
            .is_none());
    }
}
