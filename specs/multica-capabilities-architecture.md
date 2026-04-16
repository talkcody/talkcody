# TalkCody Refactor Plan for Multica-Style Core Capabilities

## 1. Goal
This document defines the refactor plan for making TalkCody support the four Multica-style core capabilities in a way that fits TalkCody's current architecture and product direction:

1. Autonomous Execution
2. Agents as Teammates
3. Reusable Skills
4. Unified Runtimes

This is an architecture and migration spec. It defines the target architecture, target directory organization, domain model split, execution harness design, policy model, rollout phases, and the concrete files and modules that should be added or changed.

## 2. Executive Decision
The most reasonable and elegant solution is not to copy Multica's product shape directly.

TalkCody should borrow Multica's execution lifecycle, runtime registry, realtime eventing, and skill materialization ideas, but keep TalkCody's own center of gravity:

- `Project` remains the top-level collaboration and repository boundary.
- Current frontend `Task` is treated as a chat/session concept, not as a backlog item.
- A new `WorkItem` domain is introduced for assignable work.
- A new `ExecutionRun` domain is introduced for durable autonomous execution lifecycle.
- A new `RuntimeHost` domain is introduced for local, daemon, and cloud execution.
- Skills move from file-only runtime injection into a catalog plus binding plus materialization model.
- Execution is formalized as a backend harness with protocol-driven runtime adapters, explicit policy layers, checkpointing, and resumability.

In one sentence:

TalkCody should evolve from a chat-first single-task execution app into a project-scoped collaborative agent operating system with four distinct planes: collaboration, execution, runtime, and policy.

## 3. Current Gaps

### 3.1 What TalkCody already has
- `Project`, `Task`, `Message`, `Agent`, `Tool`, and `Skill` concepts.
- `TaskService`, `MessageService`, `ExecutionService`, and `LLMService` on the frontend.
- Nested `callAgent` execution and dependency scheduling.
- File-based skills and skill injection.
- Ongoing Rust-core backend refactor.

### 3.2 What is missing relative to Multica
- No durable backlog entity for assignable work.
- No clean separation between conversation, execution attempt, and work assignment.
- No first-class runtime registry with heartbeat, capacity, capability, and claiming.
- No event-driven autonomous execution ledger owned by the backend.
- No teammate model where agents can be assigned work, report blockers, and post progress as actors.
- No skill catalog abstraction above current local file skills.
- No protocol-first runtime adapter layer.
- No explicit approval and sandbox policy layer.
- No checkpoint/resume model for long-running or interrupted autonomous execution.
- No artifact offload strategy for very large tool outputs or compacted history.

### 3.3 Core naming problem
Today `Task` means a chat container in TypeScript (`src/types/task.ts`), while Rust has already introduced `Session` concepts in `src-tauri/core/src/types/session.rs` and `src-tauri/core/src/core/session.rs`.

This mismatch will become a major architecture problem if not fixed now.

## 4. Refactor Principles
- Backend-first ownership for lifecycle, persistence, runtime placement, and events.
- Additive migration first; destructive renames later.
- Keep current chat UX working while new collaboration domains are introduced.
- Separate human collaboration state from execution state.
- Separate runtime selection from agent identity.
- Separate skill storage from skill materialization into execution environments.
- Separate runtime protocol from runtime implementation.
- Separate policy evaluation from agent reasoning.
- Design every long-running run to be resumable, replayable, and inspectable.
- Treat frontend stores as projections of backend truth, not the truth itself.
- Borrow Multica's mechanisms, not its exact data model or UI shape.

## 5. Target Domain Model

### 5.1 Final domain split

| Domain | Purpose | Notes |
|---|---|---|
| `Project` | Repository and collaboration boundary | Keep existing TalkCody concept |
| `WorkItem` | Assignable unit of work with status, owner, blocker state | New |
| `Session` | Conversation thread for humans and agents | Current frontend `Task` evolves into this |
| `ExecutionRun` | One execution attempt against a Session and optionally a WorkItem | New |
| `RunCheckpoint` | Persisted execution snapshot used for resume and recovery | New |
| `RuntimeHost` | Concrete execution host: local desktop, local daemon, cloud worker | New |
| `RuntimeCapability` | What a runtime can execute | New |
| `RuntimeAdapter` | Backend protocol implementation for one runtime class | New |
| `AgentProfile` | Agent identity, role, default skills, runtime policy | Existing agent concept expanded |
| `Skill` | Reusable capability package | Existing skill concept expanded |
| `SkillBinding` | Skill attachment to project, agent, or run | New |
| `ApprovalPolicy` | Declarative approval and sandbox rules | New |
| `Artifact` | Large output, offloaded transcript, or binary payload metadata | New |
| `EventStream` | Typed realtime lifecycle events | New backend-first source of truth |

### 5.2 New entity relationships

```text
Project
 |- WorkItem[]
 |   |- assignee -> AgentProfile | HumanActor
 |   |- linkedSessionId
 |   |- latestRunId
 |
 |- Session[]
 |   |- Message[]
 |   |- ExecutionRun[]
 |
 |- AgentProfile[]
 |   |- SkillBinding[]
 |
 |- SkillBinding[]
 |
 |- ProjectPolicy

RuntimeHost[]
 |- RuntimeCapability[]
 |- ExecutionRun[]

ExecutionRun
 |- sessionId
 |- workItemId?
 |- runtimeHostId
 |- agentId
 |- approvalPolicyId
 |- checkpointId?
 |- status
 |- progress events
 |- usage metrics
 |- artifactRefs[]
```

### 5.3 Status models

#### WorkItem status
- `todo`
- `ready`
- `in_progress`
- `blocked`
- `in_review`
- `done`
- `cancelled`

