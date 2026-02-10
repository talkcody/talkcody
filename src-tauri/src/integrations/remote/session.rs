use crate::core::types::RuntimeTaskState;

use super::types::RemoteChannelId;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RemoteStatusAck {
    Accepted,
    Running,
    Completed,
    Failed,
    Stopped,
}

#[derive(Debug, Clone)]
pub struct RemoteSession {
    pub channel_id: RemoteChannelId,
    pub chat_id: String,
    pub session_id: String,
    pub task_id: String,
    pub last_message_id: Option<String>,
    pub streaming_message_id: Option<String>,
    pub last_sent_at_ms: u64,
    pub sent_chunks: Vec<String>,
    pub last_stream_status: Option<RuntimeTaskState>,
    pub last_status_ack: Option<RemoteStatusAck>,
}

impl RemoteSession {
    pub fn key(&self) -> String {
        format!("{}:{}", self.channel_id.as_str(), self.chat_id)
    }
}
