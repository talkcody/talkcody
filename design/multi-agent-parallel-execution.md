# Multi-Agent Parallel Execution Design Document

## 1. Architecture Overview

The multi-agent parallel execution feature consists of the following core components:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Code Planner v2                              │
│                    (uses callAgentV2 tool)                          │
└─────────────────────────────┬───────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     DependencyAnalyzer                              │
│            (unified entry point, auto-selects analyzer)             │
├─────────────────────────────┬───────────────────────────────────────┤
│   AgentDependencyAnalyzer   │      ToolDependencyAnalyzer           │
│   (pure agent calls)        │      (regular tool calls)             │
└─────────────────────────────┴───────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       ToolExecutor                                  │
│    (executes plan, supports parallel/sequential, configurable       │
│     max concurrency via AgentExecutionConfig)                       │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       LLMService                                    │
│       (each nested agent creates independent StreamProcessor)       │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Core Components

### 2.1 callAgentV2 Tool (`src/lib/tools/call-agent-v2-tool.tsx`)

**Key Features:**
- `canConcurrent: true` - declares support for concurrent execution
- `isBeta: true` - marked as beta feature
- Supports `targets` parameter to declare operated files/modules
- Configurable timeout protection (default 5 minutes) to prevent infinite loops
- Dynamic description loading with available subagents list

**Differences from callAgent:**
- Top-level tasks use task-specific LLMService instances via `createLLMService(taskId)` for isolation
- callAgentV2 uses singleton `llmService` for nested agent calls with `taskId='nested'` behavior
- This is safe because loop state (`loopState`, `StreamProcessor`) is created locally per execution, and all instance properties are `readonly`
- callAgentV2 supports `targets` parameter for conflict detection
- callAgentV2 is restricted to planner-v2 agent only (via agent-tool-access.ts)

**Input Schema:**
```typescript
{
  agentId: string,     // The id of the registered agent to call
  task: string,        // The instruction or task to be executed
  context: string,     // Relevant context for solving the task
  targets?: string[]   // Optional resource targets for conflict detection
}
```

### 2.2 AgentDependencyAnalyzer (`src/services/agents/agent-dependency-analyzer.ts`)

**Core Responsibilities:**
Analyzes agent call dependencies and generates optimized execution plans.

**Execution Strategy:**
1. Analyze each agent's role classification (`AgentRole`):
   - `information-gathering`: read-only operations (e.g., context-gatherer)
   - `content-modification`: creates, edits, or deletes content

2. Two-phase execution model:
   - **Discovery Phase (read-stage)**: Information-gathering agents run in parallel, ignoring targets
   - **Implementation Phase (write-edit-stage)**: Content-modification agents grouped by target conflicts

**Conflict Detection Logic:**
```typescript
// callAgentV2 without targets → sequential execution (safety policy)
// Has targets but no conflicts → parallel execution
// Has targets with conflicts → new group, sequential execution
```

**Path Conflict Detection:**
- Exact path matches (`src/a.ts` vs `src/a.ts`)
- Directory containment (`src/` vs `src/utils/file.ts`)
- Parent-child relationships (`src/utils/` vs `src/utils/helper.ts`)

### 2.3 DependencyAnalyzer (`src/services/agents/dependency-analyzer.ts`)

**Unified Entry Point, Routing Rules:**
- Pure agent calls → `AgentDependencyAnalyzer`
- Pure tool calls → `ToolDependencyAnalyzer`
- Mixed calls → **throws error** (Context Isolation principle)

### 2.4 ToolExecutor (`src/services/agents/tool-executor.ts`)

**Execution Plan Executor:**
- Supports both `ExecutionPlan` and `AgentExecutionPlan` types
- Configurable max concurrency via `getMaxParallelSubagents()`
- Batch execution: processes in batches when exceeding concurrency limit
- Handles both regular tool groups and agent execution groups

### 2.5 Agent Tool Access Control (`src/services/agents/agent-tool-access.ts`)

```typescript
export const TOOL_ACCESS_RULES: Record<string, ToolAccessRule> = {
  callAgentV2: { allowAgents: ['planner-v2'] },
  callAgent: { allowAgents: ['planner'] },
};
```

