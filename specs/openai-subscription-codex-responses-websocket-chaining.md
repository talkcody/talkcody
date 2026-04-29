# OpenAI Subscription Codex Responses WebSocket Chaining Specification

## 1. Overview

This specification defines how TalkCody should add multi-turn `previous_response_id` chaining for the OpenAI subscription-backed Codex Responses path first, while guaranteeing that all non-OpenAI providers keep their current behavior unchanged.

Primary target:
- `https://chatgpt.com/backend-api/codex/responses`

Primary user flow:
- OpenAI OAuth / ChatGPT subscription login
- Agent loop with repeated tool calls
- Persistent WebSocket transport when the backend supports it
- Incremental follow-up turns using `previous_response_id`
- Safe fallback to the current stateless full-history mode when chaining is unavailable or unsafe

Secondary target, later:
- `https://api.openai.com/v1/responses`

This document is intentionally scoped to the main agent loop path driven by `src/services/agents/llm-service.ts`. It does not require changing other providers, other protocols, or non-agent LLM services in the first rollout.

## 2. Clarification: What `chatgpt.com/backend-api/codex/responses` Means

In this repository, `chatgpt.com/backend-api/codex/responses` is the OpenAI subscription-backed path, not the standard API-key path.

Evidence in the current codebase:
- OAuth starts at `https://auth.openai.com/oauth/authorize`
- The flow uses `codex_cli_simplified_flow=true` and `originator=codex_cli_rs`
- OAuth tokens are stored as `openai_oauth_access_token` and `openai_oauth_refresh_token`
- `src-tauri/core/src/llm/providers/openai_provider.rs` routes OAuth mode to `https://chatgpt.com/backend-api/codex/responses`

Operationally, this is the current "OpenAI subscription" mode used by TalkCody for ChatGPT-authenticated Codex access.

## 3. Goals

### 3.1 Primary Goals
- Support the OpenAI subscription-backed Codex Responses path first.
- Add multi-turn continuation with `previous_response_id`.
- Make the upper agent loop send only incremental inputs after the first turn.
- Use WebSocket mode when the subscription backend supports it.
- Preserve the current full-history stateless path as a safe fallback.
- Keep all non-OpenAI providers completely unaffected.
- Refactor `llm-service.ts` so transport and continuation logic are isolated instead of spread through the main loop.

### 3.2 Non-Goals
- Changing behavior for Anthropic, OpenRouter, Moonshot, Gemini, DeepSeek, or custom providers.
- Changing the standard `chat/completions` path.
- Refactoring the Rust `CoreRuntime` task loop in this milestone.
- Requiring all Rust AI service helpers to adopt WebSocket mode immediately.
- Enabling subscription WebSocket mode without runtime capability validation.

## 4. Hard Compatibility Requirements

The implementation must satisfy all of the following:

- Only the OpenAI provider can enter chained Responses mode.
- Chained mode is enabled only when OpenAI OAuth subscription mode is active.
- Other providers must continue using their current request building, transport, and retry behavior.
- Canonical full message history must still be preserved in TypeScript for compaction, UI persistence, retries, and fallback.
- If chaining fails at any point, the system must be able to fall back to the current full-history request mode without corrupting loop state.
- No new request fields may be required for other providers.
- New stream events must be additive and ignorable by existing consumers.

## 5. Current State

### 5.1 TypeScript agent loop

The real multi-turn tool-call loop is in `src/services/agents/llm-service.ts`.

Current behavior:
- `loopState.messages` stores the entire conversation for the active loop.
- Every iteration rebuilds a new `StreamTextRequest` with the full message history.
- After tool execution, the loop appends:
  - one assistant message containing text, reasoning, and tool-call parts
  - one tool message containing tool-result parts
- The next iteration resends the entire conversation again.

### 5.2 Rust transport

Current Rust streaming is stateless per request:
- `src-tauri/core/src/llm/streaming/stream_handler.rs`
- HTTP POST request
- SSE response parsing
- no session reuse
- no WebSocket transport
- no captured `response_id`
- no `previous_response_id`

### 5.3 OpenAI provider routing

`src-tauri/core/src/llm/providers/openai_provider.rs` currently selects:
- OAuth mode -> `https://chatgpt.com/backend-api/codex/responses`
- standard OpenAI Responses models -> `https://api.openai.com/v1/responses`
- standard OpenAI chat models -> `https://api.openai.com/v1/chat/completions`

## 6. Core Design Principle

The optimization changes what gets sent over the wire, not what gets stored as the loop's canonical history.

