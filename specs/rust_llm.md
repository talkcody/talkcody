# Rust LLM Refactor Specification

## 1. Objective

Move provider and model management from the TypeScript frontend to the Rust backend, while adopting a layered architecture inspired by the Vercel AI SDK. The refactor aims to separate protocol responsibilities from provider-specific behavior, making the system easier to extend and maintain.

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Application Layer                        │
│                     (StreamHandler, Commands)                   │
└───────────────────────┬─────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Provider Layer                            │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐            │
│  │ OpenAiProvider│ │MoonshotProvider│ │GithubCopilot │            │
│  │  (OAuth)      │ │ (Coding Plan) │ │ (Headers)    │            │
│  └──────┬───────┘ └──────┬───────┘ └──────┬───────┘            │
│         │                │                │                     │
│  ┌──────┴───────┐ ┌──────┴───────┐ ┌──────┴───────┐            │
│  │ DefaultProvider│ │AnthropicProvider│ │ ...          │            │
│  └──────────────┘ └──────────────┘ └──────────────┘            │
│                                                                  │
│  Trait: Provider - provider-specific business logic              │
└───────────────────────┬─────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Protocol Layer                            │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  ProtocolRequestBuilder - build protocol-specific request  │ │
│  └────────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  ProtocolStreamParser   - parse SSE stream events          │ │
│  └────────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  ProtocolHeaderBuilder  - build protocol headers           │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  Implementations: OpenAIProtocol, ClaudeProtocol                 │
└─────────────────────────────────────────────────────────────────┘
```

## 3. Core Design Principles

- Single Responsibility: request building, stream parsing, and header building are separate protocol traits; provider logic is isolated in provider implementations.
- Open/Closed: new providers are added by implementing the Provider trait without modifying stream handling.
- Dependency Inversion: StreamHandler depends on Provider trait; Provider depends on Protocol traits.

## 4. Current Implementation Status

### 4.1 Protocol Traits (Completed)

- `ProtocolRequestBuilder` (`src/llm/protocols/request_builder.rs`)
- `ProtocolStreamParser` (`src/llm/protocols/stream_parser.rs`)
- `ProtocolHeaderBuilder` (`src/llm/protocols/header_builder.rs`)

### 4.2 Provider Trait and Implementations (Completed)

- `Provider` trait (`src/llm/providers/provider.rs`) with default methods
- `OpenAiProvider` (OAuth/Codex support, custom headers, endpoint path)
- `GithubCopilotProvider` (custom headers)
- `MoonshotProvider` (KimiCLI User-Agent for coding plan)
- `DefaultProvider` (generic providers)

### 4.3 Provider Registry (Completed)

- `ProviderRegistry` adds `create_provider()` and keeps legacy protocol adapter for backward compatibility.

### 4.4 Backward Compatibility (Completed)

- `LlmProtocol` trait remains with default methods delegating to the new protocol traits.
- `ProtocolStreamState` and `ToolCallAccum` retained.

## 5. File Structure (Rust)

```
src-tauri/src/llm/
├── protocols/
│   ├── mod.rs
│   ├── request_builder.rs
│   ├── stream_parser.rs
│   ├── header_builder.rs
│   ├── openai_protocol.rs
│   └── claude_protocol.rs
├── providers/
│   ├── mod.rs
│   ├── provider.rs
│   ├── provider_configs.rs
│   ├── provider_registry.rs
│   ├── default_provider.rs
│   ├── openai_provider.rs
│   ├── github_copilot_provider.rs
│   └── moonshot_provider.rs
├── streaming/
│   ├── mod.rs
│   └── stream_handler.rs
└── types.rs
```

## 6. Provider Extension Example

```rust
pub struct MyProvider {
    base: BaseProvider,
    protocol: OpenAiProtocol,
}

#[async_trait]
impl Provider for MyProvider {
    fn id(&self) -> &str { &self.base.config.id }
    fn name(&self) -> &str { &self.base.config.name }

    async fn add_provider_headers(
        &self,
        ctx: &ProviderContext<'_>,
        headers: &mut HashMap<String, String>,
    ) -> Result<(), String> {
        headers.insert("X-Custom-Header".to_string(), "value".to_string());
        Ok(())
    }
}
```

## 7. Migration Plan

### Phase 1: Architecture Foundation (Completed)
- New protocol traits
- Provider trait + implementations
- Provider registry + legacy adapter

### Phase 2: Provider Migration (In Progress)
- Completed: OpenAI, GitHub Copilot, Moonshot
- Pending: Anthropic Provider (can use DefaultProvider), other providers

### Phase 3: StreamHandler Simplification (Pending)
- Use Provider trait in `StreamHandler::stream_completion`
- Remove provider-specific branches
- Use `provider.build_complete_request()` for request creation

### Phase 4: Legacy Code Removal (Optional)
- Remove legacy adapter after all code uses the new architecture

## 8. Known Issues / Fixes Required

- Update `StreamEvent::ToolCall` pattern matching to include `provider_metadata`
- Fix `ClaudeProtocol` implementations for new traits
- Fix `DefaultProvider` trait method calls
- Remove unused imports

## 9. Testing Plan

- Unit tests per protocol (OpenAI, Claude)
- Unit tests per provider implementation
- Integration tests for streaming, tool calls, and OAuth
- Ensure existing tests still pass

## 10. Further Optimization and Improvement Opportunities

- Complete StreamHandler simplification and remove provider-specific branching in streaming logic.
- Add provider-level integration tests using lightweight mock servers for SSE streams.
- Harden OAuth error handling and token refresh behavior under concurrency.
- Add structured metrics for usage, latency, retries, and provider failure rates.
- Introduce configurable retry/backoff strategies per provider.
- Add robust validation for custom provider configs before registration.
- Improve error typing for protocol parsing vs. network vs. auth failures.
- Consider stream backpressure control and cancellation propagation end-to-end.
- Evaluate optional removal of legacy adapter once all consumers migrate.
- Extend protocol support (e.g., Google/Gemini) as a separate protocol implementation.