#### ExecutionRun status
- `queued`
- `claimed`
- `preparing`
- `running`
- `waiting_input`
- `paused`
- `checkpointed`
- `resuming`
- `completed`
- `failed`
- `cancelled`
- `timed_out`

### 5.4 Critical naming decision
Do not overload `Task` further.

Refactor path:
- Keep current TS `Task` type during transition.
- Introduce `Session` as the backend source-of-truth term immediately.
- Add frontend aliases and migration wrappers.
- Later rename user-facing and internal task APIs where safe.

## 6. Target Overall Architecture

### 6.1 Architecture summary
TalkCody should be organized into four planes.

#### Collaboration Plane
Owns projects, work items, assignments, comments, session links, agent identity, and user-visible workflow state.

#### Execution Plane
Owns session lifecycle, execution runs, tool calls, approvals, retries, checkpointing, and event emission.

#### Runtime Plane
Owns runtime registration, capability inventory, health, heartbeats, placement, worktree provisioning, and execution host policies.

#### Policy Plane
Owns sandbox policy, approval rules, filesystem/tool permissions, escalation logic, and audit constraints.

### 6.2 Target system diagram

```text
+--------------------------------------------------------------------------------+
|                                 UI Clients                                     |
| Desktop | Web | iOS | CLI | IM Bots                                            |
+-----------------------------------+--------------------------------------------+
                                    |
                                    | HTTP + SSE + WebSocket
                                    v
+--------------------------------------------------------------------------------+
|                           TalkCody Backend Gateway                              |
| Auth | API | Event Fanout | Policy Routing | Presence | Runtime Placement       |
+----------------------+---------------------------+------------------------------+
                       |                           |
                       v                           v
+--------------------------------+   +-------------------------------------------+
|       Collaboration Plane      |   |              Execution Plane              |
| Projects                       |   | Sessions                                  |
| WorkItems                      |   | ExecutionRuns                             |
| AgentProfiles                  |   | AgentLoop / Tool Dispatch                 |
| Comments / Activity            |   | Approvals / Waiting Input                 |
| SkillBindings                  |   | Retry / Resume / Checkpoint               |
+--------------------------------+   +-------------------------------------------+
                       \                         /
                        \                       /
                         v                     v
+--------------------------------------------------------------------------------+
|                      Runtime Plane + Policy Plane                               |
| RuntimeRegistry | RuntimeAdapters | CapabilityIndex | Worktree Manager          |
| ApprovalPolicy | SandboxPolicy | ToolPermissionPolicy | Artifact Offload         |
+--------------------------------------------------------------------------------+
                                    |
                                    v
+--------------------------------------------------------------------------------+
|                                 Storage Layer                                  |
| SQLite | Files | Skill Packages | Attachments | Event Log | Runtime Metadata    |
| Checkpoints | Artifacts | Offloaded Histories                                   |
+--------------------------------------------------------------------------------+
```

### 6.3 What is borrowed from Multica
Borrow directly:
- Queue lifecycle: enqueue -> claim -> start -> complete/fail.
- WebSocket-style realtime state propagation.
- Runtime heartbeat, liveness, health, and usage reporting.
- Runtime-specific skill injection boundary.
- Agents acting as assignable actors instead of only prompt presets.

Do not copy directly:
- Multica's workspace and multi-tenant model.
- Board-first issue-product shape.
- Provider-specific runtime identity as the main abstraction.
- Go server + separate daemon topology as the canonical architecture.

## 7. Execution Harness Model
This is the largest gap in the current spec and the main area that needs to be tightened.

### 7.1 Why a harness layer is required
DeepAgents is strong in one specific area that the current TalkCody spec under-defines: it treats execution as a composable harness with a backend protocol, middleware ordering, permission gates, skills loading, summarization, and subagent orchestration.

TalkCody should adopt the same discipline at the architecture level.

### 7.2 Target execution harness stack
Execution should not be a single `ExecutionOrchestrator -> LLMService -> tools` chain.

It should be:

```text
ExecutionOrchestrator
 -> RunContextBuilder
 -> SkillResolver
 -> PolicyPipeline
 -> RuntimePlacementService
 -> RuntimeAdapter.prepare_run()
 -> AgentLoopService
 -> ToolDispatchService
 -> CheckpointWriter
 -> ArtifactOffloadService
 -> EventPublisher
```

### 7.3 Required pipeline ordering
The pipeline order must be explicit and stable:

1. Build run context.
2. Resolve effective skills.
3. Resolve effective approval and sandbox policy.
4. Select runtime.
5. Prepare worktree and runtime environment.
6. Materialize runtime-native skills and instructions.
7. Start agent loop.
8. Intercept tool requests through policy middleware.
9. Persist checkpoints at run-safe boundaries.
10. Offload large artifacts and compactable history.
11. Publish events and update read models.

Without this ordering, behavior will diverge across embedded, daemon, and cloud runtimes.

### 7.4 RuntimeAdapter contract
A runtime adapter is the contract between the execution plane and concrete runtime implementations.

```text
trait RuntimeAdapter {
  register_host()
  heartbeat()
  claim_run()
  prepare_run()
  start_run()
  stream_events()
  pause_run()
  resume_run()
  cancel_run()
  collect_usage()
  collect_artifacts()
  cleanup_run()
}
```

### 7.5 Canonical adapter result types
All runtime adapters must return canonical result types rather than provider-specific payloads.

Required contracts:
- `RunPrepareResult`
- `RunStartResult`
- `ToolExecutionResult`
- `ApprovalRequest`
- `CheckpointWriteResult`
- `ArtifactReference`
- `RuntimeHealthSnapshot`

