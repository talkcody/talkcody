# TalkCody WeChat Remote Integration Specification

## 1. Goal

Add WeChat remote control support to TalkCody for **personal use only**, implemented **entirely on the TypeScript side**, with **no Rust gateway work**.

Scope constraints:
- Only support **1:1 personal chats**.
- Do **not** support group chats.
- Do **not** support multi-tenant bot management.
- Do **not** copy openilink-hub's full hub architecture.
- Reuse TalkCody's existing remote chat orchestration wherever possible.

This design is based on three sources:
- TalkCody's existing Telegram and Feishu remote architecture in `specs/remote-chat-integration.md`
- openilink-hub's WeChat/iLink handling patterns under `/Users/kks/mygit/openilink-hub`
- `videGavin/fastclaw-plugin-weixin`, especially its TS-only polling, sync buffer, context token, and media upload patterns

## 2. Why TS-Only Is The Right Choice

WeChat support should live in TypeScript instead of Rust for this feature.

Reasons:
- The iLink integration model is primarily **HTTP long-polling + HTTP send/upload APIs**, not a heavy realtime socket stack that benefits from Rust.
- TalkCody already has a solid TS orchestration layer in `src/services/remote/remote-chat-service.ts` and `src/services/remote/remote-channel-manager.ts`.
- Tauri already gives TS access to:
  - HTTP via `simpleFetch` in `src/lib/tauri-fetch.ts`
  - app-data persistence via `@tauri-apps/plugin-fs`
  - path utilities via `@tauri-apps/api/path`
- `fastclaw-plugin-weixin` proves the core WeChat bridge can run well in JS/TS with:
  - `getupdates` long-polling
  - sync buffer persistence
  - context token persistence
  - AES-128-ECB media handling
  - session-expiry handling
- Avoiding Rust keeps iteration faster and avoids introducing a third backend gateway implementation style.

## 3. Reference Takeaways

### 3.1 Reuse From openilink-hub

Useful patterns to reuse conceptually:
- **Normalized inbound message model** from `internal/provider/provider.go`
- **Store/recover poll cursor (`sync_buf`)** pattern from the iLink provider flow
- **Context token per chat/user** for legal outbound replies
- **Group filtering** and provider-side capability boundaries
- **Media flow**: CDN params + AES key + deferred decrypt/download
- **Session expiry as an explicit runtime status**, not just a thrown error

Useful specific lessons:
- Outbound WeChat replies are not fully free-form; they often rely on a fresh `context_token`
- Inbound handling should preserve enough provider metadata to support later reply/media operations
- Media details should stay provider-specific until normalized by the channel adapter layer

### 3.2 Reuse From fastclaw-plugin-weixin

Useful implementation ideas to adapt directly:
- Long-poll loop around `ilink/bot/getupdates`
- `sync_buf` persistence per account/session
- `context_token` persistence keyed by peer
- `SESSION_EXPIRED_ERRCODE = -14` handling
- `X-WECHAT-UIN` random header generation
- image send flow:
  1. get upload URL
  2. AES-128-ECB encrypt image bytes
  3. upload to CDN
  4. send image message referencing CDN params
- markdown stripping before outbound delivery
- extracting text from reply/quote messages and voice transcription text

### 3.3 What Not To Copy

Do not copy these patterns directly:
- openilink-hub's full bot manager / relay / channel / app-installation architecture
- openilink-hub's account-login coupling in `internal/api/auth_scan.go`
- fastclaw's JSON-RPC plugin process model
- multi-account discovery as a first milestone
- Rust gateway commands like Telegram/Feishu currently use

TalkCody should remain:
- single-user
- desktop-local
- channel-adapter based
- settings-driven

## 4. Product Definition

### 4.1 Supported Use Cases

Supported:
- receive direct messages from a personal WeChat contact
- send AI replies back into the same direct conversation
- support slash-command style control similar to Telegram/Feishu:
  - `/help`
  - `/new`
  - `/status`
  - `/model`
  - `/project`
  - `/agent`
  - `/list`
  - `/approve`
  - `/reject`
- receive image / voice / file messages in 1:1 chats
- transcribe voice to text for prompting
- persist cursor and reply context across restarts

Not supported:
- group chats
- proactive cold-start messaging without a valid WeChat reply context
- multiple WeChat accounts in the first implementation
- editing previously sent WeChat messages
- service-mode multi-tenant hosting in this phase