### 2.6 Agent Execution Config (`src/services/agents/agent-execution-config.ts`)

**Configurable Execution Parameters:**
```typescript
interface AgentExecutionConfig {
  maxParallelSubagents: number;      // Default: 5
  nestedAgentTimeoutMs: number;      // Default: 300000 (5 minutes)
  enableParallelExecution: boolean;  // Default: true
}

// Usage
import { getMaxParallelSubagents, updateAgentExecutionConfig } from './agent-execution-config';
updateAgentExecutionConfig({ maxParallelSubagents: 10 });
```

### 2.7 AgentRole Type Definition (`src/types/agent.ts`)

```typescript
export type AgentRole =
  | 'information-gathering'  // Primarily reads and analyzes
  | 'content-modification';  // Creates, edits, or deletes (includes mixed operations)

export type ExecutionPhase =
  | 'read-stage'       // Information gathering phase
  | 'write-edit-stage'; // Content modification phase
```

---

## 3. Execution Flow

```
1. Planner-v2 calls multiple callAgentV2 tools
   ↓
2. ToolExecutor.executeWithSmartConcurrency()
   ↓
3. DependencyAnalyzer.analyzeDependencies()
   - Detects if pure agent calls
   - Routes to AgentDependencyAnalyzer
   ↓
4. AgentDependencyAnalyzer.analyzeDependencies()
   - Gets each agent definition from agentRegistry
   - Analyzes role property or infers role
   - Detects conflicts based on targets
   - Generates AgentExecutionPlan
   ↓
5. ToolExecutor.executeStage() executes by stage
   - read-stage: parallel execution of all information-gathering agents
   - write-edit-stage: grouped execution of content-modification agents
   ↓
6. Each callAgentV2.execute() calls llmService.runAgentLoop()
   - Creates independent StreamProcessor instance
   - Nested agent tool messages linked via parentToolCallId
```

---

## 4. Design Analysis

### 4.1 Critical Issues

#### 4.1.1 Strict Context Isolation
**Issue:** Mixed agent + tool calls throw error
```typescript
// dependency-analyzer.ts:113-131
private validateNoMixedAgentCalls() {
  throw new Error(`Context isolation violation...`);
}
```
**Impact:** Limits planner flexibility; cannot read files then delegate to agents in the same turn

#### 4.1.2 Simple Target Conflict Detection
**Issue:** Only handles path-based conflicts, not:
- Wildcard patterns
- Implicit dependencies (import relationships)
- Semantic-level conflicts

#### 4.1.3 Role Inference Limitations
```typescript
// agent-dependency-analyzer.ts:252-260
if (hasWriteTools) {
  return 'content-modification';
} else if (hasReadTools) {
  return 'information-gathering';
} else {
  return 'content-modification'; // Default to most restrictive
}
```
**Issue:** Doesn't consider agents that have write tools but primarily perform read operations

### 4.2 Potential Risks

#### 4.2.1 Single Timeout Strategy
```typescript
const timeoutMs = getNestedAgentTimeoutMs(); // Configurable, default 5 minutes
```
- Complex tasks may need longer time
- Simple tasks might benefit from shorter timeouts

#### 4.2.2 Error Handling Granularity
- One agent failure doesn't affect other parallel agents (good)
- No retry mechanism
- No partial success result aggregation

### 4.3 Architecture Considerations

#### 4.3.1 Dynamic Agent Description Loading
```typescript
// call-agent-v2-tool.tsx:81-86
let currentDescription = getToolDescription('- (Loading subagents...)');
getSubAgents().then((agentsList) => {
  currentDescription = getToolDescription(agentsList);
});
```
- Relies on async initialization
- Tool may be called before description updates

## 5. Optimization Suggestions

### 5.2 Medium-term Optimizations

1. **Relax Context Isolation** (pending)
Allow read tools mixed with agent calls; only prohibit write tools with agents

2. **Task Priority Queue**
- Support priority ordering
- Resource-aware scheduling