### 7.6 Required invariants
- Runtime adapters do not own workflow semantics.
- Runtime adapters do not invent event names.
- Agent loop workers do not own queue state.
- Policy evaluation happens outside model reasoning.
- Checkpoints happen at deterministic boundaries.

## 8. Policy and Approval Model
This is another missing section in the current spec.

### 8.1 Why policy must be first-class
DeepAgents explicitly separates backend capability, permissions, and interrupt behavior. TalkCody needs the same thing, otherwise runtime abstraction will remain too fuzzy.

### 8.2 Policy layers
| Policy type | Responsibility |
|---|---|
| `ApprovalPolicy` | Which tools/actions require human confirmation |
| `SandboxPolicy` | Filesystem, shell, network, process, and path rules |
| `RuntimePolicy` | Which runtimes a run may use |
| `DelegationPolicy` | Which subagents may be invoked and with what scope |
| `ArtifactPolicy` | What must be offloaded, truncated, or retained |

### 8.3 Approval modes
- `always_ask`
- `ask_on_write`
- `ask_on_destructive`
- `auto_approve_safe`
- `headless_trusted`

### 8.4 Tool permission model
Every runtime capability must expose permission traits:
- filesystem read
- filesystem write
- shell execute
- network outbound
- process spawn
- git mutate
- browser automation
- external API access

### 8.5 Policy evaluation points
Policies are evaluated at:
- run creation
- runtime placement
- tool call request
- subagent delegation
- artifact offload
- resume after checkpoint

## 9. Target Service Boundaries

### 9.1 Collaboration services
| Service | Responsibility |
|---|---|
| `ProjectService` | Project metadata, repository context, policies |
| `WorkItemService` | Work item CRUD, assignment, blocker state, transitions |
| `ActivityService` | Comments, agent updates, activity feed, mentions |
| `AgentRosterService` | Agent profiles, role, visibility, default skills, routing policy |
| `SkillBindingService` | Project-agent-run skill attachment rules |

### 9.2 Execution services
| Service | Responsibility |
|---|---|
| `SessionService` | Session lifecycle, messages, approval state |
| `ExecutionOrchestrator` | Queueing, claiming, state machine, retry, timeout |
| `RunContextBuilder` | Build run context from project, session, work item, and agent |
| `CheckpointService` | Persist and restore `RunCheckpoint` snapshots |
| `ArtifactOffloadService` | Offload large outputs, compacted history, and binary artifacts |
| `ExecutionLogService` | Run logs, progress snapshots, usage metrics, audit trail |
| `ToolDispatchService` | Tool execution routing and policy |
| `AgentLoopService` | Per-run LLM loop worker; not owner of queue lifecycle |
| `ApprovalService` | Human approvals, user questions, pause/resume |
| `DelegationService` | Subagent invocation, context isolation, and result return |

### 9.3 Runtime services
| Service | Responsibility |
|---|---|
| `RuntimeRegistry` | Runtime registration, heartbeat, status, capacity |
| `RuntimePlacementService` | Select runtime by capability, policy, and availability |
| `RuntimeProvisioningService` | Worktree, repo checkout, environment preparation |
| `RuntimeUsageService` | Tokens, duration, cost, concurrency statistics |
| `RuntimeHealthService` | Ping, stale runtime detection, forced failover |
| `RuntimeAdapterRegistry` | Resolve the concrete adapter for each runtime class |

### 9.4 Skill services
| Service | Responsibility |
|---|---|
| `SkillCatalogService` | Skill indexing, versioning, metadata, source location |
| `SkillPackageService` | Packaging, import/export, install, validation |
| `SkillMaterializer` | Translate skill into runtime-native files/context |
| `SkillResolver` | Resolve effective skill set for project + agent + run |
| `SkillSourceService` | Resolve layered skill sources and precedence |

### 9.5 Event and policy services
| Service | Responsibility |
|---|---|
| `EventBus` | Internal typed event publication |
| `EventStreamGateway` | SSE and WebSocket fanout |
| `EventProjector` | Project backend events into frontend stores and read models |
| `PolicyEngine` | Evaluate approval, sandbox, delegation, and runtime policy |

## 10. Target Directory Organization

### 10.1 Root-level direction
The refactor should move the codebase toward clear frontend/backend/shared layering.

```text
talkcody/
|- src/                        # Frontend thin client
|- src-tauri/
|  |- core/                    # Rust domain + application + infrastructure
|  |- server/                  # HTTP/SSE/WS transport host
|  |- desktop/                 # Desktop shell integration
|- packages/shared/            # Shared DTOs, event contracts, API types
|- specs/                      # Architecture and migration specs
```

### 10.2 Frontend target organization
The frontend should become feature-oriented, with the current `services` and `stores` gradually reduced to facades and shared utilities.

```text
src/
|- app/                        # App shell and route composition
|- features/
|  |- projects/
|  |- work-items/
|  |- sessions/
|  |- executions/
|  |- runtimes/
|  |- agents/
|  |- skills/
|  |- activity/
|  |- approvals/
|  |- artifacts/
|- shared/
|  |- api/
|  |- events/
|  |- ui/
|  |- stores/
|  |- lib/
|- legacy/
|  |- services/               # Temporary adapters during migration
|  |- stores/
|- locales/
|- test/
```

#### 10.2.1 Frontend migration rule
Do not freeze development waiting for a full folder rewrite.

Migration approach:
- New domains land under `src/features/*`.
- Existing `src/services/*` and `src/stores/*` continue working as adapters.
- Existing `src/components/*` are gradually moved behind feature entry points.
- Pages become thin shells over feature modules.

### 10.3 Rust core target organization
The Rust core should move away from mixed `core/`, `types/`, and duplicate session management modules toward domain/application/infrastructure separation.

