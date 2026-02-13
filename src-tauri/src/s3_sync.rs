use crate::device_id::get_or_create_device_id;
use crate::s3::{S3BucketConfig, S3CredentialsInput};
use bytes::Bytes;
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use reqwest::Client;
use rusty_s3::{Bucket, Credentials, S3Action, UrlStyle};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::time::Duration;
use tauri::Manager;
use tar::{Archive, Builder};
use url::Url;
use tauri::Emitter;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct S3SyncConfig {
    pub bucket: S3BucketConfig,
    pub credentials: S3CredentialsInput,
    /// Optional namespace for cross-device sync. If empty, device_id is used.
    #[serde(default)]
    pub namespace: Option<String>,
    /// Key prefix in the bucket (default: "talkcody-sync")
    #[serde(default = "default_key_prefix")]
    pub key_prefix: String,
}

fn default_key_prefix() -> String {
    "talkcody-sync".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct S3SyncBackupResult {
    pub namespace: String,
    pub latest_key: String,
    pub timestamp_key: String,
    pub sha256: String,
    pub size: u64,
    pub created_at_ms: u64,
}

fn build_bucket(cfg: &S3BucketConfig) -> Result<Bucket, String> {
    let endpoint = Url::parse(&cfg.endpoint).map_err(|e| format!("Invalid S3 endpoint URL: {e}"))?;
    let style = if cfg.path_style {
        UrlStyle::Path
    } else {
        UrlStyle::VirtualHost
    };

    Bucket::new(
        endpoint,
        style,
        cfg.bucket.clone(),
        cfg.region.clone(),
    )
    .map_err(|e| format!("Failed to create S3 bucket: {e}"))
}

fn build_credentials(input: &S3CredentialsInput) -> Credentials {
    match input.session_token.as_deref() {
        Some(token) => Credentials::new_with_token(
            input.access_key_id.clone(),
            input.secret_access_key.clone(),
            token.to_string(),
        ),
        None => Credentials::new(input.access_key_id.clone(), input.secret_access_key.clone()),
    }
}

fn header_map_from_lowercase(headers: &rusty_s3::Map<'_>) -> Result<HeaderMap, String> {
    let mut out = HeaderMap::new();
    for (key, value) in headers.iter() {
        let name = HeaderName::from_bytes(key.as_bytes())
            .map_err(|e| format!("Invalid header name '{key}': {e}"))?;
        let value =
            HeaderValue::from_str(value).map_err(|e| format!("Invalid header value: {e}"))?;
        out.insert(name, value);
    }
    Ok(out)
}

fn normalize_key_prefix(prefix: &str) -> String {
    let trimmed = prefix.trim().trim_matches('/');
    if trimmed.is_empty() {
        default_key_prefix()
    } else {
        trimmed.to_string()
    }
}

fn compute_sha256_hex(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|e| format!("Failed to open archive: {e}"))?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 1024 * 64];
    loop {
        let n = file
            .read(&mut buf)
            .map_err(|e| format!("Failed to read archive: {e}"))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

fn archive_source_paths(app_data_dir: &Path) -> Vec<(PathBuf, String)> {
    let mut out: Vec<(PathBuf, String)> = Vec::new();
    for name in ["talkcody.db", "chat_history.db", "agents.db", "settings.db", "device_id"] {
        out.push((app_data_dir.join(name), name.to_string()));
    }
    out.push((app_data_dir.join("attachments"), "attachments".to_string()));
    out
}

fn is_allowed_restore_path(rel: &Path) -> bool {
    if rel.is_absolute() {
        return false;
    }
    for comp in rel.components() {
        match comp {
            Component::Normal(_) => {}
            Component::CurDir => {}
            _ => return false,
        }
    }

    let mut it = rel.components();
    let first = match it.next() {
        Some(Component::Normal(s)) => s.to_string_lossy().to_string(),
        _ => return false,
    };

    if matches!(
        first.as_str(),
        "talkcody.db" | "chat_history.db" | "agents.db" | "settings.db" | "device_id"
    ) && it.next().is_none()
    {
        return true;
    }

    if first == "attachments" {
        return true;
    }

    false
}

fn add_dir_recursive(
    builder: &mut Builder<GzEncoder<File>>,
    dir: &Path,
    base_name: &str,
) -> Result<(), String> {
    if !dir.exists() {
        return Ok(());
    }
    let mut stack = vec![dir.to_path_buf()];
    while let Some(current) = stack.pop() {
        for entry in std::fs::read_dir(&current)
            .map_err(|e| format!("Failed to read directory '{}': {e}", current.display()))?
        {
            let entry = entry.map_err(|e| format!("Failed to read directory entry: {e}"))?;
            let path = entry.path();
            let ty = entry
                .file_type()
                .map_err(|e| format!("Failed to stat '{}': {e}", path.display()))?;

            if ty.is_dir() {
                stack.push(path);
                continue;
            }
            if !ty.is_file() {
                continue;
            }

            let rel = path
                .strip_prefix(dir)
                .map_err(|e| format!("Failed to strip prefix: {e}"))?;
            let name_in_archive = Path::new(base_name).join(rel);
            builder
                .append_path_with_name(&path, &name_in_archive)
                .map_err(|e| format!("Failed to add '{}' to archive: {e}", path.display()))?;
        }
    }
    Ok(())
}

fn create_backup_archive(app_data_dir: &Path, archive_path: &Path) -> Result<(), String> {
    let file = File::create(archive_path)
        .map_err(|e| format!("Failed to create archive '{}': {e}", archive_path.display()))?;
    let encoder = GzEncoder::new(file, Compression::default());
    let mut builder = Builder::new(encoder);

    for (path, name_in_archive) in archive_source_paths(app_data_dir) {
        if name_in_archive == "attachments" {
            add_dir_recursive(&mut builder, &path, "attachments")?;
            continue;
        }

        if !path.exists() {
            continue;
        }
        builder
            .append_path_with_name(&path, name_in_archive)
            .map_err(|e| format!("Failed to add '{}' to archive: {e}", path.display()))?;
    }

    let encoder = builder
        .into_inner()
        .map_err(|e| format!("Failed to finalize archive: {e}"))?;
    encoder
        .finish()
        .map_err(|e| format!("Failed to finish archive: {e}"))?;
    Ok(())
}

async fn put_object_from_file(
    client: &Client,
    bucket: &Bucket,
    credentials: &Credentials,
    key: &str,
    file_path: &Path,
    content_type: &str,
) -> Result<(), String> {
    let size = std::fs::metadata(file_path)
        .map_err(|e| format!("Failed to stat '{}': {e}", file_path.display()))?
        .len();

    let mut action = bucket.put_object(Some(credentials), key);
    action
        .headers_mut()
        .insert("content-type".to_string(), content_type.to_string());

    let url = action.sign(Duration::from_secs(900));
    let headers = header_map_from_lowercase(action.headers_mut())?;

    let file = tokio::fs::File::open(file_path)
        .await
        .map_err(|e| format!("Failed to open '{}': {e}", file_path.display()))?;

    let stream = futures_util::stream::try_unfold(file, |mut file| async move {
        let mut buf = vec![0u8; 1024 * 64];
        let n = tokio::io::AsyncReadExt::read(&mut file, &mut buf).await?;
        if n == 0 {
            Ok::<Option<(Bytes, tokio::fs::File)>, std::io::Error>(None)
        } else {
            buf.truncate(n);
            Ok(Some((Bytes::from(buf), file)))
        }
    });

    let res = client
        .put(url.as_str())
        .headers(headers)
        .header("content-length", size)
        .body(reqwest::Body::wrap_stream(stream))
        .send()
        .await
        .map_err(|e| format!("S3 PUT request failed: {e}"))?;

    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(format!("S3 PUT failed: {status} {body}"));
    }

    Ok(())
}

