use crate::llm::auth::api_key_manager::ApiKeyManager;
use crate::llm::image_generation::types::{GeneratedImage, ImageGenerationRequest};
use crate::llm::providers::provider::BaseProvider;
use crate::llm::types::ProviderConfig;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;

/// Minimum pixel count required by Volcengine Seedream model (3,686,400 pixels)
/// This equals dimensions like 2560x1440, 1920x1920, etc.
const MIN_PIXEL_COUNT: u32 = 3_686_400;

/// Request format for Volcengine/ByteDance Seedream image generation
/// Follows OpenAI-compatible format
#[derive(Debug, Clone, Serialize)]
struct VolcengineImageRequest {
    model: String,
    prompt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    size: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    quality: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    n: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    response_format: Option<String>,
}

/// Response format from Volcengine image generation API
#[derive(Debug, Clone, Deserialize)]
struct VolcengineImageResponse {
    data: Vec<VolcengineImageData>,
}

#[derive(Debug, Clone, Deserialize)]
struct VolcengineImageData {
    #[serde(rename = "b64_json")]
    b64_json: Option<String>,
    url: Option<String>,
    #[serde(rename = "revised_prompt")]
    revised_prompt: Option<String>,
}

pub struct VolcengineImageClient {
    config: ProviderConfig,
}

impl VolcengineImageClient {
    pub fn new(config: ProviderConfig) -> Self {
        Self { config }
    }

    /// Validates and converts the requested size to a valid Volcengine size.
    /// If the requested size doesn't meet the minimum pixel requirement (3,686,400),
    /// it will be converted to the closest valid size.
    fn validate_and_convert_size(&self, requested_size: Option<String>) -> Option<String> {
        let size = requested_size?;

        // Parse the size string (format: "WIDTHxHEIGHT")
        let parts: Vec<&str> = size.split('x').collect();
        if parts.len() != 2 {
            // Invalid format, return a safe default
            return Some("2560x1440".to_string());
        }

        // Try to parse dimensions; if parsing fails, return default
        let width_result: Result<u32, _> = parts[0].parse();
        let height_result: Result<u32, _> = parts[1].parse();

        let (width, height) = match (width_result, height_result) {
            (Ok(w), Ok(h)) => (w, h),
            _ => return Some("2560x1440".to_string()), // Invalid numbers, return default
        };

        let pixel_count = width * height;

        // If size meets minimum requirement, use it
        if pixel_count >= MIN_PIXEL_COUNT {
            return Some(size);
        }

        // Otherwise, convert to closest valid size based on aspect ratio
        let aspect_ratio = width as f32 / height as f32;

        // Find the best matching preset
        let best_match = if aspect_ratio >= 1.5 {
            "2560x1440" // 16:9 landscape
        } else if aspect_ratio <= 0.67 {
            "1440x2560" // 9:16 portrait
        } else {
            "1920x1920" // 1:1 square
        };

        Some(best_match.to_string())
    }

