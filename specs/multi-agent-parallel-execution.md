# Multi-Agent Parallel Execution (Current Code)

This document reflects how TalkCody schedules `callAgent` executions today.

## Overview
`callAgent` is a tool that runs a nested LLM loop with a sub-agent. Execution scheduling uses a dependency analyzer that can switch between agent-specific and tool-specific planners based on the tool mix in a single turn.

## callAgent Tool
- Implemented in `src/lib/tools/call-agent-tool.tsx`.
- Requires `agentId`, `task`, `context`, and optional `targets`.
- Creates a nested `LLMService` using the parent `taskId` and streams nested tool messages with `parentToolCallId`.
- Uses an idle timeout (`nestedAgentTimeoutMs`) and pauses it for user-interaction tools (`exitPlanMode`, `askUserQuestions`).

## Dependency Analysis

### DependencyAnalyzer
- `src/services/agents/dependency-analyzer.ts` splits tool calls into `callAgent` vs non-agent tools.
- If all calls are `callAgent`, it uses `AgentDependencyAnalyzer`.
- Otherwise, it falls back to `ToolDependencyAnalyzer` for the whole batch.

### AgentDependencyAnalyzer
- `src/services/agents/agent-dependency-analyzer.ts` classifies each agent as `read` or `write`.
- Role is taken from `AgentDefinition.role` or inferred from tool metadata.
- `explore` is treated as `read`.
- Stages:
  - `read-stage`: all read agents can run in parallel.
  - `write-edit-stage`: write agents grouped by target conflicts.
- `callAgent` without `targets` runs sequentially for safety.
- Target conflicts use exact path or directory containment checks.

### ToolDependencyAnalyzer
- `src/services/agents/tool-dependency-analyzer.ts` groups tools by category (`read`, `write`, `edit`, `other`).
- `read` runs in parallel; `write/edit` runs sequentially for review.
- `other` uses `canConcurrent` plus basic target conflict checks.

## Configuration
- `src/services/agents/agent-execution-config.ts`:
  - `maxParallelSubagents` (default 5)
  - `nestedAgentTimeoutMs` (default 5 minutes)
  - `enableParallelExecution` (default true)
- Tool access rules in `src/services/agents/agent-tool-access.ts` restrict `callAgent` to the `planner` agent.

## Current Design Flaw
If a tool batch contains both `callAgent` and other tools, the planner falls back to `ToolDependencyAnalyzer`, so agent role-based staging and target conflict grouping for agents is not applied in mixed workflows.

## Further Optimization
Implement a unified scheduler that can plan `callAgent` and regular tools together (single DAG), preserving agent role staging while honoring tool dependencies and richer target analysis (glob patterns or import graph).