```text
src-tauri/core/src/
|- domain/
|  |- project/
|  |- work_item/
|  |- session/
|  |- execution/
|  |- checkpoint/
|  |- runtime/
|  |- agent/
|  |- skill/
|  |- policy/
|  |- artifact/
|  |- event/
|- application/
|  |- project/
|  |- work_item/
|  |- session/
|  |- execution/
|  |- runtime/
|  |- skill/
|  |- policy/
|  |- artifact/
|- infrastructure/
|  |- storage/
|  |  |- sqlite/
|  |  |- migrations/
|  |- runtime/
|  |  |- adapters/
|  |- platform/
|  |- events/
|  |- artifacts/
|- transport/
|  |- http/
|  |- sse/
|  |- ws/
|- integrations/
|- security/
|- lib.rs
```

#### 10.3.1 Rust migration rule
Do not attempt a single-step directory explosion.

Migration approach:
- Add new directories first.
- Move new code there.
- Wrap or re-export old modules.
- Remove old duplicates after parity.

### 10.4 Shared contracts target organization

```text
packages/shared/src/
|- api/
|  |- sessions.ts
|  |- work-items.ts
|  |- executions.ts
|  |- runtimes.ts
|  |- agents.ts
|  |- skills.ts
|  |- approvals.ts
|  |- artifacts.ts
|- events/
|  |- execution-events.ts
|  |- runtime-events.ts
|  |- work-item-events.ts
|  |- approval-events.ts
|  |- artifact-events.ts
|- types/
|  |- project.ts
|  |- session.ts
|  |- work-item.ts
|  |- execution-run.ts
|  |- run-checkpoint.ts
|  |- runtime.ts
|  |- runtime-adapter.ts
|  |- approval-policy.ts
|  |- artifact.ts
|  |- skill.ts
|  |- activity.ts
|- index.ts
```

## 11. Runtime Model

### 11.1 Runtime abstraction
A runtime is not a provider.

A runtime is a host plus capabilities, adapters, and policies.

```text
RuntimeHost = host identity + mode + health + capacity + policies
RuntimeCapability = executable providers + tool permissions + platform traits + workspace support
RuntimeAdapter = implementation contract for executing runs on that host class
```

### 11.1.1 Runtime modes
- `embedded_local`
- `desktop_daemon`
- `service_managed`
- `external_worker`

### 11.1.2 Capability examples
- supports `codex`
- supports `claude`
- supports `local shell`
- supports `lsp`
- supports `git worktree`
- supports `image generation`
- supports `headless browser`
- supports `long_running`

### 11.2 Runtime placement policy
Placement should consider:
- required capability set
- runtime mode policy
- project affinity
- local vs remote preference
- concurrency slots
- health score
- policy restrictions
- artifact handling support
- checkpoint/resume support

### 11.3 Runtime events
- `runtime.registered`
- `runtime.heartbeat`
- `runtime.status_changed`
- `runtime.capacity_changed`
- `runtime.health_failed`
- `runtime.claimed_run`
- `runtime.released_run`
- `runtime.resume_supported_changed`

## 12. Checkpoint, Resume, and Artifact Model
This is a required improvement inspired by DeepAgents-style resumable harnesses and summarization/offload discipline.

### 12.1 Checkpoint boundaries
A checkpoint may be written at:
- run start after preparation
- before waiting for user approval
- after every completed tool batch
- before compaction or artifact offload
- before cancellation or failover

### 12.2 What a checkpoint stores
- run status
- loop iteration metadata
- current tool queue state
- resolved skills and policy snapshot
- runtime assignment snapshot
- artifact references
- compaction state and summary references

### 12.3 Artifact offload rules
Large payloads should not remain only in event streams or message bodies.

Offload targets:
- huge bash outputs
- large patches and file diffs
- long tool call transcripts
- compacted message history
- binary attachments generated during execution

### 12.4 Compaction strategy
TalkCody should support both:
- automatic compaction for long-running runs
- explicit agent or user-triggered compaction

Compaction output should create:
- compacted summary artifact
- offloaded full transcript artifact
- new checkpoint linked to both

## 13. Skill Model

### 13.1 Skill evolution
Current state:
- file-based skills under local directories
- runtime prompt injection

Target state:
- skill catalog abstraction
- skill metadata and versioning
- source provenance
- layered source resolution
- bindings at project, agent, and run scope
- runtime-native materialization

### 13.2 Skill scopes
- `global`
- `project`
- `agent_default`
- `run_override`

### 13.3 Skill source layers
Skill source resolution should be explicit and ordered:

```text
builtin -> installed_global -> project_local -> project_remote -> agent_default -> run_override
```

Later layers override earlier layers when skill IDs collide.

### 13.4 Skill resolution order
```text
run_override > work_item/project binding > agent_default > global
```

### 13.5 Skill metadata requirements
Each skill should have validated metadata:
- `id`
- `name`
- `description`
- `version`
- `source`
- `compatibility`
- `allowed_tools`
- `files[]`

### 13.6 Skill materialization boundary
The runtime should receive a materialized execution context, not raw storage semantics.

Examples:
- Codex runtime gets generated `AGENTS.md` or provider-native skill paths.
- Claude runtime gets `CLAUDE.md` or native skill folder structure.
- Embedded Rust runtime gets normalized structured skill payloads.

### 13.7 Skill validation rules
The spec should require:
- stable skill ID normalization
- file size limits for `SKILL.md`
- metadata validation before publish or bind
- explicit source precedence rules
- private run-only skill state not leaking into parent sessions

## 14. Teammate Agents vs Subagents
This distinction needs to be explicit.

### 14.1 Teammate agent
A teammate agent is a durable actor visible in the product model.

Properties:
- assignable to `WorkItem`
- has profile, role, visibility, and default skills
- can post comments, blockers, and status changes
- can own multiple runs over time