async fn put_object_bytes(
    client: &Client,
    bucket: &Bucket,
    credentials: &Credentials,
    key: &str,
    bytes: Vec<u8>,
    content_type: &str,
) -> Result<(), String> {
    let mut action = bucket.put_object(Some(credentials), key);
    action
        .headers_mut()
        .insert("content-type".to_string(), content_type.to_string());

    let url = action.sign(Duration::from_secs(900));
    let headers = header_map_from_lowercase(action.headers_mut())?;

    let res = client
        .put(url.as_str())
        .headers(headers)
        .body(bytes)
        .send()
        .await
        .map_err(|e| format!("S3 PUT request failed: {e}"))?;

    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(format!("S3 PUT failed: {status} {body}"));
    }

    Ok(())
}

async fn delete_object(
    client: &Client,
    bucket: &Bucket,
    credentials: &Credentials,
    key: &str,
) -> Result<(), String> {
    let action = bucket.delete_object(Some(credentials), key);
    let url = action.sign(Duration::from_secs(900));

    let res = client
        .delete(url.as_str())
        .send()
        .await
        .map_err(|e| format!("S3 DELETE request failed: {e}"))?;
    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(format!("S3 DELETE failed: {status} {body}"));
    }
    Ok(())
}

async fn get_object_to_file(
    client: &Client,
    bucket: &Bucket,
    credentials: &Credentials,
    key: &str,
    output_path: &Path,
) -> Result<(), String> {
    let action = bucket.get_object(Some(credentials), key);
    let url = action.sign(Duration::from_secs(900));

    let res = client
        .get(url.as_str())
        .send()
        .await
        .map_err(|e| format!("S3 GET request failed: {e}"))?;

    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(format!("S3 GET failed: {status} {body}"));
    }

    if let Some(parent) = output_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create dir: {e}"))?;
    }

    let mut file = tokio::fs::File::create(output_path)
        .await
        .map_err(|e| format!("Failed to create '{}': {e}", output_path.display()))?;

    let mut stream = res.bytes_stream();
    while let Some(item) = stream.next().await {
        let chunk = item.map_err(|e| format!("Failed to read S3 response: {e}"))?;
        tokio::io::AsyncWriteExt::write_all(&mut file, &chunk)
            .await
            .map_err(|e| format!("Failed to write file: {e}"))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn s3_sync_test_connection(
    app_handle: tauri::AppHandle,
    config: S3SyncConfig,
) -> Result<(), String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?;

    let namespace = config
        .namespace
        .clone()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| get_or_create_device_id(&app_data_dir));

    let prefix = normalize_key_prefix(&config.key_prefix);
    let key = format!("{prefix}/{namespace}/test/{}.txt", std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis());

    let bucket = build_bucket(&config.bucket)?;
    let credentials = build_credentials(&config.credentials);
    let client = Client::new();

    put_object_bytes(&client, &bucket, &credentials, &key, b"ok".to_vec(), "text/plain").await?;
    delete_object(&client, &bucket, &credentials, &key).await?;

    Ok(())
}

