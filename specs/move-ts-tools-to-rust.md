# Move TS Tool Execution to Rust - Design Spec

## 1. Overview

### 1.1 Background
TalkCody currently executes tools in the TypeScript (TS) layer. Built-in tools, tool concurrency, and custom tool loading/compilation/execution are implemented under `src/services/agents` and `src/services/tools`. The Rust backend already contains a tool registry, definitions, and dependency analyzer under `src-tauri/core`, but TS remains the source of truth for tool execution and custom tools.

The goal is to move tool implementation/execution and the custom tool lifecycle (definition, compile, execute) to the Rust side while preserving UI behavior and compatibility.

### 1.2 Goals
- Make Rust the source of truth for tool definitions and execution.
- Move custom tool discovery, compilation, and execution to Rust.
- Keep UI behavior stable (tool selector, tool result UI, approvals).
- Preserve cross-platform behavior (macOS, Windows, Linux).
- Provide a phased migration path and compatibility bridge.

### 1.3 Non-Goals
- Rewriting the React UI or tool result components.
- Changing LLM providers or agent loop logic beyond tool execution routing.
- Introducing new UI-only custom tool rendering in phase 1 (optional future).

### 1.4 Feasibility Summary
Yes, it is feasible. The Rust backend already has a tool registry, definitions, and a dependency analyzer. The main complexity is custom tool runtime: running user-defined TypeScript/JavaScript code safely and consistently across platforms. A two-tier runtime (compatibility mode using external JS runtime and sandboxed mode using an embedded runtime) is recommended to reduce risk while enabling a secure future path.

## 2. Current State Summary

### 2.1 Tool Execution (TS)
- `ToolExecutor` handles:
  - Tool call parsing and nested JSON string normalization.
  - Dependency planning and concurrency (read/write/other stages).
  - Tool execution with UI rendering hooks (`ToolWithUI`).
- `ToolRegistry` loads built-in tools, MCP tools, and custom tools, then adapts them for UI.

### 2.2 Custom Tools (TS)
- Loader scans `.talkcody/tools` in workspace and user home.
- Custom tools can be single-file or packaged:
  - Single-file: compiled via `@swc/wasm-web` and imported dynamically.
  - Packaged: validates `package.json`, ensures dependencies via bun/npm, and executes using a bun runner script.
- Permissions are stored in a TS store (`custom-tool-permission-store`).
- UI rendering for custom tools is optional; fallback UI is provided.

### 2.3 Tool Definitions (Rust)
- Rust has `ToolRegistry`, `ToolDispatcher`, `ToolDefinition`, and `ToolDependencyAnalyzer`.
- Built-in tools (read/write/edit/bash/etc.) already exist in Rust.
- There is duplication between `src-tauri/core/src/types/tools.rs` and `src-tauri/core/src/core/tools.rs`.

## 3. Target Architecture

### 3.1 High-Level Design
Rust becomes the single source of truth for tool definitions, execution, and custom tool lifecycle. TS becomes a thin UI layer that:
- Renders tool selection and tool result UI.
- Requests tool execution via Tauri commands.
- Displays approval prompts and tool output.

```
+-------------------+            +-----------------------------+
|  TS UI (React)    |  Tauri IPC |  Rust Core (Tool Runtime)   |
| - tool selector   |  <-------> | - Tool registry             |
| - tool result UI  |            | - Tool planner/executor     |
| - approvals UI    |            | - Custom tool lifecycle     |
+-------------------+            +-----------------------------+
```

### 3.2 Rust Components
- `core/tools`:
  - `ToolRegistry` (built-in and custom).
  - `ToolPlanner` (dependency analysis + concurrency plan).
  - `ToolExecutor` (execute planned groups).
- `core/custom_tools`:
  - `CustomToolScanner` (find tools, parse manifests).
  - `CustomToolCompiler` (TS/JS compile pipeline).
  - `CustomToolRuntime` (execute JS, enforce permissions).
  - `CustomToolStore` (cache compiled artifacts, metadata, permissions).
- `core/permissions`:
  - `ToolPermissionManager` (store and enforce grants).

## 4. Data Contracts (Rust <-> TS)