### 14.2 Subagent
A subagent is an ephemeral execution helper invoked inside a run.

Properties:
- stateless and run-scoped
- isolated context window
- no direct durable product identity
- returns a bounded result to the parent run

### 14.3 Why this distinction matters
Without this, TalkCody will blur three different concepts:
- durable teammate
- nested execution helper
- runtime worker

These must stay separate.

### 14.4 Delegation rules
Subagent delegation should define:
- context passed in
- state excluded from child agent
- allowed tools and policies inherited or overridden
- result contract returned to parent
- whether the child is synchronous or async/background

## 15. Event and API Model

### 15.1 Event namespaces
- `project.*`
- `work_item.*`
- `session.*`
- `message.*`
- `execution.*`
- `runtime.*`
- `agent.*`
- `skill.*`
- `activity.*`
- `approval.*`
- `artifact.*`

### 15.2 Transport decision
- SSE for token and ordered session stream output.
- WebSocket for control-plane updates, work item state, runtime state, and live collaboration.
- Internal typed event bus as the single source of truth.

### 15.3 Proposed API surface

#### Collaboration
- `GET /v1/projects/:id/work-items`
- `POST /v1/projects/:id/work-items`
- `PATCH /v1/work-items/:id`
- `POST /v1/work-items/:id/assign`
- `POST /v1/work-items/:id/comments`

#### Sessions
- `POST /v1/sessions`
- `GET /v1/sessions/:id`
- `POST /v1/sessions/:id/messages`
- `GET /v1/sessions/:id/events`

#### Executions
- `POST /v1/executions`
- `GET /v1/executions/:id`
- `POST /v1/executions/:id/cancel`
- `POST /v1/executions/:id/retry`
- `POST /v1/executions/:id/respond`
- `POST /v1/executions/:id/checkpoint`
- `POST /v1/executions/:id/resume`

#### Runtimes
- `GET /v1/runtimes`
- `POST /v1/runtimes/register`
- `POST /v1/runtimes/:id/heartbeat`
- `POST /v1/runtimes/:id/claim`
- `POST /v1/runtimes/:id/usage`

#### Skills
- `GET /v1/skills`
- `POST /v1/skills`
- `POST /v1/skills/import`
- `PUT /v1/agents/:id/skills`
- `PUT /v1/projects/:id/skills`

#### Policy and artifacts
- `GET /v1/approval-policies`
- `PUT /v1/projects/:id/approval-policy`
- `GET /v1/artifacts/:id`

## 16. Primary User Flows After Refactor

### 16.1 Manual chat with no work item
1. User creates a `Session`.
2. User sends a message.
3. Backend creates an `ExecutionRun` in direct mode.
4. Placement selects default runtime.
5. Session receives stream events.
6. Run completes, but no `WorkItem` is required.

### 16.2 Autonomous teammate workflow
1. User creates `WorkItem`.
2. User assigns an `AgentProfile`.
3. Backend creates or links a `Session`.
4. Backend enqueues `ExecutionRun`.
5. `RuntimeHost` claims run.
6. Agent posts progress and blockers into activity/session.
7. Work item status is projected from run state plus human actions.

### 16.3 Retry on another runtime
1. `ExecutionRun` fails.
2. `WorkItem` remains blocked or in progress depending on policy.
3. User or policy triggers retry.
4. New `ExecutionRun` is placed on another compatible runtime.
5. Same `Session` continues, preserving context.

### 16.4 Skill-bound autonomous execution
1. Agent default skills resolved.
2. Project skills resolved.
3. Run overrides resolved.
4. `SkillMaterializer` builds runtime-native context.
5. Runtime executes with consistent capability payload.

### 16.5 Interrupted run resume
1. Run is paused for approval or runtime failure.
2. Backend writes `RunCheckpoint`.
3. User approves or alternate runtime becomes available.
4. Run resumes from checkpoint with stable skill and policy snapshot.
5. Session and work item continue without creating duplicate state.

## 17. Rollout Plan

## Phase 0: Spec and terminology lock
Deliverables:
- finalize domain names
- freeze `WorkItem`, `Session`, `ExecutionRun`, `RunCheckpoint`, `RuntimeHost`
- document migration aliases
- freeze runtime adapter contract

## Phase 1: Shared contract layer
Deliverables:
- shared DTOs for work item, session, execution run, runtime, policy, artifacts, and events
- typed event contracts
- TS/Zod schemas where appropriate

## Phase 2: Backend domain introduction
Deliverables:
- add `WorkItem`, `ExecutionRun`, `RuntimeHost`, `SkillBinding`, `RunCheckpoint`, and `Artifact` storage tables
- add repositories and services
- keep current frontend behavior intact

## Phase 3: Backend execution ledger cut-in
Deliverables:
- move durable execution lifecycle out of frontend memory
- keep frontend `ExecutionService` as adapter
- emit backend-first events
- add deterministic checkpoint boundaries

## Phase 4: Runtime registry and claiming
Deliverables:
- runtime registration, heartbeat, capacity, claiming
- embedded local runtime first
- daemon/cloud workers later
- adapter registry operational

## Phase 5: Policy and approval layer
Deliverables:
- approval policy objects
- tool permission evaluation
- delegation policy
- artifact offload policy

## Phase 6: Skill catalog unification
Deliverables:
- wrap file skills in catalog abstraction
- add project and agent bindings
- add runtime materialization service
- add layered source precedence and validation

## Phase 7: Frontend feature migration
Deliverables:
- work item list/detail UI
- execution run detail UI
- runtime dashboard
- activity feed
- approval and artifact panels
- thin pages and shared event adapters

