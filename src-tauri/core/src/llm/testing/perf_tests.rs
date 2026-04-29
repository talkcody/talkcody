use crate::llm::protocols::openai_protocol::OpenAiProtocol;
use crate::llm::protocols::request_builder::{ProtocolRequestBuilder, RequestBuildContext};
use crate::llm::protocols::stream_parser::{
    ProtocolStreamParser, StreamParseContext, StreamParseState,
};
use crate::llm::testing::fixtures::{ProviderFixture, RecordedResponse};
use crate::llm::types::{Message, MessageContent};
use std::time::{Duration, Instant};

fn build_messages(count: usize) -> Vec<Message> {
    let mut messages = Vec::with_capacity(count);
    for i in 0..count {
        let content = MessageContent::Text(format!("message {}", i));
        let message = if i % 2 == 0 {
            Message::User {
                content,
                provider_options: None,
            }
        } else {
            Message::Assistant {
                content,
                provider_options: None,
            }
        };
        messages.push(message);
    }
    messages
}

#[test]
#[ignore]
fn perf_openai_build_request() {
    let protocol = OpenAiProtocol;
    let messages = build_messages(200);
    let request_ctx = RequestBuildContext {
        model: "gpt-4o",
        messages: &messages,
        tools: None,
        temperature: Some(1.0),
        max_tokens: Some(2048),
        top_p: Some(0.9),
        top_k: Some(64),
        provider_options: None,
        extra_body: None,
        conversation_mode: None,
        input_mode: None,
        previous_response_id: None,
        transport_session_id: None,
        allow_transport_fallback: None,
        continuation_context: None,
    };

    let iterations = 300;
    let start = Instant::now();
    for _ in 0..iterations {
        let _ = protocol
            .build_request(request_ctx.clone())
            .expect("build request");
    }
    let elapsed = start.elapsed();
    eprintln!(
        "perf_openai_build_request: {} iterations in {:?}",
        iterations, elapsed
    );

    assert!(
        elapsed < Duration::from_secs(10),
        "build_request perf regression: {:?}",
        elapsed
    );
}

#[test]
#[ignore]
fn perf_openai_parse_stream() {
    let protocol = OpenAiProtocol;
    let raw_fixture = include_str!(
        "recordings/aiGateway__OpenAiCompatible__google_gemini-2.5-flash-lite__custom.json"
    );
    let fixture: ProviderFixture = serde_json::from_str(raw_fixture).expect("parse fixture");
    let events = match fixture.response {
        RecordedResponse::Stream { sse_events, .. } => sse_events,
        _ => panic!("expected stream response"),
    };

    let iterations = 1000;
    let start = Instant::now();
    for _ in 0..iterations {
        let mut state = StreamParseState::default();
        for event in &events {
            let ctx = StreamParseContext {
                event_type: event.event.as_deref(),
                data: &event.data,
            };
            let _ = protocol.parse_stream_event(ctx, &mut state);
            state.pending_events.clear();
        }
    }
    let elapsed = start.elapsed();
    eprintln!(
        "perf_openai_parse_stream: {} iterations in {:?}",
        iterations, elapsed
    );

    assert!(
        elapsed < Duration::from_secs(10),
        "parse_stream_event perf regression: {:?}",
        elapsed
    );
}