    pub async fn generate(
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
                    "API key not configured for Volcengine image generation / Volcengine 图片生成未配置 API 密钥"
                        .to_string(),
                )
            }
        };

        let base = BaseProvider::new(self.config.clone());
        let base_url = base.resolve_base_url_with_fallback(api_keys).await?;
        let url = format!("{}/images/generations", base_url.trim_end_matches('/'));

        // Validate and convert size to meet Volcengine's minimum pixel requirement
        let validated_size = self.validate_and_convert_size(request.size);

        let body = VolcengineImageRequest {
            model: model.to_string(),
            prompt: request.prompt,
            size: validated_size,
            quality: request.quality,
            n: request.n,
            response_format: request.response_format,
        };

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

        let response = client
            .post(&url)
            .headers(header_map)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Volcengine image request failed: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response
                .text()
                .await
                .unwrap_or_else(|_| "Unknown error".to_string());
            return Err(format!(
                "Volcengine image generation failed ({}): {} / Volcengine 图片生成失败",
                status, body
            ));
        }

        let payload = response
            .json::<VolcengineImageResponse>()
            .await
            .map_err(|e| format!("Failed to parse Volcengine response: {}", e))?;

        let images = payload
            .data
            .into_iter()
            .map(|item| GeneratedImage {
                b64_json: item.b64_json,
                url: item.url,
                mime_type: "image/png".to_string(),
                revised_prompt: item.revised_prompt,
            })
            .collect();

        Ok(images)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_volcengine_image_response_with_b64() {
        let json = r#"{"data":[{"b64_json":"abc123","revised_prompt":"refined prompt"}]}"#;
        let parsed: VolcengineImageResponse = serde_json::from_str(json).expect("parse response");
        assert_eq!(parsed.data.len(), 1);
        assert_eq!(parsed.data[0].b64_json.as_deref(), Some("abc123"));
        assert_eq!(
            parsed.data[0].revised_prompt.as_deref(),
            Some("refined prompt")
        );
    }

    #[test]
    fn parses_volcengine_image_response_with_url() {
        let json = r#"{"data":[{"url":"https://example.com/image.png"}]}"#;
        let parsed: VolcengineImageResponse = serde_json::from_str(json).expect("parse response");
        assert_eq!(parsed.data.len(), 1);
        assert_eq!(
            parsed.data[0].url.as_deref(),
            Some("https://example.com/image.png")
        );
    }

    #[test]
    fn volcengine_image_client_constructs() {
        let config = ProviderConfig {
            id: "volcengine".to_string(),
            name: "Volcengine".to_string(),
            protocol: crate::llm::types::ProtocolType::OpenAiCompatible,
            base_url: "https://ark.cn-beijing.volces.com/api/v3".to_string(),
            api_key_name: "VOLCENGINE_API_KEY".to_string(),
            supports_oauth: false,
            supports_coding_plan: false,
            supports_international: false,
            coding_plan_base_url: None,
            international_base_url: None,
            headers: None,
            extra_body: None,
            auth_type: crate::llm::types::AuthType::Bearer,
        };
        let _client = VolcengineImageClient::new(config);
    }

    #[test]
    fn test_validate_size_meets_minimum() {
        let config = ProviderConfig {
            id: "volcengine".to_string(),
            name: "Volcengine".to_string(),
            protocol: crate::llm::types::ProtocolType::OpenAiCompatible,
            base_url: "https://ark.cn-beijing.volces.com/api/v3".to_string(),
            api_key_name: "VOLCENGINE_API_KEY".to_string(),
            supports_oauth: false,
            supports_coding_plan: false,
            supports_international: false,
            coding_plan_base_url: None,
            international_base_url: None,
            headers: None,
            extra_body: None,
            auth_type: crate::llm::types::AuthType::Bearer,
        };
        let client = VolcengineImageClient::new(config);

        // 2560x1440 (3,686,400 pixels) - exactly at minimum
        let result = client.validate_and_convert_size(Some("2560x1440".to_string()));
        assert_eq!(result, Some("2560x1440".to_string()));

        // 3840x2160 (8,294,400 pixels) - well above minimum
        let result = client.validate_and_convert_size(Some("3840x2160".to_string()));
        assert_eq!(result, Some("3840x2160".to_string()));
    }

    #[test]
    fn test_validate_size_converts_small_sizes() {
        let config = ProviderConfig {
            id: "volcengine".to_string(),
            name: "Volcengine".to_string(),
            protocol: crate::llm::types::ProtocolType::OpenAiCompatible,
            base_url: "https://ark.cn-beijing.volces.com/api/v3".to_string(),
            api_key_name: "VOLCENGINE_API_KEY".to_string(),
            supports_oauth: false,
            supports_coding_plan: false,
            supports_international: false,
            coding_plan_base_url: None,
            international_base_url: None,
            headers: None,
            extra_body: None,
            auth_type: crate::llm::types::AuthType::Bearer,
        };
        let client = VolcengineImageClient::new(config);

        // 1024x1024 (1,048,576 pixels) - too small, should convert to square
        let result = client.validate_and_convert_size(Some("1024x1024".to_string()));
        assert_eq!(result, Some("1920x1920".to_string()));

        // 1792x1024 (1,835,008 pixels) - landscape, too small, should convert to 16:9
        let result = client.validate_and_convert_size(Some("1792x1024".to_string()));
        assert_eq!(result, Some("2560x1440".to_string()));

        // 1024x1792 (1,835,008 pixels) - portrait, too small, should convert to 9:16
        let result = client.validate_and_convert_size(Some("1024x1792".to_string()));
        assert_eq!(result, Some("1440x2560".to_string()));
    }

    #[test]
    fn test_validate_size_handles_invalid_input() {
        let config = ProviderConfig {
            id: "volcengine".to_string(),
            name: "Volcengine".to_string(),
            protocol: crate::llm::types::ProtocolType::OpenAiCompatible,
            base_url: "https://ark.cn-beijing.volces.com/api/v3".to_string(),
            api_key_name: "VOLCENGINE_API_KEY".to_string(),
            supports_oauth: false,
            supports_coding_plan: false,
            supports_international: false,
            coding_plan_base_url: None,
            international_base_url: None,
            headers: None,
            extra_body: None,
            auth_type: crate::llm::types::AuthType::Bearer,
        };
        let client = VolcengineImageClient::new(config);

        // Invalid format like "2K"
        let result = client.validate_and_convert_size(Some("2K".to_string()));
        assert_eq!(result, Some("2560x1440".to_string()));

        // None input
        let result = client.validate_and_convert_size(None);
        assert_eq!(result, None);

        // Non-numeric dimensions
        let result = client.validate_and_convert_size(Some("abcxyz".to_string()));
        assert_eq!(result, Some("2560x1440".to_string()));
    }

    #[test]
    fn test_validate_size_preserves_aspect_ratio() {
        let config = ProviderConfig {
            id: "volcengine".to_string(),
            name: "Volcengine".to_string(),
            protocol: crate::llm::types::ProtocolType::OpenAiCompatible,
            base_url: "https://ark.cn-beijing.volces.com/api/v3".to_string(),
            api_key_name: "VOLCENGINE_API_KEY".to_string(),
            supports_oauth: false,
            supports_coding_plan: false,
            supports_international: false,
            coding_plan_base_url: None,
            international_base_url: None,
            headers: None,
            extra_body: None,
            auth_type: crate::llm::types::AuthType::Bearer,
        };
        let client = VolcengineImageClient::new(config);

        // Wide landscape (21:9 approx)
        let result = client.validate_and_convert_size(Some("1920x823".to_string()));
        assert_eq!(result, Some("2560x1440".to_string()));

        // Tall portrait
        let result = client.validate_and_convert_size(Some("823x1920".to_string()));
        assert_eq!(result, Some("1440x2560".to_string()));

        // Square-ish
        let result = client.validate_and_convert_size(Some("1024x1024".to_string()));
        assert_eq!(result, Some("1920x1920".to_string()));
    }
}
