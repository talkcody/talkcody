//! Database migration system for SQLite databases
//! Each database has its own migration history tracked in a _migrations table

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// A single migration definition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Migration {
    pub version: i64,
    pub name: &'static str,
    pub up_sql: &'static str,
    pub down_sql: Option<&'static str>,
}

/// Migration registry for a specific database
pub struct MigrationRegistry {
    db_name: &'static str,
    migrations: Vec<Migration>,
}

impl MigrationRegistry {
    pub fn new(db_name: &'static str) -> Self {
        Self {
            db_name,
            migrations: Vec::new(),
        }
    }

    pub fn register(&mut self, migration: Migration) {
        self.migrations.push(migration);
    }

    pub fn migrations(&self) -> &[Migration] {
        &self.migrations
    }

    pub fn db_name(&self) -> &str {
        self.db_name
    }
}

/// Migration runner for executing migrations
pub struct MigrationRunner<'a> {
    db: &'a crate::database::Database,
    registry: &'a MigrationRegistry,
}

impl<'a> MigrationRunner<'a> {
    pub fn new(db: &'a crate::database::Database, registry: &'a MigrationRegistry) -> Self {
        Self { db, registry }
    }

    /// Initialize migrations table if not exists
    pub async fn init(&self) -> Result<(), String> {
        let sql = r#"
            CREATE TABLE IF NOT EXISTS _migrations (
                version INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                applied_at INTEGER NOT NULL
            )
        "#;
        self.db.execute(sql, vec![]).await?;
        Ok(())
    }

    /// Get current schema version
    pub async fn current_version(&self) -> Result<i64, String> {
        let result = self
            .db
            .query("SELECT MAX(version) as version FROM _migrations", vec![])
            .await?;

        Ok(result
            .rows
            .first()
            .and_then(|row| row.get("version"))
            .and_then(|v| v.as_i64())
            .unwrap_or(0))
    }

    /// Run all pending migrations
    pub async fn migrate(&self) -> Result<Vec<String>, String> {
        self.init().await?;
        let current = self.current_version().await?;
        let mut applied = Vec::new();

        for migration in self.registry.migrations() {
            if migration.version > current {
                self.apply_migration(migration).await?;
                applied.push(format!("{}: {}", migration.version, migration.name));
            }
        }

        Ok(applied)
    }

    async fn apply_migration(&self, migration: &Migration) -> Result<(), String> {
        // Execute migration in transaction
        self.db.execute(migration.up_sql, vec![]).await?;

        // Record migration
        let now = chrono::Utc::now().timestamp();
        self.db
            .execute(
                "INSERT INTO _migrations (version, name, applied_at) VALUES (?, ?, ?)",
                vec![
                    serde_json::json!(migration.version),
                    serde_json::json!(migration.name),
                    serde_json::json!(now),
                ],
            )
            .await?;

        Ok(())
    }
}

// ============== Chat History Migrations ==============

pub fn chat_history_migrations() -> MigrationRegistry {
    let mut registry = MigrationRegistry::new("chat_history");

    registry.register(Migration {
        version: 1,
        name: "create_sessions_table",
        up_sql: r#"
            CREATE TABLE sessions (
                id TEXT PRIMARY KEY,
                project_id TEXT,
                title TEXT,
                status TEXT NOT NULL DEFAULT 'created',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                last_event_id TEXT,
                metadata TEXT
            );
            CREATE INDEX idx_sessions_project ON sessions(project_id);
            CREATE INDEX idx_sessions_status ON sessions(status);
            CREATE INDEX idx_sessions_updated ON sessions(updated_at);
        "#,
        down_sql: Some("DROP TABLE sessions;"),
    });

    registry.register(Migration {
        version: 2,
        name: "create_messages_table",
        up_sql: r#"
            CREATE TABLE messages (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                tool_call_id TEXT,
                parent_id TEXT,
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            );
            CREATE INDEX idx_messages_session ON messages(session_id);
            CREATE INDEX idx_messages_created ON messages(created_at);
        "#,
        down_sql: Some("DROP TABLE messages;"),
    });

    registry.register(Migration {
        version: 3,
        name: "create_events_table",
        up_sql: r#"
            CREATE TABLE events (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                payload TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            );
            CREATE INDEX idx_events_session ON events(session_id);
            CREATE INDEX idx_events_session_created ON events(session_id, created_at);
        "#,
        down_sql: Some("DROP TABLE events;"),
    });

    registry.register(Migration {
        version: 4,
        name: "create_attachments_table",
        up_sql: r#"
            CREATE TABLE attachments (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                message_id TEXT,
                filename TEXT NOT NULL,
                mime_type TEXT NOT NULL,
                size INTEGER NOT NULL DEFAULT 0,
                path TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                origin TEXT NOT NULL DEFAULT 'user_upload',
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
                FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE SET NULL
            );
            CREATE INDEX idx_attachments_session ON attachments(session_id);
            CREATE INDEX idx_attachments_message ON attachments(message_id);
        "#,
        down_sql: Some("DROP TABLE attachments;"),
    });

    // Migration 5: Add message_id to attachments for TS compatibility
    registry.register(Migration {
        version: 5,
        name: "add_message_id_to_attachments",
        up_sql: r#"
            -- Backfill index only; column already exists in migration 4
            CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id);
        "#,
        down_sql: Some("DROP INDEX IF EXISTS idx_attachments_message;"),
    });

    registry
}