## Phase 8: Cleanup and rename
Deliverables:
- rename frontend task concepts to session where safe
- remove duplicate Rust session implementations
- collapse legacy adapters
- remove direct frontend lifecycle ownership

## 18. Concrete File Plan
This section lists the main files and modules that should be added or modified.

### 18.1 New spec files
| Path | Action | Purpose |
|---|---|---|
| `specs/multica-capabilities-architecture.md` | modify | Master refactor spec |
| `specs/work-item-domain.md` | create later | Detailed state machine and API contract |
| `specs/runtime-registry-design.md` | create later | Runtime lifecycle, placement, claiming |
| `specs/execution-event-model.md` | create later | Event types, transport, resumability |
| `specs/skill-catalog-refactor.md` | create later | Skill catalog, binding, materialization |
| `specs/policy-and-approval-model.md` | create later | Approval, sandbox, and delegation policy |
| `specs/checkpoint-and-artifact-model.md` | create later | Checkpointing, compaction, and artifact offload |

### 18.2 Shared package files
#### Add
- `packages/shared/src/types/project.ts`
- `packages/shared/src/types/session.ts`
- `packages/shared/src/types/work-item.ts`
- `packages/shared/src/types/execution-run.ts`
- `packages/shared/src/types/run-checkpoint.ts`
- `packages/shared/src/types/runtime.ts`
- `packages/shared/src/types/runtime-adapter.ts`
- `packages/shared/src/types/approval-policy.ts`
- `packages/shared/src/types/artifact.ts`
- `packages/shared/src/types/activity.ts`
- `packages/shared/src/events/work-item-events.ts`
- `packages/shared/src/events/execution-events.ts`
- `packages/shared/src/events/runtime-events.ts`
- `packages/shared/src/events/approval-events.ts`
- `packages/shared/src/events/artifact-events.ts`
- `packages/shared/src/api/work-items.ts`
- `packages/shared/src/api/executions.ts`
- `packages/shared/src/api/runtimes.ts`
- `packages/shared/src/api/sessions.ts`
- `packages/shared/src/api/approvals.ts`
- `packages/shared/src/api/artifacts.ts`

#### Modify
- `packages/shared/src/types/cloud-backend.ts`
- `packages/shared/src/types/index.ts`
- `packages/shared/src/index.ts`

### 18.3 Frontend files to add
#### New feature modules
- `src/features/work-items/index.ts`
- `src/features/work-items/types.ts`
- `src/features/work-items/store.ts`
- `src/features/work-items/service.ts`
- `src/features/work-items/components/work-item-list.tsx`
- `src/features/work-items/components/work-item-detail.tsx`
- `src/features/work-items/components/work-item-board.tsx`
- `src/features/sessions/index.ts`
- `src/features/sessions/service.ts`
- `src/features/sessions/store.ts`
- `src/features/executions/index.ts`
- `src/features/executions/store.ts`
- `src/features/executions/service.ts`
- `src/features/executions/components/run-status-badge.tsx`
- `src/features/executions/components/execution-run-detail.tsx`
- `src/features/runtimes/index.ts`
- `src/features/runtimes/store.ts`
- `src/features/runtimes/service.ts`
- `src/features/runtimes/components/runtime-dashboard.tsx`
- `src/features/activity/index.ts`
- `src/features/activity/store.ts`
- `src/features/activity/service.ts`
- `src/features/activity/components/activity-timeline.tsx`
- `src/features/approvals/index.ts`
- `src/features/approvals/store.ts`
- `src/features/approvals/service.ts`
- `src/features/approvals/components/approval-queue.tsx`
- `src/features/artifacts/index.ts`
- `src/features/artifacts/service.ts`
- `src/features/artifacts/components/artifact-viewer.tsx`
- `src/features/agents/components/agent-assignment-picker.tsx`
- `src/features/skills/components/skill-binding-panel.tsx`
- `src/shared/api/backend-client.ts`
- `src/shared/events/event-bridge.ts`
- `src/shared/events/event-reducer.ts`

#### Transitional adapter files
- `src/legacy/services/task-session-adapter.ts`
- `src/legacy/services/execution-adapter.ts`
- `src/legacy/stores/task-session-adapter.ts`

### 18.4 Frontend files to modify
#### Core types and stores
- `src/types/task.ts`
- `src/types/index.ts`
- `src/types/agent.ts`
- `src/types/skill.ts`
- `src/stores/task-store.ts`
- `src/stores/execution-store.ts`
- `src/stores/agent-store.ts`
- `src/stores/skills-store.ts`
- `src/stores/project-store.ts`

#### Core services
- `src/services/task-service.ts`
- `src/services/message-service.ts`
- `src/services/execution-service.ts`
- `src/services/workspace-root-service.ts`
- `src/services/agents/llm-service.ts`
- `src/services/agents/tool-executor.ts`
- `src/services/skills/agent-skill-service.ts`
- `src/services/skills/skill-service.ts`

#### Hooks and pages
- `src/hooks/use-task.ts`
- `src/hooks/use-tasks.ts`
- `src/hooks/use-skills.ts`
- `src/hooks/use-unified-agents.ts`
- `src/components/navigation-sidebar.tsx`
- `src/pages/projects-page.tsx`
- `src/pages/agents-page.tsx`
- `src/pages/skills-page.tsx`
- `src/app.tsx`

#### Purpose of these frontend modifications
- split session concerns from work-item concerns
- project backend event streams into UI state
- replace frontend-owned execution state with backend-backed read models
- expose runtime visibility, approval visibility, artifact visibility, and agent assignment

