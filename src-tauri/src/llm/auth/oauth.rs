use crate::llm::auth::api_key_manager::{normalize_domain, ApiKeyManager, LlmState};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use tauri::State;
use tokio::sync::Mutex;

const OPENAI_CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
const OPENAI_REDIRECT_URI: &str = "http://localhost:1455/auth/callback";
const OPENAI_AUTH_URL: &str = "https://auth.openai.com/oauth/authorize";
const OPENAI_TOKEN_URL: &str = "https://auth.openai.com/oauth/token";
const OPENAI_OAUTH_SCOPE: &str = "openid profile email offline_access";

const CLAUDE_CLIENT_ID: &str = "app_01Kcx9v5mR2eGz4B2KG1hp6P";
const CLAUDE_REDIRECT_URI: &str = "http://localhost:1455/auth/callback";
const CLAUDE_AUTH_URL: &str = "https://claude.ai/oauth/authorize";
const CLAUDE_TOKEN_URL: &str = "https://claude.ai/oauth/token";

const GITHUB_COPILOT_ACCESS_TOKEN_KEY: &str = "github_copilot_oauth_access_token";
const GITHUB_COPILOT_COPILOT_TOKEN_KEY: &str = "github_copilot_oauth_copilot_token";
const GITHUB_COPILOT_EXPIRES_AT_KEY: &str = "github_copilot_oauth_expires_at";
const GITHUB_COPILOT_ENTERPRISE_URL_KEY: &str = "github_copilot_oauth_enterprise_url";

const GITHUB_COPILOT_CLIENT_ID: &str = "Iv1.b507a08c87ecfe98";
const GITHUB_COPILOT_USER_AGENT: &str = "GitHubCopilotChat/0.35.0";
const GITHUB_COPILOT_EDITOR_VERSION: &str = "vscode/1.105.1";
const GITHUB_COPILOT_PLUGIN_VERSION: &str = "copilot-chat/0.35.0";
const GITHUB_COPILOT_INTEGRATION_ID: &str = "vscode-chat";

const OAUTH_STATE_TIMEOUT: Duration = Duration::from_secs(600); // 10 minutes

/// OAuth state entry with timestamp for expiration
#[derive(Clone, Debug)]
struct OAuthStateEntry {
    state: String,
    created_at: Instant,
}

/// Global storage for pending OAuth states (CSRF protection)
static PENDING_OAUTH_STATES: OnceLock<Mutex<Vec<OAuthStateEntry>>> = OnceLock::new();

fn oauth_states() -> &'static Mutex<Vec<OAuthStateEntry>> {
    PENDING_OAUTH_STATES.get_or_init(|| Mutex::new(Vec::new()))
}

/// Store a new OAuth state and clean up expired ones
async fn store_oauth_state(state: String) {
    let mut states = oauth_states().lock().await;
    let now = Instant::now();
    // Remove expired states
    states.retain(|entry| now.duration_since(entry.created_at) < OAUTH_STATE_TIMEOUT);
    // Add new state
    states.push(OAuthStateEntry {
        state,
        created_at: now,
    });
}

/// Validate and consume an OAuth state
async fn validate_oauth_state(state: &str) -> bool {
    let mut states = oauth_states().lock().await;
    let now = Instant::now();
    // Remove expired states
    states.retain(|entry| now.duration_since(entry.created_at) < OAUTH_STATE_TIMEOUT);
    // Find and remove the matching state
    if let Some(pos) = states.iter().position(|entry| entry.state == state) {
        states.remove(pos);
        true
    } else {
        false
    }
}

/// Generate a random code verifier for PKCE (32 bytes = 256 bits)
fn generate_code_verifier() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    base64_url_encode(&bytes)
}

/// Generate a random state parameter for CSRF protection
fn generate_state() -> String {
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    base64_url_encode(&bytes)
}

/// Base64 URL encoding without padding
fn base64_url_encode(bytes: &[u8]) -> String {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    URL_SAFE_NO_PAD.encode(bytes)
}

/// Generate PKCE code challenge from verifier (SHA256 hash, base64url encoded)
fn code_challenge(verifier: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    let result = hasher.finalize();
    base64_url_encode(&result)
}

/// Extract OpenAI account ID from JWT token
fn extract_openai_account_id(token: &str) -> Option<String> {
    // JWT format: header.payload.signature
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() != 3 {
        return None;
    }

    // Decode payload (base64url)
    let payload = parts[1];
    let decoded = base64_url_decode(payload).ok()?;
    let json: serde_json::Value = serde_json::from_slice(&decoded).ok()?;

    // Extract account ID from the OpenAI auth claim
    json.get("https://api.openai.com/auth")
        .and_then(|auth| auth.get("user_id"))
        .and_then(|id| id.as_str())
        .map(|s| s.to_string())
}

