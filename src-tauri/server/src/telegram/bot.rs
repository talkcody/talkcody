//! Telegram Bot service — high-level orchestration
//!
//! - Long-polling loop (runs in background Tokio task)
//! - Per-chat session management
//! - Command parsing (/new, /help, /status, /stop, /approve, /reject)
//! - Streaming response handling (edit-based throttling)
//! - AI agent invocation via CoreRuntime

use super::client::{MIN_BACKOFF_MS, *};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};
use talkcody_core::core::types::{EventSender, RuntimeEvent, TaskInput};
use talkcody_core::core::CoreRuntime;
use talkcody_core::storage::models::{
    Message, MessageContent, MessageRole, Session, SessionStatus, TaskSettings,
};
use talkcody_core::storage::Storage;
use tokio::sync::{mpsc, Mutex, RwLock};
use tokio::time::interval;

const EDIT_THROTTLE_MS: u64 = 1_000; // Stream edit at most once per second
const STREAM_EDIT_LIMIT: usize = 3_800; // Leave headroom below Telegram 4096 limit

/// Bot configuration (loaded from env / settings).
#[derive(Clone, Debug)]
pub struct BotConfig {
    pub bot_token: String,
    pub allowed_chat_ids: Vec<i64>,
    pub data_root: PathBuf,
}

impl BotConfig {
    pub fn from_env(data_root: PathBuf) -> Option<Self> {
        let bot_token = std::env::var("TELEGRAM_BOT_TOKEN").ok()?;
        if bot_token.is_empty() {
            return None;
        }
        let allowed = std::env::var("TELEGRAM_ALLOWED_CHAT_IDS")
            .ok()
            .map(|s| {
                s.split(',')
                    .filter_map(|p| p.trim().parse::<i64>().ok())
                    .collect()
            })
            .unwrap_or_default();
        Some(Self {
            bot_token,
            allowed_chat_ids: allowed,
            data_root,
        })
    }

    pub fn is_chat_allowed(&self, chat_id: i64) -> bool {
        self.allowed_chat_ids.is_empty() || self.allowed_chat_ids.contains(&chat_id)
    }
}

/// Active conversation state for a single Telegram chat.
struct ChatSession {
    session_id: String,
    task_id: Option<String>,
    last_message_id: Option<i64>, // For editing streaming responses
    pending_text: String,         // Buffered streaming text
    last_edit_at: Instant,
    is_streaming: bool,
}

/// The bot service owns the long-polling loop and bridges Telegram ↔ AI runtime.
pub struct TelegramBot {
    client: TelegramClient,
    config: BotConfig,
    runtime: Arc<CoreRuntime>,
    storage: Storage,
    #[allow(dead_code)]
    event_sender: EventSender,
    /// Map Telegram chat_id → internal session state
    sessions: Arc<RwLock<HashMap<i64, ChatSession>>>,
    /// Inbound messages from polling loop → processor
    msg_rx: Arc<Mutex<mpsc::UnboundedReceiver<(TgMessage, TgUser)>>>,
    msg_tx: mpsc::UnboundedSender<(TgMessage, TgUser)>,
}

impl TelegramBot {
    pub fn new(
        config: BotConfig,
        runtime: Arc<CoreRuntime>,
        storage: Storage,
        event_sender: EventSender,
    ) -> Self {
        let client = TelegramClient::new(&config.bot_token);
        let (msg_tx, msg_rx) = mpsc::unbounded_channel();
        Self {
            client,
            config,
            runtime,
            storage,
            event_sender,
            sessions: Arc::new(RwLock::new(HashMap::new())),
            msg_rx: Arc::new(Mutex::new(msg_rx)),
            msg_tx,
        }
    }

    /// Spawn the polling loop and the message processor as background tasks.
    pub fn spawn(self: Arc<Self>) {
        let this_poll = self.clone();
        tokio::spawn(async move {
            this_poll.polling_loop().await;
        });

        let this_proc = self.clone();
        tokio::spawn(async move {
            this_proc.processor_loop().await;
        });

        let this_stream = self.clone();
        tokio::spawn(async move {
            this_stream.stream_flusher_loop().await;
        });
    }

