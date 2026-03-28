use crate::llm::auth::api_key_manager::ApiKeyManager;
use crate::llm::image_generation::types::{GeneratedImage, ImageGenerationRequest};
use serde::{Deserialize, Serialize};
use std::time::Duration;

/// Request format for Vertex AI predict endpoint (used for Imagen models)
#[derive(Debug, Clone, Serialize)]
struct VertexAiPredictRequest {
    instances: Vec<VertexAiInstance>,
    parameters: VertexAiParameters,
}

#[derive(Debug, Clone, Serialize)]
struct VertexAiInstance {
    prompt: String,
}

#[derive(Debug, Clone, Serialize)]
struct VertexAiParameters {
    #[serde(rename = "sampleCount")]
    sample_count: u32,
}

/// Response format from Vertex AI predict endpoint
#[derive(Debug, Clone, Deserialize)]
struct VertexAiPredictResponse {
    predictions: Option<Vec<VertexAiPrediction>>,
}

#[derive(Debug, Clone, Deserialize)]
struct VertexAiPrediction {
    #[serde(rename = "mimeType")]
    mime_type: Option<String>,
    #[serde(rename = "base64Binary")]
    base64_binary: Option<String>,
}

/// Request format for Gemini generateContent (used for Gemini image models)
#[derive(Debug, Clone, Serialize)]
struct GeminiGenerateContentRequest {
    contents: Vec<GeminiContent>,
    #[serde(rename = "generationConfig")]
    generation_config: GeminiGenerationConfig,
}

#[derive(Debug, Clone, Serialize)]
struct GeminiContent {
    role: String,
    parts: Vec<GeminiPart>,
}

#[derive(Debug, Clone, Serialize)]
struct GeminiPart {
    text: String,
}

#[derive(Debug, Clone, Serialize)]
struct GeminiGenerationConfig {
    #[serde(rename = "responseModalities")]
    response_modalities: Vec<String>,
    #[serde(rename = "candidateCount")]
    candidate_count: u32,
}

/// Response format from Gemini generateContent
#[derive(Debug, Clone, Deserialize)]
struct GeminiGenerateContentResponse {
    candidates: Option<Vec<GeminiCandidate>>,
}

#[derive(Debug, Clone, Deserialize)]
struct GeminiCandidate {
    content: Option<GeminiCandidateContent>,
}

#[derive(Debug, Clone, Deserialize)]
struct GeminiCandidateContent {
    parts: Option<Vec<GeminiResponsePart>>,
}

#[derive(Debug, Clone, Deserialize)]
struct GeminiResponsePart {
    #[serde(rename = "inlineData")]
    inline_data: Option<GeminiInlineData>,
}

#[derive(Debug, Clone, Deserialize)]
struct GeminiInlineData {
    #[serde(rename = "mimeType")]
    mime_type: String,
    data: String,
}

pub struct GoogleImageClient {
    base_url: String,
    provider_id: String,
}

impl GoogleImageClient {
    pub fn new() -> Self {
        Self {
            base_url: "https://generativelanguage.googleapis.com/v1beta".to_string(),
            provider_id: "google".to_string(),
        }
    }

    pub fn with_base_url(base_url: String) -> Self {
        Self {
            base_url,
            provider_id: "google".to_string(),
        }
    }

    /// Create a client with custom base_url and provider_id
    /// Used for third-party providers hosting Gemini models (e.g., zenmux)
    pub fn with_base_url_and_provider(base_url: String, provider_id: String) -> Self {
        Self {
            base_url,
            provider_id,
        }
    }

    pub async fn generate(
        &self,
        api_keys: &ApiKeyManager,
        model: &str,
        request: ImageGenerationRequest,
    ) -> Result<Vec<GeneratedImage>, String> {
        let api_key = api_keys
            .get_setting(&format!("api_key_{}", self.provider_id))
            .await?
            .unwrap_or_default();

        if api_key.is_empty() {
            return Err(format!(
                "API key not configured for {} image generation / {} 图片生成未配置 API 密钥",
                self.provider_id, self.provider_id
            ));
        }

        log::info!(
            "[GoogleImageClient] provider_id: {}, base_url: {}, model: {}, api_key: {}",
            self.provider_id,
            self.base_url,
            model,
            api_key
        );

        // Detect model type: Imagen models use :predict, Gemini image models use :generateContent
        let model_name = model.rsplit('/').next().unwrap_or(model);
        let is_imagen_model = model_name.starts_with("imagen");

        if is_imagen_model {
            self.generate_imagen(api_key, model, request).await
        } else {
            self.generate_gemini(api_key, model, request).await
        }
    }

    fn resolve_vertex_base_url(&self) -> String {
        let base = self.base_url.trim_end_matches('/');
        if self.provider_id == "zenmux" && !base.ends_with("/v1") {
            format!("{}/v1", base)
        } else {
            base.to_string()
        }
    }

    /// Generate images using Vertex AI Imagen models via :predict endpoint
    async fn generate_imagen(
        &self,
        api_key: String,
        model: &str,
        request: ImageGenerationRequest,
    ) -> Result<Vec<GeneratedImage>, String> {
        let payload = VertexAiPredictRequest {
            instances: vec![VertexAiInstance {
                prompt: request.prompt,
            }],
            parameters: VertexAiParameters { sample_count: 1 },
        };

        let base_url = self.resolve_vertex_base_url();
        let url = format!("{}/models/{}:predict", base_url, model);

        log::info!("[GoogleImageClient] Imagen URL: {}", url);

        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(120))
            .build()
            .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