### 18.5 Rust backend files to add
#### Domain
- `src-tauri/core/src/domain/project/mod.rs`
- `src-tauri/core/src/domain/work_item/mod.rs`
- `src-tauri/core/src/domain/work_item/entity.rs`
- `src-tauri/core/src/domain/work_item/status.rs`
- `src-tauri/core/src/domain/session/mod.rs`
- `src-tauri/core/src/domain/execution/mod.rs`
- `src-tauri/core/src/domain/execution/entity.rs`
- `src-tauri/core/src/domain/execution/status.rs`
- `src-tauri/core/src/domain/checkpoint/mod.rs`
- `src-tauri/core/src/domain/checkpoint/entity.rs`
- `src-tauri/core/src/domain/runtime/mod.rs`
- `src-tauri/core/src/domain/runtime/entity.rs`
- `src-tauri/core/src/domain/runtime/capability.rs`
- `src-tauri/core/src/domain/runtime/adapter.rs`
- `src-tauri/core/src/domain/skill/mod.rs`
- `src-tauri/core/src/domain/skill/binding.rs`
- `src-tauri/core/src/domain/policy/mod.rs`
- `src-tauri/core/src/domain/policy/approval.rs`
- `src-tauri/core/src/domain/policy/sandbox.rs`
- `src-tauri/core/src/domain/artifact/mod.rs`
- `src-tauri/core/src/domain/event/mod.rs`

#### Application layer
- `src-tauri/core/src/application/project/project_service.rs`
- `src-tauri/core/src/application/work_item/work_item_service.rs`
- `src-tauri/core/src/application/session/session_service.rs`
- `src-tauri/core/src/application/execution/execution_orchestrator.rs`
- `src-tauri/core/src/application/execution/run_context_builder.rs`
- `src-tauri/core/src/application/execution/checkpoint_service.rs`
- `src-tauri/core/src/application/execution/artifact_offload_service.rs`
- `src-tauri/core/src/application/execution/execution_log_service.rs`
- `src-tauri/core/src/application/runtime/runtime_registry.rs`
- `src-tauri/core/src/application/runtime/runtime_adapter_registry.rs`
- `src-tauri/core/src/application/runtime/runtime_placement_service.rs`
- `src-tauri/core/src/application/runtime/runtime_health_service.rs`
- `src-tauri/core/src/application/skill/skill_catalog_service.rs`
- `src-tauri/core/src/application/skill/skill_materializer.rs`
- `src-tauri/core/src/application/skill/skill_source_service.rs`
- `src-tauri/core/src/application/activity/activity_service.rs`
- `src-tauri/core/src/application/policy/policy_engine.rs`
- `src-tauri/core/src/application/delegation/delegation_service.rs`

#### Infrastructure layer
- `src-tauri/core/src/infrastructure/storage/sqlite/work_item_repository.rs`
- `src-tauri/core/src/infrastructure/storage/sqlite/session_repository.rs`
- `src-tauri/core/src/infrastructure/storage/sqlite/execution_run_repository.rs`
- `src-tauri/core/src/infrastructure/storage/sqlite/run_checkpoint_repository.rs`
- `src-tauri/core/src/infrastructure/storage/sqlite/runtime_repository.rs`
- `src-tauri/core/src/infrastructure/storage/sqlite/skill_binding_repository.rs`
- `src-tauri/core/src/infrastructure/storage/sqlite/artifact_repository.rs`
- `src-tauri/core/src/infrastructure/storage/migrations/xxxx_work_items.sql`
- `src-tauri/core/src/infrastructure/storage/migrations/xxxx_execution_runs.sql`
- `src-tauri/core/src/infrastructure/storage/migrations/xxxx_run_checkpoints.sql`
- `src-tauri/core/src/infrastructure/storage/migrations/xxxx_runtime_hosts.sql`
- `src-tauri/core/src/infrastructure/storage/migrations/xxxx_skill_bindings.sql`
- `src-tauri/core/src/infrastructure/storage/migrations/xxxx_artifacts.sql`
- `src-tauri/core/src/infrastructure/events/event_bus.rs`
- `src-tauri/core/src/infrastructure/runtime/adapters/embedded_runtime.rs`
- `src-tauri/core/src/infrastructure/runtime/adapters/daemon_runtime.rs`
- `src-tauri/core/src/infrastructure/runtime/adapters/cloud_runtime.rs`
- `src-tauri/core/src/infrastructure/artifacts/file_artifact_store.rs`

#### Transport layer
- `src-tauri/core/src/transport/http/work_items.rs`
- `src-tauri/core/src/transport/http/sessions.rs`
- `src-tauri/core/src/transport/http/executions.rs`
- `src-tauri/core/src/transport/http/runtimes.rs`
- `src-tauri/core/src/transport/http/skills.rs`
- `src-tauri/core/src/transport/http/approvals.rs`
- `src-tauri/core/src/transport/http/artifacts.rs`
- `src-tauri/core/src/transport/sse/session_stream.rs`
- `src-tauri/core/src/transport/ws/control_plane.rs`

### 18.6 Rust backend files to modify
#### Existing core and storage
- `src-tauri/core/src/lib.rs`
- `src-tauri/core/src/storage/mod.rs`
- `src-tauri/core/src/storage/models.rs`
- `src-tauri/core/src/storage/chat_history.rs`
- `src-tauri/core/src/storage/settings.rs`
- `src-tauri/core/src/storage/migrations/talkcody_db.rs`
- `src-tauri/core/src/core/runtime.rs`
- `src-tauri/core/src/core/tools.rs`
- `src-tauri/core/src/core/tool_definitions.rs`
- `src-tauri/core/src/platform/*`
- `src-tauri/core/src/streaming/*`

#### Existing duplicate session modules to consolidate
- `src-tauri/core/src/types/session.rs`
- `src-tauri/core/src/core/session.rs`

#### Server host
- `src-tauri/server/src/lib.rs`
- `src-tauri/server/src/state.rs`
- `src-tauri/server/src/config.rs`

