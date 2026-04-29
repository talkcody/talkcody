#![cfg(test)]

use crate::llm::testing::fixtures::{
    assert_json_matches, build_sse_body, recorded_json_body_to_http_text, ProviderFixture,
    RecordedResponse,
};
use std::net::TcpListener;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

pub struct MockProviderServer {
    base_url: String,
    running: Arc<AtomicBool>,
    handle: Option<thread::JoinHandle<()>>,
}

impl MockProviderServer {
    pub fn start(fixture: ProviderFixture) -> Result<Self, String> {
        let listener = TcpListener::bind("127.0.0.1:0")
            .map_err(|e| format!("Failed to bind mock server: {}", e))?;
        let addr = listener
            .local_addr()
            .map_err(|e| format!("Failed to read mock server address: {}", e))?;
        let server = tiny_http::Server::from_listener(listener, None)
            .map_err(|e| format!("Failed to start mock server: {}", e))?;

        let running = Arc::new(AtomicBool::new(true));
        let running_flag = running.clone();
        let handle = thread::spawn(move || {
            while running_flag.load(Ordering::SeqCst) {
                match server.recv_timeout(Duration::from_millis(50)) {
                    Ok(Some(request)) => {
                        if let Err(err) = handle_request(request, &fixture) {
                            log::error!("Mock provider server error: {}", err);
                        }
                    }
                    Ok(None) => {}
                    Err(err) => {
                        log::error!("Mock provider server recv error: {}", err);
                    }
                }
            }
        });

        Ok(Self {
            base_url: format!("http://{}", addr),
            running,
            handle: Some(handle),
        })
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }
}

impl Drop for MockProviderServer {
    fn drop(&mut self) {
        self.running.store(false, Ordering::SeqCst);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

fn handle_request(
    mut request: tiny_http::Request,
    fixture: &ProviderFixture,
) -> Result<(), String> {
    let url = request.url().to_string();
    let expected_url = format!("/{}", fixture.endpoint_path.trim_start_matches('/'));
    if url != expected_url {
        let response = tiny_http::Response::from_string("Not Found").with_status_code(404);
        let _ = request.respond(response);
        return Ok(());
    }

    let mut body = String::new();
    request
        .as_reader()
        .read_to_string(&mut body)
        .map_err(|e| format!("Failed to read request body: {}", e))?;
    let json: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("Failed to parse request JSON: {}", e))?;

    assert_json_matches(&fixture.request.body, &json)?;

    let response = match &fixture.response {
        RecordedResponse::Stream {
            status,
            headers,
            sse_events,
        } => {
            let mut response = tiny_http::Response::from_string(build_sse_body(sse_events))
                .with_status_code(*status);
            let content_type = headers
                .get("content-type")
                .cloned()
                .unwrap_or_else(|| "text/event-stream".to_string());
            response = response.with_header(
                tiny_http::Header::from_bytes("content-type", content_type)
                    .map_err(|()| "Invalid header: content-type".to_string())?,
            );
            response
        }
        RecordedResponse::Json {
            status,
            headers,
            body,
        } => {
            let mut response =
                tiny_http::Response::from_string(recorded_json_body_to_http_text(body))
                    .with_status_code(*status);
            let content_type = headers
                .get("content-type")
                .cloned()
                .unwrap_or_else(|| "application/json".to_string());
            response = response.with_header(
                tiny_http::Header::from_bytes("content-type", content_type)
                    .map_err(|()| "Invalid header: content-type".to_string())?,
            );
            response
        }
    };

    request
        .respond(response)
        .map_err(|e| format!("Failed to send response: {}", e))?;
    Ok(())
}
