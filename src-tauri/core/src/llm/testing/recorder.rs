use crate::llm::testing::fixtures::{
    normalize_recorded_json_body, FixtureInput, ProviderFixture, RecordedRequest, RecordedResponse,
    RecordedSseEvent,
};
use crate::llm::types::StreamEvent;
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TestMode {
    Off,
    Record,
    Replay,
}

#[derive(Debug, Clone)]
pub struct TestConfig {
    pub mode: TestMode,
    pub fixture_dir: PathBuf,
    pub base_url_override: Option<String>,
}

impl TestConfig {
    pub fn from_env() -> Self {
        let mode = match std::env::var("LLM_TEST_MODE")
            .unwrap_or_default()
            .to_lowercase()
            .as_str()
        {
            "record" => TestMode::Record,
            "replay" => TestMode::Replay,
            _ => TestMode::Off,
        };

        let fixture_dir = std::env::var("LLM_FIXTURE_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("src")
                    .join("llm")
                    .join("testing")
                    .join("recordings")
            });

        let base_url_override = std::env::var("LLM_TEST_BASE_URL").ok();

        Self {
            mode,
            fixture_dir,
            base_url_override,
        }
    }
}

pub struct RecordingContext {
    pub provider_id: String,
    pub protocol: String,
    pub model: String,
    pub endpoint_path: String,
    pub url: String,
    pub channel: String,
    pub request_headers: HashMap<String, String>,
    pub request_body: Value,
}

pub struct Recorder {
    fixture: ProviderFixture,
    path: PathBuf,
}

impl Recorder {
    pub fn from_test_config(config: &TestConfig, ctx: RecordingContext) -> Option<Self> {
        if config.mode != TestMode::Record {
            return None;
        }

        let request = RecordedRequest {
            method: "POST".to_string(),
            url: ctx.url,
            headers: redact_headers(&ctx.request_headers),
            body: ctx.request_body,
        };

        let fixture = ProviderFixture {
            version: 1,
            provider_id: ctx.provider_id,
            protocol: ctx.protocol,
            model: ctx.model,
            endpoint_path: ctx.endpoint_path,
            request,
            response: RecordedResponse::Stream {
                status: 0,
                headers: HashMap::new(),
                sse_events: Vec::new(),
            },
            test_input: None,
            expected_events: Some(Vec::new()),
        };

        let path = recorded_fixture_path(config, &fixture, &ctx.channel);
        Some(Self { fixture, path })
    }

    pub fn set_test_input(&mut self, input: FixtureInput) {
        self.fixture.test_input = Some(input);
    }

    pub fn record_expected_event(&mut self, event: &StreamEvent) {
        let events = self.fixture.expected_events.get_or_insert_with(Vec::new);
        events.push(event.clone());
    }

    pub fn record_sse_event(&mut self, event: Option<&str>, data: &str) {
        if let RecordedResponse::Stream { sse_events, .. } = &mut self.fixture.response {
            sse_events.push(RecordedSseEvent {
                event: event.map(|value| value.to_string()),
                data: data.to_string(),
            });
        }
    }

    pub fn finish_stream(
        &mut self,
        status: u16,
        response_headers: &reqwest::header::HeaderMap,
    ) -> Result<(), String> {
        if let RecordedResponse::Stream {
            headers, status: s, ..
        } = &mut self.fixture.response
        {
            *s = status;
            *headers = headers_from_header_map(response_headers);
        }
        crate::llm::testing::fixtures::write_fixture(&self.path, &self.fixture)
    }

    pub fn finish_error(
        &mut self,
        status: u16,
        response_headers: &reqwest::header::HeaderMap,
        body: &str,
    ) -> Result<(), String> {
        self.fixture.response = RecordedResponse::Json {
            status,
            headers: headers_from_header_map(response_headers),
            body: normalize_recorded_json_body(&Value::String(body.to_string())),
        };
        crate::llm::testing::fixtures::write_fixture(&self.path, &self.fixture)
    }
}

fn recorded_fixture_path(config: &TestConfig, fixture: &ProviderFixture, channel: &str) -> PathBuf {
    let model = fixture.model.replace(['/', ' '], "_");
    let file_name = format!(
        "{}__{}__{}__{}.json",
        fixture.provider_id, fixture.protocol, model, channel
    );
    config.fixture_dir.join(file_name)
}

fn headers_from_header_map(map: &reqwest::header::HeaderMap) -> HashMap<String, String> {
    let mut headers = HashMap::new();
    for (key, value) in map.iter() {
        if let Ok(value_str) = value.to_str() {
            headers.insert(key.as_str().to_lowercase(), value_str.to_string());
        }
    }
    headers
}

fn redact_headers(headers: &HashMap<String, String>) -> HashMap<String, String> {
    let mut redacted = HashMap::new();
    for (key, value) in headers {
        let lower = key.to_lowercase();
        if lower == "authorization"
            || lower == "x-api-key"
            || lower == "api-key"
            || lower.contains("token")
        {
            redacted.insert(lower, "REDACTED".to_string());
        } else {
            redacted.insert(lower, value.to_string());
        }
    }
    redacted
}
