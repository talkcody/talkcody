use crate::llm::ai_services::model_resolver::{resolve_model_identifier, FallbackStrategy};
use crate::llm::ai_services::stream_collector::StreamCollector;
use crate::llm::ai_services::stream_runner::StreamRunner;
use crate::llm::ai_services::types::{PromptEnhancementRequest, PromptEnhancementResult};
use crate::llm::auth::api_key_manager::ApiKeyManager;
use crate::llm::providers::provider_registry::ProviderRegistry;
use crate::search::RipgrepSearch;
use regex::Regex;
use std::collections::HashSet;
use std::time::Duration;

/// Maximum number of context snippets to include
const MAX_CONTEXT_SNIPPETS: usize = 20;
/// Maximum total character budget for context
const MAX_CONTEXT_CHARS: usize = 8000;
/// Maximum number of search queries to generate
const MAX_SEARCH_QUERIES: usize = 3;

/// Technical abbreviations commonly found in coding contexts
const TECH_ABBREVIATIONS: &[&str] = &[
    "API", "UI", "JWT", "HTTP", "REST", "SQL", "ORM", "CLI", "CSS", "HTML", "SDK", "IDE", "CI",
    "CD", "MVC", "MVP", "DNS", "TCP", "UDP", "SSH", "TLS", "SSL", "CORS", "CRUD", "DOM", "AJAX",
    "JSON", "XML", "YAML", "CSV", "PNG", "SVG", "WASM", "AWS", "GCP", "GPU", "CPU", "RAM", "SSD",
    "FIFO", "LIFO",
];

/// Chinese technical keywords
const CHINESE_TECH_WORDS: &[&str] = &[
    "重构",
    "解耦",
    "并发",
    "异步",
    "缓存",
    "事务",
    "索引",
    "幂等",
    "微服务",
    "中间件",
    "消息队列",
    "负载均衡",
    "容器化",
    "序列化",
    "反序列化",
];

const SYSTEM_PROMPT_TEMPLATE: &str = r#"You are a prompt enhancement expert. Your task is to optimize and expand the user's prompt for better AI coding assistance.

## Context from codebase:
${context}

## Instructions:
1. Analyze the original prompt and understand the user's intent
2. Use the provided context snippets to make the prompt more specific
3. Add relevant technical details, file references, and code patterns from the context
4. Maintain the original intent while making it clearer and more actionable
5. Output ONLY the enhanced prompt text, no explanations or metadata
6. Keep the language consistent with the original prompt (if Chinese, respond in Chinese)"#;

pub struct PromptEnhancementService;

impl PromptEnhancementService {
    pub fn new() -> Self {
        Self
    }

    /// Enhance a user prompt with codebase context and LLM optimization
    pub async fn enhance_prompt(
        &self,
        request: PromptEnhancementRequest,
        api_keys: &ApiKeyManager,
        registry: &ProviderRegistry,
    ) -> Result<PromptEnhancementResult, String> {
        log::info!(
            "enhancePrompt: originalPrompt length = {}",
            request.original_prompt.len()
        );

        if request.original_prompt.trim().is_empty() {
            log::error!("No original prompt provided for enhancement");
            return Err("No original prompt provided".to_string());
        }

        // Step 1: Extract keywords from original prompt + conversation history
        let mut keywords = extract_keywords(&request.original_prompt);
        if let Some(ref history) = request.conversation_history {
            let history_keywords = extract_keywords(history);
            keywords.extend(history_keywords);
        }
        let keywords: Vec<String> = keywords.into_iter().collect();

        log::info!("Extracted {} keywords", keywords.len());

        // Step 2: Generate search queries
        let mut queries = generate_queries(&keywords);
        if let Some(ref history) = request.conversation_history {
            let file_paths = extract_file_paths(history);
            let func_names = extract_function_names(history);
            for path in file_paths.iter().take(MAX_SEARCH_QUERIES) {
                queries.push(path.clone());
            }
            for name in func_names.iter().take(MAX_SEARCH_QUERIES) {
                queries.push(name.clone());
            }
        }
        queries.truncate(MAX_SEARCH_QUERIES);

        log::info!("Generated {} search queries", queries.len());

        // Step 3: Search codebase if enabled
        let mut context_snippets: Vec<String> = Vec::new();
        if request.enable_context_extraction {
            if let Some(ref project_path) = request.project_path {
                context_snippets = search_codebase(project_path, &queries);
                log::info!("Found {} context snippets", context_snippets.len());
            }
        }

        let context_snippet_count = context_snippets.len() as u32;

        // Step 4: Build prompts
        let context_text = if context_snippets.is_empty() {
            "No context available.".to_string()
        } else {
            context_snippets.join("\n\n")
        };

        let system_prompt = build_system_prompt(&context_text);
        let user_prompt = request.original_prompt.clone();

        // Step 5: Call LLM
        let preferred_model = request.model.clone();
        let model_identifier = resolve_model_identifier(
            api_keys,
            registry,
            preferred_model,
            FallbackStrategy::AnyAvailable,
        )
        .await?;

        let full_prompt = format!(
            "{}\n\nUser prompt to enhance:\n{}",
            system_prompt, user_prompt
        );
        let llm_request = StreamCollector::create_completion_request(model_identifier, full_prompt);

        let runner = StreamRunner::new(registry.clone(), api_keys.clone());
        let result =
            StreamCollector::collect_with_runner(&runner, llm_request, Duration::from_secs(60))
                .await?;

        let enhanced_prompt = result.text.trim().to_string();
        if enhanced_prompt.is_empty() {
            return Err("Empty enhanced prompt generated".to_string());
        }

        Ok(PromptEnhancementResult {
            enhanced_prompt,
            extracted_keywords: keywords,
            generated_queries: queries,
            context_snippet_count,
        })
    }
}