### 4.2 UX Positioning

WeChat should be exposed as another remote-control channel, but with a different UX than Telegram/Feishu:
- Telegram: token-based bot setup
- Feishu: app credentials setup
- WeChat: QR/bot credential setup + session health + personal-contact allowlist

## 5. Current TalkCody Integration Constraints

Relevant current files:
- `src/services/remote/remote-channel-types.ts`
- `src/services/remote/remote-channel-manager.ts`
- `src/services/remote/remote-chat-service.ts`
- `src/services/remote/remote-message-format.ts`
- `src/services/remote/remote-text-utils.ts`
- `src/components/remote/telegram-remote-runner.tsx`
- `src/components/settings/remote-control-settings.tsx`
- `src/stores/settings-store.ts`
- `src/types/remote-control.ts`
- `src/types/scheduled-task.ts`

Current pain points that matter for WeChat:
- `remote-chat-service.ts` still contains channel-specific branches for Feishu streaming behavior.
- `/status` currently fetches gateway status via Rust command branches (`telegram_get_status`, `feishu_get_status`).
- `RemoteChannelAdapter` has no explicit capability or status API.
- `remote-text-utils.ts` assumes only Telegram/Feishu message limits.
- `scheduled-task` delivery types only allow `'telegram' | 'feishu'` today.

WeChat should not be added as another pile of special cases. The adapter layer needs a small upgrade.

## 6. Recommended Architecture

## 6.1 High-Level Shape

```text
WeChat iLink HTTP APIs
   |
   v
src/services/remote/wechat/wechat-ilink-client.ts
   |
   +--> wechat-bind-service.ts
   +--> wechat-sync-state.ts
   +--> wechat-context-token-store.ts
   +--> wechat-media-service.ts
   |
   v
src/services/remote/channels/wechat-channel-adapter.ts
   |
   v
src/services/remote/remote-channel-manager.ts
   |
   v
src/services/remote/remote-chat-service.ts
   |
   v
TalkCody tasks / execution / approvals / media pipeline
```

## 6.2 Design Principles

- Keep all WeChat/iLink specifics under `src/services/remote/wechat/`
- Only expose normalized `RemoteInboundMessage` and `RemoteSendMessageRequest` to the shared remote layer
- Treat WeChat as a **capability-constrained append-only channel**
- Persist only the minimum provider state needed for recovery:
  - credentials
  - sync buffer
  - context tokens
  - bind session state if needed during QR flow
- Never allow group messages into TalkCody's remote chat flow

## 7. Proposed File Layout

### 7.1 New Files

- `src/services/remote/channels/wechat-channel-adapter.ts`
- `src/services/remote/wechat/wechat-types.ts`
- `src/services/remote/wechat/wechat-ilink-client.ts`
- `src/services/remote/wechat/wechat-bind-service.ts`
- `src/services/remote/wechat/wechat-sync-state.ts`
- `src/services/remote/wechat/wechat-context-token-store.ts`
- `src/services/remote/wechat/wechat-media-service.ts`
- `src/services/remote/wechat/wechat-header-utils.ts`
- `src/services/remote/wechat/wechat-message-parser.ts`
- `src/services/remote/wechat/wechat-status-store.ts`
- `src/services/remote/wechat/wechat-crypto.ts`

### 7.2 Existing Files To Modify

- `src/types/remote-control.ts`
- `src/types/scheduled-task.ts`
- `src/stores/settings-store.ts`
- `src/components/settings/remote-control-settings.tsx`
- `src/components/remote/telegram-remote-runner.tsx`
- `src/services/remote/remote-channel-types.ts`
- `src/services/remote/remote-channel-manager.ts`
- `src/services/remote/remote-chat-service.ts`
- `src/services/remote/remote-message-format.ts`
- `src/services/remote/remote-text-utils.ts`
- `src/services/scheduled-tasks/scheduled-task-delivery-service.ts`
- `src/components/scheduled-tasks/scheduled-task-form-modal.tsx`
- `src/locales/en.ts`
- `src/locales/zh.ts`
- `src/locales/types.ts`

## 8. Adapter Contract Changes

Before implementing WeChat, evolve the adapter contract.

Current `RemoteChannelAdapter` is too small:
- `start`
- `stop`
- `onInbound`
- `sendMessage`
- `editMessage`

Add the following:

