//! Telegram Bot integration for TalkCody Server
//!
//! This module provides a lightweight Telegram Bot integration for the
//! standalone server deployment. It supports long-polling mode and bridges
//! Telegram conversations to the AI Agent runtime.
//!
//! ## Usage
//!
//! 1. Set environment variable `TELEGRAM_BOT_TOKEN` to your BotFather token
//! 2. Optionally set `TELEGRAM_ALLOWED_CHAT_IDS` (comma-separated) to restrict access
//! 3. The bot auto-starts when the server boots
//!
//! ## Architecture
//!
//! ```text
//! Telegram Bot API (long-polling)
//!          │
//!          ▼
//!  +---------------+
//!  │    client     │  HTTP wrapper (getUpdates, sendMessage, editMessage)
//!  +---------------+
//!          │
//!          ▼
//!  +---------------+
//!  │      bot      │  Session management, command routing, streaming
//!  +---------------+
//!          │
//!          ▼
//!  +---------------+
//!  │   CoreRuntime │  AI Agent execution
//!  +---------------+
//! ```

pub mod bot;
pub mod client;

pub use bot::{BotConfig, TelegramBot};
pub use client::{TelegramClient, TgMessage, TgUser};

use std::path::PathBuf;
use std::sync::Arc;
use talkcody_core::core::types::EventSender;
use talkcody_core::core::CoreRuntime;
use talkcody_core::storage::Storage;

/// Initialize and spawn the Telegram bot if configured.
pub fn maybe_spawn_bot(
    runtime: Arc<CoreRuntime>,
    storage: Storage,
    event_sender: EventSender,
    data_root: PathBuf,
) -> Option<Arc<TelegramBot>> {
    let config = BotConfig::from_env(data_root)?;
    log::info!("[Telegram] Bot configuration loaded; spawning bot…");

    let bot = Arc::new(TelegramBot::new(config, runtime, storage, event_sender));
    let bot_ret = bot.clone();
    bot.spawn();
    Some(bot_ret)
}