impl Default for PromptEnhancementService {
    fn default() -> Self {
        Self::new()
    }
}

/// Extract technical keywords from text using multiple strategies
fn extract_keywords(text: &str) -> HashSet<String> {
    let mut keywords = HashSet::new();

    // Extract camelCase identifiers
    if let Ok(re) = Regex::new(r"\b[a-z]+(?:[A-Z][a-z0-9]+)+\b") {
        for cap in re.find_iter(text) {
            keywords.insert(cap.as_str().to_string());
        }
    }

    // Extract snake_case identifiers
    if let Ok(re) = Regex::new(r"\b[a-z]+(?:_[a-z0-9]+)+\b") {
        for cap in re.find_iter(text) {
            keywords.insert(cap.as_str().to_string());
        }
    }

    // Match technical abbreviations (case-insensitive word boundary match)
    let upper_text = text.to_uppercase();
    for abbr in TECH_ABBREVIATIONS {
        // Check if the abbreviation appears as a standalone word
        let pattern = format!(r"\b{}\b", regex::escape(abbr));
        if let Ok(re) = Regex::new(&pattern) {
            if re.is_match(&upper_text) {
                keywords.insert(abbr.to_string());
            }
        }
    }

    // Match Chinese technical words
    for word in CHINESE_TECH_WORDS {
        if text.contains(word) {
            keywords.insert(word.to_string());
        }
    }

    keywords
}

/// Extract file paths from conversation history
fn extract_file_paths(text: &str) -> Vec<String> {
    let mut paths = HashSet::new();

    // Match common file path patterns (both Unix and Windows)
    if let Ok(re) = Regex::new(r"(?:[a-zA-Z]:\\|/)?(?:[\w\-\.]+[/\\])+[\w\-\.]+\.\w+") {
        for cap in re.find_iter(text) {
            let path = cap.as_str().to_string();
            // Filter out very short matches and common false positives
            if path.len() > 3 {
                paths.insert(path);
            }
        }
    }

    paths.into_iter().collect()
}

/// Extract function names from conversation history
fn extract_function_names(text: &str) -> Vec<String> {
    let mut names = HashSet::new();

    // Match function declarations: fn name, function name, def name, func name
    if let Ok(re) = Regex::new(
        r"\b(?:fn|function|def|func|pub fn|async fn|pub async fn)\s+([a-zA-Z_][a-zA-Z0-9_]*)",
    ) {
        for cap in re.captures_iter(text) {
            if let Some(name) = cap.get(1) {
                names.insert(name.as_str().to_string());
            }
        }
    }

    // Match method calls: .methodName(
    if let Ok(re) = Regex::new(r"\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\(") {
        for cap in re.captures_iter(text) {
            if let Some(name) = cap.get(1) {
                let n = name.as_str();
                // Skip very common methods to avoid noise
                if n.len() > 2 {
                    names.insert(n.to_string());
                }
            }
        }
    }

    names.into_iter().collect()
}

/// Generate search queries from extracted keywords
fn generate_queries(keywords: &[String]) -> Vec<String> {
    let mut queries: Vec<String> = Vec::new();

    for keyword in keywords.iter().take(MAX_SEARCH_QUERIES) {
        queries.push(keyword.clone());
    }

    queries
}

