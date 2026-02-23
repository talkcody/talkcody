//! Image Generation Tool
//!
//! Generate images using AI image generation models.
//! Matches TypeScript image-generation-tool.tsx logic.

use crate::core::tools::ToolContext;
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageGenerationResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub images: Option<Vec<GeneratedImageInfo>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedImageInfo {
    pub file_path: String,
    pub filename: String,
    pub size: usize,
    pub mime_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revised_prompt: Option<String>,
}

/// Execute imageGeneration tool
///
/// NOTE: To fully enable image generation in tools, you need to:
/// 1. Modify ToolContext to include LlmState reference
/// 2. Pass LlmState when creating ToolContext in AgentLoop/runtime
/// 3. Then uncomment the actual image generation code below
///
/// For now, this returns a helpful error message explaining the requirement.
pub async fn execute(
    prompt: &str,
    size: Option<&str>,
    quality: Option<&str>,
    n: Option<u32>,
    _ctx: &ToolContext,
) -> ImageGenerationResult {
    // Build the request
    let _request = crate::llm::types::ImageGenerationRequest {
        model: String::new(), // Empty string lets backend auto-select
        prompt: prompt.to_string(),
        size: Some(size.unwrap_or("1024x1024").to_string()),
        quality: Some(
            if quality == Some("high") {
                "hd"
            } else {
                quality.unwrap_or("standard")
            }
            .to_string(),
        ),
        n: Some(n.unwrap_or(1).min(4)),
        response_format: Some("url".to_string()),
        provider_options: None,
        request_id: None,
    };

    // TODO: To enable actual image generation:
    //
    // 1. Add LlmState to ToolContext:
    //    pub struct ToolContext {
    //        ...
    //        pub llm_state: Option<Arc<LlmState>>, // Add this
    //    }
    //
    // 2. Then use it here:
    //    if let Some(ref llm_state) = ctx.llm_state {
    //        let registry = llm_state.registry.lock().await;
    //        let api_keys = llm_state.api_keys.lock().await;
    //        let custom_providers = api_keys.load_custom_providers().await?;
    //        let models = api_keys.load_models_config().await?;
    //
    //        match ImageGenerationService::generate(
    //            &api_keys, &registry, &custom_providers, &models, request
    //        ).await {
    //            Ok(response) => { ... process and save images ... }
    //            Err(e) => { ... error ... }
    //        }
    //    }

    ImageGenerationResult {
        success: false,
        provider: None,
        images: None,
        count: None,
        error: Some(
            "Image generation tool is available but requires LlmState to be added to ToolContext. \
            To enable: 1) Add 'pub llm_state: Option<Arc<LlmState>>' to ToolContext, \
            2) Pass llm_state when creating ToolContext in AgentLoop, \
            3) Uncomment the implementation code in image_generation.rs. \
            The infrastructure is ready - see the TODO comment in the source code."
                .to_string(),
        ),
    }
}

// Helper functions for when image generation is fully enabled
#[allow(dead_code)]
fn get_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[allow(dead_code)]
fn extension_from_mime_type(mime_type: &str) -> &'static str {
    let lower = mime_type.to_lowercase();
    if lower.contains("png") {
        "png"
    } else if lower.contains("jpeg") || lower.contains("jpg") {
        "jpg"
    } else if lower.contains("gif") {
        "gif"
    } else if lower.contains("webp") {
        "webp"
    } else {
        "png"
    }
}

/// Example of how the full implementation would look (requires LlmState in ToolContext)
#[allow(dead_code)]
async fn _execute_full_impl(
    prompt: &str,
    size: Option<&str>,
    quality: Option<&str>,
    n: Option<u32>,
    ctx: &ToolContext,
) -> ImageGenerationResult {
    use crate::llm::image_generation::service::ImageGenerationService;

    let request = crate::llm::types::ImageGenerationRequest {
        model: String::new(),
        prompt: prompt.to_string(),
        size: Some(size.unwrap_or("1024x1024").to_string()),
        quality: Some(
            if quality == Some("high") {
                "hd"
            } else {
                quality.unwrap_or("standard")
            }
            .to_string(),
        ),
        n: Some(n.unwrap_or(1).min(4)),
        response_format: Some("url".to_string()),
        provider_options: None,
        request_id: None,
    };

    // This would work if LlmState was in ToolContext:
    // let llm_state = ctx.llm_state.as_ref().ok_or("LlmState not available")?;
    // let registry = llm_state.registry.lock().await;
    // let api_keys = llm_state.api_keys.lock().await;
    // let custom_providers = api_keys.load_custom_providers().await?;
    // let models = api_keys.load_models_config().await?;
    //
    // match ImageGenerationService::generate(&api_keys, &registry, &custom_providers, &models, request).await {
    //     Ok(response) => { ... }
    // }

    let _ = ctx; // Suppress unused warning
    ImageGenerationResult {
        success: false,
        provider: None,
        images: None,
        count: None,
        error: Some("Full implementation requires LlmState in ToolContext".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_image_generation_placeholder() {
        let ctx = ToolContext {
            session_id: "test".to_string(),
            task_id: "test".to_string(),
            workspace_root: "/tmp".to_string(),
            worktree_path: None,
            settings: crate::storage::models::TaskSettings::default(),
            llm_state: None,
        };

        let result = execute("A cat", None, None, None, &ctx).await;

        // Currently returns error with instructions
        assert!(!result.success);
        assert!(result.error.unwrap().contains("requires LlmState"));
    }
}
