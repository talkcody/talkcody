//! Streaming Events
//!
//! Defines event types for SSE streaming and conversion between internal and external formats.

use crate::storage::models::{EventId, EventType, SessionEvent, SessionId};
use serde::{Deserialize, Serialize};

/// Event envelope for streaming
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum StreamingEvent {
    /// Status update
    #[serde(rename = "status")]
    Status {
        #[serde(rename = "eventId")]
        event_id: EventId,
        #[serde(rename = "sessionId")]
        session_id: SessionId,
        data: StatusEventData,
    },
    /// Token from LLM stream
    #[serde(rename = "token")]
    Token {
        #[serde(rename = "eventId")]
        event_id: EventId,
        #[serde(rename = "sessionId")]
        session_id: SessionId,
        data: TokenEventData,
    },
    /// Final message content
    #[serde(rename = "message.final")]
    MessageFinal {
        #[serde(rename = "eventId")]
        event_id: EventId,
        #[serde(rename = "sessionId")]
        session_id: SessionId,
        data: MessageFinalEventData,
    },
    /// Tool call requested
    #[serde(rename = "tool.call")]
    ToolCall {
        #[serde(rename = "eventId")]
        event_id: EventId,
        #[serde(rename = "sessionId")]
        session_id: SessionId,
        data: ToolCallEventData,
    },
    /// Tool execution result
    #[serde(rename = "tool.result")]
    ToolResult {
        #[serde(rename = "eventId")]
        event_id: EventId,
        #[serde(rename = "sessionId")]
        session_id: SessionId,
        data: ToolResultEventData,
    },
    /// Error occurred
    #[serde(rename = "error")]
    Error {
        #[serde(rename = "eventId")]
        event_id: EventId,
        #[serde(rename = "sessionId")]
        session_id: Option<SessionId>,
        data: ErrorEventData,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusEventData {
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenEventData {
    pub token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageFinalEventData {
    #[serde(rename = "messageId")]
    pub message_id: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallEventData {
    #[serde(rename = "toolCallId")]
    pub tool_call_id: String,
    pub name: String,
    pub input: serde_json::Value,
    pub provider_metadata: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolResultEventData {
    #[serde(rename = "toolCallId")]
    pub tool_call_id: String,
    pub name: Option<String>,
    pub output: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorEventData {
    pub message: String,
}

impl StreamingEvent {
    /// Get the event ID
    pub fn event_id(&self) -> &EventId {
        match self {
            StreamingEvent::Status { event_id, .. } => event_id,
            StreamingEvent::Token { event_id, .. } => event_id,
            StreamingEvent::MessageFinal { event_id, .. } => event_id,
            StreamingEvent::ToolCall { event_id, .. } => event_id,
            StreamingEvent::ToolResult { event_id, .. } => event_id,
            StreamingEvent::Error { event_id, .. } => event_id,
        }
    }

    /// Get the session ID
    pub fn session_id(&self) -> Option<&SessionId> {
        match self {
            StreamingEvent::Status { session_id, .. } => Some(session_id),
            StreamingEvent::Token { session_id, .. } => Some(session_id),
            StreamingEvent::MessageFinal { session_id, .. } => Some(session_id),
            StreamingEvent::ToolCall { session_id, .. } => Some(session_id),
            StreamingEvent::ToolResult { session_id, .. } => Some(session_id),
            StreamingEvent::Error { session_id, .. } => session_id.as_ref(),
        }
    }

    /// Get the event type
    pub fn event_type(&self) -> EventType {
        match self {
            StreamingEvent::Status { .. } => EventType::Status,
            StreamingEvent::Token { .. } => EventType::Token,
            StreamingEvent::MessageFinal { .. } => EventType::MessageFinal,
            StreamingEvent::ToolCall { .. } => EventType::ToolCall,
            StreamingEvent::ToolResult { .. } => EventType::ToolResult,
            StreamingEvent::Error { .. } => EventType::Error,
        }
    }

    /// Convert to SSE event string
    pub fn to_sse_string(&self) -> String {
        let event_type = match self {
            StreamingEvent::Status { .. } => "status",
            StreamingEvent::Token { .. } => "token",
            StreamingEvent::MessageFinal { .. } => "message.final",
            StreamingEvent::ToolCall { .. } => "tool.call",
            StreamingEvent::ToolResult { .. } => "tool.result",
            StreamingEvent::Error { .. } => "error",
        };

        let event_id = self.event_id();
        let data = serde_json::to_string(self).unwrap_or_default();

        format!(
            "id: {}\nevent: {}\ndata: {}\n\n",
            event_id, event_type, data
        )
    }
}

/// Convert from storage SessionEvent to StreamingEvent
impl TryFrom<SessionEvent> for StreamingEvent {
    type Error = String;

    fn try_from(event: SessionEvent) -> Result<Self, <Self as TryFrom<SessionEvent>>::Error> {
        let payload = event.payload.clone();

        match event.event_type {
            EventType::Status => {
                let data: StatusEventData = serde_json::from_value(payload)
                    .map_err(|e| format!("Failed to parse status event: {}", e))?;
                Ok(StreamingEvent::Status {
                    event_id: event.id,
                    session_id: event.session_id,
                    data,
                })
            }
            EventType::Token => {
                let data: TokenEventData = serde_json::from_value(payload)
                    .map_err(|e| format!("Failed to parse token event: {}", e))?;
                Ok(StreamingEvent::Token {
                    event_id: event.id,
                    session_id: event.session_id,
                    data,
                })
            }
            EventType::MessageFinal => {
                let data: MessageFinalEventData = serde_json::from_value(payload)
                    .map_err(|e| format!("Failed to parse message.final event: {}", e))?;
                Ok(StreamingEvent::MessageFinal {
                    event_id: event.id,
                    session_id: event.session_id,
                    data,
                })
            }
            EventType::ToolCall => {
                let data: ToolCallEventData = serde_json::from_value(payload)
                    .map_err(|e| format!("Failed to parse tool.call event: {}", e))?;
                Ok(StreamingEvent::ToolCall {
                    event_id: event.id,
                    session_id: event.session_id,
                    data,
                })
            }
            EventType::ToolResult => {
                let data: ToolResultEventData = serde_json::from_value(payload)
                    .map_err(|e| format!("Failed to parse tool.result event: {}", e))?;
                Ok(StreamingEvent::ToolResult {
                    event_id: event.id,
                    session_id: event.session_id,
                    data,
                })
            }
            EventType::Error => {
                let data: ErrorEventData = serde_json::from_value(payload)
                    .map_err(|e| format!("Failed to parse error event: {}", e))?;
                Ok(StreamingEvent::Error {
                    event_id: event.id,
                    session_id: Some(event.session_id),
                    data,
                })
            }
        }
    }
}

/// Convert StreamingEvent to SessionEvent for storage
impl From<StreamingEvent> for SessionEvent {
    fn from(event: StreamingEvent) -> Self {
        let (id, session_id, event_type, payload) = match event {
            StreamingEvent::Status {
                event_id,
                session_id,
                data,
            } => (
                event_id,
                session_id,
                EventType::Status,
                serde_json::to_value(data).unwrap(),
            ),
            StreamingEvent::Token {
                event_id,
                session_id,
                data,
            } => (
                event_id,
                session_id,
                EventType::Token,
                serde_json::to_value(data).unwrap(),
            ),
            StreamingEvent::MessageFinal {
                event_id,
                session_id,
                data,
            } => (
                event_id,
                session_id,
                EventType::MessageFinal,
                serde_json::to_value(data).unwrap(),
            ),
            StreamingEvent::ToolCall {
                event_id,
                session_id,
                data,
            } => (
                event_id,
                session_id,
                EventType::ToolCall,
                serde_json::to_value(data).unwrap(),
            ),
            StreamingEvent::ToolResult {
                event_id,
                session_id,
                data,
            } => (
                event_id,
                session_id,
                EventType::ToolResult,
                serde_json::to_value(data).unwrap(),
            ),
            StreamingEvent::Error {
                event_id,
                session_id,
                data,
            } => (
                event_id,
                session_id.unwrap_or_default(),
                EventType::Error,
                serde_json::to_value(data).unwrap(),
            ),
        };

        SessionEvent {
            id,
            session_id,
            event_type,
            payload,
            created_at: chrono::Utc::now().timestamp(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_streaming_event_conversions() {
        let event = StreamingEvent::Token {
            event_id: "evt-1".to_string(),
            session_id: "sess-1".to_string(),
            data: TokenEventData {
                token: "Hello".to_string(),
            },
        };

        assert_eq!(event.event_id(), "evt-1");
        assert_eq!(event.session_id(), Some(&"sess-1".to_string()));
        assert_eq!(event.event_type(), EventType::Token);

        let sse = event.to_sse_string();
        assert!(sse.contains("id: evt-1"));
        assert!(sse.contains("event: token"));
    }

    #[test]
    fn test_streaming_event_to_session_event() {
        let streaming = StreamingEvent::Status {
            event_id: "evt-2".to_string(),
            session_id: "sess-2".to_string(),
            data: StatusEventData {
                message: "Running".to_string(),
            },
        };

        let session_event: SessionEvent = streaming.into();
        assert_eq!(session_event.id, "evt-2");
        assert_eq!(session_event.session_id, "sess-2");
        assert_eq!(session_event.event_type, EventType::Status);
    }
}