```ts
export interface RemoteChannelCapabilities {
  supportsEdit: boolean;
  supportsReply: boolean;
  supportsMediaSend: boolean;
  supportsVoiceInput: boolean;
  supportsProactiveMessage: boolean;
  maxMessageLength: number;
  streamMode: 'edit' | 'append';
}

export interface RemoteChannelStatus {
  running: boolean;
  sessionExpired?: boolean;
  lastPollAtMs?: number | null;
  lastError?: string | null;
  lastErrorAtMs?: number | null;
  details?: Record<string, string | number | boolean | null>;
}

export interface RemoteChannelAdapter {
  readonly channelId: RemoteChannelId;
  readonly capabilities: RemoteChannelCapabilities;
  start(): Promise<void>;
  stop(): Promise<void>;
  onInbound(handler: (message: RemoteInboundMessage) => void): () => void;
  sendMessage(request: RemoteSendMessageRequest): Promise<RemoteSendMessageResponse>;
  editMessage(request: RemoteEditMessageRequest): Promise<void>;
  getStatus?(): Promise<RemoteChannelStatus>;
}
```

Why this is needed:
- WeChat will not support edit-message streaming.
- WeChat proactive messaging may be impossible without valid context.
- `/status` should query adapter status, not Rust invoke branches.
- shared code should ask adapter capabilities instead of hardcoding Feishu behavior.

## 9. Data Model

## 9.1 Remote Types Extension

In `src/types/remote-control.ts`:

```ts
export type RemoteChannelId =
  | 'telegram'
  | 'discord'
  | 'slack'
  | 'feishu'
  | 'whatsapp'
  | 'wechat';
```

Add WeChat-specific config/status types:

```ts
export interface WechatRemoteConfig {
  enabled: boolean;
  baseUrl: string;
  botToken: string;
  botId: string;
  ilinkUserId: string;
  allowedUserIds: string[];
  pollTimeoutMs: number;
}

export interface WechatRemoteStatus {
  running: boolean;
  sessionExpired: boolean;
  lastPollAtMs?: number | null;
  lastError?: string | null;
  lastErrorAtMs?: number | null;
  syncBufPresent: boolean;
  activeContextCount: number;
}
```

## 9.2 Provider Types

In `src/services/remote/wechat/wechat-types.ts` define provider-native shapes.

Recommended types:

```ts
export interface ILinkBaseInfo {
  channel_version: string;
}

export interface ILinkGetUpdatesRequest {
  get_updates_buf?: string;
  base_info: ILinkBaseInfo;
}

export interface ILinkGetUpdatesResponse {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  get_updates_buf?: string;
  msgs?: ILinkInboundMessage[];
}

export interface ILinkInboundMessage {
  msg_id?: string | number;
  from_user_id?: string;
  to_user_id?: string;
  group_id?: string;
  create_time_ms?: number;
  context_token?: string;
  session_id?: string;
  msg_state?: number;
  item_list?: ILinkMessageItem[];
}

export interface ILinkMessageItem {
  type: number | string;
  text_item?: { text?: string };
  image_item?: { media?: ILinkMedia; mid_size?: number };
  voice_item?: { media?: ILinkMedia; text?: string };
  file_item?: { file_name?: string; media?: ILinkMedia };
  video_item?: { media?: ILinkMedia };
  ref_msg?: ILinkRefMessage;
}

export interface ILinkRefMessage {
  title?: string;
  message_item?: {
    text_item?: { text?: string };
  };
}

export interface ILinkMedia {
  url?: string;
  encrypt_query_param?: string;
  aes_key?: string;
  encrypt_type?: number;
  file_size?: number;
}
```

Keep raw types provider-native. Normalize only in parser/adapter.

## 10. Persistence Design

All persistence stays in app data using `@tauri-apps/plugin-fs`.

Recommended app-data layout:

```text
AppData/
  remote/
    wechat/
      credentials.json
      sync-state.json
      context-tokens.json
      status.json
      attachments/
        <message-id>-<filename>
```

### 10.1 `credentials.json`

Stores the active personal account credentials:
- `botToken`
- `botId`
- `ilinkUserId`
- `baseUrl`
- `updatedAt`

This is TalkCody-local state, not a cloud account store.

### 10.2 `sync-state.json`

Stores:
- latest `get_updates_buf`
- `updatedAt`
- optional `lastMessageId`

This mirrors the openilink-hub / fastclaw sync-cursor concept.

### 10.3 `context-tokens.json`

Stores a mapping:

