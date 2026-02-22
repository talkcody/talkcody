use crate::core::tools::ToolContext;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::Duration;

const MAX_INLINE_CONTENT_LENGTH: usize = 10_000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WebFetchResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<String>,
    url: String,
    content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    published_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    file_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    truncated: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    content_length: Option<usize>,
}

#[derive(Debug, Deserialize)]
struct TavilyExtractResponse {
    results: Vec<TavilyExtractItem>,
}

#[derive(Debug, Deserialize)]
struct TavilyExtractItem {
    url: Option<String>,
    raw_content: Option<String>,
}

pub(crate) async fn execute_web_fetch(
    url: &str,
    ctx: &ToolContext,
    tool_call_id: &str,
) -> Result<WebFetchResult, String> {
    let result = fetch_web_content_internal(url).await?;
    handle_large_content(result, ctx, tool_call_id).await
}

fn sanitize_file_name(file_name: &str) -> String {
    let safe_name = if file_name.is_empty() {
        "web-fetch"
    } else {
        file_name
    };
    safe_name
        .replace(['<', '>', ':', '"', '/', '\\', '|', '?', '*'], "_")
        .replace("..", "_")
        .trim()
        .to_string()
}

fn build_large_content_message(file_path: &str, content_length: usize) -> String {
    format!(
        "Content is {} characters and was saved to: {}.\nYou can use shell tools like `grep`, `less`, or `tail` to inspect the file.",
        content_length, file_path
    )
}

fn truncate_content(content: &str) -> String {
    content.chars().take(MAX_INLINE_CONTENT_LENGTH).collect()
}

fn is_safe_task_id(task_id: &str) -> bool {
    !task_id.is_empty()
        && task_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

fn build_tool_output_path(
    workspace_root: &str,
    task_id: &str,
    tool_call_id: &str,
) -> Result<PathBuf, String> {
    if workspace_root.is_empty() {
        return Err("Workspace root is empty".to_string());
    }
    if !is_safe_task_id(task_id) {
        return Err("Invalid task ID".to_string());
    }
    let file_name = sanitize_file_name(&format!("{}_web-fetch.txt", tool_call_id));
    Ok(Path::new(workspace_root)
        .join(".talkcody")
        .join("tool")
        .join(task_id)
        .join(file_name))
}

fn validate_url(url: &str) -> Result<url::Url, String> {
    let parsed = url::Url::parse(url).map_err(|e| format!("Invalid URL provided: {}", e))?;
    match parsed.scheme() {
        "http" | "https" => Ok(parsed),
        _ => Err("Invalid URL provided. URL must start with http or https".to_string()),
    }
}

fn extract_title(html: &str) -> Option<String> {
    let re = Regex::new(r"(?is)<title[^>]*>(.*?)</title>").ok()?;
    let title = re
        .captures(html)
        .and_then(|cap| cap.get(1))
        .map(|m| m.as_str().trim().to_string())?;
    if title.is_empty() {
        None
    } else {
        Some(title)
    }
}

fn decode_basic_html_entities(input: &str) -> String {
    input
        .replace("&nbsp;", " ")
        .replace("&#34;", "\"")
        .replace("&apos;", "'")
        .replace("<", "<")
        .replace(">", ">")
        .replace("&", "&")
}

fn extract_text_from_html(html: &str) -> String {
    let mut text = html.to_string();
    if let Ok(re) = Regex::new(r"(?is)<(script|style)[^>]*>.*?</\1>") {
        text = re.replace_all(&text, " ").into_owned();
    }
    if let Ok(re) = Regex::new(r"(?i)<br\s*/?>") {
        text = re.replace_all(&text, "\n").into_owned();
    }
    if let Ok(re) = Regex::new(r"(?i)</p>") {
        text = re.replace_all(&text, "\n").into_owned();
    }
    if let Ok(re) = Regex::new(r"(?is)<[^>]+>") {
        text = re.replace_all(&text, " ").into_owned();
    }
    let text = decode_basic_html_entities(&text);
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

async fn fetch_with_tavily(url: &str) -> Result<WebFetchResult, String> {
    let api_key = std::env::var("TAVILY_API_KEY")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            std::env::var("VITE_TAVILY_API_KEY")
                .ok()
                .filter(|value| !value.trim().is_empty())
        })
        .ok_or_else(|| "Tavily API key not configured".to_string())?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let response = client
        .post("https://api.tavily.com/extract")
        .header(
            reqwest::header::AUTHORIZATION,
            format!("Bearer {}", api_key),
        )
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .json(&serde_json::json!({
            "urls": [url],
            "include_images": false,
        }))
        .send()
        .await
        .map_err(|e| format!("Tavily fetch failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!(
            "Tavily fetch failed with status code: {} - {}",
            status, text
        ));
    }

    let data: TavilyExtractResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Tavily response: {}", e))?;

    let first = data
        .results
        .into_iter()
        .next()
        .ok_or_else(|| "No results returned from Tavily API".to_string())?;

    Ok(WebFetchResult {
        title: None,
        url: first.url.unwrap_or_else(|| url.to_string()),
        content: first.raw_content.unwrap_or_default(),
        published_date: None,
        file_path: None,
        truncated: None,
        content_length: None,
    })
}