That means:
- `loopState.messages` remains the full, provider-agnostic, canonical history.
- A new continuation planner computes the outbound slice for the next turn.
- If chained mode is active and healthy, the planner sends only incremental messages plus `previous_response_id`.
- If chained mode is invalidated, the planner reverts to sending the full canonical history.

This design is the main safeguard that keeps other providers and fallback behavior intact.

## 7. Proposed Architecture

### 7.1 New conversation strategy layer in TypeScript

Refactor `llm-service.ts` so it no longer mixes:
- provider-specific continuation logic
- transport mode selection
- request-shape decisions
- fallback state management

Instead, introduce a conversation strategy abstraction.

Recommended shape:
- `StatelessConversationStrategy`
- `OpenAiSubscriptionResponsesStrategy`

Suggested new file:
- `src/services/agents/llm-response-chaining.ts`

Responsibilities of the strategy:
- decide whether chaining is enabled for this loop
- track chain state for the active loop
- compute full-history vs incremental request payload
- accept response metadata from Rust
- invalidate chain state on unsafe mutations
- generate fallback decisions

### 7.2 New transport/session layer in Rust

Add a dedicated OpenAI Responses transport layer, isolated from other transports.

Suggested new file:
- `src-tauri/core/src/llm/streaming/openai_responses_ws.rs`

Responsibilities:
- build a WebSocket request for the active OpenAI subscription session
- manage WebSocket session reuse keyed by a loop-scoped session id
- send `response.create` frames
- read JSON event frames
- feed events into the existing OpenAI Responses parser
- downgrade to current HTTP/SSE when WebSocket is unsupported or unsafe

### 7.3 Capability gating

The system must not assume the subscription backend always supports WebSocket mode.

Instead, WebSocket must be gated by runtime capability checks:
- provider is `openai`
- OAuth mode is active
- request targets Codex Responses path
- chained mode is enabled for this loop
- backend WebSocket handshake succeeds

If any of these checks fail, the request must fall back to the existing stateless path.

## 8. Provider Isolation Guarantees

To ensure other providers are unaffected, the implementation must follow these rules:

### 8.1 TypeScript isolation
- The default strategy for all providers remains `StatelessConversationStrategy`.
- Only OpenAI OAuth subscription mode may instantiate `OpenAiSubscriptionResponsesStrategy`.
- Existing message conversion logic remains untouched for non-OpenAI providers.

### 8.2 Rust isolation
- Transport selection must remain provider-scoped, not global.
- Only `OpenAiProvider` may request the new chained Responses transport.
- Existing HTTP/SSE code path remains the default for all providers.
- No Claude/OpenAI-compatible generic provider may reuse the subscription transport logic.

### 8.3 Schema isolation
- All new request fields must be optional.
- Non-OpenAI providers must ignore them completely.
- New response metadata events must not be required by any existing UI code.

## 9. Detailed Design

### 9.1 New TypeScript loop state

Extend `AgentLoopState` in `src/types/agent.ts`.

Recommended addition:

```ts
export interface ResponsesChainState {
  enabled: boolean;
  provider: 'openai-subscription';
  transportPreference: 'auto' | 'websocket' | 'http';
  transportSessionId?: string;
  lastResponseId?: string;
  baselineMessageCount: number;
  fallbackCount: number;
  broken: boolean;
  brokenReason?: string;
  lastTransport?: 'http-sse' | 'websocket';
  lastContinuationAccepted?: boolean;
}
```

Then add:

```ts
responsesChain?: ResponsesChainState;
```

Behavior:
- `baselineMessageCount` marks the point in canonical history already acknowledged by the previous chained turn.
- `lastResponseId` is the last valid OpenAI response id returned by the backend.
- `transportSessionId` binds a loop to one Rust WebSocket session.
- `broken` prevents unsafe reuse after compaction, reconnect failure, or history rewrite.

### 9.2 New request fields

Extend `StreamTextRequest` in both:
- `src/services/llm/types.ts`
- `src-tauri/core/src/llm/types.rs`

Recommended new fields:

```ts
conversationMode?: 'stateless' | 'responses-chained';
inputMode?: 'full-history' | 'incremental';
previousResponseId?: string | null;
transportSessionId?: string | null;
allowTransportFallback?: boolean | null;
continuationContext?: {
  iteration: number;
  baselineMessageCount: number;
  deltaMessageCount: number;
  fallbackCount: number;
} | null;
```

Semantics:
- `conversationMode='stateless'` means current behavior.
- `conversationMode='responses-chained'` is allowed only for OpenAI subscription mode.
- `inputMode='incremental'` means `messages` contains only new items since the last committed baseline.
- `previousResponseId` is passed only when the loop has a known prior response id.
- `transportSessionId` allows Rust to reuse a loop-local WebSocket connection.

