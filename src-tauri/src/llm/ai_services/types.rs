use serde::{Deserialize, Serialize};

// Completion Service Types
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompletionContext {
    #[serde(rename = "fileContent")]
    pub file_content: String,
    #[serde(rename = "cursorPosition")]
    pub cursor_position: usize,
    #[serde(rename = "fileName")]
    pub file_name: String,
    pub language: String,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompletionResult {
    pub completion: String,
    pub range: Option<CompletionRange>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompletionRange {
    #[serde(rename = "startLineNumber")]
    pub start_line_number: u32,
    #[serde(rename = "startColumn")]
    pub start_column: u32,
    #[serde(rename = "endLineNumber")]
    pub end_line_number: u32,
    #[serde(rename = "endColumn")]
    pub end_column: u32,
}

// Context Compaction Service Types
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextCompactionRequest {
    #[serde(rename = "conversationHistory")]
    pub conversation_history: String,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextCompactionResult {
    #[serde(rename = "compressedSummary")]
    pub compressed_summary: String,
}

// Git Message Service Types
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitMessageContext {
    #[serde(rename = "userInput")]
    pub user_input: Option<String>,
    #[serde(rename = "diffText")]
    pub diff_text: String,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitMessageResult {
    pub message: String,
    pub suggestions: Option<Vec<String>>,
}

// Pricing Service Types
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenUsage {
    #[serde(rename = "inputTokens")]
    pub input_tokens: u32,
    #[serde(rename = "outputTokens")]
    pub output_tokens: u32,
    #[serde(rename = "cachedInputTokens")]
    pub cached_input_tokens: Option<u32>,
    #[serde(rename = "cacheCreationInputTokens")]
    pub cache_creation_input_tokens: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalculateCostRequest {
    #[serde(rename = "modelId")]
    pub model_id: String,
    pub usage: TokenUsage,
    #[serde(rename = "modelConfigs")]
    pub model_configs: std::collections::HashMap<String, crate::llm::types::ModelConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalculateCostResult {
    pub cost: f64,
}

// Task Title Service Types
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TitleGenerationRequest {
    #[serde(rename = "userInput")]
    pub user_input: String,
    pub language: Option<String>,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TitleGenerationResult {
    pub title: String,
}

// Prompt Enhancement Service Types
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptEnhancementRequest {
    #[serde(rename = "originalPrompt")]
    pub original_prompt: String,
    #[serde(rename = "projectPath")]
    pub project_path: Option<String>,
    #[serde(rename = "conversationHistory")]
    pub conversation_history: Option<String>,
    #[serde(rename = "enableContextExtraction")]
    pub enable_context_extraction: bool,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptEnhancementResult {
    #[serde(rename = "enhancedPrompt")]
    pub enhanced_prompt: String,
    #[serde(rename = "extractedKeywords")]
    pub extracted_keywords: Vec<String>,
    #[serde(rename = "generatedQueries")]
    pub generated_queries: Vec<String>,
    #[serde(rename = "contextSnippetCount")]
    pub context_snippet_count: u32,
}

// Model Fallback Types
#[derive(Debug, Clone)]
pub struct ModelFallbackInfo {
    pub model_key: String,
    pub provider_id: String,
    pub context_length: u32,
    pub input_price: f64,
}

// Error Types
#[derive(Debug, Clone)]
pub enum AiServiceError {
    EmptyConversationHistory,
    EmptyDiffText,
    EmptyUserInput,
    NoAvailableModel,
    CompressionTimeout(u64),
    ModelPricingNotFound(String),
    StreamingError(String),
    InvalidModelIdentifier(String),
    Other(String),
}

impl std::fmt::Display for AiServiceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::EmptyConversationHistory => write!(f, "No conversation history provided"),
            Self::EmptyDiffText => write!(f, "No diff text provided"),
            Self::EmptyUserInput => write!(f, "No user input provided"),
            Self::NoAvailableModel => write!(f, "No available model for the requested operation"),
            Self::CompressionTimeout(ms) => write!(f, "Compression timeout after {}ms", ms),
            Self::ModelPricingNotFound(id) => write!(f, "Model pricing not found: {}", id),
            Self::StreamingError(msg) => write!(f, "Streaming error: {}", msg),
            Self::InvalidModelIdentifier(id) => write!(f, "Invalid model identifier: {}", id),
            Self::Other(msg) => write!(f, "{}", msg),
        }
    }
}

impl std::error::Error for AiServiceError {}

impl Serialize for AiServiceError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}