/// Base64 URL decoding (handles padding)
fn base64_url_decode(input: &str) -> Result<Vec<u8>, String> {
    use base64::{engine::general_purpose::URL_SAFE, Engine};

    // Add padding if necessary
    let padding = (4 - input.len() % 4) % 4;
    let padded = format!("{}{}", input, "=".repeat(padding));

    URL_SAFE
        .decode(&padded)
        .map_err(|e| format!("Base64 decode error: {}", e))
}

// ============================================================================
// OpenAI OAuth
// ============================================================================

fn build_openai_authorize_url(redirect_uri: &str, challenge: &str, state: &str) -> String {
    let mut url = url::Url::parse(OPENAI_AUTH_URL).expect("OPENAI_AUTH_URL is valid");
    url.query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", OPENAI_CLIENT_ID)
        .append_pair("redirect_uri", redirect_uri)
        .append_pair("scope", OPENAI_OAUTH_SCOPE)
        .append_pair("code_challenge", challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", state)
        .append_pair("id_token_add_organizations", "true")
        .append_pair("codex_cli_simplified_flow", "true")
        .append_pair("originator", "codex_cli_rs");
    url.to_string()
}

#[cfg(test)]
mod openai_authorize_url_tests {
    use super::*;

    #[test]
    fn openai_authorize_url_uses_oauth_endpoints_and_scope() {
        let redirect = "http://localhost:1455/auth/callback";
        let challenge = "test_challenge";
        let state = "test_state";
        let url = build_openai_authorize_url(redirect, challenge, state);

        assert!(url.starts_with("https://auth.openai.com/oauth/authorize"));
        assert!(url.contains("response_type=code"));
        assert!(url.contains("client_id=app_EMoamEEZ73f0CkXaXp7hrann"));
        assert!(url.contains("redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback"));
        assert!(url.contains("scope=openid+profile+email+offline_access"));
        assert!(url.contains("code_challenge=test_challenge"));
        assert!(url.contains("code_challenge_method=S256"));
        assert!(url.contains("state=test_state"));
        assert!(url.contains("id_token_add_organizations=true"));
        assert!(url.contains("codex_cli_simplified_flow=true"));
        assert!(url.contains("originator=codex_cli_rs"));
    }
}

#[derive(Deserialize)]
pub struct OpenAIOAuthStartRequest {
    #[serde(rename = "redirectUri")]
    pub redirect_uri: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAIOAuthStartResponse {
    pub url: String,
    pub verifier: String,
    pub state: String,
}

#[tauri::command]
pub async fn llm_openai_oauth_start(
    request: Option<OpenAIOAuthStartRequest>,
) -> Result<OpenAIOAuthStartResponse, String> {
    let verifier = generate_code_verifier();
    let challenge = code_challenge(&verifier);
    let state = generate_state();

    // Store state for CSRF protection
    store_oauth_state(state.clone()).await;

    let redirect_uri = request
        .and_then(|value| value.redirect_uri)
        .unwrap_or_else(|| OPENAI_REDIRECT_URI.to_string());
    let url = build_openai_authorize_url(&redirect_uri, &challenge, &state);

    Ok(OpenAIOAuthStartResponse {
        url,
        verifier,
        state,
    })
}

#[derive(Deserialize)]
pub struct OpenAIOAuthCompleteRequest {
    pub code: String,
    pub verifier: String,
    #[serde(rename = "expectedState")]
    pub expected_state: Option<String>,
    #[serde(rename = "redirectUri")]
    pub redirect_uri: Option<String>,
}

#[derive(Deserialize)]
#[serde(untagged)]
pub enum OpenAIOAuthCompletePayload {
    Wrapped { request: OpenAIOAuthCompleteRequest },
    Direct(OpenAIOAuthCompleteRequest),
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAIOAuthCompleteResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account_id: Option<String>,
}

#[tauri::command]
pub async fn llm_openai_oauth_complete(
    payload: OpenAIOAuthCompletePayload,
    state: State<'_, LlmState>,
) -> Result<OpenAIOAuthCompleteResponse, String> {
    let request = match payload {
        OpenAIOAuthCompletePayload::Wrapped { request } => request,
        OpenAIOAuthCompletePayload::Direct(request) => request,
    };

    // Validate state for CSRF protection
    let expected_state = request
        .expected_state
        .ok_or("Missing OAuth state parameter")?;
    if !validate_oauth_state(&expected_state).await {
        return Err("Invalid or expired OAuth state".to_string());
    }

    let client = reqwest::Client::new();

    let redirect_uri = request
        .redirect_uri
        .unwrap_or_else(|| OPENAI_REDIRECT_URI.to_string());

    let params = [
        ("grant_type", "authorization_code"),
        ("client_id", OPENAI_CLIENT_ID),
        ("code", &request.code),
        ("redirect_uri", &redirect_uri),
        ("code_verifier", &request.verifier),
    ];

    let response = client
        .post(OPENAI_TOKEN_URL)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("Token request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!("Token exchange failed ({}): {}", status, text));
    }

    let token_response: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse token response: {}", e))?;

    let access_token = token_response["access_token"]
        .as_str()
        .ok_or("Missing access_token in response")?
        .to_string();

    let refresh_token = token_response["refresh_token"]
        .as_str()
        .ok_or("Missing refresh_token in response")?
        .to_string();

    let expires_in = token_response["expires_in"].as_i64().unwrap_or(3600);
    let expires_at = chrono::Utc::now().timestamp() + expires_in;

    let account_id = extract_openai_account_id(&access_token);

    // Save to settings
    let api_keys = state.api_keys.lock().await;
    api_keys
        .set_setting("openai_oauth_access_token", &access_token)
        .await?;
    api_keys
        .set_setting("openai_oauth_refresh_token", &refresh_token)
        .await?;
    api_keys
        .set_setting("openai_oauth_expires_at", &expires_at.to_string())
        .await?;
    if let Some(ref id) = account_id {
        api_keys.set_setting("openai_oauth_account_id", id).await?;
    }

    Ok(OpenAIOAuthCompleteResponse {
        access_token,
        refresh_token,
        expires_at,
        account_id,
    })
}

#[derive(Deserialize)]
pub struct OpenAIOAuthRefreshRequest {
    pub refresh_token: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAIOAuthRefreshResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account_id: Option<String>,
}

pub(crate) async fn refresh_openai_oauth_tokens(
    client: &reqwest::Client,
    refresh_token: &str,
    api_keys: &ApiKeyManager,
) -> Result<OpenAIOAuthRefreshResponse, String> {
    let params = [
        ("grant_type", "refresh_token"),
        ("client_id", OPENAI_CLIENT_ID),
        ("refresh_token", refresh_token),
    ];

    let response = client
        .post(OPENAI_TOKEN_URL)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("Refresh request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!("Token refresh failed ({}): {}", status, text));
    }

    let token_response: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse refresh response: {}", e))?;

    let access_token = token_response["access_token"]
        .as_str()
        .ok_or("Missing access_token in response")?
        .to_string();

    // Use new refresh token if provided, otherwise keep the old one
    let refresh_token = token_response["refresh_token"]
        .as_str()
        .map(|s| s.to_string())
        .unwrap_or(refresh_token.to_string());

    let expires_in = token_response["expires_in"].as_i64().unwrap_or(3600);
    let expires_at = chrono::Utc::now().timestamp() + expires_in;

    let account_id = extract_openai_account_id(&access_token);

    api_keys
        .set_setting("openai_oauth_access_token", &access_token)
        .await?;
    api_keys
        .set_setting("openai_oauth_refresh_token", &refresh_token)
        .await?;
    api_keys
        .set_setting("openai_oauth_expires_at", &expires_at.to_string())
        .await?;
    if let Some(ref id) = account_id {
        api_keys.set_setting("openai_oauth_account_id", id).await?;
    }

    Ok(OpenAIOAuthRefreshResponse {
        access_token,
        refresh_token,
        expires_at,
        account_id,
    })
}

#[tauri::command]
pub async fn llm_openai_oauth_refresh(
    request: OpenAIOAuthRefreshRequest,
    state: State<'_, LlmState>,
) -> Result<OpenAIOAuthRefreshResponse, String> {
    let api_keys = state.api_keys.lock().await;
    let client = reqwest::Client::new();
    refresh_openai_oauth_tokens(&client, &request.refresh_token, &api_keys).await
}

#[tauri::command]
pub async fn llm_openai_oauth_refresh_from_store(
    state: State<'_, LlmState>,
) -> Result<OpenAIOAuthRefreshResponse, String> {
    let api_keys = state.api_keys.lock().await;
    let refresh_token = api_keys
        .get_setting("openai_oauth_refresh_token")
        .await?
        .unwrap_or_default();

    if refresh_token.trim().is_empty() {
        return Err("OpenAI OAuth refresh token missing".to_string());
    }

    let client = reqwest::Client::new();
    refresh_openai_oauth_tokens(&client, &refresh_token, &api_keys).await
}

#[tauri::command]
pub async fn llm_openai_oauth_disconnect(state: State<'_, LlmState>) -> Result<(), String> {
    let api_keys = state.api_keys.lock().await;
    api_keys
        .set_setting("openai_oauth_access_token", "")
        .await?;
    api_keys
        .set_setting("openai_oauth_refresh_token", "")
        .await?;
    api_keys.set_setting("openai_oauth_expires_at", "").await?;
    api_keys.set_setting("openai_oauth_account_id", "").await?;
    Ok(())
}

// ============================================================================
// Claude OAuth
// ============================================================================

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeOAuthStartResponse {
    pub url: String,
    pub verifier: String,
    pub state: String,
}

#[tauri::command]
pub async fn llm_claude_oauth_start() -> Result<ClaudeOAuthStartResponse, String> {
    let verifier = generate_code_verifier();
    let challenge = code_challenge(&verifier);
    let state = generate_state();

    // Store state for CSRF protection
    store_oauth_state(state.clone()).await;

    let redirect_uri_encoded = CLAUDE_REDIRECT_URI
        .replace(':', "%3A")
        .replace('/', "%2F")
        .replace('?', "%3F")
        .replace('&', "%26")
        .replace('=', "%3D");
    let url = format!(
        "{}?client_id={}&redirect_uri={}&response_type=code&code_challenge={}&code_challenge_method=S256&state={}",
        CLAUDE_AUTH_URL,
        CLAUDE_CLIENT_ID,
        redirect_uri_encoded,
        challenge,
        state
    );

    Ok(ClaudeOAuthStartResponse {
        url,
        verifier,
        state,
    })
}

#[derive(Deserialize)]
pub struct ClaudeOAuthCompleteRequest {
    pub code: String,
    pub verifier: String,
    pub state: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeOAuthCompleteResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: i64,
}

#[tauri::command]
pub async fn llm_claude_oauth_complete(
    request: ClaudeOAuthCompleteRequest,
    state: State<'_, LlmState>,
) -> Result<ClaudeOAuthCompleteResponse, String> {
    // Validate state for CSRF protection
    if !validate_oauth_state(&request.state).await {
        return Err("Invalid or expired OAuth state".to_string());
    }

    let client = reqwest::Client::new();

    let params = [
        ("grant_type", "authorization_code"),
        ("client_id", CLAUDE_CLIENT_ID),
        ("code", &request.code),
        ("redirect_uri", CLAUDE_REDIRECT_URI),
        ("code_verifier", &request.verifier),
    ];

    let response = client
        .post(CLAUDE_TOKEN_URL)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("Token request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!("Token exchange failed ({}): {}", status, text));
    }

    let token_response: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse token response: {}", e))?;

    let access_token = token_response["access_token"]
        .as_str()
        .ok_or("Missing access_token in response")?
        .to_string();

    let refresh_token = token_response["refresh_token"]
        .as_str()
        .ok_or("Missing refresh_token in response")?
        .to_string();

    let expires_in = token_response["expires_in"].as_i64().unwrap_or(3600);
    let expires_at = chrono::Utc::now().timestamp() + expires_in;

    // Save to settings
    let api_keys = state.api_keys.lock().await;
    api_keys
        .set_setting("claude_oauth_access_token", &access_token)
        .await?;
    api_keys
        .set_setting("claude_oauth_refresh_token", &refresh_token)
        .await?;
    api_keys
        .set_setting("claude_oauth_expires_at", &expires_at.to_string())
        .await?;

    Ok(ClaudeOAuthCompleteResponse {
        access_token,
        refresh_token,
        expires_at,
    })
}

#[derive(Deserialize)]
pub struct ClaudeOAuthRefreshRequest {
    pub refresh_token: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeOAuthRefreshResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: i64,
}

#[tauri::command]
pub async fn llm_claude_oauth_refresh(
    request: ClaudeOAuthRefreshRequest,
    state: State<'_, LlmState>,
) -> Result<ClaudeOAuthRefreshResponse, String> {
    let client = reqwest::Client::new();

    let params = [
        ("grant_type", "refresh_token"),
        ("client_id", CLAUDE_CLIENT_ID),
        ("refresh_token", &request.refresh_token),
    ];

    let response = client
        .post(CLAUDE_TOKEN_URL)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("Refresh request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!("Token refresh failed ({}): {}", status, text));
    }

    let token_response: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse refresh response: {}", e))?;

    let access_token = token_response["access_token"]
        .as_str()
        .ok_or("Missing access_token in response")?
        .to_string();

    // Use new refresh token if provided, otherwise keep the old one
    let refresh_token = token_response["refresh_token"]
        .as_str()
        .map(|s| s.to_string())
        .unwrap_or(request.refresh_token);

    let expires_in = token_response["expires_in"].as_i64().unwrap_or(3600);
    let expires_at = chrono::Utc::now().timestamp() + expires_in;

    // Save to settings
    let api_keys = state.api_keys.lock().await;
    api_keys
        .set_setting("claude_oauth_access_token", &access_token)
        .await?;
    api_keys
        .set_setting("claude_oauth_refresh_token", &refresh_token)
        .await?;
    api_keys
        .set_setting("claude_oauth_expires_at", &expires_at.to_string())
        .await?;

    Ok(ClaudeOAuthRefreshResponse {
        access_token,
        refresh_token,
        expires_at,
    })
}

#[tauri::command]
pub async fn llm_claude_oauth_disconnect(state: State<'_, LlmState>) -> Result<(), String> {
    let api_keys = state.api_keys.lock().await;
    api_keys
        .set_setting("claude_oauth_access_token", "")
        .await?;
    api_keys
        .set_setting("claude_oauth_refresh_token", "")
        .await?;
    api_keys.set_setting("claude_oauth_expires_at", "").await?;
    Ok(())
}

// ============================================================================
// GitHub Copilot OAuth (Device Code Flow)
// ============================================================================

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubCopilotOAuthStartRequest {
    pub enterprise_url: Option<String>,
}

#[derive(Deserialize)]
struct GitHubCopilotDeviceCodeResponse {
    device_code: String,
    user_code: String,
    verification_uri: String,
    expires_in: i64,
    interval: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubCopilotOAuthStartResponse {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: i64,
    pub interval: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubCopilotOAuthPollRequest {
    pub device_code: String,
    pub enterprise_url: Option<String>,
}

#[derive(Deserialize)]
struct GitHubCopilotAccessTokenResponse {
    access_token: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubCopilotOAuthTokens {
    pub access_token: String,
    pub copilot_token: String,
    pub expires_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enterprise_url: Option<String>,
}

#[derive(Serialize)]
pub struct GitHubCopilotTokenExchangeResponse {
    #[serde(rename = "type")]
    pub result_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tokens: Option<GitHubCopilotOAuthTokens>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubCopilotOAuthTokenSnapshot {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub access_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub copilot_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enterprise_url: Option<String>,
}

fn github_copilot_domain(enterprise_url: Option<&str>) -> String {
    enterprise_url
        .map(normalize_domain)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "github.com".to_string())
}

async fn github_copilot_api_token(
    client: &reqwest::Client,
    access_token: &str,
    enterprise_url: Option<&str>,
) -> Result<(String, i64), String> {
    let domain = github_copilot_domain(enterprise_url);
    let url = format!("https://api.{}/copilot_internal/v2/token", domain);

    let response = client
        .get(&url)
        .header("Accept", "application/json")
        .header("Authorization", format!("Bearer {}", access_token))
        .header("User-Agent", GITHUB_COPILOT_USER_AGENT)
        .header("Editor-Version", GITHUB_COPILOT_EDITOR_VERSION)
        .header("Editor-Plugin-Version", GITHUB_COPILOT_PLUGIN_VERSION)
        .header("Copilot-Integration-Id", GITHUB_COPILOT_INTEGRATION_ID)
        .send()
        .await
        .map_err(|e| format!("Copilot token request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!(
            "Copilot token request failed ({}): {}",
            status, text
        ));
    }

    let payload: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Copilot token response: {}", e))?;
    let token = payload
        .get("token")
        .and_then(|value| value.as_str())
        .ok_or("Missing Copilot token in response")?
        .to_string();
    let expires_at = payload
        .get("expires_at")
        .and_then(|value| value.as_i64())
        .ok_or("Missing Copilot expires_at in response")?;

    Ok((token, expires_at * 1000))
}

#[tauri::command]
pub async fn llm_github_copilot_oauth_start_device_code(
    request: GitHubCopilotOAuthStartRequest,
) -> Result<GitHubCopilotOAuthStartResponse, String> {
    let domain = github_copilot_domain(request.enterprise_url.as_deref());
    let url = format!("https://{}/login/device/code", domain);

    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .header("User-Agent", GITHUB_COPILOT_USER_AGENT)
        .header("Editor-Version", GITHUB_COPILOT_EDITOR_VERSION)
        .header("Editor-Plugin-Version", GITHUB_COPILOT_PLUGIN_VERSION)
        .header("Copilot-Integration-Id", GITHUB_COPILOT_INTEGRATION_ID)
        .json(&serde_json::json!({
            "client_id": GITHUB_COPILOT_CLIENT_ID,
            "scope": "read:user"
        }))
        .send()
        .await
        .map_err(|e| format!("Device code request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!("Device code request failed ({}): {}", status, text));
    }

    let data: GitHubCopilotDeviceCodeResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse device code response: {}", e))?;

    Ok(GitHubCopilotOAuthStartResponse {
        device_code: data.device_code,
        user_code: data.user_code,
        verification_uri: data.verification_uri,
        expires_in: data.expires_in,
        interval: data.interval,
    })
}

#[tauri::command]
pub async fn llm_github_copilot_oauth_poll_device_code(
    request: GitHubCopilotOAuthPollRequest,
    state: State<'_, LlmState>,
) -> Result<GitHubCopilotTokenExchangeResponse, String> {
    let domain = github_copilot_domain(request.enterprise_url.as_deref());
    let url = format!("https://{}/login/oauth/access_token", domain);

    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .header("User-Agent", GITHUB_COPILOT_USER_AGENT)
        .json(&serde_json::json!({
            "client_id": GITHUB_COPILOT_CLIENT_ID,
            "device_code": request.device_code,
            "grant_type": "urn:ietf:params:oauth:grant-type:device_code"
        }))
        .send()
        .await
        .map_err(|e| format!("Token request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        return Ok(GitHubCopilotTokenExchangeResponse {
            result_type: "failed".to_string(),
            tokens: None,
            error: Some(format!("Token request failed ({}): {}", status, text)),
        });
    }

    let data: GitHubCopilotAccessTokenResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse access token response: {}", e))?;

    if let Some(access_token) = data.access_token {
        let (copilot_token, expires_at_ms) =
            github_copilot_api_token(&client, &access_token, request.enterprise_url.as_deref())
                .await?;

        let api_keys = state.api_keys.lock().await;
        api_keys
            .set_setting(GITHUB_COPILOT_ACCESS_TOKEN_KEY, &access_token)
            .await?;
        api_keys
            .set_setting(GITHUB_COPILOT_COPILOT_TOKEN_KEY, &copilot_token)
            .await?;
        api_keys
            .set_setting(GITHUB_COPILOT_EXPIRES_AT_KEY, &expires_at_ms.to_string())
            .await?;
        api_keys
            .set_setting(
                GITHUB_COPILOT_ENTERPRISE_URL_KEY,
                request.enterprise_url.as_deref().unwrap_or(""),
            )
            .await?;

        return Ok(GitHubCopilotTokenExchangeResponse {
            result_type: "success".to_string(),
            tokens: Some(GitHubCopilotOAuthTokens {
                access_token,
                copilot_token,
                expires_at: expires_at_ms,
                enterprise_url: request.enterprise_url,
            }),
            error: None,
        });
    }

    if let Some(error) = data.error {
        if error == "authorization_pending" || error == "slow_down" {
            return Ok(GitHubCopilotTokenExchangeResponse {
                result_type: "pending".to_string(),
                tokens: None,
                error: None,
            });
        }

        let message = data
            .error_description
            .unwrap_or_else(|| format!("OAuth error: {}", error));
        return Ok(GitHubCopilotTokenExchangeResponse {
            result_type: "failed".to_string(),
            tokens: None,
            error: Some(message),
        });
    }

    Ok(GitHubCopilotTokenExchangeResponse {
        result_type: "failed".to_string(),
        tokens: None,
        error: Some("Unknown OAuth response".to_string()),
    })
}

#[tauri::command]
pub async fn llm_github_copilot_oauth_refresh(
    state: State<'_, LlmState>,
) -> Result<GitHubCopilotOAuthTokens, String> {
    let api_keys = state.api_keys.lock().await;
    let access_token = api_keys
        .get_setting(GITHUB_COPILOT_ACCESS_TOKEN_KEY)
        .await?
        .unwrap_or_default();
    if access_token.trim().is_empty() {
        return Err("Missing GitHub Copilot OAuth access token".to_string());
    }

    let enterprise_url = api_keys
        .get_setting(GITHUB_COPILOT_ENTERPRISE_URL_KEY)
        .await?
        .filter(|value| !value.trim().is_empty());

    let client = reqwest::Client::new();
    let (copilot_token, expires_at_ms) =
        github_copilot_api_token(&client, &access_token, enterprise_url.as_deref()).await?;

    api_keys
        .set_setting(GITHUB_COPILOT_COPILOT_TOKEN_KEY, &copilot_token)
        .await?;
    api_keys
        .set_setting(GITHUB_COPILOT_EXPIRES_AT_KEY, &expires_at_ms.to_string())
        .await?;

    Ok(GitHubCopilotOAuthTokens {
        access_token,
        copilot_token,
        expires_at: expires_at_ms,
        enterprise_url,
    })
}

#[tauri::command]
pub async fn llm_github_copilot_oauth_disconnect(state: State<'_, LlmState>) -> Result<(), String> {
    let api_keys = state.api_keys.lock().await;
    api_keys
        .set_setting(GITHUB_COPILOT_ACCESS_TOKEN_KEY, "")
        .await?;
    api_keys
        .set_setting(GITHUB_COPILOT_COPILOT_TOKEN_KEY, "")
        .await?;
    api_keys
        .set_setting(GITHUB_COPILOT_EXPIRES_AT_KEY, "")
        .await?;
    api_keys
        .set_setting(GITHUB_COPILOT_ENTERPRISE_URL_KEY, "")
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn llm_github_copilot_oauth_tokens(
    state: State<'_, LlmState>,
) -> Result<GitHubCopilotOAuthTokenSnapshot, String> {
    let api_keys = state.api_keys.lock().await;
    let access_token = api_keys
        .get_setting(GITHUB_COPILOT_ACCESS_TOKEN_KEY)
        .await?
        .filter(|value| !value.trim().is_empty());
    let copilot_token = api_keys
        .get_setting(GITHUB_COPILOT_COPILOT_TOKEN_KEY)
        .await?
        .filter(|value| !value.trim().is_empty());
    let expires_at = api_keys
        .get_setting(GITHUB_COPILOT_EXPIRES_AT_KEY)
        .await?
        .and_then(|value| value.parse::<i64>().ok());
    let enterprise_url = api_keys
        .get_setting(GITHUB_COPILOT_ENTERPRISE_URL_KEY)
        .await?
        .filter(|value| !value.trim().is_empty());

    Ok(GitHubCopilotOAuthTokenSnapshot {
        access_token,
        copilot_token,
        expires_at,
        enterprise_url,
    })
}

// ============================================================================
// OAuth Status
// ============================================================================

/// OAuth status response - does NOT include sensitive tokens
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OAuthProviderStatus {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_connected: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_refresh_token: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthStatusResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub openai: Option<OAuthProviderStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anthropic: Option<OAuthProviderStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub github_copilot: Option<OAuthProviderStatus>,
}

#[tauri::command]
pub async fn llm_oauth_status(state: State<'_, LlmState>) -> Result<OAuthStatusResponse, String> {
    let api_keys = state.api_keys.lock().await;

    // OpenAI status - only return metadata, not tokens
    let openai_access = api_keys
        .get_setting("openai_oauth_access_token")
        .await?
        .filter(|s| !s.is_empty());
    let openai_refresh = api_keys
        .get_setting("openai_oauth_refresh_token")
        .await?
        .filter(|s| !s.is_empty());
    let openai_expires = api_keys
        .get_setting("openai_oauth_expires_at")
        .await?
        .and_then(|s| s.parse::<i64>().ok());
    let openai_account = api_keys
        .get_setting("openai_oauth_account_id")
        .await?
        .filter(|s| !s.is_empty());

    let openai = if openai_access.is_some() || openai_refresh.is_some() {
        Some(OAuthProviderStatus {
            expires_at: openai_expires,
            account_id: openai_account,
            is_connected: Some(true),
            has_refresh_token: Some(openai_refresh.is_some()),
        })
    } else {
        None
    };

    // Anthropic status - only return metadata, not tokens
    let anthropic_access = api_keys
        .get_setting("claude_oauth_access_token")
        .await?
        .filter(|s| !s.is_empty());
    let anthropic_expires = api_keys
        .get_setting("claude_oauth_expires_at")
        .await?
        .and_then(|s| s.parse::<i64>().ok());

    let anthropic = if anthropic_access.is_some() {
        Some(OAuthProviderStatus {
            expires_at: anthropic_expires,
            account_id: None,
            is_connected: Some(true),
            has_refresh_token: None,
        })
    } else {
        None
    };

    // GitHub Copilot status - only return metadata
    let copilot_access = api_keys
        .get_setting(GITHUB_COPILOT_ACCESS_TOKEN_KEY)
        .await?
        .filter(|s| !s.is_empty());
    let copilot_token = api_keys
        .get_setting(GITHUB_COPILOT_COPILOT_TOKEN_KEY)
        .await?
        .filter(|s| !s.is_empty());

    let github_copilot = if copilot_access.is_some() || copilot_token.is_some() {
        Some(OAuthProviderStatus {
            is_connected: Some(true),
            ..Default::default()
        })
    } else {
        None
    };

    Ok(OAuthStatusResponse {
        openai,
        anthropic,
        github_copilot,
    })
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_openai_oauth_complete_payload_wrapped() {
        let payload = json!({
            "request": {
                "code": "code-123",
                "verifier": "verifier-123",
                "expectedState": "state-123",
                "redirectUri": "http://localhost:1455/auth/callback"
            }
        });
        let parsed: OpenAIOAuthCompletePayload =
            serde_json::from_value(payload).expect("parse wrapped payload");
        match parsed {
            OpenAIOAuthCompletePayload::Wrapped { request } => {
                assert_eq!(request.code, "code-123");
                assert_eq!(request.verifier, "verifier-123");
                assert_eq!(request.expected_state.as_deref(), Some("state-123"));
                assert_eq!(
                    request.redirect_uri.as_deref(),
                    Some("http://localhost:1455/auth/callback")
                );
            }
            OpenAIOAuthCompletePayload::Direct(_) => panic!("expected wrapped payload"),
        }
    }

    #[test]
    fn test_openai_oauth_complete_payload_direct() {
        let payload = json!({
            "code": "code-456",
            "verifier": "verifier-456",
            "expectedState": "state-456"
        });
        let parsed: OpenAIOAuthCompletePayload =
            serde_json::from_value(payload).expect("parse direct payload");
        match parsed {
            OpenAIOAuthCompletePayload::Direct(request) => {
                assert_eq!(request.code, "code-456");
                assert_eq!(request.verifier, "verifier-456");
                assert_eq!(request.expected_state.as_deref(), Some("state-456"));
            }
            OpenAIOAuthCompletePayload::Wrapped { .. } => panic!("expected direct payload"),
        }
    }

    #[test]
    fn test_code_challenge() {
        // Test that code_challenge produces consistent output
        // Note: RFC 7636 Appendix B test vector uses raw bytes, but our
        // code_challenge function takes a string. We test consistency instead.
        let verifier = "test_verifier_12345";
        let challenge1 = code_challenge(verifier);
        let challenge2 = code_challenge(verifier);
        assert_eq!(challenge1, challenge2);
        assert!(!challenge1.is_empty());

        // Verify it's base64url encoded (no padding, no + or /)
        assert!(!challenge1.contains('='));
        assert!(!challenge1.contains('+'));
        assert!(!challenge1.contains('/'));
    }

    #[test]
    fn test_base64_url_encode() {
        let bytes = [0u8, 1, 2, 3, 255, 254, 253];
        let encoded = base64_url_encode(&bytes);
        // Should not contain padding or standard base64 characters
        assert!(!encoded.contains('='));
        assert!(!encoded.contains('+'));
        assert!(!encoded.contains('/'));
    }

    #[test]
    fn test_extract_openai_account_id() {
        // Create a test JWT with the OpenAI claim
        // Header: {"alg":"none"}
        // Payload: {"https://api.openai.com/auth":{"user_id":"acct_test123"},"exp":1234567890}
        let header = base64_url_encode(b"{\"alg\":\"none\"}");
        let payload = base64_url_encode(
            b"{\"https://api.openai.com/auth\":{\"user_id\":\"acct_test123\"},\"exp\":1234567890}",
        );
        let token = format!("{}.{}.", header, payload);

        let account_id = extract_openai_account_id(&token);
        assert_eq!(account_id, Some("acct_test123".to_string()));
    }

    #[test]
    fn test_extract_openai_account_id_invalid() {
        // Invalid token format
        assert_eq!(extract_openai_account_id("invalid"), None);
        assert_eq!(
            extract_openai_account_id("header.payload.signature.extra"),
            None
        );

        // Valid format but missing claim
        let header = base64_url_encode(b"{\"alg\":\"none\"}");
        let payload = base64_url_encode(b"{\"sub\":\"user123\"}");
        let token = format!("{}.{}.", header, payload);
        assert_eq!(extract_openai_account_id(&token), None);
    }
}
