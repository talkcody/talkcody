//! Unified TalkCody Database Migrations
//!
//! This module provides migrations for the unified talkcody.db database
//! that is shared between Desktop (TypeScript) and Server (Rust) modes.
//!
//! Table schema is based on src/services/database/turso-schema.ts

use super::{Migration, MigrationRegistry};

/// Create migration registry for talkcody.db
/// This includes all tables used by both TypeScript and Rust code
pub fn talkcody_migrations() -> MigrationRegistry {
    let mut registry = MigrationRegistry::new("talkcody");

    // Migration 1: Core chat tables (projects, conversations, messages, attachments)
    registry.register(Migration {
        version: 1,
        name: "create_core_chat_tables",
        up_sql: r#"
            -- Projects table
            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT DEFAULT '',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                context TEXT DEFAULT '',
                rules TEXT DEFAULT '',
                root_path TEXT DEFAULT NULL
            );

            -- Conversations table (tasks)
            CREATE TABLE IF NOT EXISTS conversations (
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

            -- Messages table
            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                assistant_id TEXT,
                position_index INTEGER DEFAULT 0,
                FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE
            );

            -- Message attachments table
            CREATE TABLE IF NOT EXISTS message_attachments (
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

            -- Default project
            INSERT OR IGNORE INTO projects (id, name, description, created_at, updated_at, context, rules, root_path)
            VALUES ('default', 'Default Project', 'Default project for all conversations', 
                    strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000, '', '', NULL);
        "#,
        down_sql: Some("DROP TABLE IF EXISTS message_attachments; DROP TABLE IF EXISTS messages; DROP TABLE IF EXISTS conversations; DROP TABLE IF EXISTS projects;"),
    });

    // Migration 2: Agent tables
    registry.register(Migration {
        version: 2,
        name: "create_agent_tables",
        up_sql: r#"
            CREATE TABLE IF NOT EXISTS agents (
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
        "#,
        down_sql: Some("DROP TABLE IF EXISTS agents;"),
    });

    // Migration 3: Skill tables
    registry.register(Migration {
        version: 3,
        name: "create_skill_tables",
        up_sql: r#"
            CREATE TABLE IF NOT EXISTS skills (
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

            CREATE TABLE IF NOT EXISTS conversation_skills (
                conversation_id TEXT NOT NULL,
                skill_id TEXT NOT NULL,
                enabled INTEGER DEFAULT 1,
                priority INTEGER DEFAULT 0,
                activated_at INTEGER NOT NULL,
                FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
                FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE,
                PRIMARY KEY (conversation_id, skill_id)
            );

            CREATE TABLE IF NOT EXISTS active_skills (
                skill_id TEXT PRIMARY KEY,
                created_at INTEGER NOT NULL
            );
        "#,
        down_sql: Some("DROP TABLE IF EXISTS active_skills; DROP TABLE IF EXISTS conversation_skills; DROP TABLE IF EXISTS skills;"),
    });

    // Migration 4: MCP and utility tables
    registry.register(Migration {
        version: 4,
        name: "create_mcp_and_utility_tables",
        up_sql: r#"
            -- MCP servers table
            CREATE TABLE IF NOT EXISTS mcp_servers (
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

            -- Todos table
            CREATE TABLE IF NOT EXISTS todos (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                content TEXT NOT NULL,
                status TEXT NOT NULL CHECK (status IN ('pending', 'in_progress', 'completed')),
                priority TEXT NOT NULL CHECK (priority IN ('high', 'medium', 'low')),
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE
            );

            -- Recent files table
            CREATE TABLE IF NOT EXISTS recent_files (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_path TEXT NOT NULL,
                repository_path TEXT NOT NULL,
                opened_at INTEGER NOT NULL,
                UNIQUE(file_path, repository_path)
            );

            -- Recent projects table
            CREATE TABLE IF NOT EXISTS recent_projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id TEXT NOT NULL UNIQUE,
                project_name TEXT NOT NULL,
                root_path TEXT NOT NULL,
                opened_at INTEGER NOT NULL
            );

            -- Settings table
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );
        "#,
        down_sql: Some("DROP TABLE IF EXISTS settings; DROP TABLE IF EXISTS recent_projects; DROP TABLE IF EXISTS recent_files; DROP TABLE IF EXISTS todos; DROP TABLE IF EXISTS mcp_servers;"),
    });

    // Migration 5: Tracing tables
    registry.register(Migration {
        version: 5,
        name: "create_tracing_tables",
        up_sql: r#"
            CREATE TABLE IF NOT EXISTS traces (
                id TEXT PRIMARY KEY,
                started_at INTEGER NOT NULL,
                ended_at INTEGER,
                metadata TEXT
            );

            CREATE TABLE IF NOT EXISTS spans (
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

            CREATE TABLE IF NOT EXISTS span_events (
                id TEXT PRIMARY KEY,
                span_id TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                event_type TEXT NOT NULL,
                payload TEXT,
                FOREIGN KEY (span_id) REFERENCES spans(id) ON DELETE CASCADE
            );
        "#,
        down_sql: Some("DROP TABLE IF EXISTS span_events; DROP TABLE IF EXISTS spans; DROP TABLE IF EXISTS traces;"),
    });

    // Migration 6: API usage tables
    registry.register(Migration {
        version: 6,
        name: "create_api_usage_tables",
        up_sql: r#"
            CREATE TABLE IF NOT EXISTS api_usage_events (
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
        "#,
        down_sql: Some("DROP TABLE IF EXISTS api_usage_events;"),
    });

    // Migration 7: Scheduled tasks tables (Rust-specific)
    registry.register(Migration {
        version: 7,
        name: "create_scheduled_tasks_tables",
        up_sql: r#"
            CREATE TABLE IF NOT EXISTS scheduled_tasks (
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

            CREATE TABLE IF NOT EXISTS scheduled_task_runs (
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

            CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_status ON scheduled_tasks(status);
            CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_next_run ON scheduled_tasks(next_run_at);
            CREATE INDEX IF NOT EXISTS idx_task_runs_job ON scheduled_task_runs(scheduled_task_id);
            CREATE INDEX IF NOT EXISTS idx_task_runs_triggered ON scheduled_task_runs(triggered_at);
            CREATE INDEX IF NOT EXISTS idx_task_runs_status ON scheduled_task_runs(status);
        "#,
        down_sql: Some(
            "DROP TABLE IF EXISTS scheduled_task_runs; DROP TABLE IF EXISTS scheduled_tasks;",
        ),
    });

    // Migration 8: Create all indexes
    registry.register(Migration {
        version: 8,
        name: "create_indexes",
        up_sql: r#"
            -- Projects indexes
            CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_root_path ON projects (root_path) WHERE root_path IS NOT NULL;

            -- Conversations indexes
            CREATE INDEX IF NOT EXISTS idx_conversations_project_id ON conversations (project_id);

            -- Messages indexes
            CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages (conversation_id);
            CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages (timestamp);

            -- Message attachments indexes
            CREATE INDEX IF NOT EXISTS idx_attachments_message_id ON message_attachments (message_id);

            -- MCP servers indexes
            CREATE INDEX IF NOT EXISTS idx_mcp_servers_is_enabled ON mcp_servers (is_enabled);
            CREATE INDEX IF NOT EXISTS idx_mcp_servers_is_built_in ON mcp_servers (is_built_in);
            CREATE INDEX IF NOT EXISTS idx_mcp_servers_protocol ON mcp_servers (protocol);

            -- Todos indexes
            CREATE INDEX IF NOT EXISTS idx_todos_conversation_id ON todos (conversation_id);
            CREATE INDEX IF NOT EXISTS idx_todos_status ON todos (status);
            CREATE INDEX IF NOT EXISTS idx_todos_created_at ON todos (created_at);

            -- Agents indexes
            CREATE INDEX IF NOT EXISTS idx_agents_is_hidden ON agents (is_hidden);

            -- Skills indexes
            CREATE INDEX IF NOT EXISTS idx_skills_category ON skills(category);
            CREATE INDEX IF NOT EXISTS idx_skills_marketplace ON skills(marketplace_id);
            CREATE INDEX IF NOT EXISTS idx_skills_tags ON skills(tags);
            CREATE INDEX IF NOT EXISTS idx_skills_name ON skills(name);

            -- Conversation skills indexes
            CREATE INDEX IF NOT EXISTS idx_conversation_skills_conversation ON conversation_skills(conversation_id);
            CREATE INDEX IF NOT EXISTS idx_conversation_skills_enabled ON conversation_skills(conversation_id, enabled);
            CREATE INDEX IF NOT EXISTS idx_conversation_skills_priority ON conversation_skills(conversation_id, priority DESC);

            -- Recent files indexes
            CREATE INDEX IF NOT EXISTS idx_recent_files_repository ON recent_files(repository_path, opened_at DESC);

            -- Tracing indexes
            CREATE INDEX IF NOT EXISTS idx_spans_trace_id ON spans(trace_id);
            CREATE INDEX IF NOT EXISTS idx_spans_parent_span_id ON spans(parent_span_id);
            CREATE INDEX IF NOT EXISTS idx_span_events_span_id ON span_events(span_id);
            CREATE INDEX IF NOT EXISTS idx_traces_started_at ON traces(started_at DESC);
            CREATE INDEX IF NOT EXISTS idx_spans_started_at ON spans(started_at DESC);
            CREATE INDEX IF NOT EXISTS idx_span_events_timestamp ON span_events(timestamp DESC);
            CREATE INDEX IF NOT EXISTS idx_span_events_type ON span_events(event_type);

            -- API usage events indexes
            CREATE INDEX IF NOT EXISTS idx_api_usage_events_created_at ON api_usage_events(created_at);
            CREATE INDEX IF NOT EXISTS idx_api_usage_events_model ON api_usage_events(model);
            CREATE INDEX IF NOT EXISTS idx_api_usage_events_conversation ON api_usage_events(conversation_id);
        "#,
        down_sql: None,
    });

    // Migration 9: Repair partially-applied schemas created by the old single-statement runner.
    registry.register(Migration {
        version: 9,
        name: "repair_partially_applied_unified_schema",
        up_sql: r#"
            -- Core chat tables that may have been skipped inside earlier multi-statement migrations.
            CREATE TABLE IF NOT EXISTS conversations (
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

            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                assistant_id TEXT,
                position_index INTEGER DEFAULT 0,
                FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS message_attachments (
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

            -- Utility tables that may have been skipped.
            CREATE TABLE IF NOT EXISTS todos (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                content TEXT NOT NULL,
                status TEXT NOT NULL CHECK (status IN ('pending', 'in_progress', 'completed')),
                priority TEXT NOT NULL CHECK (priority IN ('high', 'medium', 'low')),
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS recent_files (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_path TEXT NOT NULL,
                repository_path TEXT NOT NULL,
                opened_at INTEGER NOT NULL,
                UNIQUE(file_path, repository_path)
            );

            CREATE TABLE IF NOT EXISTS recent_projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id TEXT NOT NULL UNIQUE,
                project_name TEXT NOT NULL,
                root_path TEXT NOT NULL,
                opened_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS conversation_skills (
                conversation_id TEXT NOT NULL,
                skill_id TEXT NOT NULL,
                enabled INTEGER DEFAULT 1,
                priority INTEGER DEFAULT 0,
                activated_at INTEGER NOT NULL,
                FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
                FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE,
                PRIMARY KEY (conversation_id, skill_id)
            );

            CREATE TABLE IF NOT EXISTS active_skills (
                skill_id TEXT PRIMARY KEY,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS span_events (
                id TEXT PRIMARY KEY,
                span_id TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                event_type TEXT NOT NULL,
                payload TEXT,
                FOREIGN KEY (span_id) REFERENCES spans(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS spans (
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

            CREATE TABLE IF NOT EXISTS scheduled_task_runs (
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

            -- Recreate indexes that may have been skipped.
            CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_root_path ON projects (root_path) WHERE root_path IS NOT NULL;
            CREATE INDEX IF NOT EXISTS idx_conversations_project_id ON conversations (project_id);
            CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages (conversation_id);
            CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages (timestamp);
            CREATE INDEX IF NOT EXISTS idx_attachments_message_id ON message_attachments (message_id);
            CREATE INDEX IF NOT EXISTS idx_mcp_servers_is_enabled ON mcp_servers (is_enabled);
            CREATE INDEX IF NOT EXISTS idx_mcp_servers_is_built_in ON mcp_servers (is_built_in);
            CREATE INDEX IF NOT EXISTS idx_mcp_servers_protocol ON mcp_servers (protocol);
            CREATE INDEX IF NOT EXISTS idx_todos_conversation_id ON todos (conversation_id);
            CREATE INDEX IF NOT EXISTS idx_todos_status ON todos (status);
            CREATE INDEX IF NOT EXISTS idx_todos_created_at ON todos (created_at);
            CREATE INDEX IF NOT EXISTS idx_agents_is_hidden ON agents (is_hidden);
            CREATE INDEX IF NOT EXISTS idx_skills_category ON skills(category);
            CREATE INDEX IF NOT EXISTS idx_skills_marketplace ON skills(marketplace_id);
            CREATE INDEX IF NOT EXISTS idx_skills_tags ON skills(tags);
            CREATE INDEX IF NOT EXISTS idx_skills_name ON skills(name);
            CREATE INDEX IF NOT EXISTS idx_conversation_skills_conversation ON conversation_skills(conversation_id);
            CREATE INDEX IF NOT EXISTS idx_conversation_skills_enabled ON conversation_skills(conversation_id, enabled);
            CREATE INDEX IF NOT EXISTS idx_conversation_skills_priority ON conversation_skills(conversation_id, priority DESC);
            CREATE INDEX IF NOT EXISTS idx_recent_files_repository ON recent_files(repository_path, opened_at DESC);
            CREATE INDEX IF NOT EXISTS idx_spans_trace_id ON spans(trace_id);
            CREATE INDEX IF NOT EXISTS idx_spans_parent_span_id ON spans(parent_span_id);
            CREATE INDEX IF NOT EXISTS idx_span_events_span_id ON span_events(span_id);
            CREATE INDEX IF NOT EXISTS idx_traces_started_at ON traces(started_at DESC);
            CREATE INDEX IF NOT EXISTS idx_spans_started_at ON spans(started_at DESC);
            CREATE INDEX IF NOT EXISTS idx_span_events_timestamp ON span_events(timestamp DESC);
            CREATE INDEX IF NOT EXISTS idx_span_events_type ON span_events(event_type);
            CREATE INDEX IF NOT EXISTS idx_api_usage_events_created_at ON api_usage_events(created_at);
            CREATE INDEX IF NOT EXISTS idx_api_usage_events_model ON api_usage_events(model);
            CREATE INDEX IF NOT EXISTS idx_api_usage_events_conversation ON api_usage_events(conversation_id);
            CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_status ON scheduled_tasks(status);
            CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_next_run ON scheduled_tasks(next_run_at);
            CREATE INDEX IF NOT EXISTS idx_task_runs_job ON scheduled_task_runs(scheduled_task_id);
            CREATE INDEX IF NOT EXISTS idx_task_runs_triggered ON scheduled_task_runs(triggered_at);
            CREATE INDEX IF NOT EXISTS idx_task_runs_status ON scheduled_task_runs(status);

            INSERT OR IGNORE INTO projects (id, name, description, created_at, updated_at, context, rules, root_path)
            VALUES ('default', 'Default Project', 'Default project for all conversations',
                    strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000, '', '', NULL);
        "#,
        down_sql: None,
    });

    registry
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_talkcody_migrations_count() {
        let registry = talkcody_migrations();
        assert_eq!(registry.migrations().len(), 9);
    }
}