// ============== Agents Migrations ==============

pub fn agents_migrations() -> MigrationRegistry {
    let mut registry = MigrationRegistry::new("agents");

    registry.register(Migration {
        version: 1,
        name: "create_agents_table",
        up_sql: r#"
            CREATE TABLE agents (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                model TEXT NOT NULL,
                system_prompt TEXT,
                tools TEXT NOT NULL DEFAULT '[]',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE INDEX idx_agents_name ON agents(name);
        "#,
        down_sql: Some("DROP TABLE agents;"),
    });

    registry.register(Migration {
        version: 2,
        name: "create_agent_sessions_table",
        up_sql: r#"
            CREATE TABLE agent_sessions (
                agent_id TEXT NOT NULL,
                session_id TEXT NOT NULL PRIMARY KEY,
                settings TEXT,
                created_at INTEGER NOT NULL,
                FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
            );
            CREATE INDEX idx_agent_sessions_agent ON agent_sessions(agent_id);
        "#,
        down_sql: Some("DROP TABLE agent_sessions;"),
    });

    registry
}

// ============== Settings Migrations ==============

pub fn settings_migrations() -> MigrationRegistry {
    let mut registry = MigrationRegistry::new("settings");

    registry.register(Migration {
        version: 1,
        name: "create_settings_table",
        up_sql: r#"
            CREATE TABLE settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );
        "#,
        down_sql: Some("DROP TABLE settings;"),
    });

    registry.register(Migration {
        version: 2,
        name: "create_task_settings_table",
        up_sql: r#"
            CREATE TABLE task_settings (
                task_id TEXT PRIMARY KEY,
                settings TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );
        "#,
        down_sql: Some("DROP TABLE task_settings;"),
    });

    registry
}

/// Run migrations for all databases
pub async fn run_all_migrations(
    chat_history_db: &crate::database::Database,
    agents_db: &crate::database::Database,
    settings_db: &crate::database::Database,
) -> Result<HashMap<&'static str, Vec<String>>, String> {
    let mut results = HashMap::new();

    // Chat history migrations
    let chat_registry = chat_history_migrations();
    let chat_runner = MigrationRunner::new(chat_history_db, &chat_registry);
    results.insert("chat_history", chat_runner.migrate().await?);

    // Agents migrations
    let agents_registry = agents_migrations();
    let agents_runner = MigrationRunner::new(agents_db, &agents_registry);
    results.insert("agents", agents_runner.migrate().await?);

    // Settings migrations
    let settings_registry = settings_migrations();
    let settings_runner = MigrationRunner::new(settings_db, &settings_registry);
    results.insert("settings", settings_runner.migrate().await?);

    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_chat_history_migrations_count() {
        let registry = chat_history_migrations();
        assert_eq!(registry.migrations().len(), 5);
    }

    #[test]
    fn test_agents_migrations_count() {
        let registry = agents_migrations();
        assert_eq!(registry.migrations().len(), 2);
    }

    #[test]
    fn test_settings_migrations_count() {
        let registry = settings_migrations();
        assert_eq!(registry.migrations().len(), 2);
    }
}
