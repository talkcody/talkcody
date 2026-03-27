//! Chat History Repository
//! Maps Rust session/message APIs onto the unified talkcody.db schema.

use crate::database::Database;
use crate::storage::models::*;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::sync::Arc;

const SERVER_COMPAT_KEY: &str = "_serverCompat";
const DEFAULT_PROJECT_ID: &str = "default";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServerSessionCompat {
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_event_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    metadata: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MessageEnvelope {
    content: MessageContent,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_call_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    parent_id: Option<String>,
}

/// Repository for chat history operations.
#[derive(Clone)]
pub struct ChatHistoryRepository {
    db: Arc<Database>,
}

impl ChatHistoryRepository {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }

    pub fn get_db(&self) -> Arc<Database> {
        self.db.clone()
    }

    async fn ensure_project_exists(&self, project_id: &str, timestamp: i64) -> Result<(), String> {
        let project_name = if project_id == DEFAULT_PROJECT_ID {
            "Default Project"
        } else {
            project_id
        };

        self.db
            .execute(
                r#"
                INSERT OR IGNORE INTO projects (
                    id, name, description, created_at, updated_at, context, rules, root_path
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                "#,
                vec![
                    serde_json::json!(project_id),
                    serde_json::json!(project_name),
                    serde_json::json!(""),
                    serde_json::json!(timestamp),
                    serde_json::json!(timestamp),
                    serde_json::json!(""),
                    serde_json::json!(""),
                    Value::Null,
                ],
            )
            .await?;

        Ok(())
    }

    // ============== Session Operations ==============

    pub async fn create_session(&self, session: &Session) -> Result<(), String> {
        let project_id = session.project_id.as_deref().unwrap_or(DEFAULT_PROJECT_ID);
        self.ensure_project_exists(project_id, to_db_timestamp(session.created_at))
            .await?;

        let settings_json = settings_map_to_string(build_settings_map(None, session)?)?;
        self.db
            .execute(
                r#"
                INSERT INTO conversations (
                    id, title, project_id, created_at, updated_at, settings
                ) VALUES (?, ?, ?, ?, ?, ?)
                "#,
                vec![
                    serde_json::json!(session.id),
                    serde_json::json!(session.title.clone().unwrap_or_default()),
                    serde_json::json!(project_id),
                    serde_json::json!(to_db_timestamp(session.created_at)),
                    serde_json::json!(to_db_timestamp(session.updated_at)),
                    serde_json::json!(settings_json),
                ],
            )
            .await?;
        Ok(())
    }

    pub async fn get_session(&self, session_id: &str) -> Result<Option<Session>, String> {
        let result = self
            .db
            .query(
                "SELECT * FROM conversations WHERE id = ?",
                vec![serde_json::json!(session_id)],
            )
            .await?;
        result.rows.first().map(row_to_session).transpose()
    }

    pub async fn update_session_status(
        &self,
        session_id: &str,
        status: SessionStatus,
        last_event_id: Option<&str>,
    ) -> Result<(), String> {
        let settings_map = self.get_conversation_settings(session_id).await?;
        let compat = compat_from_settings_map(&settings_map)?;
        let merged_settings = settings_map_to_string(set_compat_on_settings_map(
            settings_map,
            ServerSessionCompat {
                status: Some(status.as_str().to_string()),
                last_event_id: last_event_id
                    .map(ToOwned::to_owned)
                    .or(compat.last_event_id),
                metadata: compat.metadata,
            },
        ))?;

        self.db
            .execute(
                "UPDATE conversations SET settings = ?, updated_at = ? WHERE id = ?",
                vec![
                    serde_json::json!(merged_settings),
                    serde_json::json!(to_db_timestamp(chrono::Utc::now().timestamp())),
                    serde_json::json!(session_id),
                ],
            )
            .await?;
        Ok(())
    }

    pub async fn update_session_title(&self, session_id: &str, title: &str) -> Result<(), String> {
        self.db
            .execute(
                "UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?",
                vec![
                    serde_json::json!(title),
                    serde_json::json!(to_db_timestamp(chrono::Utc::now().timestamp())),
                    serde_json::json!(session_id),
                ],
            )
            .await?;
        Ok(())
    }

    pub async fn list_sessions(
        &self,
        project_id: Option<&str>,
        status: Option<SessionStatus>,
        limit: Option<usize>,
        offset: Option<usize>,
    ) -> Result<Vec<Session>, String> {
        let mut sql = "SELECT * FROM conversations WHERE 1=1".to_string();
        let mut params: Vec<Value> = vec![];

        if let Some(pid) = project_id {
            sql.push_str(" AND project_id = ?");
            params.push(serde_json::json!(pid));
        }
        sql.push_str(" ORDER BY updated_at DESC");

        let result = self.db.query(&sql, params).await?;
        let mut sessions = Vec::new();
        for row in &result.rows {
            let session = row_to_session(row)?;
            if status.is_none_or(|wanted| session.status == wanted) {
                sessions.push(session);
            }
        }

        let start = offset.unwrap_or(0);
        if start >= sessions.len() {
            return Ok(vec![]);
        }
        let end = limit
            .map(|lim| start.saturating_add(lim))
            .unwrap_or(sessions.len());
        Ok(sessions[start..sessions.len().min(end)].to_vec())
    }

    pub async fn delete_session(&self, session_id: &str) -> Result<(), String> {
        self.db
            .execute(
                "DELETE FROM conversations WHERE id = ?",
                vec![serde_json::json!(session_id)],
            )
            .await?;
        Ok(())
    }

    // ============== Message Operations ==============

    pub async fn create_message(&self, message: &Message) -> Result<(), String> {
        let position_index = self.next_message_position(&message.session_id).await?;
        self.db
            .execute(
                r#"
                INSERT INTO messages (
                    id, conversation_id, role, content, timestamp, assistant_id, position_index
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                "#,
                vec![
                    serde_json::json!(message.id),
                    serde_json::json!(message.session_id),
                    serde_json::json!(message.role.as_str()),
                    serde_json::json!(message_to_db_content(message)?),
                    serde_json::json!(to_db_timestamp(message.created_at)),
                    serde_json::json!(None::<String>),
                    serde_json::json!(position_index),
                ],
            )
            .await?;

        self.db
            .execute(
                r#"
                UPDATE conversations
                SET updated_at = ?, message_count = COALESCE(message_count, 0) + 1
                WHERE id = ?
                "#,
                vec![
                    serde_json::json!(to_db_timestamp(chrono::Utc::now().timestamp())),
                    serde_json::json!(&message.session_id),
                ],
            )
            .await?;
        Ok(())
    }

    pub async fn get_messages(
        &self,
        session_id: &str,
        limit: Option<usize>,
        before_id: Option<&str>,
    ) -> Result<Vec<Message>, String> {
        let mut sql = "SELECT * FROM messages WHERE conversation_id = ?".to_string();
        let mut params: Vec<Value> = vec![serde_json::json!(session_id)];

        if let Some(before) = before_id {
            let before_result = self
                .db
                .query(
                    "SELECT timestamp FROM messages WHERE id = ?",
                    vec![serde_json::json!(before)],
                )
                .await?;
            if let Some(row) = before_result.rows.first() {
                if let Some(ts) = row.get("timestamp").and_then(|v| v.as_i64()) {
                    sql.push_str(" AND timestamp < ?");
                    params.push(serde_json::json!(ts));
                }
            }
        }

        sql.push_str(" ORDER BY timestamp DESC");
        if let Some(limit) = limit {
            sql.push_str(&format!(" LIMIT {}", limit));
        }

        let result = self.db.query(&sql, params).await?;
        let mut messages = result
            .rows
            .iter()
            .map(row_to_message)
            .collect::<Result<Vec<_>, _>>()?;
        messages.reverse();
        Ok(messages)
    }

    pub async fn delete_messages(&self, session_id: &str) -> Result<(), String> {
        self.db
            .execute(
                "DELETE FROM messages WHERE conversation_id = ?",
                vec![serde_json::json!(session_id)],
            )
            .await?;
        Ok(())
    }

    // ============== Event Operations ==============

    /// Unified schema does not persist events yet; keep server streaming in-memory only.
    pub async fn create_event(&self, _event: &SessionEvent) -> Result<(), String> {
        Ok(())
    }

    pub async fn get_events(
        &self,
        _session_id: &str,
        _after_event_id: Option<&str>,
        _limit: Option<usize>,
    ) -> Result<Vec<SessionEvent>, String> {
        Ok(vec![])
    }

    pub async fn delete_events_before(
        &self,
        _session_id: &str,
        _before_timestamp: i64,
    ) -> Result<u64, String> {
        Ok(0)
    }

    async fn next_message_position(&self, session_id: &str) -> Result<i64, String> {
        let result = self
            .db
            .query(
                "SELECT COALESCE(MAX(position_index), -1) as max_position FROM messages WHERE conversation_id = ?",
                vec![serde_json::json!(session_id)],
            )
            .await?;
        Ok(result
            .rows
            .first()
            .and_then(|row| row.get("max_position"))
            .and_then(|v| v.as_i64())
            .unwrap_or(-1)
            + 1)
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
}

fn to_db_timestamp(value: i64) -> i64 {
    if value.abs() >= 1_000_000_000_000 {
        value
    } else {
        value.saturating_mul(1000)
    }
}

fn from_db_timestamp(value: i64) -> i64 {
    if value.abs() >= 1_000_000_000_000 {
        value / 1000
    } else {
        value
    }
}

fn parse_settings_map(raw: Option<&str>) -> Result<Map<String, Value>, String> {
    match raw {
        Some(raw) if !raw.trim().is_empty() => match serde_json::from_str::<Value>(raw) {
            Ok(Value::Object(map)) => Ok(map),
            Ok(_) => Ok(Map::new()),
            Err(e) => Err(format!("Failed to parse conversation.settings: {}", e)),
        },
        _ => Ok(Map::new()),
    }
}

fn settings_map_to_string(map: Map<String, Value>) -> Result<String, String> {
    serde_json::to_string(&Value::Object(map))
        .map_err(|e| format!("Failed to serialize settings: {}", e))
}

fn compat_from_settings_map(map: &Map<String, Value>) -> Result<ServerSessionCompat, String> {
    match map.get(SERVER_COMPAT_KEY) {
        Some(value) => serde_json::from_value(value.clone())
            .map_err(|e| format!("Failed to parse server compat payload: {}", e)),
        None => Ok(ServerSessionCompat::default()),
    }
}

fn set_compat_on_settings_map(
    mut map: Map<String, Value>,
    compat: ServerSessionCompat,
) -> Map<String, Value> {
    map.insert(
        SERVER_COMPAT_KEY.to_string(),
        serde_json::to_value(compat).unwrap_or(Value::Object(Map::new())),
    );
    map
}

fn build_settings_map(
    existing: Option<Map<String, Value>>,
    session: &Session,
) -> Result<Map<String, Value>, String> {
    let mut map = existing.unwrap_or_default();
    map = set_compat_on_settings_map(
        map,
        ServerSessionCompat {
            status: Some(session.status.as_str().to_string()),
            last_event_id: session.last_event_id.clone(),
            metadata: session.metadata.clone(),
        },
    );
    Ok(map)
}

fn row_to_session(row: &Value) -> Result<Session, String> {
    let settings_map = parse_settings_map(row.get("settings").and_then(|v| v.as_str()))?;
    let compat = compat_from_settings_map(&settings_map)?;
    Ok(Session {
        id: row
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        project_id: row
            .get("project_id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        title: row
            .get("title")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        status: compat
            .status
            .as_deref()
            .and_then(|s| s.parse().ok())
            .unwrap_or(SessionStatus::Created),
        created_at: row
            .get("created_at")
            .and_then(|v| v.as_i64())
            .map(from_db_timestamp)
            .unwrap_or(0),
        updated_at: row
            .get("updated_at")
            .and_then(|v| v.as_i64())
            .map(from_db_timestamp)
            .unwrap_or(0),
        last_event_id: compat.last_event_id,
        metadata: compat.metadata,
    })
}

fn message_to_db_content(message: &Message) -> Result<String, String> {
    match (&message.content, &message.tool_call_id, &message.parent_id) {
        (MessageContent::Text { text }, None, None) => Ok(text.clone()),
        _ => serde_json::to_string(&MessageEnvelope {
            content: message.content.clone(),
            tool_call_id: message.tool_call_id.clone(),
            parent_id: message.parent_id.clone(),
        })
        .map_err(|e| format!("Failed to serialize message content: {}", e)),
    }
}

fn row_to_message(row: &Value) -> Result<Message, String> {
    let raw_content = row
        .get("content")
        .and_then(|v| v.as_str())
        .ok_or("Missing content field")?;

    let (content, tool_call_id, parent_id) =
        if let Ok(envelope) = serde_json::from_str::<MessageEnvelope>(raw_content) {
            (envelope.content, envelope.tool_call_id, envelope.parent_id)
        } else if let Ok(content) = serde_json::from_str::<MessageContent>(raw_content) {
            (content, None, None)
        } else {
            (
                MessageContent::Text {
                    text: raw_content.to_string(),
                },
                None,
                None,
            )
        };

    Ok(Message {
        id: row
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        session_id: row
            .get("conversation_id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        role: row
            .get("role")
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse().ok())
            .unwrap_or(MessageRole::User),
        content,
        created_at: row
            .get("timestamp")
            .and_then(|v| v.as_i64())
            .map(from_db_timestamp)
            .unwrap_or(0),
        tool_call_id,
        parent_id,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    async fn create_test_db() -> (Arc<Database>, TempDir) {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");
        let db = Arc::new(Database::new(db_path.to_string_lossy().to_string()));
        db.connect()
            .await
            .expect("Failed to connect to test database");

        let migrations = super::super::migrations::talkcody_db::talkcody_migrations();
        let runner = super::super::migrations::MigrationRunner::new(&db, &migrations);
        runner.init().await.expect("Failed to init migrations");
        runner.migrate().await.expect("Failed to run migrations");

        (db, temp_dir)
    }

    #[tokio::test]
    async fn test_create_and_get_session() {
        let (db, _temp) = create_test_db().await;
        let repo = ChatHistoryRepository::new(db);

        let session = Session {
            id: "test-session-1".to_string(),
            project_id: Some("project-1".to_string()),
            title: Some("Test Session".to_string()),
            status: SessionStatus::Created,
            created_at: chrono::Utc::now().timestamp(),
            updated_at: chrono::Utc::now().timestamp(),
            last_event_id: None,
            metadata: Some(serde_json::json!({"key": "value"})),
        };

        repo.create_session(&session)
            .await
            .expect("Failed to create session");
        let retrieved = repo
            .get_session("test-session-1")
            .await
            .expect("Failed to get session");
        assert!(retrieved.is_some());
        let retrieved = retrieved.unwrap();
        assert_eq!(retrieved.id, "test-session-1");
        assert_eq!(retrieved.project_id, Some("project-1".to_string()));
        assert_eq!(retrieved.title, Some("Test Session".to_string()));
        assert_eq!(retrieved.status, SessionStatus::Created);
    }

    #[tokio::test]
    async fn test_create_session_creates_missing_project_reference() {
        let (db, _temp) = create_test_db().await;
        let repo = ChatHistoryRepository::new(db.clone());

        let session = Session {
            id: "test-session-project".to_string(),
            project_id: Some("project-42".to_string()),
            title: Some("Project-backed Session".to_string()),
            status: SessionStatus::Created,
            created_at: chrono::Utc::now().timestamp(),
            updated_at: chrono::Utc::now().timestamp(),
            last_event_id: None,
            metadata: None,
        };

        repo.create_session(&session)
            .await
            .expect("Failed to create session");

        let project = db
            .query(
                "SELECT id, name FROM projects WHERE id = ?",
                vec![serde_json::json!("project-42")],
            )
            .await
            .expect("Failed to fetch project");

        assert_eq!(project.rows.len(), 1);
        assert_eq!(
            project.rows[0].get("id").and_then(|value| value.as_str()),
            Some("project-42")
        );
        assert_eq!(
            project.rows[0].get("name").and_then(|value| value.as_str()),
            Some("project-42")
        );
    }

    #[tokio::test]
    async fn test_update_session_status() {
        let (db, _temp) = create_test_db().await;
        let repo = ChatHistoryRepository::new(db);

        let session = Session {
            id: "test-session-2".to_string(),
            project_id: None,
            title: None,
            status: SessionStatus::Created,
            created_at: chrono::Utc::now().timestamp(),
            updated_at: chrono::Utc::now().timestamp(),
            last_event_id: None,
            metadata: None,
        };

        repo.create_session(&session)
            .await
            .expect("Failed to create session");
        repo.update_session_status("test-session-2", SessionStatus::Running, Some("event-1"))
            .await
            .expect("Failed to update status");

        let retrieved = repo
            .get_session("test-session-2")
            .await
            .expect("Failed to get session");
        let retrieved = retrieved.unwrap();
        assert_eq!(retrieved.status, SessionStatus::Running);
        assert_eq!(retrieved.last_event_id, Some("event-1".to_string()));
    }

    #[tokio::test]
    async fn test_create_and_get_messages() {
        let (db, _temp) = create_test_db().await;
        let repo = ChatHistoryRepository::new(db);

        let session = Session {
            id: "test-session-3".to_string(),
            project_id: None,
            title: None,
            status: SessionStatus::Created,
            created_at: chrono::Utc::now().timestamp(),
            updated_at: chrono::Utc::now().timestamp(),
            last_event_id: None,
            metadata: None,
        };
        repo.create_session(&session)
            .await
            .expect("Failed to create session");

        let message = Message {
            id: "msg-1".to_string(),
            session_id: "test-session-3".to_string(),
            role: MessageRole::User,
            content: MessageContent::Text {
                text: "Hello".to_string(),
            },
            created_at: chrono::Utc::now().timestamp(),
            tool_call_id: None,
            parent_id: None,
        };

        repo.create_message(&message)
            .await
            .expect("Failed to create message");
        let messages = repo
            .get_messages("test-session-3", None, None)
            .await
            .expect("Failed to get messages");
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].id, "msg-1");
        match &messages[0].content {
            MessageContent::Text { text } => assert_eq!(text, "Hello"),
            _ => panic!("expected text message"),
        }
    }
}