### 9.3 New stream events

Extend `StreamEvent` in TS and Rust with additive metadata events.

Recommended additions:

```ts
| {
    type: 'response-metadata';
    responseId: string;
    transport: 'http-sse' | 'websocket';
    provider: 'openai-subscription' | 'openai-api';
    continuationAccepted?: boolean;
    transportSessionId?: string;
  }
| {
    type: 'transport-fallback';
    reason: string;
    from: 'websocket' | 'responses-chained';
    to: 'http-sse' | 'stateless';
  }
```

These events are internal control-plane signals for `llm-service.ts` and can be ignored by the UI.

### 9.4 Request planning in `llm-service.ts`

Replace the current inline request construction with a planner function.

Suggested extracted methods:
- `buildTurnRequest(...)`
- `computeOutboundMessages(...)`
- `applyResponseMetadata(...)`
- `invalidateResponsesChain(...)`
- `shouldRetryStateless(...)`
- `commitTurnToChainBaseline(...)`

#### Full-history turn
Used when:
- iteration 1
- no valid `lastResponseId`
- chain is broken
- compaction rewrote history
- fallback was requested
- provider is not OpenAI subscription mode

Behavior:
- send full `loopState.messages`
- omit `previousResponseId`
- set `inputMode='full-history'`

#### Incremental turn
Used when:
- OpenAI subscription chained mode is enabled
- `lastResponseId` exists
- chain is healthy
- no history rewrite occurred

Behavior:
- send only `loopState.messages.slice(baselineMessageCount)`
- pass `previousResponseId`
- pass `transportSessionId`
- set `inputMode='incremental'`

### 9.5 When the baseline advances

The baseline must advance only after the turn is safely committed to canonical history.

That means:
- assistant output is fully processed
- tool calls, if any, are appended
- tool results, if any, are appended
- no unsafe error occurred before the iteration was committed

Then:
- `baselineMessageCount = loopState.messages.length`

This avoids losing messages when partial failures occur.

### 9.6 Interaction with tool calls

This is the critical path.

#### Iteration 1
Send full history.
Model returns:
- text / reasoning
- tool calls

TS appends to canonical history:
- assistant message with text, reasoning, tool-call parts

Tools run.
TS appends:
- tool message with tool-result parts

Rust emits `response-metadata` with `responseId=resp_1`.
TS stores:
- `lastResponseId=resp_1`
- `baselineMessageCount = loopState.messages.length`

#### Iteration 2
Send only the new tool result message added after the baseline established by iteration 1.
Request includes:
- `previousResponseId=resp_1`
- only the incremental tool result content

Model returns either:
- more tool calls, or
- final answer

Repeat until done.

### 9.7 Interaction with error guidance

`src/services/agents/error-handler.ts` currently appends synthetic user messages into `loopState.messages`.

In chained mode, these synthetic user messages must be treated exactly like real incremental follow-up input.

That means:
- do not force a full resend just because an error-guidance message was appended
- instead, send that new user message as the next incremental input when the chain is still healthy

This is why canonical history and outbound delta must be separated.

### 9.8 Interaction with compaction

Compaction rewrites history, so it invalidates the chain.

If `loopState.messages` is compacted or replaced:
- clear `lastResponseId`
- clear `transportSessionId`
- set `broken=true`
- set `brokenReason='history_rewritten'`
- next request must use full-history stateless mode

This rule is mandatory. Chained continuation must never continue from a stale baseline after history rewrite.

### 9.9 Interaction with task restore / cached compacted messages

At loop startup, if cached compacted messages are loaded:
- treat that restored state as canonical input only
- do not assume it is already part of a valid response chain
- first network request after restore must be full-history
- chain state starts fresh from that baseline

## 10. Rust Transport Design

### 10.1 New transport enum

Add transport metadata to the built request pipeline.

Recommended enum:

```rust
pub enum StreamTransport {
    HttpSse,
    OpenAiResponsesWebSocket,
}
```

Only OpenAI subscription mode may request `OpenAiResponsesWebSocket`.

### 10.2 `OpenAiProvider` routing

Update `src-tauri/core/src/llm/providers/openai_provider.rs` so it can distinguish:
- OpenAI OAuth subscription Codex Responses path
- OpenAI API-key Responses path
- standard chat path

For the first milestone:
- prioritize OAuth subscription path for chained mode
- keep API-key Responses path unchanged unless explicitly enabled later
- keep standard chat untouched

