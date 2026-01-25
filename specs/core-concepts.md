# Core Concepts (Current Code)

This document summarizes the main domain concepts and runtime types used by TalkCody today.

## Overview
TalkCody is built around Projects, Repositories, Tasks, Messages, Agents, Tools, and Models. Tasks represent chat-based workflows. Messages are persisted in SQLite and mirrored in Zustand stores for immediate UI response. Agents run via the LLM execution loop and can call tools, including MCP tools resolved at runtime.

## Domain Entities

### Project
- `Project` (`src/types/task.ts`) stores the repository root path, context, and rules.
- A project is the top-level container for tasks and file operations.

### Repository and File Tree
- `FileNode`, `OpenFile`, and `RepositoryState` (`src/types/file-system.ts`) represent the file tree, editor tabs, and indexing progress.

### Task
- `Task` (`src/types/task.ts`) is a conversation container with usage metrics (cost/tokens) and optional `settings` JSON.
- `TaskSettings` includes `autoApproveEdits`, `autoApprovePlan`, and `autoCodeReview`.

### Message
- `UIMessage` (`src/types/agent.ts`) is used by the UI and includes tool messages, attachments, and streaming state.
- `StoredMessage` (`src/types/message.ts`) is persisted in the database; tool messages are serialized JSON in `content`.

### Agent
- `AgentDefinition` (`src/types/agent.ts`) defines model type, system prompt, tools, and optional skills.
- System agents are loaded in memory; user agents are loaded from the database or local files.

### Tool
- `ToolWithUI` (`src/types/tool.ts`) defines executable tools with UI renderers.
- MCP tools are stored as placeholders and resolved at runtime.

### MCP
- `MCPServer` and `MCPToolInfo` (`src/types/mcp.ts`) represent external tool providers.

### Models and Providers
- `ModelType`, `ModelConfig`, and provider definitions (`src/types/model-types.ts`, `src/types/models.ts`, `src/types/provider.ts`) describe model categories and provider capabilities.

## Service Layer Responsibilities
- `TaskService` creates, loads, deletes, and updates tasks and coordinates worktree acquisition.
- `MessageService` updates the UI store synchronously and persists messages asynchronously.
- `ExecutionService` runs the agent loop per task via `LLMService` and routes callbacks into `MessageService`.

## Data Flow (High Level)
1. User starts a task -> `TaskService.createTask()` updates store and DB.
2. User message -> `MessageService.addUserMessage()` updates store and DB.
3. Execution -> `ExecutionService.startExecution()` creates `LLMService` and runs the agent loop.
4. Tool calls -> `MessageService.addToolMessage()` stores tool call/result as JSON.
5. Finalize -> `MessageService.finalizeMessage()` persists assistant output.

## Current Design Flaw
Task settings are stored as a raw JSON string (`Task.settings`) and parsed without schema validation. A malformed value can throw or silently drop fields when merged, and there is no versioning.

## Further Optimization
Introduce a validated `TaskSettings` schema (for example via Zod) and store a versioned structure (or normalized columns) to avoid parse failures and enable safe evolution.
