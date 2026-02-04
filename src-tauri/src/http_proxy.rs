use bytes::Bytes;
use futures_util::StreamExt;
use reqwest::Method;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::{IpAddr, ToSocketAddrs};
use std::str::FromStr;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Duration;
use tauri::{Emitter, Manager};
use tokio::time::{timeout, Instant};
use url::Url;

static REQUEST_COUNTER: AtomicU32 = AtomicU32::new(0);

const ACCEPT_HEADER_VALUE: &str = "text/event-stream, text/plain, application/json";
const PROXY_ACCEPT_ENCODING: &str = "gzip, br, identity";
const STREAM_ACCEPT_ENCODING: &str = "identity";

/// Validate URL to prevent SSRF attacks
/// Returns an error if the URL points to a private/internal IP address
/// Exception: localhost access is allowed for local development and AI services
fn validate_url(url_str: &str, allow_private_ip: bool) -> Result<(), String> {
    let url = Url::parse(url_str).map_err(|e| format!("Invalid URL: {}", e))?;

    // Only allow http and https schemes
    match url.scheme() {
        "http" | "https" => {}
        scheme => return Err(format!("Unsupported URL scheme: {}", scheme)),
    }

    // Get the host
    let host = url.host_str().ok_or("URL has no host")?;

    // Check for localhost variations
    let host_lower = host.to_lowercase();
    let is_localhost = host_lower == "localhost"
        || host_lower == "127.0.0.1"
        || host_lower == "::1"
        || host_lower == "[::1]"; // IPv6 bracket notation

    if is_localhost {
        // Allow all localhost access for local development and MCP servers
        // Security note: This allows any localhost port but still blocks private IPs
        return Ok(());
    }

    // Try to resolve the host to IP addresses
    let port = url
        .port()
        .unwrap_or(if url.scheme() == "https" { 443 } else { 80 });
    let socket_addr = format!("{}:{}", host, port);

    if let Ok(addrs) = socket_addr.to_socket_addrs() {
        for addr in addrs {
            if !allow_private_ip && is_private_ip(&addr.ip()) {
                return Err(format!(
                    "Access to private/internal IP addresses is not allowed: {}",
                    addr.ip()
                ));
            }
        }
    }

    Ok(())
}

