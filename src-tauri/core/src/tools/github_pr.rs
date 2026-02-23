//! GitHub PR Tool
//!
//! Fetch GitHub Pull Request information using GitHub REST API.
//! Matches TypeScript github-pr-tool.tsx logic.

use crate::core::tools::ToolContext;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubPRResult {
    pub success: bool,
    pub action: String,
    pub pr_url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rate_limit_remaining: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Parse GitHub PR URL to extract owner, repo, and PR number
fn parse_github_pr_url(url: &str) -> Option<(String, String, u64)> {
    // Match patterns like: https://github.com/owner/repo/pull/123
    let re = regex::Regex::new(r"github\.com/([^/]+)/([^/]+)/pull/(\d+)").ok()?;
    let caps = re.captures(url)?;

    let owner = caps.get(1)?.as_str().to_string();
    let repo = caps.get(2)?.as_str().to_string();
    let pr_number = caps.get(3)?.as_str().parse().ok()?;

    Some((owner, repo, pr_number))
}

/// Execute githubPR tool
pub async fn execute(
    url: &str,
    action: &str,
    page: Option<u32>,
    per_page: Option<u32>,
    filename_filter: Option<&str>,
    _ctx: &ToolContext,
) -> GitHubPRResult {
    // Parse the GitHub PR URL
    let (owner, repo, pr_number) = match parse_github_pr_url(url) {
        Some(parts) => parts,
        None => {
            return GitHubPRResult {
                success: false,
                action: action.to_string(),
                pr_url: url.to_string(),
                data: None,
                rate_limit_remaining: None,
                error: Some(
                    "Invalid GitHub PR URL. Expected format: https://github.com/owner/repo/pull/123".to_string()
                ),
            };
        }
    };

    // Build API URL based on action
    let api_url = match action {
        "info" => format!(
            "https://api.github.com/repos/{}/{}/pulls/{}",
            owner, repo, pr_number
        ),
        "files" => format!(
            "https://api.github.com/repos/{}/{}/pulls/{}/files?page={}&per_page={}",
            owner,
            repo,
            pr_number,
            page.unwrap_or(1),
            per_page.unwrap_or(30).min(100)
        ),
        "diff" => {
            // For diff, we need to use the Accept header
            format!(
                "https://api.github.com/repos/{}/{}/pulls/{}",
                owner, repo, pr_number
            )
        }
        "comments" => format!(
            "https://api.github.com/repos/{}/{}/pulls/{}/comments",
            owner, repo, pr_number
        ),
        _ => {
            return GitHubPRResult {
                success: false,
                action: action.to_string(),
                pr_url: url.to_string(),
                data: None,
                rate_limit_remaining: None,
                error: Some(format!("Unknown action: {}", action)),
            };
        }
    };

    // Make HTTP request
    let client = reqwest::Client::new();
    let mut request = client.get(&api_url);

    // Add headers
    request = request
        .header(
            "Accept",
            if action == "diff" {
                "application/vnd.github.diff"
            } else {
                "application/vnd.github+json"
            },
        )
        .header("User-Agent", "TalkCody-GitHub-PR-Tool")
        .header("X-GitHub-Api-Version", "2022-11-28");

    // Add GitHub token if available (optional for public repos)
    if let Ok(token) = std::env::var("GITHUB_TOKEN") {
        request = request.header("Authorization", format!("Bearer {}", token));
    }

    match request.send().await {
        Ok(response) => {
            let rate_limit_remaining = response
                .headers()
                .get("X-RateLimit-Remaining")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.parse().ok());

            if !response.status().is_success() {
                let status = response.status();
                let error_text = response.text().await.unwrap_or_default();
                return GitHubPRResult {
                    success: false,
                    action: action.to_string(),
                    pr_url: url.to_string(),
                    data: None,
                    rate_limit_remaining,
                    error: Some(format!("GitHub API error: {} - {}", status, error_text)),
                };
            }

            // Parse response based on action
            let data = if action == "diff" {
                match response.text().await {
                    Ok(text) => serde_json::Value::String(text),
                    Err(e) => {
                        return GitHubPRResult {
                            success: false,
                            action: action.to_string(),
                            pr_url: url.to_string(),
                            data: None,
                            rate_limit_remaining,
                            error: Some(format!("Failed to read diff: {}", e)),
                        };
                    }
                }
            } else {
                match response.json().await {
                    Ok(json) => json,
                    Err(e) => {
                        return GitHubPRResult {
                            success: false,
                            action: action.to_string(),
                            pr_url: url.to_string(),
                            data: None,
                            rate_limit_remaining,
                            error: Some(format!("Failed to parse response: {}", e)),
                        };
                    }
                }
            };

            GitHubPRResult {
                success: true,
                action: action.to_string(),
                pr_url: url.to_string(),
                data: Some(data),
                rate_limit_remaining,
                error: None,
            }
        }
        Err(e) => GitHubPRResult {
            success: false,
            action: action.to_string(),
            pr_url: url.to_string(),
            data: None,
            rate_limit_remaining: None,
            error: Some(format!("Failed to fetch PR data: {}", e)),
        },
    }
}
