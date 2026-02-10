//! Settings Repository
//! Handles CRUD operations for application settings in settings.db

use crate::database::Database;
use crate::storage::models::TaskSettings;
use std::collections::HashMap;
use std::sync::Arc;

/// Repository for settings operations
#[derive(Clone)]
pub struct SettingsRepository {
    db: Arc<Database>,
}

impl SettingsRepository {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }

    /// Get a reference to the underlying database
    pub fn get_db(&self) -> Arc<Database> {
        self.db.clone()
    }

    // ============== Generic Settings Operations ==============

    /// Get a setting value by key
    pub async fn get_setting(&self, key: &str) -> Result<Option<serde_json::Value>, String> {
        let result = self
            .db
            .query(
                "SELECT value FROM settings WHERE key = ?",
                vec![serde_json::json!(key)],
            )
            .await?;

        if let Some(row) = result.rows.first() {
            if let Some(value_str) = row.get("value").and_then(|v| v.as_str()) {
                return serde_json::from_str(value_str)
                    .map(Some)
                    .map_err(|e| format!("Failed to parse setting value: {}", e));
            }
        }

        Ok(None)
    }

    /// Get a setting with default value
    pub async fn get_setting_or_default<T: serde::de::DeserializeOwned>(
        &self,
        key: &str,
        default: T,
    ) -> Result<T, String> {
        match self.get_setting(key).await? {
            Some(value) => serde_json::from_value(value)
                .map_err(|e| format!("Failed to deserialize setting: {}", e)),
            None => Ok(default),
        }
    }

    /// Set a setting value
    pub async fn set_setting(&self, key: &str, value: &serde_json::Value) -> Result<(), String> {
        let updated_at = chrono::Utc::now().timestamp();
        let value_str = serde_json::to_string(value)
            .map_err(|e| format!("Failed to serialize setting: {}", e))?;

        self.db
            .execute(
                r#"
                INSERT INTO settings (key, value, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET
                    value = excluded.value,
                    updated_at = excluded.updated_at
            "#,
                vec![
                    serde_json::json!(key),
                    serde_json::json!(value_str),
                    serde_json::json!(updated_at),
                ],
            )
            .await?;

        Ok(())
    }

    /// Delete a setting
    pub async fn delete_setting(&self, key: &str) -> Result<(), String> {
        self.db
            .execute(
                "DELETE FROM settings WHERE key = ?",
                vec![serde_json::json!(key)],
            )
            .await?;
        Ok(())
    }

    /// Get all settings
    pub async fn get_all_settings(&self) -> Result<HashMap<String, serde_json::Value>, String> {
        let result = self
            .db
            .query("SELECT key, value FROM settings ORDER BY key", vec![])
            .await?;

        let mut settings = HashMap::new();

        for row in &result.rows {
            if let (Some(key), Some(value_str)) = (
                row.get("key").and_then(|v| v.as_str()),
                row.get("value").and_then(|v| v.as_str()),
            ) {
                if let Ok(value) = serde_json::from_str(value_str) {
                    settings.insert(key.to_string(), value);
                }
            }
        }

        Ok(settings)
    }

    // ============== Task Settings Operations ==============

    /// Get task-specific settings
    pub async fn get_task_settings(&self, task_id: &str) -> Result<Option<TaskSettings>, String> {
        let result = self
            .db
            .query(
                "SELECT settings FROM task_settings WHERE task_id = ?",
                vec![serde_json::json!(task_id)],
            )
            .await?;

        if let Some(row) = result.rows.first() {
            if let Some(settings_str) = row.get("settings").and_then(|v| v.as_str()) {
                return serde_json::from_str(settings_str)
                    .map(Some)
                    .map_err(|e| format!("Failed to parse task settings: {}", e));
            }
        }

        Ok(None)
    }

    /// Get task settings with defaults
    pub async fn get_task_settings_or_default(
        &self,
        task_id: &str,
    ) -> Result<TaskSettings, String> {
        match self.get_task_settings(task_id).await? {
            Some(settings) => Ok(settings),
            None => Ok(TaskSettings::default()),
        }
    }

    /// Set task-specific settings
    pub async fn set_task_settings(
        &self,
        task_id: &str,
        settings: &TaskSettings,
    ) -> Result<(), String> {
        let updated_at = chrono::Utc::now().timestamp();
        let settings_str = serde_json::to_string(settings)
            .map_err(|e| format!("Failed to serialize task settings: {}", e))?;

        self.db
            .execute(
                r#"
                INSERT INTO task_settings (task_id, settings, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(task_id) DO UPDATE SET
                    settings = excluded.settings,
                    updated_at = excluded.updated_at
            "#,
                vec![
                    serde_json::json!(task_id),
                    serde_json::json!(settings_str),
                    serde_json::json!(updated_at),
                ],
            )
            .await?;

        Ok(())
    }

    /// Update specific fields in task settings
    pub async fn update_task_settings(
        &self,
        task_id: &str,
        updates: TaskSettings,
    ) -> Result<TaskSettings, String> {
        let mut settings = self.get_task_settings_or_default(task_id).await?;

        if updates.auto_approve_edits.is_some() {
            settings.auto_approve_edits = updates.auto_approve_edits;
        }
        if updates.auto_approve_plan.is_some() {
            settings.auto_approve_plan = updates.auto_approve_plan;
        }
        if updates.auto_code_review.is_some() {
            settings.auto_code_review = updates.auto_code_review;
        }

        // Merge extra settings
        for (key, value) in updates.extra {
            settings.extra.insert(key, value);
        }

        self.set_task_settings(task_id, &settings).await?;
        Ok(settings)
    }

    /// Delete task settings
    pub async fn delete_task_settings(&self, task_id: &str) -> Result<(), String> {
        self.db
            .execute(
                "DELETE FROM task_settings WHERE task_id = ?",
                vec![serde_json::json!(task_id)],
            )
            .await?;
        Ok(())
    }

    /// Get all task settings
    pub async fn get_all_task_settings(&self) -> Result<HashMap<String, TaskSettings>, String> {
        let result = self
            .db
            .query(
                "SELECT task_id, settings FROM task_settings ORDER BY task_id",
                vec![],
            )
            .await?;

        let mut settings_map = HashMap::new();

        for row in &result.rows {
            if let (Some(task_id), Some(settings_str)) = (
                row.get("task_id").and_then(|v| v.as_str()),
                row.get("settings").and_then(|v| v.as_str()),
            ) {
                if let Ok(settings) = serde_json::from_str(settings_str) {
                    settings_map.insert(task_id.to_string(), settings);
                }
            }
        }

        Ok(settings_map)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::Database;
    use tempfile::TempDir;

    async fn create_test_db() -> (Arc<Database>, TempDir) {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");
        let db = Arc::new(Database::new(db_path.to_string_lossy().to_string()));
        db.connect()
            .await
            .expect("Failed to connect to test database");

        // Run migrations
        let migrations = super::super::migrations::settings_migrations();
        let runner = super::super::migrations::MigrationRunner::new(&db, &migrations);
        runner.init().await.expect("Failed to init migrations");
        runner.migrate().await.expect("Failed to run migrations");

        (db, temp_dir)
    }

    #[tokio::test]
    async fn test_set_and_get_setting() {
        let (db, _temp) = create_test_db().await;
        let repo = SettingsRepository::new(db);

        // Set a string value
        repo.set_setting("test_key", &serde_json::json!("test_value"))
            .await
            .expect("Failed to set setting");

        let value = repo
            .get_setting("test_key")
            .await
            .expect("Failed to get setting");
        assert_eq!(value, Some(serde_json::json!("test_value")));

        // Update the value
        repo.set_setting("test_key", &serde_json::json!(123))
            .await
            .expect("Failed to update setting");

        let value = repo
            .get_setting("test_key")
            .await
            .expect("Failed to get setting");
        assert_eq!(value, Some(serde_json::json!(123)));
    }

    #[tokio::test]
    async fn test_get_nonexistent_setting() {
        let (db, _temp) = create_test_db().await;
        let repo = SettingsRepository::new(db);

        let value = repo
            .get_setting("nonexistent")
            .await
            .expect("Failed to get setting");
        assert_eq!(value, None);
    }

    #[tokio::test]
    async fn test_get_setting_or_default() {
        let (db, _temp) = create_test_db().await;
        let repo = SettingsRepository::new(db);

        // Non-existent key returns default
        let value: i32 = repo
            .get_setting_or_default("missing", 42)
            .await
            .expect("Failed to get setting");
        assert_eq!(value, 42);

        // Existing key returns stored value
        repo.set_setting("existing", &serde_json::json!(100))
            .await
            .expect("Failed to set setting");

        let value: i32 = repo
            .get_setting_or_default("existing", 42)
            .await
            .expect("Failed to get setting");
        assert_eq!(value, 100);
    }

    #[tokio::test]
    async fn test_task_settings() {
        let (db, _temp) = create_test_db().await;
        let repo = SettingsRepository::new(db);

        let settings = TaskSettings {
            auto_approve_edits: Some(true),
            auto_approve_plan: Some(false),
            auto_code_review: Some(true),
            extra: Default::default(),
        };

        repo.set_task_settings("task-1", &settings)
            .await
            .expect("Failed to set task settings");

        let retrieved = repo
            .get_task_settings("task-1")
            .await
            .expect("Failed to get task settings")
            .expect("Task settings should exist");

        assert_eq!(retrieved.auto_approve_edits, Some(true));
        assert_eq!(retrieved.auto_approve_plan, Some(false));
        assert_eq!(retrieved.auto_code_review, Some(true));
    }

    #[tokio::test]
    async fn test_update_task_settings() {
        let (db, _temp) = create_test_db().await;
        let repo = SettingsRepository::new(db);

        // Initial settings
        let initial = TaskSettings {
            auto_approve_edits: Some(true),
            auto_approve_plan: Some(false),
            auto_code_review: None,
            extra: Default::default(),
        };
        repo.set_task_settings("task-2", &initial).await.unwrap();

        // Partial update
        let updates = TaskSettings {
            auto_approve_edits: None,      // Keep existing
            auto_approve_plan: Some(true), // Update
            auto_code_review: Some(false), // Set new
            extra: Default::default(),
        };

        let updated = repo
            .update_task_settings("task-2", updates)
            .await
            .expect("Failed to update task settings");

        assert_eq!(updated.auto_approve_edits, Some(true)); // Unchanged
        assert_eq!(updated.auto_approve_plan, Some(true)); // Changed
        assert_eq!(updated.auto_code_review, Some(false)); // Set
    }

    #[tokio::test]
    async fn test_delete_setting() {
        let (db, _temp) = create_test_db().await;
        let repo = SettingsRepository::new(db);

        repo.set_setting("to_delete", &serde_json::json!("value"))
            .await
            .expect("Failed to set setting");

        repo.delete_setting("to_delete")
            .await
            .expect("Failed to delete setting");

        let value = repo
            .get_setting("to_delete")
            .await
            .expect("Failed to get setting");
        assert_eq!(value, None);
    }
}