/// Search codebase using RipgrepSearch and return deduplicated, truncated context snippets
fn search_codebase(project_path: &str, queries: &[String]) -> Vec<String> {
    let searcher = RipgrepSearch::new()
        .with_max_results(20)
        .with_max_matches_per_file(3)
        .with_exclude_dirs(Some(vec![
            "node_modules".to_string(),
            "target".to_string(),
            "dist".to_string(),
            "build".to_string(),
            ".git".to_string(),
            ".idea".to_string(),
            ".vscode".to_string(),
        ]));

    let mut seen_snippets: HashSet<String> = HashSet::new();
    let mut snippets: Vec<String> = Vec::new();
    let mut total_chars: usize = 0;

    for query in queries {
        if snippets.len() >= MAX_CONTEXT_SNIPPETS || total_chars >= MAX_CONTEXT_CHARS {
            break;
        }

        match searcher.search_content(query, project_path) {
            Ok(results) => {
                for result in results {
                    if snippets.len() >= MAX_CONTEXT_SNIPPETS || total_chars >= MAX_CONTEXT_CHARS {
                        break;
                    }

                    for search_match in &result.matches {
                        if snippets.len() >= MAX_CONTEXT_SNIPPETS
                            || total_chars >= MAX_CONTEXT_CHARS
                        {
                            break;
                        }

                        let snippet = format!(
                            "// File: {}, Line {}\n{}",
                            result.file_path, search_match.line_number, search_match.line_content
                        );

                        // Deduplicate by content
                        if seen_snippets.contains(&snippet) {
                            continue;
                        }

                        let snippet_len = snippet.len();
                        if total_chars + snippet_len > MAX_CONTEXT_CHARS {
                            break;
                        }

                        seen_snippets.insert(snippet.clone());
                        total_chars += snippet_len;
                        snippets.push(snippet);
                    }
                }
            }
            Err(e) => {
                log::warn!("Search error for query '{}': {}", query, e);
            }
        }
    }

    snippets
}

