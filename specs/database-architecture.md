# TalkCody 数据库架构文档

## 概述

TalkCody 使用 SQLite 作为本地数据库。经过重构，现在 Desktop 和 Server 模式使用**统一的数据库架构**。

## 架构状态

### ✅ 已实现统一架构

| 模式 | 数据库文件 | 状态 | 说明 |
|-----|-----------|------|------|
| **Desktop** | `talkcody.db` | ✅ 使用中 | TypeScript 和 Rust 共享 |
| **Server** | `talkcody.db` | ✅ 使用中 | 与 Desktop 相同的表结构 |

### 历史问题 (已解决)

~~Desktop 模式曾存在两套独立的数据库系统：~~
- ~~`talkcody.db` (TypeScript 使用)~~
- ~~`chat_history.db`, `agents.db`, `settings.db` (Rust 创建但未使用)~~

**解决方案**: 重构后 Rust 端只使用 `talkcody.db`，删除其他三个数据库的创建逻辑。

---

## 统一数据库: talkcody.db

**位置**: `~/Library/Application Support/com.talkcody/talkcody.db` (macOS)

**访问方式**:
- **TypeScript**: `src/services/database-service.ts` → Turso/libSQL 客户端
- **Rust**: `src-tauri/core/src/storage/mod.rs` → `Storage` 模块

**迁移系统**: `src-tauri/core/src/storage/migrations/talkcody_db.rs`

---

## 表结构

### Core Tables (v1)

#### projects
```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  context TEXT DEFAULT '',
  rules TEXT DEFAULT '',
  root_path TEXT DEFAULT NULL
);
```

#### conversations (tasks)
```sql
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  project_id TEXT NOT NULL DEFAULT 'default',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  message_count INTEGER DEFAULT 0,
  request_count INTEGER DEFAULT 0,
  cost REAL DEFAULT 0,
  input_token INTEGER DEFAULT 0,
  output_token INTEGER DEFAULT 0,
  context_usage REAL DEFAULT NULL,
  settings TEXT DEFAULT NULL,
  FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);
```

#### messages
```sql
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  assistant_id TEXT,
  position_index INTEGER DEFAULT 0,
  FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE
);
```

#### message_attachments
```sql
CREATE TABLE message_attachments (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  type TEXT NOT NULL,
  filename TEXT NOT NULL,
  file_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (message_id) REFERENCES messages (id) ON DELETE CASCADE
);
```

### Agent & Skill Tables (v2-v3)

#### agents
```sql
CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  model_type TEXT NOT NULL DEFAULT 'main_model',
  system_prompt TEXT NOT NULL,
  tools_config TEXT DEFAULT '{}',
  rules TEXT DEFAULT '',
  output_format TEXT DEFAULT '',
  is_hidden BOOLEAN DEFAULT 0,
  is_default BOOLEAN DEFAULT 0,
  is_enabled BOOLEAN DEFAULT 1,
  dynamic_enabled BOOLEAN DEFAULT 0,
  dynamic_providers TEXT DEFAULT '[]',
  dynamic_variables TEXT DEFAULT '{}',
  dynamic_provider_settings TEXT DEFAULT '{}',
  default_skills TEXT DEFAULT '[]',
  source_type TEXT DEFAULT 'local',
  marketplace_id TEXT,
  marketplace_version TEXT,
  forked_from_id TEXT,
  forked_from_marketplace_id TEXT,
  is_shared INTEGER DEFAULT 0,
  last_synced_at INTEGER,
  icon_url TEXT,
  author_name TEXT,
  author_id TEXT,
  categories TEXT DEFAULT '[]',
  tags TEXT DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  created_by TEXT DEFAULT 'system',
  usage_count INTEGER DEFAULT 0
);
```

#### skills
```sql
CREATE TABLE skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  long_description TEXT,
  category TEXT NOT NULL,
  icon_url TEXT,
  system_prompt_fragment TEXT,
  workflow_rules TEXT,
  documentation TEXT,
  source_type TEXT DEFAULT 'local',
  marketplace_id TEXT,
  marketplace_version TEXT,
  forked_from_id TEXT,
  forked_from_marketplace_id TEXT,
  is_shared INTEGER DEFAULT 0,
  author_name TEXT,
  author_id TEXT,
  downloads INTEGER DEFAULT 0,
  rating REAL DEFAULT 0,
  last_synced_at INTEGER,
  is_built_in INTEGER DEFAULT 0,
  tags TEXT DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_used_at INTEGER,
  UNIQUE(marketplace_id)
);
```

#### conversation_skills
```sql
CREATE TABLE conversation_skills (
  conversation_id TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  priority INTEGER DEFAULT 0,
  activated_at INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE,
  PRIMARY KEY (conversation_id, skill_id)
);
```

#### active_skills
```sql
CREATE TABLE active_skills (
  skill_id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);
```

### MCP & Utility Tables (v4)