    /// Long-polling loop: continuously fetch updates and enqueue messages.
    async fn polling_loop(&self) {
        let mut offset: Option<i64> = None;
        let mut backoff_ms = MIN_BACKOFF_MS;

        log::info!("[TelegramBot] Polling loop started");

        loop {
            match self.client.get_updates(offset).await {
                Ok(updates) => {
                    backoff_ms = MIN_BACKOFF_MS;
                    for up in updates {
                        if up.update_id >= offset.unwrap_or(0) {
                            offset = Some(up.update_id + 1);
                        }
                        if let Some(msg) = up.message {
                            let user = msg.from.clone().unwrap_or(TgUser {
                                id: None,
                                username: None,
                                first_name: None,
                                last_name: None,
                            });
                            let _ = self.msg_tx.send((msg, user));
                        }
                    }
                }
                Err((err, retry_hint)) => {
                    log::error!("[TelegramBot] getUpdates error: {}", err);
                    backoff_ms = next_backoff(backoff_ms, retry_hint);
                    backoff_sleep(backoff_ms).await;
                }
            }
        }
    }

    /// Processor loop: handle one message at a time (commands or chat).
    async fn processor_loop(&self) {
        let mut rx = self.msg_rx.lock().await;
        while let Some((msg, user)) = rx.recv().await {
            if let Err(e) = self.handle_message(msg, user).await {
                log::error!("[TelegramBot] handle_message error: {}", e);
            }
        }
    }

    /// Periodic flusher to ensure throttled edits are eventually sent.
    async fn stream_flusher_loop(&self) {
        let mut tick = interval(Duration::from_millis(EDIT_THROTTLE_MS));
        loop {
            tick.tick().await;
            let ids: Vec<i64> = {
                let sessions = self.sessions.read().await;
                sessions
                    .iter()
                    .filter(|(_, s)| {
                        s.is_streaming
                            && s.last_edit_at.elapsed().as_millis() as u64 > EDIT_THROTTLE_MS
                    })
                    .map(|(id, _)| *id)
                    .collect()
            };
            for chat_id in ids {
                let _ = self.flush_stream_edit(chat_id).await;
            }
        }
    }

    /// Main message handler: filter, parse commands, or start AI task.
    async fn handle_message(&self, msg: TgMessage, _user: TgUser) -> Result<(), String> {
        let chat_id = msg.chat.id;

        // Security: group chats blocked, allowlist enforced
        if is_group_chat(&msg.chat.chat_type, chat_id) {
            log::debug!("[TelegramBot] Ignoring group chat message from {}", chat_id);
            return Ok(());
        }
        if !self.config.is_chat_allowed(chat_id) {
            log::debug!("[TelegramBot] Chat {} not in allowlist", chat_id);
            self.client
                .send_message(
                    chat_id,
                    "⛔ This bot is private. Ask the admin to add your chat ID.",
                    None,
                )
                .await?;
            return Ok(());
        }

        let text = msg.text.as_deref().unwrap_or("").trim();

        // Command parsing
        if let Some(resp) = self.try_command(chat_id, text).await? {
            self.client
                .send_message(chat_id, &resp, Some(msg.message_id))
                .await?;
            return Ok(());
        }

        // Start or continue AI conversation
        let self_arc = Arc::new(unsafe { std::ptr::read(self as *const Self) });
        Self::start_ai_turn(self_arc, chat_id, text.to_string(), msg.message_id).await
    }

    /// Recognize slash commands and return a response if handled.
    async fn try_command(&self, chat_id: i64, text: &str) -> Result<Option<String>, String> {
        let cmd = text.split_whitespace().next().unwrap_or("");
        match cmd {
            "/start" => Ok(Some(
                "👋 Welcome to TalkCody!\n\n".to_string()
                    + "Send me any message to start coding with AI.\n"
                    + "Commands:\n"
                    + "/new — start fresh conversation\n"
                    + "/status — check current task status\n"
                    + "/stop — cancel current task\n"
                    + "/help — show this help",
            )),
            "/help" => Ok(Some(
                "🤖 *TalkCody Remote*\n\n".to_string()
                    + "Available commands:\n"
                    + "/new — start a new session\n"
                    + "/status — show current task status\n"
                    + "/stop — stop the running task\n"
                    + "/approve — approve pending edits\n"
                    + "/reject — reject pending edits\n"
                    + "/help — show help\n\n"
                    + "Just type your request to chat with the AI agent.",
            )),
            "/new" => {
                {
                    let mut sessions = self.sessions.write().await;
                    sessions.remove(&chat_id);
                }
                Ok(Some(
                    "✨ Started a new conversation. How can I help?".to_string(),
                ))
            }
            "/status" => {
                let status = {
                    let sessions = self.sessions.read().await;
                    match sessions.get(&chat_id) {
                        Some(s) => match s.task_id {
                            Some(_) if s.is_streaming => "🔄 Responding…".to_string(),
                            Some(_) => "⏳ Processing…".to_string(),
                            None => "💤 Idle".to_string(),
                        },
                        None => "💤 No active session".to_string(),
                    }
                };
                Ok(Some(status))
            }
            "/stop" => {
                let stopped = {
                    let mut sessions = self.sessions.write().await;
                    if let Some(s) = sessions.get_mut(&chat_id) {
                        if let Some(ref task_id) = s.task_id {
                            let _ = self.runtime.cancel_task(task_id).await;
                        }
                        s.is_streaming = false;
                        s.task_id = None;
                        true
                    } else {
                        false
                    }
                };
                Ok(Some(if stopped {
                    "🛑 Task stopped.".to_string()
                } else {
                    "No active task to stop.".to_string()
                }))
            }
            "/approve" => {
                // In MVP we rely on auto-approve; explicit approve is a no-op placeholder.
                Ok(Some(
                    "✅ Auto-approve is enabled by default in server mode.".to_string(),
                ))
            }
            "/reject" => Ok(Some(
                "❌ Reject not yet implemented in server mode.".to_string(),
            )),
            _ => Ok(None),
        }
    }