/// Build the system prompt by injecting context into the template
fn build_system_prompt(context: &str) -> String {
    SYSTEM_PROMPT_TEMPLATE.replace("${context}", context)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_camel_case_keywords() {
        let text = "We need to fix the getUserProfile and updateUserSettings functions";
        let keywords = extract_keywords(text);
        assert!(
            keywords.contains("getUserProfile"),
            "Should extract getUserProfile"
        );
        assert!(
            keywords.contains("updateUserSettings"),
            "Should extract updateUserSettings"
        );
    }

    #[test]
    fn extract_snake_case_keywords() {
        let text = "The get_user_profile and update_user_settings functions need refactoring";
        let keywords = extract_keywords(text);
        assert!(
            keywords.contains("get_user_profile"),
            "Should extract get_user_profile"
        );
        assert!(
            keywords.contains("update_user_settings"),
            "Should extract update_user_settings"
        );
    }

    #[test]
    fn extract_abbreviation_keywords() {
        let text = "We need to add JWT authentication to the REST API";
        let keywords = extract_keywords(text);
        assert!(keywords.contains("JWT"), "Should extract JWT");
        assert!(keywords.contains("REST"), "Should extract REST");
        assert!(keywords.contains("API"), "Should extract API");
    }

    #[test]
    fn extract_abbreviation_case_insensitive() {
        let text = "The api endpoint uses jwt tokens";
        let keywords = extract_keywords(text);
        assert!(
            keywords.contains("API"),
            "Should extract API case-insensitively"
        );
        assert!(
            keywords.contains("JWT"),
            "Should extract JWT case-insensitively"
        );
    }

    #[test]
    fn extract_chinese_tech_keywords() {
        let text = "我们需要对这个模块进行重构，同时解耦组件之间的依赖关系，并添加缓存层";
        let keywords = extract_keywords(text);
        assert!(keywords.contains("重构"), "Should extract 重构");
        assert!(keywords.contains("解耦"), "Should extract 解耦");
        assert!(keywords.contains("缓存"), "Should extract 缓存");
    }

    #[test]
    fn extract_chinese_multi_char_keywords() {
        let text = "实现微服务架构中的消息队列和负载均衡";
        let keywords = extract_keywords(text);
        assert!(keywords.contains("微服务"), "Should extract 微服务");
        assert!(keywords.contains("消息队列"), "Should extract 消息队列");
        assert!(keywords.contains("负载均衡"), "Should extract 负载均衡");
    }

    #[test]
    fn extract_file_paths_from_history() {
        let text = "Check the file src/components/UserProfile.tsx and also src/hooks/use-auth.ts";
        let paths = extract_file_paths(text);
        assert!(
            paths.iter().any(|p| p.contains("UserProfile.tsx")),
            "Should extract UserProfile.tsx path, got: {:?}",
            paths
        );
        assert!(
            paths.iter().any(|p| p.contains("use-auth.ts")),
            "Should extract use-auth.ts path, got: {:?}",
            paths
        );
    }

    #[test]
    fn extract_file_paths_windows_style() {
        let text = r"Look at src\components\Button.tsx for reference";
        let paths = extract_file_paths(text);
        assert!(
            paths.iter().any(|p| p.contains("Button.tsx")),
            "Should extract Windows-style path, got: {:?}",
            paths
        );
    }

    #[test]
    fn extract_function_names_rust() {
        let text = "fn get_user() and pub fn update_profile() and async fn fetch_data()";
        let names = extract_function_names(text);
        assert!(
            names.contains(&"get_user".to_string()),
            "Should extract get_user, got: {:?}",
            names
        );
        assert!(
            names.contains(&"update_profile".to_string()),
            "Should extract update_profile, got: {:?}",
            names
        );
        assert!(
            names.contains(&"fetch_data".to_string()),
            "Should extract fetch_data, got: {:?}",
            names
        );
    }

    #[test]
    fn extract_function_names_javascript() {
        let text = "function handleSubmit() and def process_data() in the module";
        let names = extract_function_names(text);
        assert!(
            names.contains(&"handleSubmit".to_string()),
            "Should extract handleSubmit, got: {:?}",
            names
        );
        assert!(
            names.contains(&"process_data".to_string()),
            "Should extract process_data, got: {:?}",
            names
        );
    }

    #[test]
    fn system_prompt_context_replacement() {
        let context = "// File: src/main.rs, Line 1\nfn main() {}";
        let prompt = build_system_prompt(context);
        assert!(
            prompt.contains(context),
            "System prompt should contain the injected context"
        );
        assert!(
            !prompt.contains("${context}"),
            "System prompt should not contain the placeholder"
        );
        assert!(
            prompt.contains("prompt enhancement expert"),
            "System prompt should contain the role description"
        );
    }

    #[test]
    fn system_prompt_empty_context() {
        let prompt = build_system_prompt("No context available.");
        assert!(
            prompt.contains("No context available."),
            "Should handle empty context gracefully"
        );
        assert!(!prompt.contains("${context}"));
    }

    #[test]
    fn generate_queries_from_keywords() {
        let keywords = vec![
            "getUserProfile".to_string(),
            "API".to_string(),
            "重构".to_string(),
            "extra_keyword".to_string(),
        ];
        let queries = generate_queries(&keywords);
        assert!(
            queries.len() <= MAX_SEARCH_QUERIES,
            "Should generate at most {} queries",
            MAX_SEARCH_QUERIES
        );
        assert!(!queries.is_empty(), "Should generate at least one query");
    }

    #[test]
    fn generate_queries_empty_keywords() {
        let keywords: Vec<String> = Vec::new();
        let queries = generate_queries(&keywords);
        assert!(
            queries.is_empty(),
            "Should return empty queries for empty keywords"
        );
    }

    #[test]
    fn extract_keywords_empty_text() {
        let keywords = extract_keywords("");
        assert!(
            keywords.is_empty(),
            "Should return empty keywords for empty text"
        );
    }

    #[test]
    fn extract_keywords_no_technical_terms() {
        let keywords = extract_keywords("hello world this is a simple sentence");
        // Should not match any camelCase, snake_case, abbreviations, or Chinese tech words
        assert!(
            keywords.is_empty(),
            "Should return empty for non-technical text, got: {:?}",
            keywords
        );
    }

    #[test]
    fn extract_keywords_mixed_content() {
        let text =
            "Fix the getUserData API endpoint and add 缓存 for better performance with http_client";
        let keywords = extract_keywords(text);
        assert!(keywords.contains("getUserData"), "Should extract camelCase");
        assert!(keywords.contains("API"), "Should extract abbreviation");
        assert!(
            keywords.contains("缓存"),
            "Should extract Chinese tech word"
        );
        assert!(
            keywords.contains("http_client"),
            "Should extract snake_case"
        );
    }
}
