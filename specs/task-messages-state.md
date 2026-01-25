# Task and Message State (Current Code)

This document reflects how tasks and messages are stored, updated, and rendered today.

## Overview
TalkCody uses a service layer to update Zustand stores synchronously for UI responsiveness and persists to SQLite asynchronously. Tasks, messages, and streaming state are coordinated across `TaskService`, `MessageService`, and `ExecutionService`.

## Key Components
- `TaskService` (`src/services/task-service.ts`): creates, loads, updates, deletes tasks and coordinates worktree acquisition.
- `MessageService` (`src/services/message-service.ts`): writes UI messages to the store and persists to DB; handles streaming updates with a RAF buffer.
- `TaskStore` (`src/stores/task-store.ts`): stores tasks, messages, and merges streaming content into the current assistant message.
- `ExecutionService` (`src/services/execution-service.ts`): runs the agent loop and routes callbacks into `MessageService`.

## Write Flow
1. `TaskService.createTask()` creates a task, updates store, persists to DB, and optionally applies default task settings.
2. `MessageService.addUserMessage()` updates store immediately and persists to DB.
3. `ExecutionService.startExecution()` creates a task-scoped `LLMService` and streams assistant responses.
4. `MessageService.finalizeMessage()` writes the final assistant content and persists to DB.
5. Tool calls/results are serialized and stored as `StoredToolContent` in `StoredMessage.content`.

## Read Flow
1. `TaskService.selectTask()` sets current task and loads messages if not cached.
2. `TaskService.loadMessages()` fetches `StoredMessage[]` and converts to `UIMessage[]` via `mapStoredMessagesToUI`.
3. `TaskStore.getMessages()` merges streaming content for the active assistant message.

## Streaming Behavior
- `MessageService.updateStreamingContent()` buffers updates and flushes via `requestAnimationFrame` to avoid excessive renders.
- `TaskStore.getMessages()` merges the latest streaming content into the last assistant message when execution is running.

## Current Design Flaw
Nested tool messages (`parentToolCallId`) are stored only in memory (`TaskStore`) and are not persisted. Reloading a task loses sub-agent and nested tool history.

## Further Optimization
Persist nested tool messages with a parent reference in storage (or embed nested tool arrays in the serialized tool payload) and restore them in `mapStoredMessagesToUI` so sub-agent traces survive reloads.