```json
{
  "user@wx": {
    "token": "ctx-...",
    "updatedAt": 1710000000000,
    "expiresAt": 1710086400000
  }
}
```

Context tokens are required because WeChat replies are constrained by the provider conversation context.

### 10.4 `status.json`

Optional but useful for recovery and UI:
- `running`
- `sessionExpired`
- `lastPollAtMs`
- `lastError`
- `lastErrorAtMs`

## 11. Settings Model

Add these fields in `src/stores/settings-store.ts`:

```ts
wechat_remote_enabled: boolean;
wechat_remote_base_url: string;
wechat_remote_bot_token: string;
wechat_remote_bot_id: string;
wechat_remote_ilink_user_id: string;
wechat_remote_allowed_user_ids: string;
wechat_remote_poll_timeout_ms: string;
```

Defaults:
- `wechat_remote_enabled = false`
- `wechat_remote_base_url = https://ilinkai.weixin.qq.com`
- `wechat_remote_poll_timeout_ms = 35000`

Notes:
- `allowed_user_ids` should be a comma-separated list like the Telegram/Feishu settings style.
- Bot token should be treated as sensitive and never logged.
- If existing secure storage utilities are appropriate, credentials can be mirrored there; otherwise keep the first version aligned with the existing settings store pattern.

## 12. QR / Bind Flow

Even in TS-only mode, the bind flow can live in a dedicated service.

## 12.1 Service: `wechat-bind-service.ts`

Responsibilities:
- start a new QR bind session
- poll QR status
- refresh expired QR code
- return confirmed bot credentials
- persist successful credentials
- expose transient bind-state updates to the settings UI

## 12.2 Flow

```text
User clicks Connect WeChat
  -> bind service fetches QR code
  -> settings UI renders QR image
  -> poll every 2-3 seconds
      -> wait
      -> scanned
      -> expired -> refresh QR
      -> confirmed -> save credentials -> ready
```

## 12.3 Important Details

Borrow from openilink-hub's bind behavior, but keep it local-only:
- pending bind session lives only in memory on the desktop app
- no HTTP WebSocket status endpoint is needed
- after confirmation, save credentials directly into local persistence/settings

Recommended bind-session shape:

```ts
interface WechatBindSession {
  sessionId: string;
  qrCode: string;
  qrImageUrl: string;
  status: 'idle' | 'wait' | 'scanned' | 'expired' | 'confirmed' | 'error';
  createdAt: number;
}
```

## 13. HTTP Client Design

## 13.1 `wechat-ilink-client.ts`

This file owns all provider HTTP operations.

Core methods:
- `getUpdates(syncBuf?: string)`
- `sendText(params)`
- `getUploadUrl(params)`
- `uploadEncryptedMedia(params)`
- `sendImage(params)`
- `fetchQrCode()`
- `pollQrStatus(qrCode)`
- `downloadMedia(media)`

Use:
- `simpleFetch` for JSON GET/POST requests
- native `fetch` for `FormData` / binary upload cases when necessary

This matches TalkCody guidance because `simpleFetch` already falls back to native fetch for unsupported body types.

## 13.2 Header Rules

Based on `fastclaw-plugin-weixin`, include:
- `Content-Type: application/json`
- `AuthorizationType: ilink_bot_token`
- `Authorization: Bearer <token>`
- `X-WECHAT-UIN: <random base64 value>`

Create helper utilities in `wechat-header-utils.ts`.

## 13.3 Error Classification

Standardize provider errors:
- `session_expired`
- `network_error`
- `rate_limited`
- `invalid_credentials`
- `provider_error`

Map raw iLink responses into these normalized internal errors.

## 14. Polling Loop

## 14.1 Core Loop

The monitor loop should live inside the adapter or a small runtime helper.

Behavior:
- read initial sync buffer from persistence
- call `getupdates` with long-poll timeout
- parse returned messages
- update sync buffer only after response is accepted
- persist sync buffer immediately
- classify and back off on errors
- stop permanently on session expiry until user reconnects

## 14.2 Backoff Strategy

Use the simpler `fastclaw-plugin-weixin` model:
- transient retry: `2s`
- after repeated failures: `30s`
- reset failure count after a successful poll

Recommended constants:

```ts
const LONG_POLL_TIMEOUT_MS = 35000;
const RETRY_DELAY_MS = 2000;
const BACKOFF_DELAY_MS = 30000;
const MAX_CONSECUTIVE_FAILURES = 3;
const SESSION_EXPIRED_ERRCODE = -14;
```