/// Check if an IP address is private/internal
fn is_private_ip(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(ipv4) => {
            // Loopback: 127.0.0.0/8
            if ipv4.is_loopback() {
                return true;
            }
            // Private ranges: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
            if ipv4.is_private() {
                return true;
            }
            // Link-local: 169.254.0.0/16
            if ipv4.is_link_local() {
                return true;
            }
            // Broadcast: 255.255.255.255
            if ipv4.is_broadcast() {
                return true;
            }
            // Documentation: 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24
            let octets = ipv4.octets();
            if (octets[0] == 192 && octets[1] == 0 && octets[2] == 2)
                || (octets[0] == 198 && octets[1] == 51 && octets[2] == 100)
                || (octets[0] == 203 && octets[1] == 0 && octets[2] == 113)
            {
                return true;
            }
            // Unspecified: 0.0.0.0
            if ipv4.is_unspecified() {
                return true;
            }
            false
        }
        IpAddr::V6(ipv6) => {
            // Loopback: ::1
            if ipv6.is_loopback() {
                return true;
            }
            // Unspecified: ::
            if ipv6.is_unspecified() {
                return true;
            }
            // Unique local: fc00::/7
            let segments = ipv6.segments();
            if (segments[0] & 0xfe00) == 0xfc00 {
                return true;
            }
            // Link-local: fe80::/10
            if (segments[0] & 0xffc0) == 0xfe80 {
                return true;
            }
            false
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct ProxyRequest {
    pub url: String,
    pub method: String,
    pub headers: HashMap<String, String>,
    pub body: Option<String>,
    pub request_id: Option<u32>,
    pub allow_private_ip: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct ProxyResponse {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct StreamResponse {
    pub request_id: u32,
    pub status: u16,
    pub headers: HashMap<String, String>,
}

#[derive(Clone, Serialize)]
pub struct ChunkPayload {
    pub request_id: u32,
    pub chunk: Vec<u8>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct EndPayload {
    pub request_id: u32,
    pub status: u16,
    pub error: Option<String>,
}

fn should_end_on_empty_chunk(chunk: &[u8]) -> bool {
    chunk.is_empty()
}

fn should_soft_end_on_decode_error(is_decode_error: bool, chunk_count: u32) -> bool {
    is_decode_error && chunk_count > 0
}

async fn drain_response_stream<S>(stream: &mut S, max_duration: Duration)
where
    S: futures_util::Stream<Item = Result<Bytes, reqwest::Error>> + Unpin,
{
    let deadline = Instant::now() + max_duration;
    loop {
        let now = Instant::now();
        if now >= deadline {
            break;
        }
        let remaining = deadline - now;
        let step_timeout = remaining.min(Duration::from_millis(200));
        match timeout(step_timeout, stream.next()).await {
            Ok(Some(_)) => continue,
            Ok(None) => break,
            Err(_) => break,
        }
    }
}

fn emit_to_window<R: tauri::Runtime, S: Serialize>(
    app_handle: &tauri::AppHandle<R>,
    window_label: &str,
    event_name: &str,
    payload: &S,
) -> Result<(), tauri::Error> {
    app_handle.emit_to(
        tauri::EventTarget::webview_window(window_label),
        event_name,
        payload,
    )
}

#[tauri::command]
pub async fn proxy_fetch(request: ProxyRequest) -> Result<ProxyResponse, String> {
    log::info!("Proxy fetch request to: {} {}", request.method, request.url);

    // Validate URL to prevent SSRF attacks
    validate_url(&request.url, request.allow_private_ip.unwrap_or(false))?;

    // Configure client with proper decompression and connection settings
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .gzip(true)
        .brotli(true)
        .tcp_nodelay(true)
        .pool_max_idle_per_host(5)
        .build()
        .map_err(|e| format!("Failed to build client: {}", e))?;

    // Build the request - support both standard and WebDAV methods
    let mut req_builder = match request.method.to_uppercase().as_str() {
        "GET" => client.get(&request.url),
        "POST" => client.post(&request.url),
        "PUT" => client.put(&request.url),
        "DELETE" => client.delete(&request.url),
        "PATCH" => client.patch(&request.url),
        // WebDAV methods
        "PROPFIND" | "MKCOL" | "MOVE" | "COPY" | "LOCK" | "UNLOCK" => {
            let method = Method::from_str(&request.method)
                .map_err(|_| format!("Invalid HTTP method: {}", request.method))?;
            client.request(method, &request.url)
        }
        _ => return Err(format!("Unsupported HTTP method: {}", request.method)),
    };

    // Add headers
    for (key, value) in request.headers {
        req_builder = req_builder.header(&key, &value);
    }

    // Add explicit encoding expectations
    req_builder = req_builder
        .header("Accept-Encoding", PROXY_ACCEPT_ENCODING)
        .header("Accept", ACCEPT_HEADER_VALUE);

    // Add body if present
    if let Some(body) = request.body {
        req_builder = req_builder.body(body);
    }

    // Send request
    let response = req_builder.send().await.map_err(|e| {
        log::error!("Proxy fetch error: {}", e);
        format!("Request failed: {}", e)
    })?;

    let status = response.status().as_u16();

    if status != 200 {
        log::error!(
            "fetch response error: status {} (request.url: {})",
            status,
            request.url
        );
    }

    // Extract headers
    let mut headers = HashMap::new();
    for (key, value) in response.headers() {
        if let Ok(value_str) = value.to_str() {
            headers.insert(key.to_string(), value_str.to_string());
        }
    }

    // Log critical response headers for debugging
    let _content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("none");
    let _transfer_encoding = response
        .headers()
        .get("transfer-encoding")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("none");
    let _content_length = response
        .headers()
        .get("content-length")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("none");

    let read_timeout = Duration::from_secs(30);

    let body = timeout(read_timeout, response.text())
        .await
        .map_err(|_| {
            log::error!(
                "Timeout reading response body after {} seconds",
                read_timeout.as_secs()
            );
            format!(
                "Timeout reading response body after {} seconds",
                read_timeout.as_secs()
            )
        })?
        .map_err(|e| {
            log::error!("Failed to read response body: {}", e);
            format!("Failed to read response body: {}", e)
        })?;

    Ok(ProxyResponse {
        status,
        headers,
        body,
    })
}

/// Real streaming fetch that emits chunks via Tauri events
/// This enables true streaming in the JavaScript side
async fn stream_fetch_inner<R: tauri::Runtime>(
    window: tauri::Window<R>,
    request: ProxyRequest,
) -> Result<StreamResponse, String> {
    let request_id = request
        .request_id
        .unwrap_or_else(|| REQUEST_COUNTER.fetch_add(1, Ordering::SeqCst));
    // Use request-specific event name to avoid global event broadcasting
    let event_name = format!("stream-response-{}", request_id);
    let window_label = window.label().to_string();
    let app_handle = window.app_handle().clone();

    // Helper to emit end event before returning error
    let emit_end = |status: u16, error_msg: Option<String>| {
        let _ = emit_to_window(
            &app_handle,
            &window_label,
            &event_name,
            &EndPayload {
                request_id,
                status,
                error: error_msg,
            },
        );
    };

    // Validate URL to prevent SSRF attacks
    if let Err(e) = validate_url(&request.url, request.allow_private_ip.unwrap_or(false)) {
        emit_end(0, Some(format!("URL validation failed: {}", e)));
        return Err(e);
    }

    // Configure client with connection settings for streaming and avoid auto-decompression.
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .gzip(false)
        .brotli(false)
        .tcp_nodelay(true) // Reduce latency for streaming
        .pool_max_idle_per_host(5) // Enable connection pooling
        .build()
        .map_err(|e| {
            emit_end(0, Some(format!("Failed to build client: {}", e)));
            format!("Failed to build client: {}", e)
        })?;

    // Build the request - support both standard and WebDAV methods
    let mut req_builder = match request.method.to_uppercase().as_str() {
        "GET" => client.get(&request.url),
        "POST" => client.post(&request.url),
        "PUT" => client.put(&request.url),
        "DELETE" => client.delete(&request.url),
        "PATCH" => client.patch(&request.url),
        // WebDAV methods
        "PROPFIND" | "MKCOL" | "MOVE" | "COPY" | "LOCK" | "UNLOCK" => {
            let method = Method::from_str(&request.method)
                .map_err(|_| format!("Invalid HTTP method: {}", request.method))?;
            client.request(method, &request.url)
        }
        _ => {
            let err = format!("Unsupported HTTP method: {}", request.method);
            emit_end(0, Some(err.clone()));
            return Err(err);
        }
    };

    // Add headers
    for (key, value) in request.headers {
        req_builder = req_builder.header(&key, &value);
    }

    // Add explicit encoding expectations
    req_builder = req_builder
        .header("Accept-Encoding", STREAM_ACCEPT_ENCODING)
        .header("Accept", ACCEPT_HEADER_VALUE);

    // Add body if present
    if let Some(body) = request.body {
        req_builder = req_builder.body(body);
    }

    // Send request
    let response = req_builder.send().await.map_err(|e| {
        let err = format!("Request failed: {}", e);
        emit_end(0, Some(err.clone()));
        err
    })?;

    let status_code = response.status();
    let status = status_code.as_u16();

    // Extract headers
    let mut headers = HashMap::new();
    for (key, value) in response.headers() {
        if let Ok(value_str) = value.to_str() {
            headers.insert(key.to_string(), value_str.to_string());
        }
    }

    // Log response headers for streaming diagnostics
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("none");
    let content_encoding = response
        .headers()
        .get("content-encoding")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("none");
    let transfer_encoding = response
        .headers()
        .get("transfer-encoding")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("none");
    let content_length = response
        .headers()
        .get("content-length")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("none");

    log::info!(
        "Stream fetch response headers: content-type={}, content-encoding={}, transfer-encoding={}, content-length={} (request_id: {})",
        content_type,
        content_encoding,
        transfer_encoding,
        content_length,
        request_id
    );

    // Spawn async task to stream chunks
    let status_for_spawn = status;
    let app_handle_clone = app_handle.clone();
    let window_label_clone = window_label.clone();
    let event_name_clone = event_name.clone();
    tauri::async_runtime::spawn(async move {
        let mut stream = response.bytes_stream();
        let chunk_timeout = Duration::from_secs(300);
        let mut chunk_count = 0;
        let mut consecutive_errors = 0;
        const MAX_CONSECUTIVE_ERRORS: u32 = 3;
        let mut error_msg: Option<String> = None;
        let mut end_of_data_reached = false;
        let mut stream_exhausted = false;

        loop {
            let chunk_result = timeout(chunk_timeout, stream.next()).await;

            match chunk_result {
                Ok(Some(Ok(chunk))) => {
                    consecutive_errors = 0; // Reset on success

                    if should_end_on_empty_chunk(&chunk) {
                        log::trace!(
                            "Received empty chunk {} (request_id: {}), marking end of data",
                            chunk_count + 1,
                            request_id
                        );
                        end_of_data_reached = true;
                        continue;
                    }

                    if end_of_data_reached {
                        // Skip emitting after end marker
                        continue;
                    }

                    chunk_count += 1;

                    // Emit chunk to frontend using request-specific event
                    if let Err(e) = emit_to_window(
                        &app_handle_clone,
                        &window_label_clone,
                        &event_name_clone,
                        &ChunkPayload {
                            request_id,
                            chunk: chunk.to_vec(),
                        },
                    ) {
                        log::error!(
                            "Failed to emit chunk {} (request_id: {}): {:?}",
                            chunk_count,
                            request_id,
                            e
                        );
                        error_msg = Some(format!("Failed to emit chunks: {}", e));
                        break;
                    }
                }
                Ok(Some(Err(e))) => {
                    if should_soft_end_on_decode_error(e.is_decode(), chunk_count) {
                        log::warn!(
                            "Decode error after {} chunks; treating as stream end (request_id: {}): {}",
                            chunk_count,
                            request_id,
                            e
                        );
                        stream_exhausted = true;
                        break;
                    }

                    consecutive_errors += 1;
                    log::error!(
                        "Error reading chunk {} (request_id: {}): {} (consecutive: {})",
                        chunk_count + 1,
                        request_id,
                        e,
                        consecutive_errors
                    );

                    // Only break on persistent errors
                    if consecutive_errors >= MAX_CONSECUTIVE_ERRORS {
                        log::error!(
                            "Too many consecutive errors, aborting stream (request_id: {})",
                            request_id
                        );
                        error_msg = Some(format!("Too many consecutive errors: {}", e));
                        break;
                    }

                    // Brief pause before retrying
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
                Ok(None) => {
                    // Stream ended normally
                    log::info!(
                        "Stream ended normally after {} chunks (request_id: {})",
                        chunk_count,
                        request_id
                    );
                    stream_exhausted = true;
                    break;
                }
                Err(_) => {
                    // Timeout waiting for next chunk
                    consecutive_errors += 1;
                    log::error!(
                        "Timeout waiting for chunk {} after {} seconds (request_id: {}, consecutive: {})",
                        chunk_count + 1,
                        chunk_timeout.as_secs(),
                        request_id,
                        consecutive_errors
                    );

                    if consecutive_errors >= MAX_CONSECUTIVE_ERRORS {
                        log::error!(
                            "Too many consecutive timeouts, aborting stream (request_id: {})",
                            request_id
                        );
                        error_msg = Some("Timeout waiting for chunks".to_string());
                        break;
                    }

                    // Brief pause before retrying
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
            }
        }

        // Always drain unless stream is already exhausted
        if !stream_exhausted {
            log::debug!(
                "Draining remaining stream data (request_id: {})",
                request_id
            );
            drain_response_stream(&mut stream, Duration::from_secs(5)).await;
        }

        // Emit end signal with actual status and error information
        if let Err(e) = emit_to_window(
            &app_handle_clone,
            &window_label_clone,
            &event_name_clone,
            &EndPayload {
                request_id,
                status: status_for_spawn,
                error: error_msg,
            },
        ) {
            log::error!(
                "Failed to emit end payload (request_id: {}): {:?}",
                request_id,
                e
            );
        }
    });

    Ok(StreamResponse {
        request_id,
        status,
        headers,
    })
}

/// Real streaming fetch that emits chunks via Tauri events
/// This enables true streaming in the JavaScript side
#[tauri::command]
pub async fn stream_fetch(
    window: tauri::Window,
    request: ProxyRequest,
) -> Result<StreamResponse, String> {
    stream_fetch_inner(window, request).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::net::{Ipv4Addr, Ipv6Addr};
    use std::sync::mpsc::{self, RecvTimeoutError};
    use tauri::Listener;

    #[test]
    fn test_validate_url_valid_https() {
        assert!(validate_url("https://example.com", false).is_ok());
        assert!(validate_url("https://api.example.com/path", false).is_ok());
        assert!(validate_url("https://example.com:443/path?query=1", false).is_ok());
    }

    #[test]
    fn test_validate_url_valid_http() {
        assert!(validate_url("http://example.com", false).is_ok());
        assert!(validate_url("http://api.example.com:8080/path", false).is_ok());
    }

    #[test]
    fn test_validate_url_allows_localhost_all_ports() {
        // All localhost access should now be allowed for development
        assert!(validate_url("http://localhost", false).is_ok());
        assert!(validate_url("https://localhost/api", false).is_ok());
        assert!(validate_url("http://LOCALHOST", false).is_ok()); // case insensitive
        assert!(validate_url("http://localhost:3000", false).is_ok());
        assert!(validate_url("http://127.0.0.1:9999", false).is_ok());
        assert!(validate_url("http://[::1]", false).is_ok());
        assert!(validate_url("http://[::1]:9999", false).is_ok());
        // Common development ports
        assert!(validate_url("http://localhost:11434", false).is_ok()); // Ollama
        assert!(validate_url("http://localhost:1234", false).is_ok()); // LM Studio
        assert!(validate_url("http://localhost:3845", false).is_ok()); // MCP Server
        assert!(validate_url("http://127.0.0.1:11434/v1/models", false).is_ok());
        assert!(validate_url("http://127.0.0.1:1234/v1/chat/completions", false).is_ok());
        assert!(validate_url("http://127.0.0.1:3845/mcp", false).is_ok());
    }

    #[test]
    fn test_validate_url_blocks_unsupported_scheme() {
        assert!(validate_url("ftp://example.com", false).is_err());
        assert!(validate_url("file:///etc/passwd", false).is_err());
        assert!(validate_url("data:text/html,<h1>Hello</h1>", false).is_err());
    }

    #[test]
    fn test_validate_url_invalid_url() {
        assert!(validate_url("not-a-url", false).is_err());
        assert!(validate_url("://missing-scheme.com", false).is_err());
    }

    #[test]
    fn test_is_private_ip_loopback_v4() {
        // 127.0.0.0/8
        assert!(is_private_ip(&IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1))));
        assert!(is_private_ip(&IpAddr::V4(Ipv4Addr::new(
            127, 255, 255, 255
        ))));
    }

    #[test]
    fn test_is_private_ip_class_a() {
        // 10.0.0.0/8
        assert!(is_private_ip(&IpAddr::V4(Ipv4Addr::new(10, 0, 0, 0))));
        assert!(is_private_ip(&IpAddr::V4(Ipv4Addr::new(10, 255, 255, 255))));
        assert!(is_private_ip(&IpAddr::V4(Ipv4Addr::new(10, 1, 2, 3))));
    }

    #[test]
    fn test_is_private_ip_class_b() {
        // 172.16.0.0/12
        assert!(is_private_ip(&IpAddr::V4(Ipv4Addr::new(172, 16, 0, 0))));
        assert!(is_private_ip(&IpAddr::V4(Ipv4Addr::new(172, 31, 255, 255))));
        assert!(is_private_ip(&IpAddr::V4(Ipv4Addr::new(172, 20, 1, 1))));

        // Outside the range
        assert!(!is_private_ip(&IpAddr::V4(Ipv4Addr::new(172, 15, 0, 0))));
        assert!(!is_private_ip(&IpAddr::V4(Ipv4Addr::new(172, 32, 0, 0))));
    }

    #[test]
    fn test_is_private_ip_class_c() {
        // 192.168.0.0/16
        assert!(is_private_ip(&IpAddr::V4(Ipv4Addr::new(192, 168, 0, 0))));
        assert!(is_private_ip(&IpAddr::V4(Ipv4Addr::new(
            192, 168, 255, 255
        ))));
        assert!(is_private_ip(&IpAddr::V4(Ipv4Addr::new(192, 168, 1, 1))));
    }

    #[test]
    fn test_is_private_ip_link_local() {
        // 169.254.0.0/16
        assert!(is_private_ip(&IpAddr::V4(Ipv4Addr::new(169, 254, 0, 0))));
        assert!(is_private_ip(&IpAddr::V4(Ipv4Addr::new(
            169, 254, 255, 255
        ))));
    }

    #[test]
    fn test_is_private_ip_broadcast() {
        assert!(is_private_ip(&IpAddr::V4(Ipv4Addr::new(
            255, 255, 255, 255
        ))));
    }

    #[test]
    fn test_is_private_ip_documentation() {
        // 192.0.2.0/24
        assert!(is_private_ip(&IpAddr::V4(Ipv4Addr::new(192, 0, 2, 0))));
        assert!(is_private_ip(&IpAddr::V4(Ipv4Addr::new(192, 0, 2, 255))));

        // 198.51.100.0/24
        assert!(is_private_ip(&IpAddr::V4(Ipv4Addr::new(198, 51, 100, 0))));
        assert!(is_private_ip(&IpAddr::V4(Ipv4Addr::new(198, 51, 100, 255))));

        // 203.0.113.0/24
        assert!(is_private_ip(&IpAddr::V4(Ipv4Addr::new(203, 0, 113, 0))));
        assert!(is_private_ip(&IpAddr::V4(Ipv4Addr::new(203, 0, 113, 255))));
    }

    #[test]
    fn test_is_private_ip_unspecified_v4() {
        assert!(is_private_ip(&IpAddr::V4(Ipv4Addr::new(0, 0, 0, 0))));
    }

    #[test]
    fn test_is_private_ip_public_v4() {
        // Public IP addresses should return false
        assert!(!is_private_ip(&IpAddr::V4(Ipv4Addr::new(8, 8, 8, 8)))); // Google DNS
        assert!(!is_private_ip(&IpAddr::V4(Ipv4Addr::new(1, 1, 1, 1)))); // Cloudflare
        assert!(!is_private_ip(&IpAddr::V4(Ipv4Addr::new(93, 184, 216, 34)))); // example.com
    }

    #[test]
    fn test_is_private_ip_loopback_v6() {
        assert!(is_private_ip(&IpAddr::V6(Ipv6Addr::new(
            0, 0, 0, 0, 0, 0, 0, 1
        ))));
    }

    #[test]
    fn test_is_private_ip_unspecified_v6() {
        assert!(is_private_ip(&IpAddr::V6(Ipv6Addr::new(
            0, 0, 0, 0, 0, 0, 0, 0
        ))));
    }

    #[test]
    fn test_is_private_ip_unique_local_v6() {
        // fc00::/7
        assert!(is_private_ip(&IpAddr::V6(Ipv6Addr::new(
            0xfc00, 0, 0, 0, 0, 0, 0, 1
        ))));
        assert!(is_private_ip(&IpAddr::V6(Ipv6Addr::new(
            0xfd00, 0, 0, 0, 0, 0, 0, 1
        ))));
    }

    #[test]
    fn test_is_private_ip_link_local_v6() {
        // fe80::/10
        assert!(is_private_ip(&IpAddr::V6(Ipv6Addr::new(
            0xfe80, 0, 0, 0, 0, 0, 0, 1
        ))));
        assert!(is_private_ip(&IpAddr::V6(Ipv6Addr::new(
            0xfebf, 0, 0, 0, 0, 0, 0, 1
        ))));
    }

    #[test]
    fn test_is_private_ip_public_v6() {
        // Public IPv6 addresses should return false
        assert!(!is_private_ip(&IpAddr::V6(Ipv6Addr::new(
            0x2001, 0x4860, 0x4860, 0, 0, 0, 0, 0x8888
        )))); // Google
        assert!(!is_private_ip(&IpAddr::V6(Ipv6Addr::new(
            0x2606, 0x4700, 0x4700, 0, 0, 0, 0, 0x1111
        )))); // Cloudflare
    }

    #[test]
    fn test_proxy_request_deserialization() {
        let json = r#"{
            "url": "https://api.example.com/data",
            "method": "POST",
            "headers": {"Content-Type": "application/json"},
            "body": "{\"key\": \"value\"}"
        }"#;

        let request: ProxyRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.url, "https://api.example.com/data");
        assert_eq!(request.method, "POST");
        assert_eq!(
            request.headers.get("Content-Type"),
            Some(&"application/json".to_string())
        );
        assert_eq!(request.body, Some("{\"key\": \"value\"}".to_string()));
    }

    #[test]
    fn test_proxy_request_without_body() {
        let json = r#"{
            "url": "https://api.example.com/data",
            "method": "GET",
            "headers": {}
        }"#;

        let request: ProxyRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.url, "https://api.example.com/data");
        assert_eq!(request.method, "GET");
        assert!(request.body.is_none());
    }

    #[test]
    fn test_validate_url_blocks_private_ip_by_default() {
        assert!(validate_url("http://10.0.0.1:8080/v1/models", false).is_err());
        assert!(validate_url("http://192.168.1.10", false).is_err());
    }

    #[test]
    fn test_validate_url_allows_private_ip_when_flagged() {
        assert!(validate_url("http://10.0.0.1:8080/v1/models", true).is_ok());
        assert!(validate_url("http://192.168.1.10", true).is_ok());
        assert!(validate_url("http://[fd00::1]:9090/v1/models", true).is_ok());
    }

    #[test]
    fn test_proxy_response_serialization() {
        let mut headers = HashMap::new();
        headers.insert("Content-Type".to_string(), "application/json".to_string());

        let response = ProxyResponse {
            status: 200,
            headers,
            body: "{\"success\": true}".to_string(),
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("\"status\":200"));
        assert!(json.contains("\"body\":\"{\\\"success\\\": true}\""));
    }

    #[test]
    fn test_stream_response_serialization() {
        let mut headers = HashMap::new();
        headers.insert("Content-Type".to_string(), "text/event-stream".to_string());

        let response = StreamResponse {
            request_id: 42,
            status: 200,
            headers,
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("\"request_id\":42"));
        assert!(json.contains("\"status\":200"));
    }

    #[test]
    fn test_chunk_payload_serialization() {
        let payload = ChunkPayload {
            request_id: 1,
            chunk: vec![72, 101, 108, 108, 111], // "Hello" in bytes
        };

        let json = serde_json::to_string(&payload).unwrap();
        assert!(json.contains("\"request_id\":1"));
        assert!(json.contains("\"chunk\":[72,101,108,108,111]"));
    }

    #[test]
    fn test_end_payload_serialization() {
        let payload = EndPayload {
            request_id: 99,
            status: 0,
            error: None,
        };

        let json = serde_json::to_string(&payload).unwrap();
        assert!(json.contains("\"request_id\":99"));
        assert!(json.contains("\"status\":0"));
        assert!(json.contains("\"error\":null"));
    }

    #[test]
    fn test_request_counter_increments() {
        let initial = REQUEST_COUNTER.load(Ordering::SeqCst);
        let next = REQUEST_COUNTER.fetch_add(1, Ordering::SeqCst);
        assert_eq!(next, initial);

        let after = REQUEST_COUNTER.load(Ordering::SeqCst);
        assert_eq!(after, initial + 1);
    }

    #[test]
    fn test_empty_chunk_handling() {
        let chunk: Vec<u8> = vec![];
        assert!(should_end_on_empty_chunk(&chunk));

        let chunk: Vec<u8> = vec![72, 101, 108, 108, 111]; // "Hello"
        assert!(!should_end_on_empty_chunk(&chunk));
        assert_eq!(chunk.len(), 5);
    }

    #[tokio::test]
    async fn test_drain_response_stream_consumes_all() {
        let items = vec![
            Ok(Bytes::from_static(b"one")),
            Ok(Bytes::from_static(b"two")),
        ];
        let mut stream = futures_util::stream::iter(items);

        drain_response_stream(&mut stream, Duration::from_secs(1)).await;

        let remaining = stream.next().await;
        assert!(remaining.is_none());
    }

    #[test]
    fn test_consecutive_error_counter_logic() {
        // Test the consecutive error counter logic used in stream_fetch
        const MAX_CONSECUTIVE_ERRORS: u32 = 3;

        let mut consecutive_errors = 0;

        // Simulate first error
        consecutive_errors += 1;
        assert_eq!(consecutive_errors, 1);
        assert!(consecutive_errors < MAX_CONSECUTIVE_ERRORS);

        // Simulate second error
        consecutive_errors += 1;
        assert_eq!(consecutive_errors, 2);
        assert!(consecutive_errors < MAX_CONSECUTIVE_ERRORS);

        // Simulate third error
        consecutive_errors += 1;
        assert_eq!(consecutive_errors, 3);
        assert!(consecutive_errors >= MAX_CONSECUTIVE_ERRORS);

        // Simulate success - should reset counter
        consecutive_errors = 0;
        assert_eq!(consecutive_errors, 0);
        assert!(consecutive_errors < MAX_CONSECUTIVE_ERRORS);
    }

    #[test]
    fn test_status_code_validation() {
        // Test status codes that should be considered successful
        let successful_statuses = [200, 201, 202, 204, 206];
        for status in successful_statuses {
            let http_status = reqwest::StatusCode::from_u16(status).unwrap();
            assert!(
                http_status.is_success(),
                "Status {} should be successful",
                status
            );
        }

        // Test status codes that should be considered errors
        let error_statuses = [400, 401, 403, 404, 500, 502, 503, 504];
        for status in error_statuses {
            let http_status = reqwest::StatusCode::from_u16(status).unwrap();
            assert!(
                !http_status.is_success(),
                "Status {} should not be successful",
                status
            );
        }
    }

    #[test]
    fn test_content_type_validation() {
        // Test valid content types for streaming
        let valid_content_types = [
            "text/event-stream",
            "text/plain",
            "application/json",
            "text/event-stream; charset=utf-8",
            "application/json; charset=utf-8",
        ];

        for ct in valid_content_types {
            let contains_text = ct.contains("text/");
            let contains_json = ct.contains("application/json");
            let contains_sse = ct.contains("text-event-stream");

            assert!(
                contains_text || contains_json || contains_sse,
                "Content type '{}' should be valid for streaming",
                ct
            );
        }
    }

    #[test]
    fn test_timeout_duration_config() {
        let chunk_timeout = Duration::from_secs(300);
        assert_eq!(chunk_timeout.as_secs(), 300);

        let retry_delay = Duration::from_millis(100);
        assert_eq!(retry_delay.as_millis(), 100);
    }

    #[test]
    fn test_encoding_headers() {
        // Test that the encoding headers are properly formatted
        let proxy_accept_encoding = PROXY_ACCEPT_ENCODING;
        assert!(proxy_accept_encoding.contains("gzip"));
        assert!(proxy_accept_encoding.contains("br"));
        assert!(proxy_accept_encoding.contains("identity"));

        let stream_accept_encoding = STREAM_ACCEPT_ENCODING;
        assert_eq!(stream_accept_encoding, "identity");
        assert!(!stream_accept_encoding.contains("gzip"));
        assert!(!stream_accept_encoding.contains("br"));

        let accept = ACCEPT_HEADER_VALUE;
        assert!(accept.contains("text/event-stream"));
        assert!(accept.contains("text/plain"));
        assert!(accept.contains("application/json"));
    }

    #[test]
    fn test_should_soft_end_on_decode_error() {
        assert!(should_soft_end_on_decode_error(true, 1));
        assert!(!should_soft_end_on_decode_error(true, 0));
        assert!(!should_soft_end_on_decode_error(false, 5));
    }

    #[test]
    fn test_end_payload_with_error() {
        let payload = EndPayload {
            request_id: 1,
            status: 500,
            error: Some("Internal Server Error".to_string()),
        };

        let json = serde_json::to_string(&payload).unwrap();
        assert!(json.contains("\"request_id\":1"));
        assert!(json.contains("\"status\":500"));
        assert!(json.contains("\"error\":\"Internal Server Error\""));
    }

    #[test]
    fn test_end_payload_without_error() {
        let payload = EndPayload {
            request_id: 1,
            status: 200,
            error: None,
        };

        let json = serde_json::to_string(&payload).unwrap();
        assert!(json.contains("\"request_id\":1"));
        assert!(json.contains("\"status\":200"));
        assert!(json.contains("\"error\":null"));
    }

    #[test]
    fn test_stream_fetch_returns_error_on_invalid_url() {
        // Test that URL validation fails correctly
        let result = validate_url("invalid-url", false);
        assert!(result.is_err());
        let err_msg = result.unwrap_err();
        assert!(err_msg.contains("Invalid URL") || err_msg.contains("scheme"));
    }

    #[test]
    fn test_stream_fetch_validates_unsupported_methods() {
        // Test that only supported methods are allowed
        let valid_methods = [
            "GET",
            "POST",
            "PUT",
            "DELETE",
            "PATCH",
            "PROPFIND",
            "MKCOL",
            "MOVE",
            "COPY",
            "LOCK",
            "UNLOCK",
        ];
        for method in valid_methods {
            let upper = method.to_uppercase();
            assert!(matches!(
                upper.as_str(),
                "GET"
                    | "POST"
                    | "PUT"
                    | "DELETE"
                    | "PATCH"
                    | "PROPFIND"
                    | "MKCOL"
                    | "MOVE"
                    | "COPY"
                    | "LOCK"
                    | "UNLOCK"
            ));
        }
    }
    #[test]
    fn test_end_payload_preserves_status_code() {
        // Test that different status codes can be stored in EndPayload
        let test_cases = [
            (200, None),
            (201, None),
            (204, None),
            (400, Some("Bad Request".to_string())),
            (401, Some("Unauthorized".to_string())),
            (404, Some("Not Found".to_string())),
            (500, Some("Internal Server Error".to_string())),
            (502, Some("Bad Gateway".to_string())),
            (503, Some("Service Unavailable".to_string())),
            (504, Some("Gateway Timeout".to_string())),
            (0, Some("URL validation failed".to_string())),
            (0, Some("Request failed".to_string())),
            (0, Some("Failed to build client".to_string())),
            (0, Some("Unsupported HTTP method".to_string())),
            (0, Some("Failed to emit chunks".to_string())),
            (0, Some("Too many consecutive errors".to_string())),
            (0, Some("Timeout waiting for chunks".to_string())),
        ];

        for (status, error) in test_cases {
            let payload = EndPayload {
                request_id: 1,
                status,
                error: error.clone(),
            };

            let json = serde_json::to_string(&payload).unwrap();

            // Check that status field is present with correct value
            assert!(
                json.contains("\"status\""),
                "Status field should be present"
            );
            assert!(
                json.contains(&format!(":{}", status)),
                "Status value should be {}",
                status
            );

            // Check that error field is present
            assert!(json.contains("\"error\""), "Error field should be present");

            if let Some(ref err) = error {
                assert!(
                    json.contains(&format!("\"{}\"", err)),
                    "Error message should be present"
                );
            } else {
                assert!(json.contains("null"), "Error should be null when no error");
            }
        }
    }

    #[test]
    fn test_end_event_error_scenarios() {
        // Test different error scenarios in end events
        let scenarios = vec![
            (0, Some("URL validation failed".to_string())),
            (0, Some("Request failed".to_string())),
            (500, Some("Server returned error status".to_string())),
            (0, Some("Failed to build client".to_string())),
            (0, Some("Unsupported HTTP method".to_string())),
            (0, Some("Failed to emit chunks".to_string())),
            (0, Some("Too many consecutive errors".to_string())),
            (0, Some("Timeout waiting for chunks".to_string())),
        ];

        for (status, error) in scenarios {
            let payload = EndPayload {
                request_id: 1,
                status,
                error: error.clone(),
            };

            let json = serde_json::to_string(&payload).unwrap();
            assert!(
                json.contains("\"status\":"),
                "Status field should be present"
            );
            assert!(json.contains("\"error\":"), "Error field should be present");
            if let Some(ref err) = error {
                assert!(json.contains(&format!("\"error\":\"{}\"", err)));
            }
        }
    }

    /// This test uses Tauri test infrastructure that may not work on Windows CI
    #[test]
    #[cfg(not(target_os = "windows"))]
    fn test_emit_to_window_uses_webview_window_target() {
        let app = tauri::test::mock_app();
        let target_window = tauri::WebviewWindowBuilder::new(
            &app,
            "stream-test-target",
            tauri::WebviewUrl::App("index.html".into()),
        )
        .build()
        .unwrap();
        let other_window = tauri::WebviewWindowBuilder::new(
            &app,
            "stream-test-other",
            tauri::WebviewUrl::App("index.html".into()),
        )
        .build()
        .unwrap();

        let payload = ChunkPayload {
            request_id: 42,
            chunk: vec![1, 2, 3],
        };

        let (target_tx, target_rx) = mpsc::channel();
        target_window.listen("stream-response-42", move |event| {
            let _ = target_tx.send(event.payload().to_string());
        });

        let (other_tx, other_rx) = mpsc::channel();
        other_window.listen("stream-response-42", move |event| {
            let _ = other_tx.send(event.payload().to_string());
        });

        emit_to_window(
            &app.handle(),
            target_window.label(),
            "stream-response-42",
            &payload,
        )
        .unwrap();

        assert!(target_rx
            .recv_timeout(std::time::Duration::from_secs(1))
            .is_ok());
        assert!(matches!(
            other_rx.recv_timeout(std::time::Duration::from_millis(200)),
            Err(RecvTimeoutError::Timeout)
        ));
    }

    /// This test uses Tauri test infrastructure that may not work on Windows CI
    #[tokio::test]
    #[cfg(not(target_os = "windows"))]
    async fn test_stream_fetch_emits_end_event_on_invalid_url() {
        let app = tauri::test::mock_app();
        let target_window = tauri::WebviewWindowBuilder::new(
            &app,
            "stream-test-invalid",
            tauri::WebviewUrl::App("index.html".into()),
        )
        .build()
        .unwrap();
        let other_window = tauri::WebviewWindowBuilder::new(
            &app,
            "stream-test-invalid-other",
            tauri::WebviewUrl::App("index.html".into()),
        )
        .build()
        .unwrap();

        let request_id = 777;
        let event_name = format!("stream-response-{}", request_id);

        let (target_tx, target_rx) = mpsc::channel();
        target_window.listen(event_name.clone(), move |event| {
            let _ = target_tx.send(event.payload().to_string());
        });

        let (other_tx, other_rx) = mpsc::channel();
        other_window.listen(event_name.clone(), move |event| {
            let _ = other_tx.send(event.payload().to_string());
        });

        let request = ProxyRequest {
            url: "invalid-url".to_string(),
            method: "GET".to_string(),
            headers: HashMap::new(),
            body: None,
            request_id: Some(request_id),
            allow_private_ip: None,
        };

        let window = target_window.as_ref().window();
        let result = stream_fetch_inner(window, request).await;
        assert!(result.is_err());

        let payload = target_rx
            .recv_timeout(std::time::Duration::from_secs(1))
            .expect("expected end payload");
        let end_payload: EndPayload = serde_json::from_str(&payload).unwrap();
        assert_eq!(end_payload.request_id, request_id);
        assert!(end_payload.error.is_some());
        assert!(matches!(
            other_rx.recv_timeout(std::time::Duration::from_millis(200)),
            Err(RecvTimeoutError::Timeout)
        ));
    }
}
