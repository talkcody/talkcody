//! Settings Repository
//! Handles CRUD operations for unified talkcody.db settings.

use crate::database::Database;
use crate::storage::models::TaskSettings;
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::sync::Arc;

const SERVER_COMPAT_KEY: &str = "_serverCompat";
const TASK_SETTINGS_KEY: &str = "taskSettings";

/// Repository for settings operations
#[derive(Clone)]
pub struct SettingsRepository {
    db: Arc<Database>,
}

impl SettingsRepository {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }

    pub fn get_db(&self) -> Arc<Database> {
        self.db.clone()
    }

    // ============== Generic Settings Operations ==============

    pub async fn get_setting(&self, key: &str) -> Result<Option<Value>, String> {
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

    pub async fn set_setting(&self, key: &str, value: &Value) -> Result<(), String> {
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

    pub async fn delete_setting(&self, key: &str) -> Result<(), String> {
        self.db
            .execute(
                "DELETE FROM settings WHERE key = ?",
                vec![serde_json::json!(key)],
            )
            .await?;
        Ok(())
    }

    pub async fn get_all_settings(&self) -> Result<HashMap<String, Value>, String> {
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

    pub async fn get_task_settings(&self, task_id: &str) -> Result<Option<TaskSettings>, String> {
        let settings_map = self.get_conversation_settings(task_id).await?;
        let maybe = settings_map
            .get(SERVER_COMPAT_KEY)
            .and_then(|v| v.as_object())
            .and_then(|obj| obj.get(TASK_SETTINGS_KEY))
            .cloned();

        match maybe {
            Some(value) => serde_json::from_value(value)
                .map(Some)
                .map_err(|e| format!("Failed to parse task settings: {}", e)),
            None => Ok(None),
        }
    }

    pub async fn get_task_settings_or_default(
        &self,
        task_id: &str,
    ) -> Result<TaskSettings, String> {
        Ok(self.get_task_settings(task_id).await?.unwrap_or_default())
    }

    pub async fn set_task_settings(
        &self,
        task_id: &str,
        settings: &TaskSettings,
    ) -> Result<(), String> {
        let mut settings_map = self.get_conversation_settings(task_id).await?;
        let mut server_compat = settings_map
            .remove(SERVER_COMPAT_KEY)
            .and_then(|v| v.as_object().cloned())
            .unwrap_or_default();
        server_compat.insert(
            TASK_SETTINGS_KEY.to_string(),
            serde_json::to_value(settings)
                .map_err(|e| format!("Failed to serialize task settings: {}", e))?,
        );
        settings_map.insert(SERVER_COMPAT_KEY.to_string(), Value::Object(server_compat));
        self.update_conversation_settings(task_id, settings_map)
            .await
    }

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
        for (key, value) in updates.extra {
            settings.extra.insert(key, value);
        }

        self.set_task_settings(task_id, &settings).await?;
        Ok(settings)
    }

    pub async fn delete_task_settings(&self, task_id: &str) -> Result<(), String> {
        let mut settings_map = self.get_conversation_settings(task_id).await?;
        let mut server_compat = settings_map
            .remove(SERVER_COMPAT_KEY)
            .and_then(|v| v.as_object().cloned())
            .unwrap_or_default();
        server_compat.remove(TASK_SETTINGS_KEY);
        if !server_compat.is_empty() {
            settings_map.insert(SERVER_COMPAT_KEY.to_string(), Value::Object(server_compat));
        }
        self.update_conversation_settings(task_id, settings_map)
            .await
    }

    pub async fn get_all_task_settings(&self) -> Result<HashMap<String, TaskSettings>, String> {
        let result = self
            .db
            .query("SELECT id, settings FROM conversations ORDER BY id", vec![])
            .await?;

        let mut settings_map = HashMap::new();
        for row in &result.rows {
            let task_id = match row.get("id").and_then(|v| v.as_str()) {
                Some(value) => value,
                None => continue,
            };
            let settings_raw = row.get("settings").and_then(|v| v.as_str());
            let parsed = parse_settings_map(settings_raw)?;
            if let Some(task_settings) = parsed
                .get(SERVER_COMPAT_KEY)
                .and_then(|v| v.as_object())
                .and_then(|obj| obj.get(TASK_SETTINGS_KEY))
                .cloned()
            {
                if let Ok(task_settings) = serde_json::from_value(task_settings) {
                    settings_map.insert(task_id.to_string(), task_settings);
                }
            }
        }
        Ok(settings_map)
    }

    async fn get_conversation_settings(&self, task_id: &str) -> Result<Map<String, Value>, String> {
        let result = self
            .db
            .query(
                "SELECT settings FROM conversations WHERE id = ?",
                vec![serde_json::json!(task_id)],
            )
            .await?;
        let row = result
            .rows
            .first()
            .ok_or_else(|| format!("Conversation not found: {}", task_id))?;
        parse_settings_map(row.get("settings").and_then(|v| v.as_str()))
    }

    async fn update_conversation_settings(
        &self,
        task_id: &str,
        settings: Map<String, Value>,
    ) -> Result<(), String> {
        self.db
            .execute(
                "UPDATE conversations SET settings = ?, updated_at = ? WHERE id = ?",
                vec![
                    serde_json::json!(serde_json::to_string(&Value::Object(settings)).map_err(
                        |e| format!("Failed to serialize conversation settings: {}", e)
                    )?),
                    serde_json::json!(chrono::Utc::now().timestamp_millis()),
                    serde_json::json!(task_id),
                ],
            )
            .await?;
        Ok(())
    }
}

fn parse_settings_map(raw: Option<&str>) -> Result<Map<String, Value>, String> {
    match raw {
        Some(raw) if !raw.trim().is_empty() => match serde_json::from_str::<Value>(raw) {
            Ok(Value::Object(map)) => Ok(map),
            Ok(_) => Ok(Map::new()),
            Err(e) => Err(format!("Failed to parse conversation settings: {}", e)),
        },
        _ => Ok(Map::new()),
    }
}
