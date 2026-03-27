//! Database migration system for SQLite databases
//! Each database has its own migration history tracked in a _migrations table

pub mod talkcody_db;

use serde::{Deserialize, Serialize};

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
        // Migrations frequently contain multiple DDL statements; execute them as a script.
        self.db.execute_batch(migration.up_sql).await?;

        // Record migration only after the full script succeeds.
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

    // Migration 6: Scheduled tasks table
    registry.register(Migration {
        version: 6,
        name: "create_scheduled_tasks_table",
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
                updated_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_status ON scheduled_tasks(status);
            CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_next_run ON scheduled_tasks(next_run_at);
        "#,
        down_sql: Some("DROP TABLE IF EXISTS scheduled_tasks;"),
    });

    // Migration 7: Scheduled task runs table
    registry.register(Migration {
        version: 7,
        name: "create_scheduled_task_runs_table",
        up_sql: r#"
            CREATE TABLE IF NOT EXISTS scheduled_task_runs (
                id TEXT PRIMARY KEY,
                scheduled_task_id TEXT NOT NULL,
                task_id TEXT,
                status TEXT NOT NULL DEFAULT 'running',
                triggered_at INTEGER NOT NULL,
                completed_at INTEGER,
                error TEXT,
                attempt INTEGER NOT NULL DEFAULT 1,
                FOREIGN KEY (scheduled_task_id) REFERENCES scheduled_tasks(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_task_runs_job ON scheduled_task_runs(scheduled_task_id);
            CREATE INDEX IF NOT EXISTS idx_task_runs_triggered ON scheduled_task_runs(triggered_at);
            CREATE INDEX IF NOT EXISTS idx_task_runs_status ON scheduled_task_runs(status);
        "#,
        down_sql: Some("DROP TABLE IF EXISTS scheduled_task_runs;"),
    });

    // Migration 8: Phase 2/3/4 scheduled task policy columns
    registry.register(Migration {
        version: 8,
        name: "extend_scheduled_tasks_for_phase_2_3_4",
        up_sql: r#"
            ALTER TABLE scheduled_tasks ADD COLUMN schedule_nl_text TEXT;
            ALTER TABLE scheduled_tasks ADD COLUMN notification_policy_json TEXT NOT NULL DEFAULT '{}';
            ALTER TABLE scheduled_tasks ADD COLUMN delivery_policy_json TEXT NOT NULL DEFAULT '{}';
            ALTER TABLE scheduled_tasks ADD COLUMN offline_policy_json TEXT NOT NULL DEFAULT '{}';
        "#,
        down_sql: None,
    });

    // Migration 9: Phase 2/3/4 scheduled run metadata columns
    registry.register(Migration {
        version: 9,
        name: "extend_scheduled_task_runs_for_phase_2_3_4",
        up_sql: r#"
            ALTER TABLE scheduled_task_runs ADD COLUMN trigger_source TEXT NOT NULL DEFAULT 'schedule';
            ALTER TABLE scheduled_task_runs ADD COLUMN scheduled_for_at INTEGER;
            ALTER TABLE scheduled_task_runs ADD COLUMN payload_snapshot_json TEXT;
            ALTER TABLE scheduled_task_runs ADD COLUMN project_id_snapshot TEXT;
            ALTER TABLE scheduled_task_runs ADD COLUMN delivery_status TEXT;
            ALTER TABLE scheduled_task_runs ADD COLUMN delivery_error TEXT;
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
        let registry = talkcody_db::talkcody_migrations();
        assert_eq!(registry.migrations().len(), 9);
    }
}
