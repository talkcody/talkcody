use crate::llm::types::{Message, StreamEvent, ToolDefinition};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::Path;
#[cfg(test)]
use std::path::PathBuf;

#[cfg(test)]
const ANY_VALUE_SENTINEL: &str = "__ANY__";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FixtureInput {
    pub model: String,
    pub messages: Vec<Message>,
    pub tools: Option<Vec<ToolDefinition>>,
    pub temperature: Option<f32>,
    pub max_tokens: Option<i32>,
    pub top_p: Option<f32>,
    pub top_k: Option<i32>,
    pub provider_options: Option<Value>,
    pub extra_body: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderFixture {
    pub version: u32,
    pub provider_id: String,
    pub protocol: String,
    pub model: String,
    pub endpoint_path: String,
    pub request: RecordedRequest,
    pub response: RecordedResponse,
    pub test_input: Option<FixtureInput>,
    pub expected_events: Option<Vec<StreamEvent>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordedRequest {
    pub method: String,
    pub url: String,
    pub headers: HashMap<String, String>,
    pub body: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum RecordedResponse {
    Stream {
        status: u16,
        headers: HashMap<String, String>,
        sse_events: Vec<RecordedSseEvent>,
    },
    Json {
        status: u16,
        headers: HashMap<String, String>,
        body: Value,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RecordedSseEvent {
    pub event: Option<String>,
    pub data: String,
}

#[allow(dead_code)]
#[cfg(test)]
pub fn fixture_file_name(fixture: &ProviderFixture) -> String {
    let model = fixture.model.replace('/', "_").replace(' ', "_");
    format!(
        "{}__{}__{}.json",
        fixture.provider_id, fixture.protocol, model
    )
}

#[allow(dead_code)]
#[cfg(test)]
pub fn fixture_path(dir: &Path, fixture: &ProviderFixture) -> PathBuf {
    dir.join(fixture_file_name(fixture))
}

#[cfg(test)]
pub fn load_fixture(path: &Path) -> Result<ProviderFixture, String> {
    let raw = std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read fixture {}: {}", path.display(), e))?;
    serde_json::from_str(&raw).map_err(|e| format!("Failed to parse fixture: {}", e))
}

pub fn write_fixture(path: &Path, fixture: &ProviderFixture) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            format!(
                "Failed to create fixture directory {}: {}",
                parent.display(),
                e
            )
        })?;
    }
    let raw = serde_json::to_string_pretty(fixture)
        .map_err(|e| format!("Failed to serialize fixture: {}", e))?;
    std::fs::write(path, raw)
        .map_err(|e| format!("Failed to write fixture {}: {}", path.display(), e))
}

#[cfg(test)]
pub fn build_sse_body(events: &[RecordedSseEvent]) -> String {
    let mut body = String::new();
    for event in events {
        if let Some(name) = &event.event {
            body.push_str("event: ");
            body.push_str(name);
            body.push('\n');
        }
        for line in event.data.split('\n') {
            body.push_str("data: ");
            body.push_str(line);
            body.push('\n');
        }
        body.push('\n');
    }
    body
}

#[cfg(test)]
pub fn parse_sse_body(body: &str) -> Vec<RecordedSseEvent> {
    let mut events = Vec::new();
    for raw in body.split("\n\n") {
        if raw.trim().is_empty() {
            continue;
        }
        let mut event_name = None;
        let mut data_lines = Vec::new();
        for line in raw.lines() {
            if let Some(rest) = line.strip_prefix("event:") {
                event_name = Some(rest.trim().to_string());
            } else if let Some(rest) = line.strip_prefix("data:") {
                let data = rest.strip_prefix(' ').unwrap_or(rest);
                data_lines.push(data.to_string());
            }
        }
        if data_lines.is_empty() {
            continue;
        }
        events.push(RecordedSseEvent {
            event: event_name,
            data: data_lines.join("\n"),
        });
    }
    events
}

#[cfg(test)]
pub fn assert_json_matches(expected: &Value, actual: &Value) -> Result<(), String> {
    match (expected, actual) {
        (Value::String(expected_str), Value::String(actual_str)) => {
            if expected_str == ANY_VALUE_SENTINEL {
                return Ok(());
            }
            // Normalize CRLF to LF for string comparison to avoid platform-specific failures
            let norm_expected = expected_str.replace("\r\n", "\n");
            let norm_actual = actual_str.replace("\r\n", "\n");
            if norm_expected == norm_actual {
                Ok(())
            } else {
                Err(format!(
                    "Value mismatch: expected {}, got {}",
                    describe_json(expected),
                    describe_json(actual)
                ))
            }
        }
        (Value::Object(expected_map), Value::Object(actual_map)) => {
            for (key, expected_value) in expected_map {
                let actual_value = actual_map
                    .get(key)
                    .ok_or_else(|| format!("Missing key '{}' in actual JSON", key))?;
                assert_json_matches(expected_value, actual_value)
                    .map_err(|e| format!("Mismatch at key '{}': {}", key, e))?;
            }
            Ok(())
        }
        (Value::Array(expected_array), Value::Array(actual_array)) => {
            if expected_array.len() != actual_array.len() {
                return Err(format!(
                    "Array length mismatch: expected {}, got {}",
                    expected_array.len(),
                    actual_array.len()
                ));
            }
            for (index, (expected_value, actual_value)) in
                expected_array.iter().zip(actual_array.iter()).enumerate()
            {
                assert_json_matches(expected_value, actual_value)
                    .map_err(|e| format!("Mismatch at index {}: {}", index, e))?;
            }
            Ok(())
        }
        (Value::Number(expected_num), Value::Number(actual_num)) => {
            let expected_f64 = expected_num.as_f64().unwrap_or(0.0);
            let actual_f64 = actual_num.as_f64().unwrap_or(0.0);
            // Use relative tolerance for large numbers, absolute for small
            let tolerance = (expected_f64.abs() * 1e-6).max(1e-9);
            if (expected_f64 - actual_f64).abs() <= tolerance {
                Ok(())
            } else {
                Err(format!(
                    "Value mismatch: expected {}, got {}",
                    describe_json(expected),
                    describe_json(actual)
                ))
            }
        }
        (expected, actual) => {
            if expected == actual {
                Ok(())
            } else {
                Err(format!(
                    "Value mismatch: expected {}, got {}",
                    describe_json(expected),
                    describe_json(actual)
                ))
            }
        }
    }
}

#[cfg(test)]
fn describe_json(value: &Value) -> String {
    match value {
        Value::Null => "null".to_string(),
        Value::Bool(v) => v.to_string(),
        Value::Number(v) => v.to_string(),
        Value::String(v) => format!("\"{}\"", v),
        Value::Array(_) => "array".to_string(),
        Value::Object(_) => "object".to_string(),
    }
}