#[tauri::command]
pub async fn s3_sync_backup(
    app_handle: tauri::AppHandle,
    config: S3SyncConfig,
) -> Result<S3SyncBackupResult, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?;

    let namespace = config
        .namespace
        .clone()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| get_or_create_device_id(&app_data_dir));

    let created_at_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    let temp_dir = std::env::temp_dir();
    let archive_path = temp_dir.join(format!("talkcody-backup-{namespace}-{created_at_ms}.tar.gz"));
    create_backup_archive(&app_data_dir, &archive_path)?;

    let size = std::fs::metadata(&archive_path)
        .map_err(|e| format!("Failed to stat archive: {e}"))?
        .len();
    let sha256 = compute_sha256_hex(&archive_path)?;

    let prefix = normalize_key_prefix(&config.key_prefix);
    let base = format!("{prefix}/{namespace}/backup");
    let latest_key = format!("{base}/latest.tar.gz");
    let timestamp_key = format!("{base}/{created_at_ms}.tar.gz");

    let bucket = build_bucket(&config.bucket)?;
    let credentials = build_credentials(&config.credentials);
    let client = Client::new();

    // Upload timestamped first, then update latest pointer.
    put_object_from_file(
        &client,
        &bucket,
        &credentials,
        &timestamp_key,
        &archive_path,
        "application/gzip",
    )
    .await?;

    put_object_from_file(
        &client,
        &bucket,
        &credentials,
        &latest_key,
        &archive_path,
        "application/gzip",
    )
    .await?;

    // Upload metadata (best-effort).
    let meta_key = format!("{base}/latest.json");
    let meta = serde_json::json!({
      "namespace": namespace,
      "latestKey": latest_key,
      "timestampKey": timestamp_key,
      "sha256": sha256,
      "size": size,
      "createdAtMs": created_at_ms,
    });
    let _ = put_object_bytes(
        &client,
        &bucket,
        &credentials,
        &meta_key,
        meta.to_string().into_bytes(),
        "application/json",
    )
    .await;

    // Cleanup local archive
    let _ = std::fs::remove_file(&archive_path);

    Ok(S3SyncBackupResult {
        namespace,
        latest_key,
        timestamp_key,
        sha256,
        size,
        created_at_ms,
    })
}