Recommended new helper methods:
- `is_subscription_codex_mode(...)`
- `supports_responses_chaining(...)`
- `supports_responses_websocket(...)`

### 10.3 WebSocket endpoint resolution

The public docs describe WebSocket mode for `wss://api.openai.com/v1/responses`.
The subscription backend path is currently `https://chatgpt.com/backend-api/codex/responses`.

Because the subscription WebSocket endpoint is not yet treated as a guaranteed public contract in this repository, the implementation must not hardcode unsupported assumptions without validation.

Required design:
- provider resolves a transport endpoint for subscription mode
- transport attempts WebSocket upgrade only when enabled for this loop
- if handshake fails cleanly before output, Rust emits `transport-fallback` and reverts to HTTP/SSE

This allows the implementation to support the subscription path first without risking other providers.

### 10.4 WebSocket session manager

Add a loop-local session manager in Rust.

Suggested responsibility:
- key sessions by `transportSessionId`
- verify provider mode, auth mode, and model compatibility before reuse
- reuse only inside one active loop
- close sessions on loop completion, fatal error, idle timeout, or mismatch

Suggested runtime data:
- `transport_session_id`
- provider id
- model
- auth mode
- created_at
- last_used_at
- websocket sender/receiver handles

### 10.5 Parser changes

Update `src-tauri/core/src/llm/protocols/openai_responses_protocol.rs` to:
- accept optional `previous_response_id` during request build
- capture `response.id` from `response.created`, `response.in_progress`, or `response.completed`
- emit `StreamEvent::ResponseMetadata` once per turn when the id is first known
- surface top-level continuation errors clearly

Parser behavior for text, tool calls, reasoning, usage, and done must remain unchanged.

### 10.6 HTTP fallback behavior

Fallback must preserve current behavior.

If WebSocket cannot be used safely before any visible output:
- Rust emits `transport-fallback`
- Rust retries the same request using current HTTP/SSE behavior if allowed
- TS chain state is either preserved or cleared depending on the fallback reason

If failure occurs after visible output:
- do not silently replay incremental tool-result input
- surface the error to TS
- let TS decide whether to fail or force a stateless retry of the next iteration

This rule prevents duplicate tool execution.

## 11. `llm-service.ts` Refactor Plan

To keep the file maintainable, split it into clear stages.

### 11.1 New internal structure

Recommended extraction:
- request planning
- stream event handling
- chain state transitions
- fallback handling
- loop commit logic

Suggested new helper file:
- `src/services/agents/llm-response-chaining.ts`

Suggested responsibilities:
- `createInitialResponsesChainState(...)`
- `buildResponsesChainedRequest(...)`
- `applyResponsesMetadataEvent(...)`
- `markResponsesChainBroken(...)`
- `commitResponsesBaseline(...)`
- `shouldUseIncrementalMode(...)`

### 11.2 Event handling changes

When `llmClient.streamText(...)` yields events, `llm-service.ts` must additionally handle:
- `response-metadata`
- `transport-fallback`

Behavior:
- `response-metadata` updates chain state in memory
- `transport-fallback` decides whether the current iteration can safely retry statelessly

### 11.3 Retry behavior

Add continuation-aware retry rules.

Timeout/lifetime semantics must stay distinct:
- the provider may allow websocket sessions to live for up to roughly 60 minutes,
- local read-idle watchdogs must not silently force a much shorter budget for subscription websocket turns,
- reused websocket sessions should be proactively rotated before the provider-side max-age window is exceeded.

Safe retry cases:
- WebSocket handshake failure before first visible stream output
- websocket send/read disconnect before first visible stream output
- `previous_response_not_found` before first visible stream output
- explicit backend rejection of continuation before first visible stream output

Preferred retry order for subscription websocket turns:
- full-history turn: retry websocket first, then fall back to HTTP SSE only after the pre-output websocket retry budget is exhausted
- incremental chained turn: retry websocket first, then retry the same iteration as a fresh full-history websocket baseline before falling back to stateless mode

Unsafe retry cases:
- failure after partial text output
- failure after streamed tool calls were already received
- ambiguous disconnect after the model may have acted

Unsafe cases must not auto-replay the same incremental input.

## 12. File-by-File Change Plan

### TypeScript
- `src/types/agent.ts`
  - add `ResponsesChainState`
  - add optional `responsesChain` to `AgentLoopState`

- `src/services/llm/types.ts`
  - add request chaining fields
  - add `response-metadata` and `transport-fallback` events

- `src/services/llm/llm-client.ts`
  - pass new request fields through unchanged
  - normalize new stream events