async fn fetch_web_content_internal(url: &str) -> Result<WebFetchResult, String> {
    let _parsed = validate_url(url)?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let response = client
        .get(url)
        .header(
            reqwest::header::USER_AGENT,
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        )
        .header(
            reqwest::header::ACCEPT,
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        )
        .send()
        .await;

    if let Ok(response) = response {
        if response.status().is_success() {
            let html = response
                .text()
                .await
                .map_err(|e| format!("Failed to read response body: {}", e))?;
            let content = extract_text_from_html(&html);
            if !content.trim().is_empty() {
                return Ok(WebFetchResult {
                    title: extract_title(&html),
                    url: url.to_string(),
                    content,
                    published_date: None,
                    file_path: None,
                    truncated: None,
                    content_length: None,
                });
            }
        }
    }

    fetch_with_tavily(url).await
}

async fn handle_large_content(
    mut result: WebFetchResult,
    ctx: &ToolContext,
    tool_call_id: &str,
) -> Result<WebFetchResult, String> {
    let content_length = result.content.chars().count();
    if content_length <= MAX_INLINE_CONTENT_LENGTH {
        result.content_length = Some(content_length);
        return Ok(result);
    }

    if tool_call_id.is_empty() {
        let truncated = truncate_content(&result.content);
        result.content = format!(
            "Content is {} characters. Returning first {} characters.\n\n{}",
            content_length, MAX_INLINE_CONTENT_LENGTH, truncated
        );
        result.truncated = Some(true);
        result.content_length = Some(content_length);
        return Ok(result);
    }

    let file_path = match build_tool_output_path(&ctx.workspace_root, &ctx.task_id, tool_call_id) {
        Ok(path) => path,
        Err(_) => {
            let truncated = truncate_content(&result.content);
            result.content = format!(
                "Content is {} characters. Returning first {} characters.\n\n{}",
                content_length, MAX_INLINE_CONTENT_LENGTH, truncated
            );
            result.truncated = Some(true);
            result.content_length = Some(content_length);
            return Ok(result);
        }
    };

    if let Some(parent) = file_path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create tool output directory: {}", e))?;
    }
    tokio::fs::write(&file_path, &result.content)
        .await
        .map_err(|e| format!("Failed to write web fetch output: {}", e))?;

    let file_path_str = file_path.to_string_lossy().to_string();
    result.content = build_large_content_message(&file_path_str, content_length);
    result.file_path = Some(file_path_str);
    result.truncated = Some(true);
    result.content_length = Some(content_length);
    Ok(result)
}