All contracts use camelCase via serde rename to stay compatible with TS.

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinitionDto {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
    #[serde(rename = "requiresApproval")]
    pub requires_approval: bool,
    #[serde(rename = "canConcurrent")]
    pub can_concurrent: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolRequestDto {
    #[serde(rename = "toolCallId")]
    pub tool_call_id: String,
    pub name: String,
    pub input: serde_json::Value,
    #[serde(rename = "providerMetadata")]
    pub provider_metadata: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolResultDto {
    #[serde(rename = "toolCallId")]
    pub tool_call_id: String,
    pub name: String,
    pub success: bool,
    pub output: serde_json::Value,
    pub error: Option<String>,
    pub attachments: Option<Vec<ToolAttachmentDto>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomToolManifestDto {
    pub name: String,
    pub description: String,
    #[serde(rename = "inputSchema")]
    pub input_schema: serde_json::Value,
    pub permissions: Vec<String>,
    pub runtime: String,
    pub entry: String,
    #[serde(rename = "uiBundle")]
    pub ui_bundle: Option<String>,
}
```

## 5. Tauri Command API

### 5.1 Tool Registry
- `tools_list() -> Vec<ToolDefinitionDto>`
- `tools_refresh()` (reload registry, including custom tools)

### 5.2 Tool Execution
- `tools_plan_execute(requests: Vec<ToolRequestDto>, ctx: ToolContextDto) -> Vec<ToolResultDto>`
- `tools_execute_single(request: ToolRequestDto, ctx: ToolContextDto) -> ToolResultDto`
- `tools_execute_approved(request: ToolRequestDto, ctx: ToolContextDto) -> ToolResultDto`

### 5.3 Custom Tools
- `custom_tools_scan(opts) -> CustomToolScanResultDto`
- `custom_tools_compile(id) -> CustomToolCompileResultDto`
- `custom_tools_execute(id, params, ctx) -> ToolResultDto`
- `custom_tools_permissions_get(name) -> PermissionGrantDto`
- `custom_tools_permissions_grant(name, permissions) -> PermissionGrantDto`
- `custom_tools_permissions_revoke(name)`

## 6. Custom Tool Runtime

### 6.1 Tool Sources
- Single-file tools in `.talkcody/tools`.
- Packaged tools with `package.json` and lockfile.

### 6.2 Manifest Requirement
To avoid complex TS AST parsing in Rust, introduce a `tool.json` manifest format:
- Name, description, permissions, inputSchema (JSON Schema).
- Entry path for runtime.
- Optional UI bundle pointer.

Legacy compatibility: attempt best-effort parsing of `inputSchema` from TS source only when manifest is absent. This should be best-effort and logged as deprecated.

### 6.3 Compilation
- Use Rust `swc` crates to transpile TS/TSX to JS.
- Cache compiled output keyed by file hash and tool version.
- Generate source maps for error reporting.

### 6.4 Execution Runtimes
Provide two runtimes, selectable per tool:

1) Compatibility Runtime (External JS)
- Execute with bun or node via Rust `Command`.
- Works with npm/bun dependencies.
- Limited sandboxing; permissions are enforced by policy checks, but JS has full OS access.

2) Sandboxed Runtime (Embedded JS)
- Use `deno_core` or similar embedded runtime.
- Expose a restricted host API (fs/net/command) with explicit permission checks.
- No direct access to Node globals, only provided APIs.

Recommended path: start with compatibility runtime for packaged tools, add sandboxed runtime for stricter tools, then migrate defaults over time.

### 6.5 Permission Model
Permissions map to: `fs`, `net`, `command`.
- Enforcement happens in Rust before executing a tool.
- For embedded runtime, permissions are enforced per host op call.
- For external runtime, enforcement is preflight plus warnings and restricted environment variables.

### 6.6 Path and Workspace Safety
- Normalize paths to prevent path traversal.
- Enforce workspace root boundaries.
- Use platform-specific path handling (Windows vs Unix separators).

## 7. TS UI Compatibility Strategy

### 7.1 Tool UI
- Built-in tool UI remains in TS.
- Custom tool UI becomes optional:
  - If a `uiBundle` is provided, TS can load a prebuilt static bundle (future).
  - Otherwise, fallback UI is used (current behavior).

### 7.2 Tool Execution Bridge
Replace `ToolExecutor` with a thin TS adapter:
- Build tool call requests.
- Invoke `tools_plan_execute`.
- Render results with existing components.

### 7.3 Tool Schema
Rust returns JSON Schema for each tool; TS uses it to render input UI and pass into LLM tool definitions. This removes the need for Zod in tool definitions on the frontend.

## 8. Migration Plan

### Phase 0 - Contracts and Stubs
- Define DTOs and Tauri commands in Rust.
- Implement TS adapter calling Rust commands (feature-flagged).

### Phase 1 - Built-in Tools in Rust
- Use Rust tool registry and executor for built-in tools only.
- Keep TS custom tools in place.

### Phase 2 - Rust Tool Planning
- Move dependency analysis and concurrency planning to Rust.
- Remove TS `ToolExecutor` logic in favor of Rust plan/execute.

### Phase 3 - Custom Tool Metadata in Rust
- Implement `custom_tools_scan` and manifest parsing.
- Store permissions in Rust and expose APIs for UI approval.

### Phase 4 - Custom Tool Compile/Execute in Rust
- Implement Rust compilation pipeline (swc).
- Add compatibility runtime (bun/node) and sandboxed runtime (deno_core).
- Keep fallback to TS execution for unknown tools behind a flag.

### Phase 5 - Deprecate TS Tool Execution
- Remove TS custom tool compiler/executor.
- Keep only TS UI bindings and adapter.

## 9. Risks and Mitigations

- Runtime security: external JS runtimes are not fully sandboxed.
  - Mitigation: sandboxed runtime option, permissions enforcement, user approvals.
- Dependency compatibility: some tools rely on Node or Bun features.
  - Mitigation: compatibility runtime, tool-specific runtime selection.
- UI regressions: custom tool UI may not be portable.
  - Mitigation: fallback UI, optional UI bundle format later.
- Duplicate tool definitions: Rust duplication can cause drift.
  - Mitigation: consolidate registry into a single Rust module.
- Performance: compile and execute latency.
  - Mitigation: compile cache, incremental updates, background warmup.

## 10. Testing and Validation

- Unit tests for:
  - Tool planner, permission checks, manifest parsing.
  - Custom tool compiler output consistency.
- Integration tests for:
  - Tauri tool execution, approval flow, result serialization.
  - Custom tool scan/compile/execute on all OS targets.
- Regression tests for:
  - Tool result UI rendering and attachment handling.
  - Tool concurrency correctness.

## 11. Open Questions

- Which embedded runtime is preferred: `deno_core`, `boa`, or other?
- Do we need to support custom tool UI bundles in v1?
- Should legacy TS custom tools without manifest remain supported, and for how long?

## 12. Feasibility Assessment

The refactor is feasible and aligns with the ongoing Rust-first architecture direction. The main decision is the custom tool runtime. A two-tier runtime strategy allows early delivery while protecting future security goals. With phased migration and compatibility flags, the change can be introduced without large UI disruptions.