#### mcp_servers
```sql
CREATE TABLE mcp_servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  protocol TEXT NOT NULL CHECK (protocol IN ('http', 'sse', 'stdio')),
  api_key TEXT DEFAULT NULL,
  headers TEXT DEFAULT '{}',
  stdio_command TEXT DEFAULT NULL,
  stdio_args TEXT DEFAULT '[]',
  stdio_env TEXT DEFAULT '{}',
  is_enabled BOOLEAN DEFAULT 1,
  is_built_in BOOLEAN DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

#### todos
```sql
CREATE TABLE todos (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'in_progress', 'completed')),
  priority TEXT NOT NULL CHECK (priority IN ('high', 'medium', 'low')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE
);
```

#### recent_files
```sql
CREATE TABLE recent_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT NOT NULL,
  repository_path TEXT NOT NULL,
  opened_at INTEGER NOT NULL,
  UNIQUE(file_path, repository_path)
);
```

#### recent_projects
```sql
CREATE TABLE recent_projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL UNIQUE,
  project_name TEXT NOT NULL,
  root_path TEXT NOT NULL,
  opened_at INTEGER NOT NULL
);
```

#### settings
```sql
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
```

### Tracing Tables (v5)

```sql
CREATE TABLE traces (
  id TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  metadata TEXT
);

CREATE TABLE spans (
  id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL,
  parent_span_id TEXT,
  name TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  attributes TEXT,
  FOREIGN KEY (trace_id) REFERENCES traces(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_span_id) REFERENCES spans(id) ON DELETE SET NULL
);

CREATE TABLE span_events (
  id TEXT PRIMARY KEY,
  span_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT,
  FOREIGN KEY (span_id) REFERENCES spans(id) ON DELETE CASCADE
);
```

### API Usage Tables (v6)

```sql
CREATE TABLE api_usage_events (
  id TEXT PRIMARY KEY,
  conversation_id TEXT DEFAULT NULL,
  model TEXT NOT NULL,
  provider_id TEXT DEFAULT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE SET NULL
);
```

### Scheduled Tasks Tables (v7)

```sql
CREATE TABLE scheduled_tasks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  project_id TEXT,
  schedule_kind TEXT NOT NULL,
  schedule_at TEXT,
  schedule_every_ms INTEGER,
  schedule_cron_expr TEXT,
  schedule_tz TEXT,
  payload_message TEXT NOT NULL,
  payload_model TEXT,
  payload_auto_approve_edits INTEGER NOT NULL DEFAULT 0,
  payload_auto_approve_plan INTEGER NOT NULL DEFAULT 0,
  exec_max_concurrent_runs INTEGER NOT NULL DEFAULT 1,
  exec_catch_up INTEGER NOT NULL DEFAULT 0,
  exec_stagger_ms INTEGER NOT NULL DEFAULT -1,
  retry_max_attempts INTEGER NOT NULL DEFAULT 2,
  retry_backoff_ms TEXT NOT NULL DEFAULT '[30000,60000]',
  status TEXT NOT NULL DEFAULT 'enabled',
  next_run_at INTEGER,
  last_run_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  schedule_nl_text TEXT,
  notification_policy_json TEXT NOT NULL DEFAULT '{}',
  delivery_policy_json TEXT NOT NULL DEFAULT '{}',
  offline_policy_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE scheduled_task_runs (
  id TEXT PRIMARY KEY,
  scheduled_task_id TEXT NOT NULL,
  task_id TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  triggered_at INTEGER NOT NULL,
  completed_at INTEGER,
  error TEXT,
  attempt INTEGER NOT NULL DEFAULT 1,
  trigger_source TEXT NOT NULL DEFAULT 'schedule',
  scheduled_for_at INTEGER,
  payload_snapshot_json TEXT,
  project_id_snapshot TEXT,
  delivery_status TEXT,
  delivery_error TEXT,
  FOREIGN KEY (scheduled_task_id) REFERENCES scheduled_tasks(id) ON DELETE CASCADE
);
```

### Indexes (v8)

```sql
-- Projects indexes
CREATE UNIQUE INDEX idx_projects_root_path ON projects (root_path) WHERE root_path IS NOT NULL;

-- Conversations indexes
CREATE INDEX idx_conversations_project_id ON conversations (project_id);

-- Messages indexes
CREATE INDEX idx_messages_conversation_id ON messages (conversation_id);
CREATE INDEX idx_messages_timestamp ON messages (timestamp);

-- Message attachments indexes
CREATE INDEX idx_attachments_message_id ON message_attachments (message_id);

-- MCP servers indexes
CREATE INDEX idx_mcp_servers_is_enabled ON mcp_servers (is_enabled);
CREATE INDEX idx_mcp_servers_is_built_in ON mcp_servers (is_built_in);
CREATE INDEX idx_mcp_servers_protocol ON mcp_servers (protocol);

-- Todos indexes
CREATE INDEX idx_todos_conversation_id ON todos (conversation_id);
CREATE INDEX idx_todos_status ON todos (status);
CREATE INDEX idx_todos_created_at ON todos (created_at);

-- Agents indexes
CREATE INDEX idx_agents_is_hidden ON agents (is_hidden);

-- Skills indexes
CREATE INDEX idx_skills_category ON skills(category);
CREATE INDEX idx_skills_marketplace ON skills(marketplace_id);
CREATE INDEX idx_skills_tags ON skills(tags);
CREATE INDEX idx_skills_name ON skills(name);