## 14.3 Dedup Strategy

Use two layers:
- primary: provider `sync_buf`
- secondary: existing TalkCody dedup TTL in `remote-text-utils.ts`

Reason:
- `sync_buf` protects across restarts
- TTL dedup protects within a single runtime if the provider repeats a message

## 15. Personal-Only / No Group Support Enforcement

This must be enforced in multiple layers.

### 15.1 Inbound Filter

Reject any inbound message where:
- `group_id` is present and non-empty
- sender is not in the allowlist when allowlist is non-empty
- message has no usable text/media

### 15.2 Outbound Policy

Only allow send to:
- a user who has already created a valid inbound reply context
- or an explicitly configured target when the provider confirms sending is legal

### 15.3 UI Wording

The settings page must clearly say:
- personal WeChat only
- no group chats
- best effort reply-based messaging
- account/session can expire

## 16. Message Normalization

## 16.1 `wechat-message-parser.ts`

Responsibilities:
- parse raw iLink message items
- extract visible text
- extract quote/reply context into readable prefix text
- map voice auto-text when present
- map image/file/voice media items to `RemoteAttachment`
- return normalized `RemoteInboundMessage`

Recommended behavior:
- If message is quoted/replied, prepend a short plain-text marker like:

```text
[Quoted: <title> | <excerpt>]
<actual message>
```

This follows the fastclaw plugin pattern and makes prompt context much better.

## 16.2 Text Extraction Rules

Support at minimum:
- plain text item
- voice item with transcription text
- reference / quote item

If no plain text exists but media exists, create a minimal synthetic prompt, for example:
- `[Image received]`
- `[Voice received]`
- `[File received: xxx.pdf]`

## 17. Context Token Strategy

This is the most important WeChat-specific rule.

## 17.1 Why It Matters

Without valid `context_token`, the provider may reject or mishandle outbound replies. WeChat is not a pure bot-push channel like Telegram.

## 17.2 Rules

- On inbound message, if `context_token` exists, store/update it for that sender.
- On outbound reply, load the latest token for that chat.
- When provider send succeeds and returns a new context token, update stored token.
- Tokens should expire locally after ~24h of inactivity.
- If no valid token exists, channel status should reflect `supportsProactiveMessage = false` and send attempts should fail with a friendly error.

## 17.3 Storage API

`wechat-context-token-store.ts` should provide:
- `get(chatId)`
- `set(chatId, token)`
- `remove(chatId)`
- `pruneExpired()`
- `countActive()`
- `load()` / `save()`

## 18. Streaming Strategy

WeChat should use **append mode only**.

Do not support editing prior messages.

In practice, WeChat should behave more like Feishu append mode than Telegram edit mode.

Required shared changes:
- move current hardcoded Feishu append behavior in `remote-chat-service.ts` to capability-based logic
- if `adapter.capabilities.streamMode === 'append'`, use append flow
- if `supportsEdit === false`, never call `editMessage`

Recommended WeChat capabilities:

```ts
{
  supportsEdit: false,
  supportsReply: true,
  supportsMediaSend: true,
  supportsVoiceInput: true,
  supportsProactiveMessage: false,
  maxMessageLength: 2000,
  streamMode: 'append'
}
```

Notes:
- message length should stay conservative initially because WeChat formatting is less predictable than Telegram.
- `remote-text-utils.ts` should add a WeChat-specific message limit.

## 19. Outbound Message Formatting

WeChat should use plain text formatting.

In `src/services/remote/remote-message-format.ts`:
- treat WeChat like plain text, similar to Feishu
- optionally add a WeChat-specific plain formatter if stripping rules need to be stronger

Recommended additions:
- strip markdown tables
- strip fenced-code markers but keep code content
- flatten links to `text (url)` or plain text
- keep bullets readable

This is especially useful because `fastclaw-plugin-weixin` explicitly strips markdown before delivery.

## 20. Media Handling

## 20.1 Inbound Media

`wechat-media-service.ts` should:
- download encrypted media bytes
- decrypt with AES-128-ECB
- save to app-data attachments directory
- return attachment metadata for existing TalkCody media processing

Supported first-phase media types:
- image
- voice
- file

Optional later:
- video

## 20.2 AES-128-ECB

This is a concrete requirement from the fastclaw plugin flow.

