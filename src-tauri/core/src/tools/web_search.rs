use serde::{Deserialize, Serialize};
use std::time::Duration;

const SERPER_API_ENDPOINT: &str = "https://google.serper.dev/search";
const MAX_SNIPPET_LENGTH: usize = 10_000;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WebSearchResult {
    title: String,
    url: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct SerperSearchResult {
    title: String,
    link: String,
    snippet: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SerperSearchResponse {
    organic: Option<Vec<SerperSearchResult>>,
}

pub(crate) async fn execute_web_search(query: &str) -> Result<Vec<WebSearchResult>, String> {
    let api_key = std::env::var("SERPER_API_KEY")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "SERPER_API_KEY is not configured".to_string())?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let response = client
        .post(SERPER_API_ENDPOINT)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .header("X-API-KEY", api_key)
        .json(&serde_json::json!({
            "q": query,
            "num": 10,
        }))
        .send()
        .await
        .map_err(|e| format!("Serper search request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Serper search failed ({}): {}", status, text));
    }

    let data: SerperSearchResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Serper search response: {}", e))?;

    Ok(transform_results(data.organic.unwrap_or_default()))
}

fn transform_results(results: Vec<SerperSearchResult>) -> Vec<WebSearchResult> {
    results
        .into_iter()
        .map(|result| WebSearchResult {
            title: result.title,
            url: result.link,
            content: result
                .snippet
                .unwrap_or_default()
                .chars()
                .take(MAX_SNIPPET_LENGTH)
                .collect(),
        })
        .collect()
}
