//! Agents Repository
//! Maps Rust agent APIs onto the unified talkcody.db schema.

use crate::database::Database;
use crate::storage::models::*;
use serde_json::{Map, Value};
use std::sync::Arc;

const SERVER_COMPAT_KEY: &str = "_serverCompat";
const AGENT_SESSION_KEY: &str = "agentSession";

/// Repository for agent operations
#[derive(Clone)]
pub struct AgentsRepository {
    db: Arc<Database>,
}

impl AgentsRepository {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }

    pub fn get_db(&self) -> Arc<Database> {
        self.db.clone()
    }

    // ============== Agent Operations ==============

    pub async fn create_agent(&self, agent: &Agent) -> Result<(), String> {
        let tools_json = serde_json::to_string(&agent.tools)
            .map_err(|e| format!("Failed to serialize tools: {}", e))?;

        self.db
            .execute(
                r#"
                INSERT INTO agents (
                    id, name, model_type, system_prompt, tools_config, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                "#,
                vec![
                    serde_json::json!(agent.id),
                    serde_json::json!(agent.name),
                    serde_json::json!(agent.model),
                    serde_json::json!(agent.system_prompt.clone().unwrap_or_default()),
                    serde_json::json!(tools_json),
                    serde_json::json!(to_db_timestamp(agent.created_at)),
                    serde_json::json!(to_db_timestamp(agent.updated_at)),
                ],
            )
            .await?;

        Ok(())
    }

    pub async fn get_agent(&self, agent_id: &str) -> Result<Option<Agent>, String> {
        let result = self
            .db
            .query(
                "SELECT * FROM agents WHERE id = ?",
                vec![serde_json::json!(agent_id)],
            )
            .await?;

        result.rows.first().map(row_to_agent).transpose()
    }

    pub async fn get_agent_by_name(&self, name: &str) -> Result<Option<Agent>, String> {
        let result = self
            .db
            .query(
                "SELECT * FROM agents WHERE name = ? LIMIT 1",
                vec![serde_json::json!(name)],
            )
            .await?;

        result.rows.first().map(row_to_agent).transpose()
    }

    pub async fn list_agents(&self) -> Result<Vec<Agent>, String> {
        let result = self
            .db
            .query("SELECT * FROM agents ORDER BY name ASC", vec![])
            .await?;

        result
            .rows
            .iter()
            .map(row_to_agent)
            .collect::<Result<Vec<_>, _>>()
    }

    pub async fn update_agent(&self, agent_id: &str, updates: AgentUpdates) -> Result<(), String> {
        let updated_at = to_db_timestamp(chrono::Utc::now().timestamp());

        let mut fields = Vec::new();
        let mut params: Vec<Value> = vec![];

        if let Some(name) = updates.name {
            fields.push("name = ?");
            params.push(serde_json::json!(name));
        }
        if let Some(model) = updates.model {
            fields.push("model_type = ?");
            params.push(serde_json::json!(model));
        }
        if let Some(system_prompt) = updates.system_prompt {
            fields.push("system_prompt = ?");
            params.push(serde_json::json!(system_prompt));
        }
        if let Some(tools) = updates.tools {
            fields.push("tools_config = ?");
            params.push(serde_json::json!(serde_json::to_string(&tools)
                .map_err(|e| format!("Failed to serialize tools: {}", e))?));
        }

        if fields.is_empty() {
            return Ok(());
        }

        fields.push("updated_at = ?");
        params.push(serde_json::json!(updated_at));
        params.push(serde_json::json!(agent_id));

        let sql = format!("UPDATE agents SET {} WHERE id = ?", fields.join(", "));
        self.db.execute(&sql, params).await?;
        Ok(())
    }

    pub async fn delete_agent(&self, agent_id: &str) -> Result<(), String> {
        self.db
            .execute(
                "DELETE FROM agents WHERE id = ?",
                vec![serde_json::json!(agent_id)],
            )
            .await?;
        Ok(())
    }

    // ============== Agent Session Compatibility Operations ==============

    pub async fn create_agent_session(&self, agent_session: &AgentSession) -> Result<(), String> {
        self.upsert_agent_session_payload(&agent_session.session_id, agent_session)
            .await
    }

    pub async fn get_agent_session(
        &self,
        session_id: &str,
    ) -> Result<Option<AgentSession>, String> {
        let settings_map = self.get_conversation_settings(session_id).await?;
        let payload = settings_map
            .get(SERVER_COMPAT_KEY)
            .and_then(|v| v.as_object())
            .and_then(|obj| obj.get(AGENT_SESSION_KEY))
            .cloned();

        match payload {
            Some(value) => serde_json::from_value(value)
                .map(Some)
                .map_err(|e| format!("Failed to parse agent session payload: {}", e)),
            None => Ok(None),
        }
    }

    pub async fn get_agent_sessions(&self, agent_id: &str) -> Result<Vec<AgentSession>, String> {
        let result = self
            .db
            .query(
                "SELECT id, settings FROM conversations ORDER BY updated_at DESC",
                vec![],
            )
            .await?;
        let mut sessions = Vec::new();
        for row in &result.rows {
            let Some(raw_settings) = row.get("settings").and_then(|v| v.as_str()) else {
                continue;
            };
            let settings_map = parse_settings_map(Some(raw_settings))?;
            let payload = settings_map
                .get(SERVER_COMPAT_KEY)
                .and_then(|v| v.as_object())
                .and_then(|obj| obj.get(AGENT_SESSION_KEY))
                .cloned();
            if let Some(value) = payload {
                let session: AgentSession = serde_json::from_value(value)
                    .map_err(|e| format!("Failed to parse agent session payload: {}", e))?;
                if session.agent_id == agent_id {
                    sessions.push(session);
                }
            }
        }
        Ok(sessions)
    }

    pub async fn update_agent_session_settings(
        &self,
        session_id: &str,
        settings: &TaskSettings,
    ) -> Result<(), String> {
        if let Some(mut agent_session) = self.get_agent_session(session_id).await? {
            agent_session.settings = settings.clone();
            self.upsert_agent_session_payload(session_id, &agent_session)
                .await?;
        }
        Ok(())
    }

    pub async fn delete_agent_session(&self, session_id: &str) -> Result<(), String> {
        let mut settings_map = self.get_conversation_settings(session_id).await?;
        let mut compat = settings_map
            .remove(SERVER_COMPAT_KEY)
            .and_then(|v| v.as_object().cloned())
            .unwrap_or_default();
        compat.remove(AGENT_SESSION_KEY);
        if !compat.is_empty() {
            settings_map.insert(SERVER_COMPAT_KEY.to_string(), Value::Object(compat));
        }
        self.update_conversation_settings(session_id, settings_map)
            .await
    }

    async fn upsert_agent_session_payload(
        &self,
        session_id: &str,
        agent_session: &AgentSession,
    ) -> Result<(), String> {
        let mut settings_map = self.get_conversation_settings(session_id).await?;
        let mut compat = settings_map
            .remove(SERVER_COMPAT_KEY)
            .and_then(|v| v.as_object().cloned())
            .unwrap_or_default();
        compat.insert(
            AGENT_SESSION_KEY.to_string(),
            serde_json::to_value(agent_session)
                .map_err(|e| format!("Failed to serialize agent session payload: {}", e))?,
        );
        settings_map.insert(SERVER_COMPAT_KEY.to_string(), Value::Object(compat));
        self.update_conversation_settings(session_id, settings_map)
            .await
    }

    async fn get_conversation_settings(
        &self,
        session_id: &str,
    ) -> Result<Map<String, Value>, String> {
        let result = self
            .db
            .query(
                "SELECT settings FROM conversations WHERE id = ?",
                vec![serde_json::json!(session_id)],
            )
            .await?;
        let row = result
            .rows
            .first()
            .ok_or_else(|| format!("Conversation not found: {}", session_id))?;
        parse_settings_map(row.get("settings").and_then(|v| v.as_str()))
    }

    async fn update_conversation_settings(
        &self,
        session_id: &str,
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
                    serde_json::json!(session_id),
                ],
            )
            .await?;
        Ok(())
    }
}

#[derive(Debug, Default)]
pub struct AgentUpdates {
    pub name: Option<String>,
    pub model: Option<String>,
    pub system_prompt: Option<String>,
    pub tools: Option<Vec<String>>,
}

fn to_db_timestamp(value: i64) -> i64 {
    if value.abs() >= 1_000_000_000_000 {
        value
    } else {
        value.saturating_mul(1000)
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

fn row_to_agent(row: &Value) -> Result<Agent, String> {
    let tools: Vec<String> = row
        .get("tools_config")
        .and_then(|v| v.as_str())
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();

    Ok(Agent {
        id: row
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        name: row
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        model: row
            .get("model_type")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        system_prompt: row
            .get("system_prompt")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        tools,
        created_at: row
            .get("created_at")
            .and_then(|v| v.as_i64())
            .map(|v| {
                if v.abs() >= 1_000_000_000_000 {
                    v / 1000
                } else {
                    v
                }
            })
            .unwrap_or(0),
        updated_at: row
            .get("updated_at")
            .and_then(|v| v.as_i64())
            .map(|v| {
                if v.abs() >= 1_000_000_000_000 {
                    v / 1000
                } else {
                    v
                }
            })
            .unwrap_or(0),
    })
}