    /// Start an AI agent turn for this chat.
    async fn start_ai_turn(
        self_arc: Arc<Self>,
        chat_id: i64,
        text: String,
        reply_to: i64,
    ) -> Result<(), String> {
        let this = &*self_arc;
        // 1) Ensure session exists
        let session_id = {
            let mut sessions = this.sessions.write().await;
            if let Some(sess) = sessions.get(&chat_id) {
                sess.session_id.clone()
            } else {
                let new_id = format!("tg_{}_{}", chat_id, uuid::Uuid::new_v4());
                let now = chrono::Utc::now().timestamp();
                let session = Session {
                    id: new_id.clone(),
                    project_id: None,
                    title: Some(format!("Telegram {}", chat_id)),
                    status: SessionStatus::Running,
                    created_at: now,
                    updated_at: now,
                    last_event_id: None,
                    metadata: None,
                };
                // Persist to DB (ignore error for MVP)
                let _ = this.storage.chat_history.create_session(&session).await;
                sessions.insert(
                    chat_id,
                    ChatSession {
                        session_id: new_id.clone(),
                        task_id: None,
                        last_message_id: None,
                        pending_text: String::new(),
                        last_edit_at: Instant::now(),
                        is_streaming: false,
                    },
                );
                new_id
            }
        };

        // 2) Save user message
        let msg_id = format!("msg_{}", uuid::Uuid::new_v4());
        let user_msg = Message {
            id: msg_id,
            session_id: session_id.clone(),
            role: MessageRole::User,
            content: MessageContent::Text { text: text.clone() },
            created_at: chrono::Utc::now().timestamp(),
            tool_call_id: None,
            parent_id: None,
        };
        let _ = this.storage.chat_history.create_message(&user_msg).await;

        // 3) Send placeholder to get a message_id for streaming edits
        let placeholder = "🤔 Thinking…";
        let telegram_msg_id = this
            .client
            .send_message(chat_id, placeholder, Some(reply_to))
            .await?;

        // 4) Update session state
        {
            let mut sessions = this.sessions.write().await;
            if let Some(sess) = sessions.get_mut(&chat_id) {
                sess.last_message_id = Some(telegram_msg_id);
                sess.is_streaming = true;
                sess.pending_text.clear();
                sess.last_edit_at = Instant::now();
            }
        }

        // 5) Start AI task
        let settings = TaskSettings {
            auto_approve_edits: Some(true),
            auto_approve_plan: Some(true),
            auto_code_review: None,
            extra: std::collections::HashMap::new(),
        };
        let task_input = TaskInput {
            session_id: session_id.clone(),
            agent_id: None,
            project_id: None,
            initial_message: text,
            settings: Some(settings),
            workspace: None,
        };

        let task_handle = match this.runtime.start_task(task_input).await {
            Ok(handle) => handle,
            Err(e) => {
                this.client
                    .edit_message(
                        chat_id,
                        telegram_msg_id,
                        &format!("❌ Failed to start task: {}", e),
                    )
                    .await?;
                return Ok(());
            }
        };
        let task_id = task_handle.task_id.clone();

        // Store task_id
        {
            let mut sessions = this.sessions.write().await;
            if let Some(sess) = sessions.get_mut(&chat_id) {
                sess.task_id = Some(task_id.clone());
            }
        }

        // 6) Spawn a listener to forward runtime events into Telegram edits
        let bot_for_listener = self_arc.clone();
        let task_id_for_listener = task_id.clone();
        tokio::spawn(async move {
            bot_for_listener
                .run_event_listener(chat_id, telegram_msg_id, task_id_for_listener)
                .await;
        });

        Ok(())
    }

