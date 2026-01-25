# TalkCody 数据库设计问题分析

> 文档版本: 1.0
> 分析日期: 2025-11-08
> 严重程度: 🔴 高 | 🟡 中 | 🟢 低

## 目录
- [问题总览](#问题总览)
- [1. 架构设计问题](#1-架构设计问题)
- [2. 数据建模问题](#2-数据建模问题)
- [3. 性能问题](#3-性能问题)
- [4. 数据一致性问题](#4-数据一致性问题)
- [5. 扩展性问题](#5-扩展性问题)
- [6. 安全性问题](#6-安全性问题)
- [改进优先级路线图](#改进优先级路线图)

---

## 问题总览

| 类别 | 问题数 | 严重程度 |
|------|--------|----------|
| 架构设计 | 5 | 🟡 中 |
| 数据建模 | 8 | 🔴 高 |
| 性能问题 | 6 | 🟡 中 |
| 数据一致性 | 4 | 🔴 高 |
| 扩展性 | 5 | 🟡 中 |
| 安全性 | 3 | 🟢 低 |

**总计**: 31个问题

---

## 1. 架构设计问题

### 🟡 问题 1.1: 多数据库分散管理

**当前状况**:
- 使用3个独立的SQLite数据库文件
- 分散管理增加了复杂性
- 跨数据库查询需要多次操作

```typescript
// 当前实现
const chatHistoryDB = await Database.load('sqlite:chat_history.db');
const agentsDB = await Database.load('sqlite:agents.db');
const settingsDB = await Database.load('sqlite:settings.db');
```

**问题**:
1. ❌ 无法使用SQL JOIN跨数据库查询
2. ❌ 事务无法跨数据库保证ACID
3. ❌ 备份需要分别处理3个文件
4. ❌ 数据迁移复杂度增加

**影响范围**: 整个应用架构

**建议方案**:

**方案A: 合并为单一数据库** (推荐)
```sql
-- 合并后的单一数据库: talkcody.db
-- 包含所有表：projects, conversations, messages, agents, skills, settings
```

**优点**:
- ✅ 支持跨表JOIN查询
- ✅ 统一的事务管理
- ✅ 简化备份和迁移
- ✅ 减少数据库连接开销

**缺点**:
- ⚠️ 需要数据迁移脚本
- ⚠️ 单文件损坏影响所有数据

**方案B: 保持分离但添加外键支持**
```typescript
// 使用 ATTACH DATABASE 在需要时关联
await db.execute("ATTACH DATABASE 'agents.db' AS agents_db");
await db.execute("SELECT * FROM conversations JOIN agents_db.agents ...");
```

**优先级**: 🟡 中优先级（重构项目）

---

### 🟡 问题 1.2: 缺少统一的ID生成策略

**当前状况**:
- 使用TEXT类型存储ID
- ID生成分散在多处
- 没有明确的生成规则

**问题示例**:
```typescript
// 不同的ID生成方式
const conversationId = generateId();           // 随机字符串
const projectId = 'default';                   // 硬编码字符串
const agentId = 'coding';                      // 硬编码字符串
const marketplaceId = uuid();                  // UUID (仅远程)
```

**问题**:
1. ❌ ID格式不统一（字符串 vs UUID）
2. ❌ 可能产生冲突（随机生成）
3. ❌ 难以调试（无序、无意义）
4. ❌ 无法区分ID来源

**影响**: 数据完整性、调试效率

**建议方案**:

**方案A: 统一使用ULID**
```typescript
// ULID = 时间戳 + 随机数
// 优点：排序、唯一、URL安全
import { ulid } from 'ulid';

const conversationId = ulid(); // 01HKDXYZ1234ABCDEFGHIJKLMN
```

**方案B: 使用前缀+UUID**
```typescript
// 带类型前缀的ID
const conversationId = `conv_${nanoid()}`;  // conv_V1StGXR8_Z5jdHi6B
const projectId = `proj_${nanoid()}`;       // proj_3BqkL9m4_K8nPdRs2
const agentId = `agent_${nanoid()}`;        // agent_7YzNx2Q1_M5vCjWe4
```

**优点**:
- ✅ 一眼识别资源类型
- ✅ URL安全
- ✅ 全局唯一

**优先级**: 🟡 中优先级

---

### 🟢 问题 1.4: 缺少数据库版本管理

**当前状况**:
- 没有明确的schema版本号
- 升级逻辑散落在代码中
- 难以追踪数据库状态

**建议方案**:

**添加schema_version表**:
```sql
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  description TEXT NOT NULL,
  applied_at INTEGER NOT NULL,
  checksum TEXT  -- 用于验证迁移完整性
);

INSERT INTO schema_version VALUES
  (1, 'Initial schema', 1699000000000, 'abc123'),
  (2, 'Add skills tables', 1699100000000, 'def456'),
  (3, 'Add marketplace fields', 1699200000000, 'ghi789');
```

**迁移框架**:
```typescript
interface Migration {
  version: number;
  description: string;
  up: (db: Database) => Promise<void>;
  down: (db: Database) => Promise<void>;
}

const migrations: Migration[] = [
  {
    version: 4,
    description: 'Add soft delete fields',
    up: async (db) => {
      await db.execute('ALTER TABLE conversations ADD COLUMN is_deleted BOOLEAN DEFAULT 0');
    },
    down: async (db) => {
      await db.execute('ALTER TABLE conversations DROP COLUMN is_deleted');
    }
  }
];
```

**优先级**: 🟢 低优先级（工程化改进）

---

### 🟡 问题 1.5: 本地与云端数据模型不一致

**当前状况**:
- 本地使用TEXT ID，云端使用UUID
- 本地INTEGER时间戳，云端TIMESTAMP
- 字段名称不一致

**问题示例**:
```sql
-- 本地 SQLite
CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  marketplace_id TEXT  -- 映射到云端ID
);

-- 云端 PostgreSQL
CREATE TABLE marketplace_agents (
  id uuid PRIMARY KEY,
  created_at timestamp DEFAULT now() NOT NULL,
  slug varchar(100) NOT NULL  -- 云端使用slug
);
```

**影响**:
1. ❌ 同步时需要复杂的转换逻辑
2. ❌ 容易产生映射错误
3. ❌ 增加维护成本

**建议**: 统一数据模型，使用adapter模式处理差异

**优先级**: 🟡 中优先级

---

## 2. 数据建模问题

### 🔴 问题 2.1: `agents` 表职责过重

**当前状况**:
- `agents` 表有30+个字段
- 混合了配置、市场、统计等多种职责

**字段分组**:
```sql
-- 核心配置 (10字段)
id, name, description, model, system_prompt, tools_config, rules, output_format, ...

-- 状态管理 (3字段)
is_hidden, is_default, is_enabled

-- 动态提示词 (4字段)
dynamic_enabled, dynamic_providers, dynamic_variables, dynamic_provider_settings

-- 市场集成 (10字段)
source_type, marketplace_id, marketplace_version, forked_from_id, ...

-- 展示信息 (5字段)
icon_url, author_name, author_id, categories, tags

-- 统计 (2字段)
usage_count, last_synced_at

-- 技能 (1字段)
default_skills
```

**问题**:
1. ❌ 违反单一职责原则
2. ❌ 查询效率低（大量无用字段）
3. ❌ 难以维护和扩展

**建议方案**: **表拆分**

```sql
-- 核心配置表
CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  model TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  is_enabled BOOLEAN DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 代理配置表
CREATE TABLE agent_configs (
  agent_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  tools_config TEXT DEFAULT '{}',
  rules TEXT DEFAULT '',
  output_format TEXT DEFAULT '',
  dynamic_enabled BOOLEAN DEFAULT 0,
  dynamic_providers TEXT DEFAULT '[]',
  dynamic_variables TEXT DEFAULT '{}',
  dynamic_provider_settings TEXT DEFAULT '{}'
);

-- 市场元数据表
CREATE TABLE agent_marketplace_meta (
  agent_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  marketplace_id TEXT UNIQUE,
  marketplace_version TEXT,
  source_type TEXT DEFAULT 'local',
  forked_from_id TEXT,
  forked_from_marketplace_id TEXT,
  is_shared BOOLEAN DEFAULT 0,
  last_synced_at INTEGER
);

-- 展示信息表
CREATE TABLE agent_display_info (
  agent_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  icon_url TEXT,
  author_name TEXT,
  author_id TEXT,
  categories TEXT DEFAULT '[]',
  tags TEXT DEFAULT '[]'
);

-- 统计表
CREATE TABLE agent_stats_local (
  agent_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  usage_count INTEGER DEFAULT 0,
  last_used_at INTEGER,
  total_messages INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0
);
```

**优点**:
- ✅ 清晰的职责划分
- ✅ 按需加载（性能优化）
- ✅ 易于扩展新功能
- ✅ 减少NULL字段

**优先级**: 🔴 高优先级（重构）

---

### 🔴 问题 2.2: `conversations` 表混合业务和统计数据

**当前问题**:
```sql
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  project_id TEXT NOT NULL,
  -- 业务字段
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  message_count INTEGER DEFAULT 0,
  -- 统计字段（应该分离）
  cost REAL DEFAULT 0,
  input_token INTEGER DEFAULT 0,
  output_token INTEGER DEFAULT 0
);
```

**问题**:
1. ❌ 统计数据污染核心表
2. ❌ 每次更新统计都要修改主表
3. ❌ 无法记录历史统计

**建议方案**: **分离统计表**

```sql
-- 核心表（只包含业务字段）
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  project_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  settings TEXT DEFAULT NULL,
  FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);

-- 统计表
CREATE TABLE conversation_stats (
  conversation_id TEXT PRIMARY KEY,
  message_count INTEGER DEFAULT 0,
  total_cost REAL DEFAULT 0,
  total_input_tokens INTEGER DEFAULT 0,
  total_output_tokens INTEGER DEFAULT 0,
  last_activity_at INTEGER,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

-- 详细使用记录表（可选，用于历史分析）
CREATE TABLE conversation_usage_logs (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  cost REAL NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  model TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE INDEX idx_usage_logs_conversation ON conversation_usage_logs(conversation_id);
CREATE INDEX idx_usage_logs_timestamp ON conversation_usage_logs(timestamp);
```

**优点**:
- ✅ 分离业务和统计逻辑
- ✅ 支持详细的历史记录
- ✅ 更好的查询性能
- ✅ 便于生成报表

**优先级**: 🔴 高优先级

---

### 🟡 问题 2.3: `messages` 表缺少树形结构支持

**当前问题**:
```sql
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  position_index INTEGER DEFAULT 0,  -- 仅支持简单分支
  -- 缺少 parent_id！
);
```

**问题**:
1. ❌ `position_index` 难以表达复杂的分支对话
2. ❌ 无法构建完整的对话树
3. ❌ 难以实现"编辑历史消息并创建新分支"功能

**建议方案**: **添加树形结构字段**

```sql
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp INTEGER NOT NULL,

  -- 树形结构
  parent_id TEXT DEFAULT NULL,        -- 父消息ID (NULL表示根消息)
  branch_name TEXT DEFAULT 'main',    -- 分支名称
  depth INTEGER DEFAULT 0,            -- 深度（根消息为0）
  order_index INTEGER DEFAULT 0,      -- 同级排序

  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES messages(id) ON DELETE CASCADE
);

CREATE INDEX idx_messages_parent ON messages(parent_id);
CREATE INDEX idx_messages_branch ON messages(conversation_id, branch_name);
```

**使用示例**:
```typescript
// 获取某个分支的消息链
async getMessageChain(messageId: string): Promise<Message[]> {
  // 递归查询父消息
  const query = `
    WITH RECURSIVE message_chain AS (
      SELECT * FROM messages WHERE id = $1
      UNION ALL
      SELECT m.* FROM messages m
      INNER JOIN message_chain mc ON m.id = mc.parent_id
    )
    SELECT * FROM message_chain ORDER BY depth ASC
  `;
  return await db.select(query, [messageId]);
}

// 创建分支
async createBranch(parentMessageId: string, branchName: string): Promise<void> {
  await db.execute(`
    INSERT INTO messages (id, conversation_id, role, content, parent_id, branch_name, depth)
    SELECT $1, conversation_id, 'user', $2, $3, $4, depth + 1
    FROM messages WHERE id = $3
  `, [newId, content, parentMessageId, branchName]);
}
```

**优先级**: 🟡 中优先级

---

### 🟡 问题 2.4: JSON字段缺少Schema验证

**当前问题**:
```sql
-- 大量JSON字段但没有验证
CREATE TABLE agents (
  tools_config TEXT DEFAULT '{}',           -- 任意JSON
  dynamic_variables TEXT DEFAULT '{}',      -- 任意JSON
  dynamic_provider_settings TEXT DEFAULT '{}'  -- 任意JSON
);

CREATE TABLE conversations (
  settings TEXT DEFAULT NULL  -- 任意JSON
);
```

**问题**:
1. ❌ 无法保证JSON格式正确
2. ❌ 可能存储无效数据
3. ❌ 缺少类型安全

**建议方案**: **添加Application层验证**

```typescript
// 使用 Zod 定义 Schema
import { z } from 'zod';

const ToolsConfigSchema = z.object({
  enabled_tools: z.array(z.string()),
  tool_settings: z.record(z.string(), z.any())
});

const ConversationSettingsSchema = z.object({
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().positive().optional(),
  custom_instructions: z.string().optional()
});

// 保存前验证
async function saveAgent(agent: Agent) {
  // 验证 JSON 字段
  const toolsConfig = ToolsConfigSchema.parse(JSON.parse(agent.tools_config));

  // 保存
  await db.execute('INSERT INTO agents (...) VALUES (...)', [...]);
}

// 读取时验证
async function getAgent(id: string): Promise<Agent> {
  const row = await db.select('SELECT * FROM agents WHERE id = $1', [id]);

  // 验证并解析
  const agent = {
    ...row[0],
    tools_config: ToolsConfigSchema.parse(JSON.parse(row[0].tools_config))
  };

  return agent;
}
```

**PostgreSQL方案** (远程数据库已使用):
```sql
-- 使用 jsonb 类型并添加约束
CREATE TABLE marketplace_agents (
  tools_config jsonb DEFAULT '{}'::jsonb NOT NULL,

  -- 添加CHECK约束
  CONSTRAINT valid_tools_config CHECK (
    jsonb_typeof(tools_config) = 'object' AND
    tools_config ? 'enabled_tools'
  )
);
```

**优先级**: 🟡 中优先级

---

### 🟢 问题 2.5: `skills` 表缺少版本管理

**当前问题**:
```sql
CREATE TABLE skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  system_prompt_fragment TEXT,
  -- 没有version字段！
  marketplace_version TEXT  -- 仅存储市场版本号
);
```

**问题**:
1. ❌ 本地修改技能后无法追踪版本
2. ❌ 无法回退到历史版本
3. ❌ 同步时无法判断哪个版本更新

**建议方案**: **添加版本字段**

```sql
ALTER TABLE skills ADD COLUMN version TEXT DEFAULT '1.0.0';
ALTER TABLE skills ADD COLUMN version_code INTEGER DEFAULT 1;

-- 创建版本历史表
CREATE TABLE skill_version_history (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL,
  version TEXT NOT NULL,
  version_code INTEGER NOT NULL,
  system_prompt_fragment TEXT,
  workflow_rules TEXT,
  documentation TEXT,
  created_at INTEGER NOT NULL,
  change_log TEXT,

  FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE,
  UNIQUE(skill_id, version_code)
);

CREATE INDEX idx_skill_versions ON skill_version_history(skill_id, version_code DESC);
```

**使用**:
```typescript
// 保存新版本
async function updateSkill(skillId: string, changes: Partial<Skill>) {
  // 1. 获取当前版本
  const current = await getSkill(skillId);

  // 2. 保存到历史表
  await db.execute(`
    INSERT INTO skill_version_history
    SELECT * FROM skills WHERE id = $1
  `, [skillId]);

  // 3. 更新主表并增加版本号
  await db.execute(`
    UPDATE skills
    SET version_code = version_code + 1,
        version = $1,
        updated_at = $2,
        ...
    WHERE id = $3
  `, [newVersion, Date.now(), skillId]);
}

// 回退版本
async function rollbackSkill(skillId: string, versionCode: number) {
  const history = await db.select(
    'SELECT * FROM skill_version_history WHERE skill_id = $1 AND version_code = $2',
    [skillId, versionCode]
  );

  await db.execute('UPDATE skills SET ... WHERE id = $1', [skillId]);
}
```

**优先级**: 🟢 低优先级

---

### 🟡 问题 2.6: `active_skills` 与 `conversation_skills` 功能重叠

**当前问题**:
```sql
-- 全局激活技能
CREATE TABLE active_skills (
  skill_id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

-- 会话级别技能
CREATE TABLE conversation_skills (
  conversation_id TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  priority INTEGER DEFAULT 0,
  activated_at INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, skill_id)
);
```

**问题**:
1. ❌ 逻辑不清晰：全局技能 vs 会话技能
2. ❌ 可能产生冲突（全局禁用但会话启用？）
3. ❌ 难以理解优先级

**建议方案**: **统一技能管理**

```sql
-- 删除 active_skills 表
DROP TABLE active_skills;

-- 扩展 conversation_skills 表
CREATE TABLE conversation_skills (
  conversation_id TEXT NOT NULL,    -- NULL 表示全局
  skill_id TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  priority INTEGER DEFAULT 0,
  scope TEXT DEFAULT 'conversation', -- 'global' | 'conversation'
  activated_at INTEGER NOT NULL,

  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE,

  PRIMARY KEY (conversation_id, skill_id)
);

-- 或者使用单独的全局设置表
CREATE TABLE global_skills (
  skill_id TEXT PRIMARY KEY,
  enabled INTEGER DEFAULT 1,
  priority INTEGER DEFAULT 0,
  activated_at INTEGER NOT NULL,
  FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
);

CREATE TABLE conversation_skills (
  conversation_id TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  priority INTEGER DEFAULT 0,
  override_global BOOLEAN DEFAULT 0,  -- 是否覆盖全局设置
  activated_at INTEGER NOT NULL,

  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE,

  PRIMARY KEY (conversation_id, skill_id)
);
```

**逻辑**:
```typescript
// 获取会话生效的技能
async function getEffectiveSkills(conversationId: string): Promise<Skill[]> {
  // 1. 获取全局技能
  const global = await db.select('SELECT * FROM global_skills WHERE enabled = 1');

  // 2. 获取会话技能
  const conversation = await db.select(
    'SELECT * FROM conversation_skills WHERE conversation_id = $1',
    [conversationId]
  );

  // 3. 合并并处理覆盖
  const merged = mergeSkills(global, conversation);

  return merged;
}
```

**优先级**: 🟡 中优先级

---

### 🟢 问题 2.7: `mcp_servers` 缺少健康检查字段

**建议添加**:
```sql
ALTER TABLE mcp_servers ADD COLUMN last_health_check INTEGER;
ALTER TABLE mcp_servers ADD COLUMN health_status TEXT CHECK (health_status IN ('healthy', 'unhealthy', 'unknown'));
ALTER TABLE mcp_servers ADD COLUMN error_message TEXT;
ALTER TABLE mcp_servers ADD COLUMN retry_count INTEGER DEFAULT 0;
```

**优先级**: 🟢 低优先级

---

### 🟢 问题 2.8: 缺少审计日志表

**建议添加**:
```sql
CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  table_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  action TEXT NOT NULL,  -- 'create', 'update', 'delete'
  old_value TEXT,        -- JSON
  new_value TEXT,        -- JSON
  user_id TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_audit_table ON audit_logs(table_name, record_id);
CREATE INDEX idx_audit_time ON audit_logs(created_at);
```

**优先级**: 🟢 低优先级

---

## 3. 性能问题

### 🟡 问题 3.1: 缺少全文搜索索引

**当前问题**:
```sql
-- messages.content 没有全文索引
CREATE TABLE messages (
  content TEXT NOT NULL
  -- 搜索需要 LIKE '%keyword%' 全表扫描
);
```

**影响**: 搜索消息内容速度慢

**建议方案**: **添加FTS5全文索引**

```sql
-- 创建FTS5虚拟表
CREATE VIRTUAL TABLE messages_fts USING fts5(
  message_id,
  content,
  tokenize='porter unicode61'
);

-- 触发器保持同步
CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(message_id, content) VALUES (new.id, new.content);
END;

CREATE TRIGGER messages_au AFTER UPDATE ON messages BEGIN
  UPDATE messages_fts SET content = new.content WHERE message_id = old.id;
END;

CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
  DELETE FROM messages_fts WHERE message_id = old.id;
END;
```

**使用**:
```typescript
// 全文搜索
async function searchMessages(keyword: string): Promise<Message[]> {
  const results = await db.select(`
    SELECT m.* FROM messages m
    JOIN messages_fts fts ON m.id = fts.message_id
    WHERE messages_fts MATCH $1
    ORDER BY rank
  `, [keyword]);

  return results;
}
```

**优先级**: 🟡 中优先级（用户体验）

---

### 🟡 问题 3.2: `conversations.updated_at` 缺少索引

**当前问题**:
```sql
-- 没有updated_at索引
CREATE TABLE conversations (
  updated_at INTEGER NOT NULL
);

-- 但频繁按updated_at排序
SELECT * FROM conversations ORDER BY updated_at DESC;
```

**影响**: 列表排序性能差

**建议**:
```sql
CREATE INDEX idx_conversations_updated_at ON conversations(updated_at DESC);

-- 复合索引（更优）
CREATE INDEX idx_conversations_project_updated
ON conversations(project_id, updated_at DESC);
```

**优先级**: 🟡 中优先级

---

### 🟡 问题 3.3: 大字段存储在主表

**当前问题**:
```sql
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,  -- 可能很大（代码、长文本）
  -- 查询列表时也会加载大字段
);
```

**影响**:
- 查询消息列表时浪费内存
- 影响分页性能

**建议方案**: **字段分离**

```sql
-- 核心表（只包含元数据）
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content_summary TEXT,      -- 前100字摘要
  content_hash TEXT,         -- 内容hash用于去重
  timestamp INTEGER NOT NULL,
  assistant_id TEXT,
  parent_id TEXT,

  -- 大字段标记
  has_large_content BOOLEAN DEFAULT 0,
  content_length INTEGER DEFAULT 0,

  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

-- 内容表（按需加载）
CREATE TABLE message_contents (
  message_id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  compressed BOOLEAN DEFAULT 0,  -- 是否压缩

  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);
```

**使用**:
```typescript
// 列表查询（轻量）
const messages = await db.select(`
  SELECT id, role, content_summary, timestamp
  FROM messages
  WHERE conversation_id = $1
`, [conversationId]);

// 详情查询（按需加载）
const content = await db.select(`
  SELECT content FROM message_contents
  WHERE message_id = $1
`, [messageId]);
```

**优先级**: 🟢 低优先级（仅当内容很大时）

---

### 🟡 问题 3.4: 缺少查询性能监控

**建议添加**:
```sql
-- 查询性能日志表
CREATE TABLE query_performance_logs (
  id TEXT PRIMARY KEY,
  query_type TEXT NOT NULL,
  query_sql TEXT,
  execution_time INTEGER NOT NULL,  -- 毫秒
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_query_perf_type ON query_performance_logs(query_type);
CREATE INDEX idx_query_perf_time ON query_performance_logs(execution_time DESC);
```

```typescript
// 装饰器
function logQueryPerformance(queryType: string) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const original = descriptor.value;
    descriptor.value = async function (...args: any[]) {
      const start = Date.now();
      const result = await original.apply(this, args);
      const executionTime = Date.now() - start;

      if (executionTime > 100) { // 只记录慢查询
        await logQuery(queryType, executionTime);
      }

      return result;
    };
    return descriptor;
  };
}

// 使用
@logQueryPerformance('getConversations')
async getConversations(projectId: string) {
  // ...
}
```

**优先级**: 🟢 低优先级

---

### 🟡 问题 3.5: 未使用连接池

**当前实现**:
```typescript
// 每次都创建新连接
const db = await Database.load('sqlite:chat_history.db');
```

**建议**: 使用单例模式或连接池

**优先级**: 🟢 低优先级（SQLite单连接）

---

### 🟡 问题 3.6: 大量小文件（attachments）

**当前问题**:
- 每个附件单独存储为文件
- 可能产生大量小文件（性能问题）

**建议**:
- 小文件（<1MB）直接存储在数据库（BLOB）
- 大文件存储到对象存储（S3/云存储）

**优先级**: 🟢 低优先级

---

## 4. 数据一致性问题

### 🔴 问题 4.1: 缺少外键约束验证

**当前问题**:
```typescript
// 代码中没有验证外键存在性
await db.execute(
  'INSERT INTO conversations (id, project_id, ...) VALUES (...)',
  [id, 'non-existent-project', ...]  // 可能引用不存在的项目
);
```

**影响**: 可能产生孤儿记录

**建议**:
1. 数据库层已有外键约束（已实现）
2. Application层添加额外验证

```typescript
async function createConversation(title: string, projectId: string) {
  // 验证项目存在
  const project = await db.select('SELECT id FROM projects WHERE id = $1', [projectId]);
  if (!project.length) {
    throw new Error(`Project ${projectId} does not exist`);
  }

  // 创建会话
  await db.execute('INSERT INTO conversations ...', [...]);
}
```

**优先级**: 🟡 中优先级

---

### 🔴 问题 4.2: 并发更新无锁机制

**当前问题**:
```typescript
// 多设备同时更新会话
// Device A
await db.execute('UPDATE conversations SET title = $1 WHERE id = $2', ['Title A', id]);

// Device B (同时)
await db.execute('UPDATE conversations SET title = $1 WHERE id = $2', ['Title B', id]);

// 最后写入覆盖，无冲突检测
```

**影响**: 数据丢失、覆盖

**建议方案**: **乐观锁**

```sql
-- 添加版本字段
ALTER TABLE conversations ADD COLUMN version INTEGER DEFAULT 0;
ALTER TABLE messages ADD COLUMN version INTEGER DEFAULT 0;
ALTER TABLE agents ADD COLUMN version INTEGER DEFAULT 0;
```

```typescript
// 更新时检查版本
async function updateConversation(id: string, updates: Partial<Conversation>, expectedVersion: number) {
  const result = await db.execute(`
    UPDATE conversations
    SET title = $1,
        version = version + 1,
        updated_at = $2
    WHERE id = $3 AND version = $4
  `, [updates.title, Date.now(), id, expectedVersion]);

  if (result.rowsAffected === 0) {
    // 版本冲突
    throw new Error('Conflict: Data has been modified by another process');
  }
}
```

**优先级**: 🔴 高优先级（多设备同步必需）

---

### 🟡 问题 4.3: 缺少唯一性约束

**当前问题**:
```sql
-- agents表没有name的唯一约束
CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
  -- 允许重复name
);
```

**影响**: 可能创建同名代理

**建议**: 根据业务需求添加唯一约束

```sql
-- 如果需要唯一名称
CREATE UNIQUE INDEX idx_agents_name_unique ON agents(name) WHERE is_deleted = 0;

-- 或者同一作者下唯一
CREATE UNIQUE INDEX idx_agents_author_name ON agents(author_id, name) WHERE is_deleted = 0;
```

**优先级**: 🟡 中优先级

---

### 🟢 问题 4.4: 缺少数据校验触发器

**建议添加**:
```sql
-- 验证JSON格式
CREATE TRIGGER validate_tools_config BEFORE INSERT ON agents
BEGIN
  SELECT CASE
    WHEN json_valid(NEW.tools_config) = 0 THEN
      RAISE(ABORT, 'Invalid JSON in tools_config')
  END;
END;

-- 验证邮箱格式
CREATE TRIGGER validate_email BEFORE INSERT ON users
BEGIN
  SELECT CASE
    WHEN NEW.email NOT LIKE '%@%.%' THEN
      RAISE(ABORT, 'Invalid email format')
  END;
END;
```

**优先级**: 🟢 低优先级

---

## 5. 扩展性问题

### 🟡 问题 5.1: 无法支持多租户

**当前架构**: 单用户本地数据库

**未来需求**:
- 团队协作
- 企业版多用户

**建议**: 预留user_id字段

```sql
ALTER TABLE conversations ADD COLUMN user_id TEXT;
ALTER TABLE messages ADD COLUMN user_id TEXT;
ALTER TABLE projects ADD COLUMN user_id TEXT;
ALTER TABLE agents ADD COLUMN user_id TEXT;

-- 复合索引
CREATE INDEX idx_conversations_user ON conversations(user_id, updated_at DESC);
```

**优先级**: 🟡 中优先级

---

### 🟡 问题 5.2: 国际化支持不足

**当前问题**:
- 所有文本字段都是单语言
- 无法支持多语言UI

**建议方案**: **添加i18n表**

```sql
CREATE TABLE i18n_texts (
  resource_type TEXT NOT NULL,  -- 'agent', 'skill', 'category'
  resource_id TEXT NOT NULL,
  field_name TEXT NOT NULL,     -- 'name', 'description'
  language TEXT NOT NULL,       -- 'en', 'zh', 'ja'
  value TEXT NOT NULL,
  created_at INTEGER NOT NULL,

  PRIMARY KEY (resource_type, resource_id, field_name, language)
);

CREATE INDEX idx_i18n_resource ON i18n_texts(resource_type, resource_id);
```

**使用**:
```typescript
// 获取本地化名称
async function getLocalizedName(agentId: string, language: string): Promise<string> {
  const result = await db.select(`
    SELECT value FROM i18n_texts
    WHERE resource_type = 'agent'
      AND resource_id = $1
      AND field_name = 'name'
      AND language = $2
  `, [agentId, language]);

  if (result.length > 0) {
    return result[0].value;
  }

  // 降级到默认语言
  const agent = await db.select('SELECT name FROM agents WHERE id = $1', [agentId]);
  return agent[0].name;
}
```

**优先级**: 🟢 低优先级

---

### 🟡 问题 5.3: 附件存储路径硬编码

**当前问题**:
```sql
CREATE TABLE message_attachments (
  file_path TEXT NOT NULL  -- 本地绝对路径
);
```

**问题**:
- 不同平台路径格式不同
- 迁移设备后路径失效

**建议方案**: **相对路径 + 配置**

```sql
-- 存储相对路径
CREATE TABLE message_attachments (
  file_path TEXT NOT NULL,  -- 相对路径: 'attachments/2023/11/file.pdf'
  storage_type TEXT DEFAULT 'local',  -- 'local', 's3', 'cloudflare_r2'
  storage_config TEXT  -- JSON配置
);

-- 全局配置表
CREATE TABLE storage_config (
  storage_type TEXT PRIMARY KEY,
  base_path TEXT,
  config TEXT  -- JSON配置
);
```

```typescript
// 解析完整路径
function resolveAttachmentPath(attachment: Attachment): string {
  const config = getStorageConfig(attachment.storage_type);

  if (attachment.storage_type === 'local') {
    return join(config.base_path, attachment.file_path);
  } else if (attachment.storage_type === 's3') {
    return `https://${config.bucket}.s3.amazonaws.com/${attachment.file_path}`;
  }

  // ...
}
```

**优先级**: 🟡 中优先级

---

### 🟢 问题 5.4: 缺少插件系统支持

**建议**: 预留扩展字段

```sql
ALTER TABLE agents ADD COLUMN extensions TEXT DEFAULT '{}';  -- JSON: 插件配置
ALTER TABLE skills ADD COLUMN metadata TEXT DEFAULT '{}';    -- JSON: 元数据
```

**优先级**: 🟢 低优先级

---

### 🟢 问题 5.5: 缺少feature flags表

**建议添加**:
```sql
CREATE TABLE feature_flags (
  flag_name TEXT PRIMARY KEY,
  is_enabled BOOLEAN DEFAULT 0,
  rollout_percentage INTEGER DEFAULT 0,  -- 0-100
  config TEXT DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

**优先级**: 🟢 低优先级

---

## 6. 安全性问题

### 🟢 问题 6.1: API密钥明文存储

**当前问题**:
```sql
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL  -- API key 明文存储
);

CREATE TABLE mcp_servers (
  api_key TEXT DEFAULT NULL  -- 明文
);
```

**建议**: 加密存储

```typescript
import { invoke } from '@tauri-apps/api/core';

// 使用Tauri的安全存储
async function saveApiKey(provider: string, apiKey: string) {
  await invoke('save_secret', {
    key: `api_key_${provider}`,
    value: apiKey
  });
}

async function getApiKey(provider: string): Promise<string> {
  return await invoke('get_secret', {
    key: `api_key_${provider}`
  });
}
```

**Rust后端** (Tauri):
```rust
// 使用系统密钥链
use keyring::Entry;

#[tauri::command]
fn save_secret(key: String, value: String) -> Result<(), String> {
    let entry = Entry::new("talkcody", &key)
        .map_err(|e| e.to_string())?;
    entry.set_password(&value)
        .map_err(|e| e.to_string())?;
    Ok(())
}
```

**优先级**: 🟡 中优先级（安全性）

---

### 🟢 问题 6.2: 缺少SQL注入防护检查

**当前状况**: 代码中使用参数化查询（已安全）

**建议**: 添加Linter规则，禁止字符串拼接SQL

```typescript
// ❌ 不允许
const sql = `SELECT * FROM users WHERE id = ${userId}`;

// ✅ 必须使用参数化
const sql = 'SELECT * FROM users WHERE id = $1';
await db.select(sql, [userId]);
```

**优先级**: 🟢 低优先级（代码审查）

---

### 🟢 问题 6.3: 缺少访问控制

**建议**:
- 添加权限表
- 实现RBAC（基于角色的访问控制）

```sql
CREATE TABLE roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  permissions TEXT NOT NULL  -- JSON array
);

CREATE TABLE user_roles (
  user_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  PRIMARY KEY (user_id, role_id)
);
```

**优先级**: 🟢 低优先级（企业版功能）

---

## 改进优先级路线图

### Phase 1: 紧急修复 (🔴 高优先级)

**时间**: 1-2周

1. ✅ 修复`mode_count`字段bug（已完成）
2. **添加软删除机制**
   - 影响表: conversations, messages, projects, agents
   - 工作量: 3天
3. **拆分agents表**
   - 分离为5个子表
   - 工作量: 5天
4. **添加乐观锁（version字段）**
   - 所有核心表添加version
   - 工作量: 2天
5. **分离conversation统计数据**
   - 创建conversation_stats表
   - 工作量: 2天

**总工作量**: 约12天

---

### Phase 2: 性能优化 (🟡 中优先级)

**时间**: 2-3周

1. **添加全文搜索索引**
   - 消息内容FTS5索引
   - 工作量: 3天
2. **优化索引策略**
   - 添加复合索引
   - 分析慢查询
   - 工作量: 3天
3. **统一ID生成策略**
   - 迁移到ULID
   - 工作量: 5天
4. **完善messages树形结构**
   - 添加parent_id
   - 实现分支功能
   - 工作量: 5天
5. **JSON Schema验证**
   - 添加Zod验证
   - 工作量: 3天

**总工作量**: 约19天

---

### Phase 3: 架构改进 (🟡 中优先级)

**时间**: 3-4周

1. **数据库合并**
   - 3个SQLite → 1个
   - 数据迁移脚本
   - 工作量: 7天
2. **添加schema版本管理**
   - 迁移框架
   - 工作量: 5天
3. **统一本地和云端数据模型**
   - Adapter模式
   - 工作量: 5天
4. **优化附件存储**
   - 相对路径
   - 多存储后端支持
   - 工作量: 4天
5. **重构技能管理**
   - 统一active_skills逻辑
   - 工作量: 3天

**总工作量**: 约24天

---

### Phase 4: 功能增强 (🟢 低优先级)

**时间**: 按需实施

1. **添加审计日志**
2. **国际化支持**
3. **插件系统**
4. **Feature Flags**
5. **性能监控**
6. **API密钥加密**
7. **多租户支持**

---

## 总结

### 关键统计

- **总问题数**: 31个
- **高优先级**: 7个 (🔴)
- **中优先级**: 15个 (🟡)
- **低优先级**: 9个 (🟢)

### 最紧迫的问题 (Top 5)

1. 🔴 **添加软删除机制** - 用户体验关键
2. 🔴 **拆分agents表** - 可维护性
3. 🔴 **添加乐观锁** - 多设备同步必需
4. 🔴 **分离统计数据** - 性能和逻辑清晰
5. 🟡 **全文搜索索引** - 用户体验

### 预计总工作量

- Phase 1 (紧急): 12天
- Phase 2 (性能): 19天
- Phase 3 (架构): 24天
- Phase 4 (增强): 按需

**总计**: 约55天（2.5个月全职开发）

---

**文档结束**