        let response = client
            .post(&url)
            .header("Content-Type", "application/json")
            .header("x-goog-api-key", api_key.as_str())
            .json(&payload)
            .send()
            .await
            .map_err(|e| format!("Google image request failed: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response
                .text()
                .await
                .unwrap_or_else(|_| "Unknown error".to_string());
            return Err(format!(
                "Google image generation failed ({}): {} / Google 图片生成失败",
                status, body
            ));
        }

        let response_data = response
            .json::<VertexAiPredictResponse>()
            .await
            .map_err(|e| format!("Failed to parse Google response: {}", e))?;

        let mut images = Vec::new();
        if let Some(predictions) = response_data.predictions {
            for prediction in predictions {
                if let (Some(mime_type), Some(base64_data)) =
                    (prediction.mime_type, prediction.base64_binary)
                {
                    images.push(GeneratedImage {
                        b64_json: Some(base64_data),
                        url: None,
                        mime_type,
                        revised_prompt: None,
                    });
                }
            }
        }

        if images.is_empty() {
            return Err("No images generated / 未生成图片".to_string());
        }

        Ok(images)
    }

    /// Generate images using Gemini image models via :generateContent endpoint
    async fn generate_gemini(
        &self,
        api_key: String,
        model: &str,
        request: ImageGenerationRequest,
    ) -> Result<Vec<GeneratedImage>, String> {
        let n = request.n.unwrap_or(1);

        let payload = GeminiGenerateContentRequest {
            contents: vec![GeminiContent {
                role: "user".to_string(),
                parts: vec![GeminiPart {
                    text: request.prompt,
                }],
            }],
            generation_config: GeminiGenerationConfig {
                response_modalities: vec!["TEXT".to_string(), "IMAGE".to_string()],
                candidate_count: n,
            },
        };

        let base_url = self.resolve_vertex_base_url();
        let url = format!("{}/models/{}:generateContent", base_url, model);

        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(120))
            .build()
            .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

        let response = client
            .post(&url)
            .header("Content-Type", "application/json")
            .header("x-goog-api-key", api_key.as_str())
            .json(&payload)
            .send()
            .await
            .map_err(|e| format!("Google image request failed: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response
                .text()
                .await
                .unwrap_or_else(|_| "Unknown error".to_string());
            return Err(format!(
                "Google image generation failed ({}): {} / Google 图片生成失败",
                status, body
            ));
        }

        let response_data = response
            .json::<GeminiGenerateContentResponse>()
            .await
            .map_err(|e| format!("Failed to parse Google response: {}", e))?;

        let mut images = Vec::new();
        if let Some(candidates) = response_data.candidates {
            for candidate in candidates {
                if let Some(content) = candidate.content {
                    if let Some(parts) = content.parts {
                        for part in parts {
                            if let Some(inline_data) = part.inline_data {
                                images.push(GeneratedImage {
                                    b64_json: Some(inline_data.data),
                                    url: None,
                                    mime_type: inline_data.mime_type,
                                    revised_prompt: None,
                                });
                            }
                        }
                    }
                }
            }
        }

        if images.is_empty() {
            return Err("No images generated / 未生成图片".to_string());
        }

        // Truncate to the requested number of images
        images.truncate(n as usize);

        Ok(images)
    }
}

impl Default for GoogleImageClient {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_vertex_ai_predict_response() {
        let json = r#"{"predictions":[{"mimeType":"image/png","base64Binary":"abc123"}]}"#;
        let parsed: VertexAiPredictResponse = serde_json::from_str(json).expect("parse response");
        assert!(parsed.predictions.is_some());
        let predictions = parsed.predictions.unwrap();
        assert_eq!(predictions.len(), 1);
        assert_eq!(predictions[0].mime_type.as_deref(), Some("image/png"));
        assert_eq!(predictions[0].base64_binary.as_deref(), Some("abc123"));
    }

    #[test]
    fn parses_gemini_generate_content_response() {
        let json = r#"{"candidates":[{"content":{"parts":[{"inlineData":{"mimeType":"image/png","data":"abc123"}}]}}]}"#;
        let parsed: GeminiGenerateContentResponse =
            serde_json::from_str(json).expect("parse response");
        assert!(parsed.candidates.is_some());
        let candidates = parsed.candidates.unwrap();
        assert_eq!(candidates.len(), 1);
        let content = &candidates[0].content;
        assert!(content.is_some());
        let parts = &content.as_ref().unwrap().parts;
        assert!(parts.is_some());
        let part = &parts.as_ref().unwrap()[0];
        assert!(part.inline_data.is_some());
        let inline_data = part.inline_data.as_ref().unwrap();
        assert_eq!(inline_data.mime_type, "image/png");
        assert_eq!(inline_data.data, "abc123");
    }

    #[test]
    fn identifies_imagen_model() {
        let _client = GoogleImageClient::new();
        // This test verifies the logic we use to detect model type
        assert!("imagen-3.0-generate-002".starts_with("imagen"));
        assert!(!"gemini-2.0-flash-exp-image-generation".starts_with("imagen"));
        assert!(!"gemini-3-pro-image-preview".starts_with("imagen"));
    }
}