3. **Fine-grained Error Handling**
- Single agent failure doesn't affect others
- Support retry strategies
- Result aggregation (success/failure/skipped)

4. **Enhanced Dependency Analysis**
- File import relationship-based dependency detection
- Semantic-level conflict detection

### 5.3 Long-term Optimizations

1. **DAG Execution Engine**
Upgrade current two-phase model to general DAG execution

2. **Resource Estimation**
Estimate each agent's resource consumption, dynamically adjust concurrency

3. **Real-time Monitoring**
- Agent execution progress visualization
- Resource usage monitoring
- Bottleneck detection

---

## 6. Testing Recommendations

### 6.1 Existing Test Coverage

`agent-dependency-analyzer.test.ts` covers:
- Empty call handling
- Non-agent tool call rejection
- information-gathering agent grouping
- content-modification agent grouping
- Target conflict detection
- Mixed agent type handling
- Role inference
- MAX_PARALLEL_SUBAGENTS limit

### 6.2 Missing Test Scenarios

#### 6.2.1 Integration Tests
```typescript
describe('Multi-Agent Integration', () => {
  it('should execute information-gathering agents in parallel', async () => {
    // Verify actual parallel execution
  });

  it('should respect MAX_PARALLEL_SUBAGENTS limit', async () => {
    // Verify batch execution
  });

  it('should handle partial failures gracefully', async () => {
    // One agent fails, others continue
  });
});
```

#### 6.2.2 Edge Case Tests
```typescript
describe('Edge Cases', () => {
  it('should handle agent timeout', async () => {});
  it('should handle concurrent abort signals', async () => {});
  it('should handle agent registry not loaded', async () => {});
  it('should handle circular agent calls', async () => {});
});
```

#### 6.2.3 Performance Tests
```typescript
describe('Performance', () => {
  it('should complete 10 parallel agents within reasonable time', async () => {});
  it('should not exhaust memory with many nested agents', async () => {});
});
```

#### 6.2.4 Conflict Detection Tests
```typescript
describe('Target Conflict Detection', () => {
  it('should detect directory containment conflict', () => {
    // targets: ['src/'] vs ['src/utils/file.ts']
  });

  it('should handle overlapping path patterns', () => {
    // targets: ['src/*.ts'] vs ['src/index.ts']
  });
});
```

### 6.3 E2E Test Recommendations

```typescript
describe('E2E: Multi-Agent Workflow', () => {
  it('should complete a multi-file refactor with parallel agents', async () => {
    // 1. Planner analyzes task
    // 2. Launch multiple Coding Agents to modify different files in parallel
    // 3. Verify all files correctly modified
    // 4. Verify no conflicts
  });
});
```

---

## 7. Key File Reference

| File Path | Responsibility |
|-----------|----------------|
| `src/lib/tools/call-agent-v2-tool.tsx` | callAgentV2 tool definition |
| `src/services/agents/agent-dependency-analyzer.ts` | Agent dependency analyzer |
| `src/services/agents/dependency-analyzer.ts` | Unified dependency analysis entry |
| `src/services/agents/tool-dependency-analyzer.ts` | Tool dependency analyzer |
| `src/services/agents/tool-executor.ts` | Tool executor |
| `src/services/agents/agent-tool-access.ts` | Agent tool access control |
| `src/services/agents/agent-execution-config.ts` | Agent execution configuration |
| `src/services/agents/code-planner-agent-v2.ts` | Planner v2 agent definition |
| `src/services/agents/llm-service.ts` | LLM service |
| `src/types/agent.ts` | Agent type definitions |

---

## 8. Summary

This implementation provides a foundational multi-agent parallel execution framework:

**Strengths:**
- Clear role classification (information-gathering / content-modification)
- Target-based conflict detection with directory containment support
- Two-phase execution model
- Configurable concurrency limits and timeouts
- Safety-first approach (unknown agents default to content-modification)

**Areas for Improvement:**
- Conflict detection precision (wildcard patterns, semantic analysis)
- Error handling granularity (retry mechanism, partial success)
- Context isolation flexibility
- Test coverage depth

Suggested priority: First address conflict detection and error handling issues, then expand into a more general execution engine.
