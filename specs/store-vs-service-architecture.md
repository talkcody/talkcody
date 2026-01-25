# Store vs Service Architecture

This document defines the architectural boundaries between Zustand stores and services in the TalkCody codebase.

## Overview

```
┌─────────────────────────────────────────────┐
│              Component Layer                │
│  ┌─────────────────┐  ┌─────────────────┐   │
│  │   Read State    │  │  Write Actions  │   │
│  │  (Use Store)    │  │ (Check Complexity)│  │
│  └────────┬────────┘  └────────┬────────┘   │
└───────────┼─────────────────────┼───────────┘
            │                     │
            ▼                     ▼
     ┌──────────┐          ┌──────────────┐
     │  Store   │◄─────────│   Service    │
     │ (State)  │          │(Business Logic)│
     └──────────┘          └──────────────┘
                                 │
                                 ▼
                          ┌──────────────┐
                          │   Database   │
                          │   / API      │
                          └──────────────┘
```

## Store Responsibilities (State Container)

Stores are for **reactive state management**:

- Store UI-reactive state that components subscribe to
- Provide synchronous read/write APIs for immediate UI response
- Act as a cache layer for database/API data
- Keep logic minimal - no complex business rules

**Example:** `src/stores/agent-store.ts`, `src/stores/task-store.ts`

## Service Responsibilities (Business Logic Layer)

Services are for **orchestration and side effects**:

- Coordinate multiple stores in a single operation
- Coordinate store updates with external systems (database, API, filesystem)
- Contain complex business logic (validation, transformation, orchestration)
- Handle async operations with error handling and rollback

**Example:** `src/services/task-service.ts`, `src/services/execution-service.ts`

## Decision Rules

| Scenario | Direct Store | Via Service |
|----------|--------------|-------------|
| Simple UI state toggle (open/close panel) | ✅ | ❌ |
| Read data for rendering | ✅ | ❌ |
| Single store + no side effects | ✅ | ❌ |
| Needs database persistence | ❌ | ✅ |
| Coordinates multiple stores | ❌ | ✅ |
| Contains business validation | ❌ | ✅ |
| Calls external APIs | ❌ | ✅ |

## Code Examples

### Direct Store Access (Simple Operations)

```typescript
// Reading state - always direct
const agents = useAgentStore((state) => state.agents);

// Simple UI state - direct
useUIStateStore.getState().togglePanel();
```

### Via Service (Complex Operations)

```typescript
// TaskService: Store update + Database persistence
async createTask(userMessage: string) {
  // 1. Sync update store (immediate UI response)
  useTaskStore.getState().addTask(task);

  // 2. Async persist to database (may fail, needs rollback)
  await databaseService.createConversation(...);
}

// ExecutionService: Coordinates ExecutionStore + TaskStore + LLMService
async startExecution(config) {
  const { success } = useExecutionStore.getState().startExecution(taskId);
  await llmService.runAgentLoop(...);
}
```

## Core Principles

1. **Store does NOT call Service** - Prevents circular dependencies
2. **Service CAN call Store** - Services orchestrate state changes
3. **Components READ from Store directly** - Best performance
4. **Components WRITE based on complexity** - Simple = Store, Complex = Service
5. **Store provides `getState()` for non-React code** - Services use this pattern
