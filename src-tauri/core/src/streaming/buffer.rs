//! Event Buffer
//!
//! Buffers events for SSE streaming with resume capability.
//! Persists events to storage and maintains in-memory cache.

use crate::storage::models::{EventId, SessionEvent, SessionId};
use crate::storage::Storage;
use crate::streaming::events::StreamingEvent;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

/// Event buffer for managing streaming events
pub struct EventBuffer {
    /// In-memory cache of recent events per session
    cache: RwLock<HashMap<SessionId, Vec<SessionEvent>>>,
    /// Maximum events to keep in memory per session
    max_memory_events: usize,
    /// Storage for persistence
    storage: Option<Arc<Storage>>,
}

impl EventBuffer {
    pub fn new(max_memory_events: usize) -> Self {
        Self {
            cache: RwLock::new(HashMap::new()),
            max_memory_events,
            storage: None,
        }
    }

    pub fn with_storage(mut self, storage: Arc<Storage>) -> Self {
        self.storage = Some(storage);
        self
    }

    /// Add an event to the buffer
    pub async fn add_event(&self, event: StreamingEvent) -> Result<(), String> {
        let session_event: SessionEvent = event.into();

        // Add to in-memory cache
        {
            let mut cache = self.cache.write().await;
            let events = cache
                .entry(session_event.session_id.clone())
                .or_insert_with(Vec::new);

            events.push(session_event.clone());

            // Trim to max size
            if events.len() > self.max_memory_events {
                *events = events.split_off(events.len() - self.max_memory_events);
            }
        }

        // Persist to storage if available
        if let Some(storage) = &self.storage {
            storage.chat_history.create_event(&session_event).await?;
        }

        Ok(())
    }

    /// Get events for a session, optionally after a specific event ID
    pub async fn get_events(
        &self,
        session_id: &str,
        after_event_id: Option<&str>,
        limit: Option<usize>,
    ) -> Result<Vec<StreamingEvent>, String> {
        // First check in-memory cache
        let cache = self.cache.read().await;

        if let Some(events) = cache.get(session_id) {
            let mut result: Vec<StreamingEvent> = events
                .iter()
                .filter(|e| {
                    if let Some(after_id) = after_event_id {
                        e.id > after_id.to_string()
                    } else {
                        true
                    }
                })
                .cloned()
                .filter_map(|e| e.try_into().ok())
                .collect();

            // Apply limit
            if let Some(lim) = limit {
                if result.len() > lim {
                    result = result.split_off(result.len() - lim);
                }
            }

            // If we have enough events from cache, return them
            if !result.is_empty() {
                return Ok(result);
            }
        }
        drop(cache);

        // Fall back to storage
        if let Some(storage) = &self.storage {
            let events = storage
                .chat_history
                .get_events(session_id, after_event_id, limit)
                .await?;

            return events
                .into_iter()
                .map(|e| e.try_into())
                .collect::<Result<Vec<_>, _>>();
        }

        Ok(vec![])
    }

    /// Get the last event ID for a session
    pub async fn get_last_event_id(&self, session_id: &str) -> Option<EventId> {
        let cache = self.cache.read().await;

        if let Some(events) = cache.get(session_id) {
            return events.last().map(|e| e.id.clone());
        }

        None
    }

    /// Clear events for a session from memory (keeps storage)
    pub async fn clear_session(&self, session_id: &str) {
        let mut cache = self.cache.write().await;
        cache.remove(session_id);
    }

    /// Get memory usage stats
    pub async fn get_stats(&self) -> BufferStats {
        let cache = self.cache.read().await;
        let total_sessions = cache.len();
        let total_events: usize = cache.values().map(|v| v.len()).sum();

        BufferStats {
            total_sessions,
            total_events,
            max_events_per_session: self.max_memory_events,
        }
    }
}

/// Buffer statistics
#[derive(Debug, Clone)]
pub struct BufferStats {
    pub total_sessions: usize,
    pub total_events: usize,
    pub max_events_per_session: usize,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::streaming::events::TokenEventData;

    #[tokio::test]
    async fn test_event_buffer() {
        let buffer = EventBuffer::new(100);

        let event = StreamingEvent::Token {
            event_id: "evt-1".to_string(),
            session_id: "sess-1".to_string(),
            data: TokenEventData {
                token: "Hello".to_string(),
            },
        };

        buffer
            .add_event(event.clone())
            .await
            .expect("Failed to add event");

        let events = buffer.get_events("sess-1", None, None).await.unwrap();
        assert_eq!(events.len(), 1);
    }

    #[tokio::test]
    async fn test_get_events_after_id() {
        let buffer = EventBuffer::new(100);

        for i in 0..5 {
            let event = StreamingEvent::Token {
                event_id: format!("evt-{}", i),
                session_id: "sess-1".to_string(),
                data: TokenEventData {
                    token: format!("token{}", i),
                },
            };
            buffer.add_event(event).await.unwrap();
        }

        let events = buffer
            .get_events("sess-1", Some("evt-2"), None)
            .await
            .unwrap();
        assert_eq!(events.len(), 2); // evt-3 and evt-4
    }

    #[tokio::test]
    async fn test_buffer_limit() {
        let buffer = EventBuffer::new(3);

        for i in 0..5 {
            let event = StreamingEvent::Token {
                event_id: format!("evt-{}", i),
                session_id: "sess-1".to_string(),
                data: TokenEventData {
                    token: format!("token{}", i),
                },
            };
            buffer.add_event(event).await.unwrap();
        }

        let stats = buffer.get_stats().await;
        assert_eq!(stats.total_events, 3); // Trimmed to max
    }
}
