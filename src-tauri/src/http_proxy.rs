use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::{IpAddr, ToSocketAddrs};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Duration;
use tokio::time::timeout;
use futures_util::StreamExt;
use tauri::Emitter;
use url::Url;

static REQUEST_COUNTER: AtomicU32 = AtomicU32::new(0);

/// Allowed localhost ports for local AI services
const ALLOWED_LOCALHOST_PORTS: &[u16] = &[
    11434, // Ollama
    1234,  // LM Studio (default)
];

/// Validate URL to prevent SSRF attacks
/// Returns an error if the URL points to a private/internal IP address
/// Exception: localhost access is allowed for specific AI service ports
fn validate_url(url_str: &str) -> Result<(), String> {
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
        || host_lower == "[::1]";  // IPv6 bracket notation

    if is_localhost {
        // Allow localhost access for specific AI service ports
        let port = url.port().unwrap_or(80);
        if ALLOWED_LOCALHOST_PORTS.contains(&port) {
            return Ok(()); // Allow access to local AI services
        }
        return Err("Access to localhost is not allowed".to_string());
    }

    // Try to resolve the host to IP addresses
    let port = url.port().unwrap_or(if url.scheme() == "https" { 443 } else { 80 });
    let socket_addr = format!("{}:{}", host, port);

    if let Ok(addrs) = socket_addr.to_socket_addrs() {
        for addr in addrs {
            if is_private_ip(&addr.ip()) {
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

#[derive(Clone, Serialize)]
pub struct EndPayload {
    pub request_id: u32,
    pub status: u16,
}

#[tauri::command]
pub async fn proxy_fetch(request: ProxyRequest) -> Result<ProxyResponse, String> {
    log::info!("Proxy fetch request to: {} {}", request.method, request.url);

    // Validate URL to prevent SSRF attacks
    validate_url(&request.url)?;

    let client = reqwest::Client::new();

    // Build the request
    let mut req_builder = match request.method.to_uppercase().as_str() {
        "GET" => client.get(&request.url),
        "POST" => client.post(&request.url),
        "PUT" => client.put(&request.url),
        "DELETE" => client.delete(&request.url),
        "PATCH" => client.patch(&request.url),
        _ => return Err(format!("Unsupported HTTP method: {}", request.method)),
    };

    // Add headers
    for (key, value) in request.headers {
        req_builder = req_builder.header(&key, &value);
    }

    // Add body if present
    if let Some(body) = request.body {
        req_builder = req_builder.body(body);
    }

    // Send request
    let response = req_builder
        .send()
        .await
        .map_err(|e| {
            log::error!("Proxy fetch error: {}", e);
            format!("Request failed: {}", e)
        })?;

    let status = response.status().as_u16();
    log::info!("Proxy fetch response status: {}", status);

    // Extract headers
    let mut headers = HashMap::new();
    for (key, value) in response.headers() {
        if let Ok(value_str) = value.to_str() {
            headers.insert(key.to_string(), value_str.to_string());
        }
    }

    // Log critical response headers for debugging
    let content_type = response.headers().get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("none");
    let transfer_encoding = response.headers().get("transfer-encoding")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("none");
    let content_length = response.headers().get("content-length")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("none");

    log::info!(
        "Response headers - Content-Type: {}, Transfer-Encoding: {}, Content-Length: {}",
        content_type, transfer_encoding, content_length
    );

    // Get response body with timeout
    log::info!("Starting to read response body...");
    let read_timeout = Duration::from_secs(30);

    let body = timeout(read_timeout, response.text())
        .await
        .map_err(|_| {
            log::error!("Timeout reading response body after {} seconds", read_timeout.as_secs());
            format!("Timeout reading response body after {} seconds", read_timeout.as_secs())
        })?
        .map_err(|e| {
            log::error!("Failed to read response body: {}", e);
            format!("Failed to read response body: {}", e)
        })?;

    log::info!("Response body read complete, length: {} bytes", body.len());

    Ok(ProxyResponse {
        status,
        headers,
        body,
    })
}

/// Streaming version of proxy_fetch that reads response in chunks
/// This is more suitable for streaming responses like SSE
#[tauri::command]
pub async fn proxy_fetch_stream(request: ProxyRequest) -> Result<ProxyResponse, String> {
    log::info!("Proxy fetch (streaming) request to: {} {}", request.method, request.url);

    // Validate URL to prevent SSRF attacks
    validate_url(&request.url)?;

    let client = reqwest::Client::new();

    // Build the request
    let mut req_builder = match request.method.to_uppercase().as_str() {
        "GET" => client.get(&request.url),
        "POST" => client.post(&request.url),
        "PUT" => client.put(&request.url),
        "DELETE" => client.delete(&request.url),
        "PATCH" => client.patch(&request.url),
        _ => return Err(format!("Unsupported HTTP method: {}", request.method)),
    };

    // Add headers
    for (key, value) in request.headers {
        req_builder = req_builder.header(&key, &value);
    }

    // Add body if present
    if let Some(body) = request.body {
        req_builder = req_builder.body(body);
    }

    // Send request
    let response = req_builder
        .send()
        .await
        .map_err(|e| {
            log::error!("Proxy fetch (streaming) error: {}", e);
            format!("Request failed: {}", e)
        })?;

    let status = response.status().as_u16();
    log::info!("Proxy fetch (streaming) response status: {}", status);

    // Extract headers
    let mut headers = HashMap::new();
    for (key, value) in response.headers() {
        if let Ok(value_str) = value.to_str() {
            headers.insert(key.to_string(), value_str.to_string());
        }
    }

    // Log critical response headers for debugging
    let content_type = response.headers().get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("none");
    let transfer_encoding = response.headers().get("transfer-encoding")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("none");
    let content_length = response.headers().get("content-length")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("none");

    log::info!(
        "Streaming response headers - Content-Type: {}, Transfer-Encoding: {}, Content-Length: {}",
        content_type, transfer_encoding, content_length
    );

    // Get response body using bytes_stream for better streaming support
    log::info!("Starting to read response body in chunks...");

    // Use per-chunk timeout instead of total timeout
    // This allows long-running streams as long as data keeps arriving
    let chunk_timeout = Duration::from_secs(30);

    let mut body_chunks = Vec::new();
    let mut stream = response.bytes_stream();
    let mut chunk_count = 0;

    loop {
        // Wait for next chunk with timeout
        let chunk_result = timeout(chunk_timeout, stream.next()).await;

        match chunk_result {
            Ok(Some(Ok(chunk))) => {
                chunk_count += 1;
                // log::info!("Received chunk {}: {} bytes", chunk_count, chunk.len());
                body_chunks.extend_from_slice(&chunk);
            }
            Ok(Some(Err(e))) => {
                log::error!("Error reading chunk {}: {}", chunk_count + 1, e);
                return Err(format!("Error reading chunk: {}", e));
            }
            Ok(None) => {
                // Stream ended normally
                log::info!("Stream ended after {} chunks", chunk_count);
                break;
            }
            Err(_) => {
                // Timeout waiting for next chunk
                log::error!(
                    "Timeout waiting for chunk {} after {} seconds (no data received)",
                    chunk_count + 1,
                    chunk_timeout.as_secs()
                );
                return Err(format!(
                    "Timeout: no data received for {} seconds after {} chunks",
                    chunk_timeout.as_secs(),
                    chunk_count
                ));
            }
        }
    }

    let body = String::from_utf8(body_chunks)
        .map_err(|e| format!("Failed to convert response to UTF-8: {}", e))?;

    log::info!("Streaming response complete - Total chunks: {}, Total size: {} bytes",
        chunk_count, body.len());

    Ok(ProxyResponse {
        status,
        headers,
        body,
    })
}

/// Real streaming fetch that emits chunks via Tauri events
/// This enables true streaming in the JavaScript side
#[tauri::command]
pub async fn stream_fetch(
    window: tauri::Window,
    request: ProxyRequest,
) -> Result<StreamResponse, String> {
    let request_id = request.request_id.unwrap_or_else(|| REQUEST_COUNTER.fetch_add(1, Ordering::SeqCst));
    // Use request-specific event name to avoid global event broadcasting
    let event_name = format!("stream-response-{}", request_id);

    log::info!(
        "Stream fetch request to: {} {} (request_id: {})",
        request.method,
        request.url,
        request_id
    );

    // Validate URL to prevent SSRF attacks
    validate_url(&request.url)?;

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to build client: {}", e))?;

    // Build the request
    let mut req_builder = match request.method.to_uppercase().as_str() {
        "GET" => client.get(&request.url),
        "POST" => client.post(&request.url),
        "PUT" => client.put(&request.url),
        "DELETE" => client.delete(&request.url),
        "PATCH" => client.patch(&request.url),
        _ => return Err(format!("Unsupported HTTP method: {}", request.method)),
    };

    // Add headers
    for (key, value) in request.headers {
        req_builder = req_builder.header(&key, &value);
    }

    // Add body if present
    if let Some(body) = request.body {
        req_builder = req_builder.body(body);
    }

    // Send request
    let response = req_builder.send().await.map_err(|e| {
        log::error!("Stream fetch error (request_id: {}): {}", request_id, e);
        format!("Request failed: {}", e)
    })?;

    let status = response.status().as_u16();
    log::info!(
        "Stream fetch response status: {} (request_id: {})",
        status,
        request_id
    );

    // Extract headers
    let mut headers = HashMap::new();
    for (key, value) in response.headers() {
        if let Ok(value_str) = value.to_str() {
            headers.insert(key.to_string(), value_str.to_string());
        }
    }

    // Log response headers
    let _content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("none");

    // Spawn async task to stream chunks
    let window_clone = window.clone();
    let event_name_clone = event_name.clone();
    tauri::async_runtime::spawn(async move {
        let mut stream = response.bytes_stream();
        let chunk_timeout = Duration::from_secs(30);
        let mut chunk_count = 0;

        log::info!("Starting to stream chunks (request_id: {}, event: {})", request_id, event_name_clone);

        loop {
            let chunk_result = timeout(chunk_timeout, stream.next()).await;

            match chunk_result {
                Ok(Some(Ok(chunk))) => {
                    chunk_count += 1;
                    let _chunk_size = chunk.len();

                    // Emit chunk to frontend using request-specific event
                    if let Err(e) = window_clone.emit(
                        &event_name_clone,
                        ChunkPayload {
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
                        break;
                    }
                }
                Ok(Some(Err(e))) => {
                    log::error!(
                        "Error reading chunk {} (request_id: {}): {}",
                        chunk_count + 1,
                        request_id,
                        e
                    );
                    break;
                }
                Ok(None) => {
                    break;
                }
                Err(_) => {
                    // Timeout waiting for next chunk
                    log::error!(
                        "Timeout waiting for chunk {} after {} seconds (request_id: {})",
                        chunk_count + 1,
                        chunk_timeout.as_secs(),
                        request_id
                    );
                    break;
                }
            }
        }

        // Emit end signal
        if let Err(e) = window_clone.emit(
            &event_name_clone,
            EndPayload {
                request_id,
                status: 0,
            },
        ) {
            log::error!("Failed to emit end payload (request_id: {}): {:?}", request_id, e);
        }
    });

    Ok(StreamResponse {
        request_id,
        status,
        headers,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{Ipv4Addr, Ipv6Addr};

    #[test]
    fn test_validate_url_valid_https() {
        assert!(validate_url("https://example.com").is_ok());
        assert!(validate_url("https://api.example.com/path").is_ok());
        assert!(validate_url("https://example.com:443/path?query=1").is_ok());
    }

    #[test]
    fn test_validate_url_valid_http() {
        assert!(validate_url("http://example.com").is_ok());
        assert!(validate_url("http://api.example.com:8080/path").is_ok());
    }

    #[test]
    fn test_validate_url_blocks_localhost_default_port() {
        // Default port (80) should be blocked
        assert!(validate_url("http://localhost").is_err());
        assert!(validate_url("https://localhost/api").is_err());
        assert!(validate_url("http://LOCALHOST").is_err()); // case insensitive
    }

    #[test]
    fn test_validate_url_allows_localhost_ai_ports() {
        // Allowed AI service ports
        assert!(validate_url("http://localhost:11434").is_ok()); // Ollama
        assert!(validate_url("http://localhost:1234").is_ok());  // LM Studio
        assert!(validate_url("http://localhost:8080").is_ok());  // Common alternative
        assert!(validate_url("http://127.0.0.1:11434/v1/models").is_ok());
        assert!(validate_url("http://127.0.0.1:1234/v1/chat/completions").is_ok());
    }

    #[test]
    fn test_validate_url_blocks_localhost_other_ports() {
        // Non-allowed ports should be blocked
        assert!(validate_url("http://localhost:3000").is_err());
        assert!(validate_url("http://127.0.0.1:9999").is_err());
    }

    #[test]
    fn test_validate_url_blocks_ipv6_loopback() {
        assert!(validate_url("http://[::1]").is_err());
        assert!(validate_url("http://[::1]:9999").is_err());
        // But allowed ports should work for IPv6 too
        assert!(validate_url("http://[::1]:11434").is_ok());
    }

    #[test]
    fn test_validate_url_blocks_unsupported_scheme() {
        assert!(validate_url("ftp://example.com").is_err());
        assert!(validate_url("file:///etc/passwd").is_err());
        assert!(validate_url("data:text/html,<h1>Hello</h1>").is_err());
    }

    #[test]
    fn test_validate_url_invalid_url() {
        assert!(validate_url("not-a-url").is_err());
        assert!(validate_url("://missing-scheme.com").is_err());
    }

    #[test]
    fn test_is_private_ip_loopback_v4() {
        // 127.0.0.0/8
        assert!(is_private_ip(&IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1))));
        assert!(is_private_ip(&IpAddr::V4(Ipv4Addr::new(127, 255, 255, 255))));
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
        assert!(is_private_ip(&IpAddr::V4(Ipv4Addr::new(192, 168, 255, 255))));
        assert!(is_private_ip(&IpAddr::V4(Ipv4Addr::new(192, 168, 1, 1))));
    }

    #[test]
    fn test_is_private_ip_link_local() {
        // 169.254.0.0/16
        assert!(is_private_ip(&IpAddr::V4(Ipv4Addr::new(169, 254, 0, 0))));
        assert!(is_private_ip(&IpAddr::V4(Ipv4Addr::new(169, 254, 255, 255))));
    }

    #[test]
    fn test_is_private_ip_broadcast() {
        assert!(is_private_ip(&IpAddr::V4(Ipv4Addr::new(255, 255, 255, 255))));
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
        assert!(is_private_ip(&IpAddr::V6(Ipv6Addr::new(0, 0, 0, 0, 0, 0, 0, 1))));
    }

    #[test]
    fn test_is_private_ip_unspecified_v6() {
        assert!(is_private_ip(&IpAddr::V6(Ipv6Addr::new(0, 0, 0, 0, 0, 0, 0, 0))));
    }

    #[test]
    fn test_is_private_ip_unique_local_v6() {
        // fc00::/7
        assert!(is_private_ip(&IpAddr::V6(Ipv6Addr::new(0xfc00, 0, 0, 0, 0, 0, 0, 1))));
        assert!(is_private_ip(&IpAddr::V6(Ipv6Addr::new(0xfd00, 0, 0, 0, 0, 0, 0, 1))));
    }

    #[test]
    fn test_is_private_ip_link_local_v6() {
        // fe80::/10
        assert!(is_private_ip(&IpAddr::V6(Ipv6Addr::new(0xfe80, 0, 0, 0, 0, 0, 0, 1))));
        assert!(is_private_ip(&IpAddr::V6(Ipv6Addr::new(0xfebf, 0, 0, 0, 0, 0, 0, 1))));
    }

    #[test]
    fn test_is_private_ip_public_v6() {
        // Public IPv6 addresses should return false
        assert!(!is_private_ip(&IpAddr::V6(Ipv6Addr::new(0x2001, 0x4860, 0x4860, 0, 0, 0, 0, 0x8888)))); // Google
        assert!(!is_private_ip(&IpAddr::V6(Ipv6Addr::new(0x2606, 0x4700, 0x4700, 0, 0, 0, 0, 0x1111)))); // Cloudflare
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
        assert_eq!(request.headers.get("Content-Type"), Some(&"application/json".to_string()));
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
        };

        let json = serde_json::to_string(&payload).unwrap();
        assert!(json.contains("\"request_id\":99"));
        assert!(json.contains("\"status\":0"));
    }

    #[test]
    fn test_request_counter_increments() {
        let initial = REQUEST_COUNTER.load(Ordering::SeqCst);
        let next = REQUEST_COUNTER.fetch_add(1, Ordering::SeqCst);
        assert_eq!(next, initial);

        let after = REQUEST_COUNTER.load(Ordering::SeqCst);
        assert_eq!(after, initial + 1);
    }
}