Implementation notes:
- Browser Web Crypto support for ECB is weak/non-standard, so prefer a well-scoped JS crypto implementation if needed.
- Keep crypto isolated in `wechat-crypto.ts`.
- Add deterministic test vectors.
- Never mix provider encryption logic into shared remote service code.

## 20.3 Voice

Recommended flow:
- save decrypted voice bytes to a file
- if provider already supplies transcription text, prefer that immediately
- if not, attempt conversion/transcription using existing audio flow
- keep first release tolerant: voice can degrade to attachment + placeholder text if codec conversion is unfinished

## 20.4 Outbound Images

Use the four-step flow proven by `fastclaw-plugin-weixin`:
1. read local image bytes
2. compute raw size / md5 / padded encrypted size
3. request upload URL / CDN params from iLink
4. AES-128-ECB encrypt image
5. upload ciphertext to CDN
6. send image message referencing returned encrypted params

Keep this logic in `wechat-ilink-client.ts` plus `wechat-crypto.ts`.

## 21. Channel Adapter Design

## 21.1 `wechat-channel-adapter.ts`

Responsibilities:
- expose TalkCody `RemoteChannelAdapter`
- start/stop polling loop
- subscribe/unsubscribe inbound handler(s)
- map raw WeChat messages to `RemoteInboundMessage`
- send text/image replies via iLink client
- expose runtime status

Pseudo-shape:

```ts
export class WechatChannelAdapter implements RemoteChannelAdapter {
  readonly channelId = 'wechat' as const;
  readonly capabilities = { ... };

  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  onInbound(handler): () => void {}
  async sendMessage(request): Promise<RemoteSendMessageResponse> {}
  async editMessage(): Promise<void> {
    throw new Error('WeChat does not support message editing');
  }
  async getStatus(): Promise<RemoteChannelStatus> {}
}
```

## 21.2 Send Behavior

When sending:
- resolve context token for `chatId`
- choose text vs media path
- strip markdown / format plain text
- split long content conservatively
- if no valid context token exists, fail early with a user-facing message

## 22. Shared Remote Layer Changes

## 22.1 `remote-channel-manager.ts`

Add:
- `getAdapter(channelId)`
- `getCapabilities(channelId)`
- `getStatus(channelId)`

## 22.2 `remote-chat-service.ts`

Required refactors:
- replace hardcoded Feishu append branches with capability lookup
- replace hardcoded `/status` Rust invoke branches with adapter `getStatus()`
- treat WeChat like append-only streaming
- provide better provider-specific status text when session expired / no context token

## 22.3 `remote-text-utils.ts`

Add:
- `WECHAT_MESSAGE_LIMIT`
- `getRemoteMessageLimit('wechat')`
- preserve existing dedup logic

## 22.4 `remote-message-format.ts`

Add WeChat-specific plain formatter behavior if needed; at minimum:
- `wechat` uses plain parse mode
- strip markdown more aggressively than Telegram HTML mode

## 23. Settings UI Design

The settings UI should add a dedicated WeChat card under `src/components/settings/remote-control-settings.tsx`.

Required fields / actions:
- enable switch
- base URL input
- connect / reconnect button
- disconnect button
- QR code preview area during bind flow
- bind status text:
  - not connected
  - waiting for scan
  - scanned, waiting for confirm
  - connected
  - session expired
- allowed user IDs input
- poll timeout input
- last error / session warning display

Recommended UX:
- hide token field by default if QR bind can populate it automatically
- allow manual credential paste as advanced fallback
- explicitly show "No group chats" note

## 24. Scheduled Task Integration

Because scheduled task delivery already supports remote channels, WeChat should be considered explicitly.

Changes:
- in `src/types/scheduled-task.ts`, extend `channelId` to `'telegram' | 'feishu' | 'wechat'`
- in scheduled task UI, include WeChat only if:
  - WeChat is enabled
  - and the target user has a valid context token or is otherwise sendable

Important limitation:
- scheduled-task delivery to WeChat may fail without a valid reply context
- therefore the UI should warn that WeChat delivery is best-effort and tied to recent conversation activity

## 25. Reliability / Recovery

## 25.1 App Restart

On startup:
- load credentials
- load sync buffer
- load context tokens
- prune expired context tokens
- resume long-polling from last sync buffer

Expected outcome:
- no duplicate messages after restart
- no loss of reply threading when token still valid

## 25.2 Session Expiry

