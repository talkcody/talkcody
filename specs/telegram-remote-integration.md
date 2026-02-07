# Telegram Remote Integration Architecture

This document describes the implementation principles, architecture, and core flows for Telegram remote control in TalkCody.

## Goals
- Receive Telegram messages on mobile and execute tasks on desktop.
- Stream responses back to Telegram with message edits and chunked delivery.
- Keep configuration simple and persisted in app settings.
- Provide safe access control via allowed chat IDs and group chat blocking.

## Key Components

### Tauri Backend Gateway (`src-tauri/src/telegram_gateway.rs`)
- Polls Telegram Bot API with `getUpdates`.
- Emits `telegram-inbound-message` events to the frontend on inbound messages.
- Sends outbound replies using `sendMessage` and updates drafts via `editMessageText`.
- Persists last update offset in `telegram-remote-state.json` under app data dir.
- Stores config in `telegram-remote.json` under app data dir.
- Exposes Tauri commands:
  - `telegram_get_config`, `telegram_set_config`, `telegram_start`, `telegram_stop`
  - `telegram_get_status`, `telegram_is_running`
  - `telegram_send_message`, `telegram_edit_message`

### Frontend Remote Service (`src/services/remote/telegram-remote-service.ts`)
- Listens for `telegram-inbound-message` events.
- Creates/loads tasks and starts agent execution via `ExecutionService`.
- Streams updates using `editMessage` and finalizes with chunked sends.
- Handles remote approvals via `EditReviewStore`.
- Supports commands: `/help`, `/new`, `/status`, `/stop`, `/approve`, `/reject`.
- Deduplicates inbound messages by `chatId + messageId`.

### Settings UI (`src/components/settings/general-settings.tsx`)
- Lets users configure bot token, allowed chat IDs, and poll timeout.
- Validates token and poll timeout range before saving.

### Storage
- Settings DB (SQLite) stores:
  - `telegram_remote_enabled`, `telegram_remote_token`,
  - `telegram_remote_allowed_chats`, `telegram_remote_poll_timeout`.
- App data files:
  - `telegram-remote.json` (backend config snapshot).
  - `telegram-remote-state.json` (last update offset).

## Core Flow

### 1. Configuration and Startup
1. User enables Telegram remote control in Settings.
2. Frontend calls `telegram_set_config` and `telegram_start`.
3. Backend loads config and state, then starts polling loop.

### 2. Polling and Inbound Messages
1. Poll loop calls `getUpdates` with `offset = last_update_id + 1`.
2. For each update, filter out:
   - non-text messages,
   - group chats (negative chat IDs or `chat_type` = group/supergroup),
   - chat IDs not in allowlist.
3. Emit `telegram-inbound-message` to the frontend.
4. Update `last_update_id` and persist state.

### 3. Task Execution
1. Frontend creates or reuses a task for the chat.
2. User message is stored and `ExecutionService` starts agent run.
3. Task settings force plan auto-approval for remote runs.

### 4. Streaming Output
1. Execution streaming content is observed from `ExecutionStore`.
2. The service edits a single Telegram message for live updates.
3. When execution completes, full output is split into chunks and sent.

### 5. Approvals
1. Pending file edits trigger a prompt via Telegram.
2. `/approve` and `/reject` map to `EditReviewStore` actions.

## Reliability and Backoff
- Polling uses exponential backoff with jitter and respects `retry_after`.
- `last_update_id` is persisted to avoid reprocessing after restarts.
- Errors are tracked in gateway status and surfaced in `/status`.

## Security Model
- Access is restricted by allowed chat IDs.
- Group chats are blocked by default.
- Bot token stays in the settings database and is not logged.

## Limitations
- Only text messages are processed.
- Group chats are not supported.
- Streaming relies on Telegram message limits (4096 chars per message).

## Testing
- Unit tests cover Telegram utilities (chunking, dedupe, command parsing).
- Backend state persistence tests validate offset storage.
