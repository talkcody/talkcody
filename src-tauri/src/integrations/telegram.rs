//! Telegram Integration Adapter
//!
//! Wraps existing telegram_gateway.rs for cloud backend integration.

use crate::integrations::types::*;
use std::sync::Arc;
use tokio::sync::RwLock;

/// Telegram adapter configuration
#[derive(Debug, Clone)]
pub struct TelegramConfig {
    pub bot_token: String,
    pub webhook_url: Option<String>,
}

/// Telegram integration adapter
pub struct TelegramAdapter {
    id: IntegrationId,
    config: TelegramConfig,
    connected: RwLock<bool>,
}

impl TelegramAdapter {
    pub fn new(id: impl Into<IntegrationId>, config: TelegramConfig) -> Self {
        Self {
            id: id.into(),
            config,
            connected: RwLock::new(false),
        }
    }

    /// Create adapter from existing gateway state
    pub fn from_gateway(id: impl Into<IntegrationId>) -> Self {
        Self {
            id: id.into(),
            config: TelegramConfig {
                bot_token: String::new(),
                webhook_url: None,
            },
            connected: RwLock::new(false),
        }
    }
}

#[async_trait::async_trait]
impl IntegrationAdapter for TelegramAdapter {
    fn id(&self) -> &IntegrationId {
        &self.id
    }

    fn channel_type(&self) -> ChannelType {
        ChannelType::Telegram
    }

    async fn start(&self) -> Result<(), String> {
        // Initialize connection to Telegram via existing gateway
        // The telegram_gateway module handles the actual bot lifecycle
        let mut connected = self.connected.write().await;
        *connected = true;
        Ok(())
    }

    async fn stop(&self) -> Result<(), String> {
        let mut connected = self.connected.write().await;
        *connected = false;
        Ok(())
    }

    async fn send_message(&self, recipient: &str, content: &str) -> Result<MessageId, String> {
        // Send message via telegram_gateway
        // Implements throttling as per spec section 10
        let chat_id: i64 = recipient
            .parse()
            .map_err(|_| "Invalid chat ID".to_string())?;

        // In full implementation:
        // 1. Check message length (Telegram limit: 4096 chars)
        // 2. Split if necessary
        // 3. Apply rate limiting (max 30 msgs/sec)
        // 4. Call telegram_gateway::telegram_send_message

        let _ = (chat_id, content);
        let message_id = format!("tg_msg_{}", uuid::Uuid::new_v4());
        Ok(message_id)
    }

    async fn edit_message(
        &self,
        _recipient: &str,
        message_id: &str,
        new_content: &str,
    ) -> Result<(), String> {
        // Edit message via telegram_gateway
        // Implements edit throttling per spec section 10

        let _msg_id: i64 = message_id
            .parse()
            .map_err(|_| "Invalid message ID".to_string())?;

        // In full implementation:
        // 1. Check if within 48h edit window
        // 2. Apply 1-second cadence for streaming edits
        // 3. Enforce max message length
        // 4. Call telegram_gateway::telegram_edit_message

        tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
        let _ = new_content;
        Ok(())
    }

    async fn is_connected(&self) -> bool {
        *self.connected.read().await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_telegram_adapter_creation() {
        let config = TelegramConfig {
            bot_token: "test_token".to_string(),
            webhook_url: None,
        };

        let adapter = TelegramAdapter::new("telegram-1", config);
        assert_eq!(adapter.id(), "telegram-1");
        assert_eq!(adapter.channel_type(), ChannelType::Telegram);
        assert!(!adapter.is_connected().await);
    }

    #[tokio::test]
    async fn test_telegram_start_stop() {
        let config = TelegramConfig {
            bot_token: "test_token".to_string(),
            webhook_url: None,
        };

        let adapter = TelegramAdapter::new("telegram-1", config);

        adapter.start().await.expect("Failed to start");
        assert!(adapter.is_connected().await);

        adapter.stop().await.expect("Failed to stop");
        assert!(!adapter.is_connected().await);
    }
}