-- Conversation skills indexes
CREATE INDEX idx_conversation_skills_conversation ON conversation_skills(conversation_id);
CREATE INDEX idx_conversation_skills_enabled ON conversation_skills(conversation_id, enabled);
CREATE INDEX idx_conversation_skills_priority ON conversation_skills(conversation_id, priority DESC);

-- Recent files indexes
CREATE INDEX idx_recent_files_repository ON recent_files(repository_path, opened_at DESC);

-- Tracing indexes
CREATE INDEX idx_spans_trace_id ON spans(trace_id);
CREATE INDEX idx_spans_parent_span_id ON spans(parent_span_id);
CREATE INDEX idx_span_events_span_id ON span_events(span_id);
CREATE INDEX idx_traces_started_at ON traces(started_at DESC);
CREATE INDEX idx_spans_started_at ON spans(started_at DESC);
CREATE INDEX idx_span_events_timestamp ON span_events(timestamp DESC);
CREATE INDEX idx_span_events_type ON span_events(event_type);

-- API usage events indexes
CREATE INDEX idx_api_usage_events_created_at ON api_usage_events(created_at);
CREATE INDEX idx_api_usage_events_model ON api_usage_events(model);
CREATE INDEX idx_api_usage_events_conversation ON api_usage_events(conversation_id);

-- Scheduled tasks indexes
CREATE INDEX idx_scheduled_tasks_status ON scheduled_tasks(status);
CREATE INDEX idx_scheduled_tasks_next_run ON scheduled_tasks(next_run_at);
CREATE INDEX idx_task_runs_job ON scheduled_task_runs(scheduled_task_id);
CREATE INDEX idx_task_runs_triggered ON scheduled_task_runs(triggered_at);
CREATE INDEX idx_task_runs_status ON scheduled_task_runs(status);
```

---

## 迁移系统

### 迁移注册表

位置: `src-tauri/core/src/storage/migrations/talkcody_db.rs`

```rust
pub fn talkcody_migrations() -> MigrationRegistry
```

### 迁移版本历史

| 版本 | 名称 | 说明 |
|-----|------|------|
| v1 | create_core_chat_tables | projects, conversations, messages, message_attachments |
| v2 | create_agent_tables | agents |
| v3 | create_skill_tables | skills, conversation_skills, active_skills |
| v4 | create_mcp_and_utility_tables | mcp_servers, todos, recent_files, recent_projects, settings |
| v5 | create_tracing_tables | traces, spans, span_events |
| v6 | create_api_usage_tables | api_usage_events |
| v7 | create_scheduled_tasks_tables | scheduled_tasks, scheduled_task_runs |
| v8 | create_indexes | 所有索引 |

### 迁移执行

**Desktop 模式**:
```rust
// desktop/src/lib.rs
let storage = Storage::new(app_data_dir, attachments_root).await?;
app.manage(storage);
```

**Server 模式**:
```rust
// server/src/state.rs
let storage = Storage::new(config.data_root, config.attachments_root).await?;
// Storage 保存在 ServerState 中
```

---

## 代码结构

### TypeScript 前端

| 文件 | 描述 |
|-----|------|
| `src/services/database-service.ts` | 主数据库服务 |
| `src/services/database/turso-client.ts` | Turso/libSQL 客户端 |
| `src/services/database/turso-schema.ts` | 表结构定义 |
| `src/services/database/turso-database-init.ts` | 初始化和迁移 |

### Rust 后端

| 文件 | 描述 |
|-----|------|
| `src-tauri/core/src/storage/mod.rs` | Storage 模块，管理 talkcody.db |
| `src-tauri/core/src/storage/migrations/talkcody_db.rs` | 统一迁移定义 |
| `src-tauri/core/src/storage/migrations/mod.rs` | 迁移框架 |
| `src-tauri/core/src/storage/chat_history.rs` | ChatHistoryRepository |
| `src-tauri/core/src/storage/agents.rs` | AgentsRepository |
| `src-tauri/core/src/storage/settings.rs` | SettingsRepository |
| `src-tauri/core/src/storage/attachments.rs` | AttachmentsRepository |

---

## 兼容性说明

### Desktop 端

✅ **TypeScript DatabaseService 继续正常工作**
- 现有数据完全保留
- Turso/libSQL 客户端直接访问 talkcody.db
- Rust Storage 模块使用相同的表结构

### Server 端

✅ **Telegram Bot 使用相同的表结构**
- 通过 Storage 模块访问 conversations/messages
- 与 Desktop 端 100% 兼容

---

## 废弃的数据库

以下数据库文件不再创建（历史遗留）：

| 数据库文件 | 状态 | 说明 |
|-----------|------|------|
| `chat_history.db` | ❌ 废弃 | 功能合并到 talkcody.db |
| `agents.db` | ❌ 废弃 | 功能合并到 talkcody.db |
| `settings.db` | ❌ 废弃 | 功能合并到 talkcody.db |

---

## 最后更新

*更新时间: 2026-03-26*
*状态: ✅ 重构完成*