#### Desktop shell integration
- `src-tauri/desktop/src/lib.rs`
- `src-tauri/desktop/src/main.rs`
- `src-tauri/desktop/src/scheduled_tasks/*`

#### Purpose of these backend modifications
- move lifecycle ownership to backend services
- replace frontend-only execution state with persistent run records
- add runtime registration and claiming
- add checkpoint and artifact offload support
- add protocol-driven runtime adapters
- eliminate duplicate session management implementations
- align transport with new event and approval contracts

### 18.7 Existing code that should eventually be deprecated or wrapped
- `src/services/task-service.ts` as the sole owner of session/task lifecycle
- `src/services/execution-service.ts` as the sole owner of run state
- `src/stores/execution-store.ts` as an in-memory truth source
- `src/types/task.ts` as the only chat and execution type bucket
- `src-tauri/core/src/core/session.rs` and `src-tauri/core/src/types/session.rs` duplication

## 19. Mapping Current Files to Future Ownership

| Current file | Future ownership |
|---|---|
| `src/types/task.ts` | split into `session`, `work-item`, and `execution-run` frontend contracts |
| `src/services/task-service.ts` | becomes session-facing adapter to backend session APIs |
| `src/services/execution-service.ts` | becomes run command adapter and event subscriber |
| `src/services/message-service.ts` | remains message-focused, no run lifecycle ownership |
| `src/services/agents/llm-service.ts` | remains per-run loop worker, no queue ownership |
| `src/stores/task-store.ts` | becomes session read model store |
| `src/stores/execution-store.ts` | becomes projection cache from backend events |
| `src/services/skills/agent-skill-service.ts` | delegates to `SkillCatalogService` and `SkillMaterializer` |
| `src-tauri/core/src/types/session.rs` | merge into new `domain/session` |
| `src-tauri/core/src/core/session.rs` | merge into new `application/session` |

## 20. Architecture Decisions That Must Be Kept Stable
- `Project` is the collaboration boundary for now; do not add Multica-style workspace tenancy yet.
- `WorkItem` is required for teammate workflows.
- `Session` is the durable chat thread.
- `ExecutionRun` is the only owner of autonomous execution lifecycle.
- `RunCheckpoint` is the unit of resumability and failover.
- `RuntimeHost` is host-plus-capabilities, never provider-only.
- `RuntimeAdapter` is the contract between runtime plane and execution plane.
- Skills are resolved by layered source precedence and materialized per runtime.
- Policy evaluation is external to model reasoning.
- Backend events are the source of truth; frontend stores are projections.

## 21. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Overloading `Task` even more | Architecture collapse | Introduce `WorkItem` and `ExecutionRun` immediately |
| Frontend/backend naming drift | Expensive migrations | Freeze terminology in shared contracts first |
| Full frontend rewrite stalls delivery | High | Use adapters and feature-by-feature migration |
| Runtime abstraction too provider-specific | Medium | Model host-plus-capabilities plus adapter contract |
| Skill duplication across file/db/runtime | High | Add `SkillCatalogService`, `SkillSourceService`, and `SkillMaterializer` separation |
| Duplicate session logic in Rust persists | Medium | Consolidate into new domain/application split by Phase 3 |
| No checkpoint strategy | High | Add deterministic checkpoint boundaries before runtime rollout |
| Policy drift across runtimes | High | Add `PolicyEngine` and canonical permission traits |

## 22. Verification Strategy
The refactor is only complete when these scenarios are cleanly supported:

1. Manual chat session with no work item.
2. Work item assigned to one agent with autonomous execution.
3. Nested `callAgent` inside an autonomous execution run.
4. Failed run retried on a different runtime with preserved session context.
5. Same agent skill set materialized consistently on embedded local and remote runtimes.
6. Runtime goes offline and queued/running work is reconciled correctly.
7. Agent can post progress, blockers, and completion summaries as first-class activity.
8. Approval-required runs checkpoint and resume without duplicating tool effects.
9. Large artifacts are offloaded and still accessible from the UI.
10. Subagent delegation preserves isolation and does not leak parent-only state.

### 22.1 Required automated evaluation suites
Add explicit evaluation tracks, not just manual scenarios:
- unit tests for policy evaluation, skill resolution, and checkpoint restoration
- integration tests for runtime claiming, failover, and resume
- end-to-end tests for work item assignment and autonomous progress reporting
- chaos tests for runtime heartbeat loss and forced cancellation
- regression tests for artifact offload and compacted history restore

## 23. Recommended Implementation Order
If execution starts now, the best order is:

1. Lock shared terminology and contracts.
2. Lock runtime adapter and policy contracts.
3. Add backend `WorkItem`, `ExecutionRun`, `RunCheckpoint`, and `Artifact` schema.
4. Introduce backend event model.
5. Convert frontend execution state to projections over backend events.
6. Add checkpoint and artifact offload support.
7. Add runtime registry and claiming.
8. Introduce policy engine.
9. Introduce skill catalog, source layering, and binding.
10. Add teammate UI surfaces.
11. Rename and remove legacy `Task` assumptions.

## 24. Final Recommendation
The elegant target architecture for TalkCody is:

- a project-scoped collaboration system
- with sessions for conversation
- work items for assignment
- execution runs for autonomous lifecycle
- checkpoints for resume and failover
- runtimes as host-plus-capabilities-plus-adapters
- skills as catalog-plus-binding-plus-materialization
- policies as explicit approval and sandbox contracts
- and backend events as the single source of truth

This gives TalkCody Multica's strongest capabilities while also adding the protocol rigor, policy discipline, resumability, and artifact handling that projects like DeepAgents demonstrate are necessary for a durable autonomous agent system.
