use crate::llm::auth::api_key_manager::ApiKeyManager;
use crate::llm::types::ModelsConfiguration;
use reqwest::Client;
use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::sync::Semaphore;

const CHECK_INTERVAL: Duration = Duration::from_secs(10 * 60);
const VERSION_ENDPOINT: &str = "/api/models/version";
const CONFIGS_ENDPOINT: &str = "/api/models/configs";
const MODELS_CACHE_FILENAME: &str = "models-cache.json";
const ENV_API_BASE_URL: &str = "TALKCODY_API_BASE_URL";
const DEFAULT_API_BASE_URL: &str = "https://api.talkcody.com";
const DEFAULT_API_BASE_URL_DEV: &str = "http://localhost:3000";

static STARTED: AtomicBool = AtomicBool::new(false);
static SYNC_SEMAPHORE: OnceLock<Semaphore> = OnceLock::new();

#[derive(Deserialize)]
struct ModelVersionResponse {
    version: String,
}

fn api_base_url() -> String {
    if let Ok(value) = std::env::var(ENV_API_BASE_URL) {
        return value.trim().trim_end_matches('/').to_string();
    }

    if cfg!(debug_assertions) {
        return DEFAULT_API_BASE_URL_DEV.to_string();
    }

    DEFAULT_API_BASE_URL.to_string()
}

fn build_api_url(path: &str) -> String {
    let base = api_base_url();
    if path.starts_with('/') {
        format!("{}{}", base, path)
    } else {
        format!("{}/{}", base, path)
    }
}

async fn fetch_remote_version(client: &Client) -> Result<ModelVersionResponse, String> {
    let url = build_api_url(VERSION_ENDPOINT);
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch model version: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!(
            "Failed to fetch model version ({}): {}",
            status, text
        ));
    }

    response
        .json::<ModelVersionResponse>()
        .await
        .map_err(|e| format!("Failed to parse model version response: {}", e))
}

async fn fetch_remote_config(client: &Client) -> Result<ModelsConfiguration, String> {
    let url = build_api_url(CONFIGS_ENDPOINT);
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch model configs: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!(
            "Failed to fetch model configs ({}): {}",
            status, text
        ));
    }

    let raw = response
        .text()
        .await
        .map_err(|e| format!("Failed to read model config response: {}", e))?;

    serde_json::from_str::<ModelsConfiguration>(&raw)
        .map_err(|e| format!("Failed to parse model configs: {}", e))
}

async fn write_models_cache_file(
    app_data_dir: &Path,
    config: &ModelsConfiguration,
) -> Result<(), String> {
    let path = app_data_dir.join(MODELS_CACHE_FILENAME);
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create models cache directory: {}", e))?;
    }

    let content = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize model config: {}", e))?;

    tokio::fs::write(&path, content)
        .await
        .map_err(|e| format!("Failed to write models cache file: {}", e))
}

async fn persist_models_config(
    api_keys: &ApiKeyManager,
    app_data_dir: &Path,
    config: &ModelsConfiguration,
) -> Result<(), String> {
    let content = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize model config: {}", e))?;

    api_keys.set_setting("models_config_json", &content).await?;
    api_keys.clear_models_cache().await;
    write_models_cache_file(app_data_dir, config).await?;
    Ok(())
}

pub async fn check_for_updates(
    app: &AppHandle,
    api_keys: &ApiKeyManager,
    app_data_dir: &Path,
) -> Result<bool, String> {
    let semaphore = SYNC_SEMAPHORE.get_or_init(|| Semaphore::new(1));
    let _permit = match semaphore.try_acquire() {
        Ok(permit) => permit,
        Err(_) => {
            log::info!("[ModelSync] Update check already in progress");
            return Ok(false);
        }
    };

    let client = Client::new();

    let local_version = match api_keys.load_models_config().await {
        Ok(config) => Some(config.version),
        Err(error) => {
            log::warn!("[ModelSync] Failed to load local config: {}", error);
            None
        }
    };

    let remote_version = fetch_remote_version(&client).await?;

    let should_update = match &local_version {
        Some(version) => remote_version.version > *version,
        None => true,
    };

    if !should_update {
        log::info!(
            "[ModelSync] Models up to date (version {})",
            local_version.unwrap_or_else(|| "unknown".to_string())
        );
        return Ok(false);
    }

    log::info!(
        "[ModelSync] Updating models: {:?} -> {}",
        local_version,
        remote_version.version
    );

    let config = fetch_remote_config(&client).await?;
    persist_models_config(api_keys, app_data_dir, &config).await?;

    if let Err(error) = app.emit("modelsUpdated", ()) {
        log::warn!("[ModelSync] Failed to emit modelsUpdated event: {}", error);
    }

    log::info!("[ModelSync] Models updated to version {}", config.version);
    Ok(true)
}

pub fn start_background_sync(app: AppHandle, api_keys: ApiKeyManager, app_data_dir: PathBuf) {
    if STARTED.swap(true, Ordering::SeqCst) {
        log::info!("[ModelSync] Background sync already started");
        return;
    }

    log::info!(
        "[ModelSync] Starting background sync with base URL {}",
        api_base_url()
    );

    tauri::async_runtime::spawn(async move {
        if let Err(error) = check_for_updates(&app, &api_keys, &app_data_dir).await {
            log::warn!("[ModelSync] Initial update check failed: {}", error);
        }

        let mut interval = tokio::time::interval(CHECK_INTERVAL);
        loop {
            interval.tick().await;
            if let Err(error) = check_for_updates(&app, &api_keys, &app_data_dir).await {
                log::warn!("[ModelSync] Background update check failed: {}", error);
            }
        }
    });
}
