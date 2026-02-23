//! Streaming Bridge
//!
//! Bridges runtime events to the StreamingManager for SSE and WebSocket delivery.
//! Implements Phase 4: Wire runtime events to streaming manager.

use crate::state::ServerState;
use talkcody_core::core::types::{EventReceiver, RuntimeEvent};
use talkcody_core::streaming::events::StreamingEvent;

/// Bridge that forwards runtime events to the streaming manager
pub struct StreamingBridge {
    state: ServerState,
}

impl StreamingBridge {
    pub fn new(state: ServerState) -> Self {
        Self { state }
    }

    /// Start the bridge - spawns a task that forwards events
    pub fn start(self, mut event_receiver: EventReceiver) {
        tokio::spawn(async move {
            while let Some(event) = event_receiver.recv().await {
                self.handle_event(event).await;
            }
        });
    }

    /// Handle a single runtime event
    async fn handle_event(&self, event: RuntimeEvent) {
        let streaming = self.state.streaming();
        let mut manager = streaming.write().await;

        let streaming_event = match event {
            RuntimeEvent::Token { session_id, token } => Some(StreamingEvent::Token {
                event_id: format!("evt_{}", uuid::Uuid::new_v4()),
                session_id,
                data: talkcody_core::streaming::events::TokenEventData { token },
            }),
            RuntimeEvent::ToolCallRequested { task_id, request } => {
                // Extract session_id from task_id (simplified)
                let session_id = task_id.clone();
                Some(StreamingEvent::ToolCall {
                    event_id: format!("evt_{}", uuid::Uuid::new_v4()),
                    session_id,
                    data: talkcody_core::streaming::events::ToolCallEventData {
                        tool_call_id: request.tool_call_id,
                        name: request.name,
                        input: request.input,
                        provider_metadata: request.provider_metadata,
                    },
                })
            }
            RuntimeEvent::ToolCallCompleted { task_id, result } => {
                // Extract session_id from task_id (simplified)
                let session_id = task_id.clone();
                Some(StreamingEvent::ToolResult {
                    event_id: format!("evt_{}", uuid::Uuid::new_v4()),
                    session_id,
                    data: talkcody_core::streaming::events::ToolResultEventData {
                        tool_call_id: result.tool_call_id,
                        name: result.name,
                        output: result.output,
                    },
                })
            }
            RuntimeEvent::MessageCreated {
                session_id,
                message,
            } => {
                // Convert to final message event
                let content = match message.content {
                    talkcody_core::storage::models::MessageContent::Text { text } => text,
                    _ => serde_json::to_string(&message.content).unwrap_or_default(),
                };
                Some(StreamingEvent::MessageFinal {
                    event_id: format!("evt_{}", uuid::Uuid::new_v4()),
                    session_id,
                    data: talkcody_core::streaming::events::MessageFinalEventData {
                        message_id: message.id,
                        content,
                    },
                })
            }
            RuntimeEvent::TaskStateChanged {
                task_id,
                state,
                previous_state,
            } => {
                // Emit status event
                let session_id = task_id.clone();
                Some(StreamingEvent::Status {
                    event_id: format!("evt_{}", uuid::Uuid::new_v4()),
                    session_id,
                    data: talkcody_core::streaming::events::StatusEventData {
                        message: format!("Task state: {:?} -> {:?}", previous_state, state),
                    },
                })
            }
            RuntimeEvent::Error {
                task_id,
                session_id,
                message,
            } => {
                let sid = session_id.or(task_id).unwrap_or_default();
                Some(StreamingEvent::Error {
                    event_id: format!("evt_{}", uuid::Uuid::new_v4()),
                    session_id: Some(sid),
                    data: talkcody_core::streaming::events::ErrorEventData { message },
                })
            }
            _ => None,
        };

        if let Some(event) = streaming_event {
            // Add to buffer (ignore errors for now)
            let _ = manager.buffer.add_event(event).await;
        }
    }
}

/// Initialize the streaming bridge for a server
pub fn init_streaming_bridge(state: ServerState, event_receiver: EventReceiver) {
    let bridge = StreamingBridge::new(state);
    bridge.start(event_receiver);
}
