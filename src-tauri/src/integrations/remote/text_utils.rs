use std::collections::HashMap;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use super::types::RemoteChannelId;

const DEFAULT_CHUNK_LIMIT: usize = 4096;
const DEFAULT_DEDUP_TTL_MS: u64 = 5 * 60 * 1000;
const FEISHU_MESSAGE_LIMIT: usize = 4000;
const TELEGRAM_MESSAGE_LIMIT: usize = 4096;

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn split_by_preference(text: &str, limit: usize) -> Vec<String> {
    if text.len() <= limit {
        return vec![text.to_string()];
    }

    let mut chunks = Vec::new();
    let mut remaining = text.trim().to_string();

    while remaining.len() > limit {
        let mut slice_end = remaining[..limit].rfind("\n\n");
        if slice_end.is_none() {
            slice_end = remaining[..limit].rfind('\n');
        }
        if slice_end.is_none() {
            slice_end = remaining[..limit].rfind(". ");
        }
        let slice_end = slice_end.unwrap_or(limit);
        let min_preferred = (limit as f32 * 0.6) as usize;
        let actual_end = if slice_end < min_preferred { limit } else { slice_end };

        let chunk = remaining[..actual_end].trim();
        if !chunk.is_empty() {
            chunks.push(chunk.to_string());
        }
        remaining = remaining[actual_end..].trim().to_string();
    }

    if !remaining.is_empty() {
        chunks.push(remaining);
    }

    chunks
}

pub fn get_remote_message_limit(channel_id: RemoteChannelId) -> usize {
    match channel_id {
        RemoteChannelId::Feishu => FEISHU_MESSAGE_LIMIT,
        RemoteChannelId::Telegram => TELEGRAM_MESSAGE_LIMIT,
    }
}

pub fn split_remote_text(text: &str, channel_id: RemoteChannelId) -> Vec<String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return vec![];
    }
    let limit = get_remote_message_limit(channel_id);
    let safe_limit = limit.clamp(256, DEFAULT_CHUNK_LIMIT);
    split_by_preference(trimmed, safe_limit)
}

pub fn normalize_remote_command(input: &str) -> String {
    let trimmed = input.trim();
    if !trimmed.starts_with('/') {
        return trimmed.to_string();
    }
    let mut parts = trimmed.split_whitespace();
    let command_raw = parts.next().unwrap_or("");
    if !command_raw.starts_with('/') {
        return trimmed.to_string();
    }
    let mut command = command_raw.trim_start_matches('/');
    if let Some(at_index) = command.find('@') {
        command = &command[..at_index];
    }
    let command = command.to_lowercase();
    let rest = parts.collect::<Vec<_>>().join(" ").trim().to_string();
    if rest.is_empty() {
        format!("/{}", command)
    } else {
        format!("/{} {}", command, rest)
    }
}

#[derive(Debug, Clone)]
struct DedupEntry {
    seen_at: u64,
}

#[derive(Debug, Default)]
pub struct DedupStore {
    entries: HashMap<String, DedupEntry>,
}

impl DedupStore {
    pub fn is_duplicate(
        &mut self,
        channel_id: RemoteChannelId,
        chat_id: &str,
        message_id: &str,
        ttl_ms: Option<u64>,
    ) -> bool {
        let ttl = ttl_ms.unwrap_or(DEFAULT_DEDUP_TTL_MS);
        let now = now_ms();
        self.cleanup(now, ttl);
        let key = format!("{}:{}:{}", channel_id.as_str(), chat_id, message_id);
        if self.entries.contains_key(&key) {
            return true;
        }
        self.entries.insert(key, DedupEntry { seen_at: now });
        false
    }

    fn cleanup(&mut self, now: u64, ttl_ms: u64) {
        self.entries.retain(|_, entry| now - entry.seen_at <= ttl_ms);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_limits() {
        assert_eq!(get_remote_message_limit(RemoteChannelId::Telegram), 4096);
        assert_eq!(get_remote_message_limit(RemoteChannelId::Feishu), 4000);
    }

    #[test]
    fn test_split_text() {
        let text = "a".repeat(5000);
        let chunks = split_remote_text(&text, RemoteChannelId::Feishu);
        assert!(chunks.len() > 1);
        assert_eq!(chunks.join(""), text);
    }

    #[test]
    fn test_dedup() {
        let mut store = DedupStore::default();
        assert!(!store.is_duplicate(RemoteChannelId::Telegram, "1", "10", Some(1000)));
        assert!(store.is_duplicate(RemoteChannelId::Telegram, "1", "10", Some(1000)));
        assert!(!store.is_duplicate(RemoteChannelId::Telegram, "1", "11", Some(1000)));
    }

    #[test]
    fn test_dedup_across_channels() {
        let mut store = DedupStore::default();
        assert!(!store.is_duplicate(RemoteChannelId::Telegram, "chat-a", "msg-1", Some(1000)));
        assert!(!store.is_duplicate(RemoteChannelId::Feishu, "chat-a", "msg-1", Some(1000)));
        assert!(store.is_duplicate(RemoteChannelId::Telegram, "chat-a", "msg-1", Some(1000)));
    }

    #[test]
    fn test_normalize_command() {
        assert_eq!(normalize_remote_command("/status@TalkCodyBot"), "/status");
        assert_eq!(normalize_remote_command("/new@TalkCodyBot hello"), "/new hello");
        assert_eq!(normalize_remote_command("hello"), "hello");
    }
}