- `src/services/agents/llm-service.ts`
  - replace inline turn request construction with strategy/planner
  - track chain state from metadata events
  - update baseline after turn commit
  - invalidate chain on compaction or unsafe mutation

- `src/services/agents/error-handler.ts`
  - keep appending synthetic guidance into canonical history
  - do not special-case away incremental mode
  - optionally add helper to tag continuation-retry-safe errors

- `src/services/agents/llm-response-chaining.ts`
  - new helper module for chain state and request planning

### Rust
- `src-tauri/core/src/llm/types.rs`
  - mirror new request fields and event variants

- `src-tauri/core/src/llm/providers/provider.rs`
  - extend provider context with continuation metadata
  - add transport selection metadata

- `src-tauri/core/src/llm/providers/openai_provider.rs`
  - add subscription-specific chained transport support
  - keep other OpenAI modes unchanged by default

- `src-tauri/core/src/llm/protocols/stream_parser.rs`
  - add fields for captured response id and metadata emission state

- `src-tauri/core/src/llm/protocols/mod.rs`
  - mirror state fields for compatibility

- `src-tauri/core/src/llm/protocols/openai_responses_protocol.rs`
  - support optional `previous_response_id`
  - emit response metadata
  - parse continuation-specific errors

- `src-tauri/core/src/llm/streaming/stream_handler.rs`
  - add transport selection for OpenAI subscription mode only
  - route WebSocket frames into the existing parser
  - preserve current HTTP/SSE path for all others

- `src-tauri/core/src/llm/streaming/openai_responses_ws.rs`
  - new WebSocket session manager and frame loop

## 13. Rollout Sequence

### Phase 1: Schema and planner groundwork
- add optional request fields
- add new metadata events
- refactor `llm-service.ts` around a strategy/planner
- keep all requests on current HTTP/SSE path

### Phase 2: Response id capture on subscription path
- parse and emit `response.id`
- store `lastResponseId` in TS loop state
- keep sending full history for safety

### Phase 3: Incremental input mode on subscription path
- switch follow-up turns to incremental messages plus `previous_response_id`
- still allow forced stateless fallback
- verify tool-call loops behave correctly

### Phase 4: Subscription WebSocket mode
- enable WebSocket transport only for OpenAI OAuth subscription mode
- reuse per-loop `transportSessionId`
- fall back to HTTP/SSE when handshake or continuation fails

### Phase 5: Optional API-key Responses adoption
- after subscription path is stable, consider extending the same architecture to `api.openai.com/v1/responses`

## 14. Testing Strategy

### 14.1 TypeScript tests
Add tests for:
- iteration 1 uses full history
- iteration 2 sends only incremental tool-result message
- synthetic error-guidance user message is sent incrementally
- compaction invalidates the chain
- fallback clears chain state when required
- non-OpenAI providers continue using stateless mode

### 14.2 Rust tests
Add tests for:
- request serialization with `previous_response_id`
- response id extraction from Responses events
- metadata event emission exactly once per turn
- fallback event emission on WebSocket handshake failure
- provider gating so non-OpenAI providers never enter the new path

### 14.3 Manual acceptance tests
Verify:
- ChatGPT subscription OAuth login still works
- `chatgpt.com/backend-api/codex/responses` remains the primary path
- multi-tool coding loop sends smaller follow-up payloads after first turn
- fallback to current behavior works when chaining fails
- Anthropic and other providers behave exactly as before

## 15. Main Risks

### 15.1 Undocumented subscription WebSocket behavior
The biggest risk is that the subscription backend's WebSocket contract may differ from the public API-key documentation.

Mitigation:
- capability gate it behind runtime validation
- keep HTTP/SSE fallback
- build the planner first so the transport can change independently

### 15.2 Duplicate tool execution
If incremental follow-up input is replayed after partial output, the model may repeat tool calls.

Mitigation:
- no silent replay after visible output
- baseline advances only after safe turn commit

### 15.3 History rewrite invalidation
Compaction or history replacement can make `previous_response_id` invalid.

Mitigation:
- explicitly break the chain whenever history is rewritten

## 16. Final Recommendation

Implement this feature with a provider-scoped strategy architecture, not scattered conditionals.

Recommended order:
1. refactor `llm-service.ts` into a request-planning strategy model
2. add response-id capture and chain state for OpenAI subscription mode only
3. enable incremental `previous_response_id` turns on the subscription path
4. add subscription WebSocket transport with strict fallback rules

This order gives TalkCody the subscription-first optimization you need while keeping every other provider on its current stable path.
