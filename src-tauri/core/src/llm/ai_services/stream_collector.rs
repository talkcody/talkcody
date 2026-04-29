use crate::llm::ai_services::stream_runner::StreamRunner;
use crate::llm::types::{Message, StreamEvent, StreamTextRequest};
use futures_util::StreamExt;
use std::time::{Duration, Instant};

/// Collects text deltas from a stream and returns the complete text
/// This is used for non-streaming operations that need the full response
pub struct StreamCollector;

impl StreamCollector {
    /// Collect text from a stream, returning the complete text and timing info
    pub async fn collect_text<F, S>(
        stream_fn: F,
        timeout: Option<Duration>,
    ) -> Result<CollectResult, String>
    where
        F: FnOnce() -> S,
        S: futures_util::Stream<Item = Result<StreamEvent, String>> + Unpin,
    {
        let start_time = Instant::now();
        let mut first_delta_time: Option<Duration> = None;
        let mut delta_count = 0;
        let mut full_text = String::new();

        let timeout = timeout.unwrap_or(Duration::from_secs(300));

        let mut stream = stream_fn();

        loop {
            let chunk_result = tokio::time::timeout(timeout, stream.next()).await;

            match chunk_result {
                Ok(Some(Ok(event))) => match event {
                    StreamEvent::TextDelta { text } => {
                        if first_delta_time.is_none() {
                            first_delta_time = Some(start_time.elapsed());
                        }
                        delta_count += 1;
                        full_text.push_str(&text);
                    }
                    StreamEvent::Done { .. } => break,
                    StreamEvent::Error { message } => {
                        return Err(format!("Stream error: {}", message));
                    }
                    _ => {}
                },
                Ok(Some(Err(e))) => return Err(e),
                Ok(None) => break,
                Err(_) => return Err(format!("Stream timeout after {:?}", timeout)),
            }
        }

        let total_time = start_time.elapsed();

        Ok(CollectResult {
            text: full_text.trim().to_string(),
            total_time_ms: total_time.as_millis() as u64,
            time_to_first_delta_ms: first_delta_time.map(|d| d.as_millis() as u64),
            delta_count,
        })
    }

    /// Collect text using the non-window stream runner
    pub async fn collect_with_runner(
        runner: &StreamRunner,
        request: StreamTextRequest,
        timeout: Duration,
    ) -> Result<CollectResult, String> {
        let start_time = Instant::now();
        let mut first_delta_time: Option<Duration> = None;
        let mut delta_count = 0;
        let mut full_text = String::new();

        runner
            .stream(request, timeout, |event| match event {
                StreamEvent::TextDelta { text } => {
                    if first_delta_time.is_none() {
                        first_delta_time = Some(start_time.elapsed());
                    }
                    delta_count += 1;
                    full_text.push_str(&text);
                }
                StreamEvent::Error { message } => {
                    log::error!("Stream error: {}", message);
                }
                _ => {}
            })
            .await?;

        let total_time = start_time.elapsed();

        Ok(CollectResult {
            text: full_text.trim().to_string(),
            total_time_ms: total_time.as_millis() as u64,
            time_to_first_delta_ms: first_delta_time.map(|d| d.as_millis() as u64),
            delta_count,
        })
    }

    /// Create a simple text completion request with a single user message
    pub fn create_completion_request(
        model: String,
        fallback_models: Option<Vec<String>>,
        prompt: String,
    ) -> StreamTextRequest {
        StreamTextRequest {
            model,
            fallback_models,
            messages: vec![Message::User {
                content: crate::llm::types::MessageContent::Text(prompt),
                provider_options: None,
            }],
            tools: None,
            stream: Some(true),
            temperature: None,
            max_tokens: None,
            top_p: None,
            top_k: None,
            provider_options: None,
            request_id: None,
            conversation_mode: None,
            input_mode: None,
            previous_response_id: None,
            transport_session_id: None,
            allow_transport_fallback: None,
            continuation_context: None,
            trace_context: None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct CollectResult {
    pub text: String,
    pub total_time_ms: u64,
    pub time_to_first_delta_ms: Option<u64>,
    pub delta_count: u32,
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::stream;

    #[tokio::test]
    async fn collect_text_combines_deltas() {
        let events = vec![
            Ok(StreamEvent::TextDelta {
                text: "Hello".to_string(),
            }),
            Ok(StreamEvent::TextDelta {
                text: " ".to_string(),
            }),
            Ok(StreamEvent::TextDelta {
                text: "World".to_string(),
            }),
            Ok(StreamEvent::Done {
                finish_reason: Some("stop".to_string()),
            }),
        ];

        let result = StreamCollector::collect_text(|| stream::iter(events), None)
            .await
            .unwrap();

        assert_eq!(result.text, "Hello World");
        assert_eq!(result.delta_count, 3);
        assert!(result.total_time_ms < 10000);
        assert!(result.time_to_first_delta_ms.is_some());
    }

    #[tokio::test]
    async fn collect_text_trims_result() {
        let events = vec![
            Ok(StreamEvent::TextDelta {
                text: "  spaced text  ".to_string(),
            }),
            Ok(StreamEvent::Done {
                finish_reason: None,
            }),
        ];

        let result = StreamCollector::collect_text(|| stream::iter(events), None)
            .await
            .unwrap();

        assert_eq!(result.text, "spaced text");
    }

    #[tokio::test]
    async fn collect_text_handles_empty_stream() {
        let events: Vec<Result<StreamEvent, String>> = vec![Ok(StreamEvent::Done {
            finish_reason: None,
        })];

        let result = StreamCollector::collect_text(|| stream::iter(events), None)
            .await
            .unwrap();

        assert_eq!(result.text, "");
        assert_eq!(result.delta_count, 0);
    }

    #[tokio::test]
    async fn collect_text_handles_errors() {
        let events: Vec<Result<StreamEvent, String>> =
            vec![Err("Stream connection failed".to_string())];

        let result = StreamCollector::collect_text(|| stream::iter(events), None).await;

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Stream connection failed"));
    }

    #[tokio::test]
    async fn collect_text_handles_stream_error_event() {
        let events = vec![
            Ok(StreamEvent::TextDelta {
                text: "Partial".to_string(),
            }),
            Ok(StreamEvent::Error {
                message: "Something went wrong".to_string(),
            }),
        ];

        let result = StreamCollector::collect_text(|| stream::iter(events), None).await;

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Something went wrong"));
    }

    #[tokio::test]
    async fn create_completion_request_builds_correct_structure() {
        let request = StreamCollector::create_completion_request(
            "gpt-4o".to_string(),
            Some(vec!["gpt-4o-mini".to_string()]),
            "Generate a title".to_string(),
        );

        assert_eq!(request.model, "gpt-4o");
        assert_eq!(
            request.fallback_models,
            Some(vec!["gpt-4o-mini".to_string()])
        );
        assert_eq!(request.messages.len(), 1);
        assert!(request.stream.unwrap_or(false));
    }
}