If iLink returns session-expired error:
- stop polling
- set adapter status to `sessionExpired = true`
- surface warning in settings and `/status`
- do not silently retry forever
- require user reconnect/rebind

## 25.3 Logging

Do log:
- poll start/stop
- retry/backoff
- message counts
- attachment download result
- bind state changes

Do not log:
- bot token
- full context token
- raw AES keys
- sensitive media URLs in full form

## 26. Security Notes

- redact tokens/keys in logs
- keep credentials only in local app data/settings
- never expose provider raw credentials to prompts
- keep media decrypt/upload logic outside shared message formatting and agent layers
- do not enable group message handling behind a hidden switch; omit it completely

## 27. Testing Plan

## 27.1 Unit Tests

Create tests for:
- `wechat-message-parser.test.ts`
- `wechat-context-token-store.test.ts`
- `wechat-sync-state.test.ts`
- `wechat-crypto.test.ts`
- `wechat-ilink-client.test.ts`
- `wechat-channel-adapter.test.ts`

Coverage targets:
- parse text / quote / voice-transcript / media-only messages
- prune expired context tokens
- persist and recover sync buffer
- classify session-expired vs transient errors
- markdown stripping for outbound messages
- conservative chunking rules

## 27.2 Integration Tests

Add or extend tests for:
- `remote-chat-service.test.ts`
  - WeChat append-mode streaming
  - `/status` through adapter status API
  - no edit attempt for WeChat
- `remote-text-utils.test.ts`
  - WeChat message limit
- `remote-message-format.test.ts`
  - WeChat plain formatting / markdown stripping
- `remote-control-lifecycle-service.test.ts`
  - WeChat enable/disable lifecycle
- settings tests
  - WeChat fields persist and reload correctly

## 27.3 Manual QA

Must verify:
1. connect account by QR or manual credentials
2. send direct-message text from WeChat -> TalkCody receives it
3. TalkCody replies successfully using stored context token
4. quoted/reply messages are parsed sensibly
5. image inbound is decrypted and attached properly
6. voice inbound becomes usable text or attachment fallback
7. restart app -> no duplicate messages
8. session expired -> UI reports reconnect required
9. group chat messages are ignored
10. non-allowlisted users are ignored

## 28. Implementation Phases

### Phase 1: Foundation
- extend remote adapter contract with capabilities/status
- add WeChat types + settings fields
- add WeChat adapter skeleton
- add basic iLink client + poll loop
- support inbound text only

### Phase 2: Stable Messaging
- context token persistence
- sync buffer persistence
- `/status` integration
- append-only streaming support through capabilities
- markdown stripping / plain text formatter

### Phase 3: Media
- inbound image decrypt/download
- inbound voice handling
- outbound image upload/send
- attachment persistence and cleanup policy

### Phase 4: UX and Hardening
- QR bind UI polish
- explicit session-expiry UX
- allowlist improvements
- scheduled task constraints/warnings
- reliability and logging cleanup

## 29. Implementation Checklist

### Shared Infrastructure
- [ ] extend `RemoteChannelAdapter` with capabilities/status
- [ ] add manager helpers for adapter lookup and status
- [ ] refactor `remote-chat-service.ts` to capability-based streaming
- [ ] refactor `/status` to use adapter status

### WeChat Core
- [ ] add WeChat provider types
- [ ] add iLink client
- [ ] add sync-state persistence
- [ ] add context-token persistence
- [ ] add bind service
- [ ] add message parser
- [ ] add crypto helper
- [ ] add media service
- [ ] add channel adapter

### App Integration
- [ ] register adapter in remote runner
- [ ] add settings-store fields and helpers
- [ ] add settings UI section
- [ ] add locale strings
- [ ] extend scheduled-task types/UI

### Validation
- [ ] unit tests
- [ ] integration tests
- [ ] manual QA against real WeChat account

## 30. Final Recommendation

The cleanest path is:
- keep WeChat fully in `src/services/remote/wechat/`
- upgrade TalkCody's remote adapter abstraction first
- implement WeChat as a TS-only append-mode channel
- rely on `sync_buf` + `context_token` as the core correctness mechanisms
- treat personal direct-message usage as the only supported product shape

In short:
- **reuse openilink-hub's state model**
- **reuse fastclaw-plugin-weixin's TS polling/upload ideas**
- **do not copy their product architecture**
- **adapt them into TalkCody's existing remote-channel architecture**