#[tauri::command]
pub async fn s3_sync_schedule_restore(
    app_handle: tauri::AppHandle,
    config: S3SyncConfig,
) -> Result<String, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?;

    let namespace = config
        .namespace
        .clone()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| get_or_create_device_id(&app_data_dir));

    let prefix = normalize_key_prefix(&config.key_prefix);
    let key = format!("{prefix}/{namespace}/backup/latest.tar.gz");

    let bucket = build_bucket(&config.bucket)?;
    let credentials = build_credentials(&config.credentials);
    let client = Client::new();

    let restore_path = app_data_dir.join("restore_pending.tar.gz");
    get_object_to_file(&client, &bucket, &credentials, &key, &restore_path).await?;

    Ok(restore_path.to_string_lossy().to_string())
}

pub fn apply_pending_restore(
    app_handle: &tauri::AppHandle,
    app_data_dir: &Path,
) -> Result<(), String> {
    let pending = app_data_dir.join("restore_pending.tar.gz");
    if !pending.exists() {
        return Ok(());
    }

    log::info!(
        "Detected pending restore archive: {}",
        pending.to_string_lossy()
    );

    let backup_dir = app_data_dir.join(format!(
        "restore_backup_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    ));
    std::fs::create_dir_all(&backup_dir)
        .map_err(|e| format!("Failed to create backup dir: {e}"))?;

    // Move existing data out of the way (best-effort)
    for (path, name) in archive_source_paths(app_data_dir) {
        if name == "attachments" {
            continue;
        }
        if path.exists() {
            let _ = std::fs::rename(&path, backup_dir.join(name));
        }
    }
    let attachments = app_data_dir.join("attachments");
    if attachments.exists() {
        let _ = std::fs::rename(&attachments, backup_dir.join("attachments"));
    }

    // Extract
    let file = File::open(&pending).map_err(|e| format!("Failed to open pending archive: {e}"))?;
    let decoder = GzDecoder::new(file);
    let mut archive = Archive::new(decoder);

    for entry in archive.entries().map_err(|e| format!("Invalid archive: {e}"))? {
        let mut entry = entry.map_err(|e| format!("Invalid archive entry: {e}"))?;
        let entry_path = entry
            .path()
            .map_err(|e| format!("Invalid entry path: {e}"))?
            .to_path_buf();

        if !is_allowed_restore_path(&entry_path) {
            return Err(format!(
                "Restore archive contains disallowed path: {}",
                entry_path.display()
            ));
        }

        let out_path = app_data_dir.join(&entry_path);
        if let Some(parent) = out_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create directory: {e}"))?;
        }

        entry
            .unpack(&out_path)
            .map_err(|e| format!("Failed to unpack entry '{}': {e}", entry_path.display()))?;
    }

    // Remove pending archive
    std::fs::remove_file(&pending).map_err(|e| format!("Failed to remove pending archive: {e}"))?;

    let device_id = get_or_create_device_id(app_data_dir);
    log::info!("Restore applied successfully (device_id={})", device_id);

    // Emit an event so the frontend can show a notification if it wants.
    let _ = app_handle.emit("s3-sync-restore-applied", serde_json::json!({ "ok": true }));

    Ok(())
}