    /// Listen to runtime events for a specific chat/task and drive Telegram edits.
    async fn run_event_listener(&self, chat_id: i64, telegram_msg_id: i64, _task_id: String) {
        // Subscribe to broadcast channel (re-subscribe per task)
        // For MVP we use a simple polling loop over a cloned receiver pattern.
        // Because the runtime broadcasts globally, we need to filter.
        // We'll use a small mpsc bridge.
        let (_tx, mut rx) = mpsc::unbounded_channel::<RuntimeEvent>();

        // Hook into the runtime's event system via a small bridge task
        // NOTE: In production we'd inject a per-task channel into runtime.
        // Here we simulate by polling storage state changes (simpler for MVP).

        // Simplified MVP: poll for completion and read final assistant message from DB.
        let poll_start = Instant::now();
        let mut last_len: usize = 0;

        loop {
            tokio::time::sleep(Duration::from_millis(500)).await;

            // Check if task still running (MVP: assume completion after timeout or simple heuristic)
            // Real implementation should query runtime task state; here we approximate.
            if poll_start.elapsed() > Duration::from_secs(60 * 5) {
                // Max 5 min timeout
                break;
            }

            // Pull latest assistant message from storage
            let session_id = {
                let sessions = self.sessions.read().await;
                sessions.get(&chat_id).map(|s| s.session_id.clone())
            };
            if let Some(sid) = session_id {
                if let Ok(msgs) = self
                    .storage
                    .chat_history
                    .get_messages(&sid, Some(10), None)
                    .await
                {
                    if let Some(last) = msgs
                        .iter()
                        .find(|m| matches!(m.role, MessageRole::Assistant))
                    {
                        if let MessageContent::Text { text } = &last.content {
                            if text.len() != last_len {
                                last_len = text.len();
                                // Append streaming indicator
                                let to_send = if text.len() > STREAM_EDIT_LIMIT {
                                    format!("{}…", &text[..STREAM_EDIT_LIMIT])
                                } else {
                                    format!("{}▌", text)
                                };
                                let _ = self
                                    .client
                                    .edit_message(chat_id, telegram_msg_id, &to_send)
                                    .await;
                            }
                        }
                    }
                }
            }

            // Break on completion (heuristic: last assistant message unchanged for 3s)
            // Real impl should use runtime event Done.
            if rx.try_recv().is_ok() {
                break;
            }
        }

        // Finalize: remove streaming indicator and send follow-up if too long
        let session_id = {
            let sessions = self.sessions.read().await;
            sessions.get(&chat_id).map(|s| s.session_id.clone())
        };

        if let Some(sid) = session_id {
            if let Ok(msgs) = self
                .storage
                .chat_history
                .get_messages(&sid, Some(5), None)
                .await
            {
                if let Some(last) = msgs
                    .iter()
                    .find(|m| matches!(m.role, MessageRole::Assistant))
                {
                    if let MessageContent::Text { text } = &last.content {
                        if text.len() <= 4000 {
                            let _ = self
                                .client
                                .edit_message(chat_id, telegram_msg_id, text)
                                .await;
                        } else {
                            // Split into chunks
                            let _ = self.client.send_chunked(chat_id, text, None).await;
                            // Edit placeholder to indicate continuation
                            let _ = self
                                .client
                                .edit_message(
                                    chat_id,
                                    telegram_msg_id,
                                    "✅ Response above (multiple messages)",
                                )
                                .await;
                        }
                    }
                }
            }
        }

        // Mark session not streaming
        {
            let mut sessions = self.sessions.write().await;
            if let Some(sess) = sessions.get_mut(&chat_id) {
                sess.is_streaming = false;
                sess.task_id = None;
            }
        }
    }

    /// Flush pending stream buffer to Telegram (throttled).
    async fn flush_stream_edit(&self, chat_id: i64) -> Result<(), String> {
        let (msg_id, text) = {
            let sessions = self.sessions.read().await;
            let sess = sessions.get(&chat_id).ok_or("No session")?;
            if !sess.is_streaming {
                return Ok(());
            }
            (
                sess.last_message_id.ok_or("No message id")?,
                sess.pending_text.clone(),
            )
        };

        let to_send = if text.len() > STREAM_EDIT_LIMIT {
            format!("{}…", &text[..STREAM_EDIT_LIMIT])
        } else {
            format!("{}▌", text)
        };

        self.client.edit_message(chat_id, msg_id, &to_send).await
    }
}
