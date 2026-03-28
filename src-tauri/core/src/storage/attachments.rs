//! Attachments Repository
//! Handles CRUD operations for unified talkcody.db attachments.
//! Also manages file system operations for attachment storage.

use crate::database::Database;
use crate::storage::models::{Attachment, AttachmentOrigin};
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// Repository for attachment operations
#[derive(Clone)]
pub struct AttachmentsRepository {
    db: Arc<Database>,
    storage_root: PathBuf,
}

impl AttachmentsRepository {
    pub fn new(db: Arc<Database>, storage_root: PathBuf) -> Self {
        Self { db, storage_root }
    }

    fn attachment_path(&self, attachment_id: &str) -> PathBuf {
        let prefix = &attachment_id[..2.min(attachment_id.len())];
        self.storage_root.join(prefix).join(attachment_id)
    }

    pub async fn create_attachment(
        &self,
        attachment: &Attachment,
        data: &[u8],
    ) -> Result<(), String> {
        let file_path = self.attachment_path(&attachment.id);
        if let Some(parent) = file_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create attachment directory: {}", e))?;
        }

        let temp_path = file_path.with_extension("tmp");
        std::fs::write(&temp_path, data)
            .map_err(|e| format!("Failed to write attachment file: {}", e))?;
        std::fs::rename(&temp_path, &file_path)
            .map_err(|e| format!("Failed to finalize attachment file: {}", e))?;

        let message_id = match &attachment.message_id {
            Some(message_id) => message_id.clone(),
            None => {
                self.ensure_holder_message(&attachment.session_id, attachment.created_at)
                    .await?
            }
        };

        self.db
            .execute(
                r#"
                INSERT INTO message_attachments (
                    id, message_id, type, filename, file_path, mime_type, size, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                "#,
                vec![
                    serde_json::json!(attachment.id),
                    serde_json::json!(message_id),
                    serde_json::json!(attachment_type(&attachment.mime_type, &attachment.filename)),
                    serde_json::json!(attachment.filename),
                    serde_json::json!(file_path.to_string_lossy()),
                    serde_json::json!(attachment.mime_type),
                    serde_json::json!(attachment.size),
                    serde_json::json!(to_db_timestamp(attachment.created_at)),
                ],
            )
            .await?;

        Ok(())
    }

    pub async fn get_attachment(&self, attachment_id: &str) -> Result<Option<Attachment>, String> {
        let result = self
            .db
            .query(
                r#"
                SELECT ma.*, m.conversation_id
                FROM message_attachments ma
                JOIN messages m ON m.id = ma.message_id
                WHERE ma.id = ?
                "#,
                vec![serde_json::json!(attachment_id)],
            )
            .await?;

        Ok(result.rows.first().map(row_to_attachment))
    }

    pub async fn read_attachment_data(
        &self,
        attachment_id: &str,
    ) -> Result<Option<Vec<u8>>, String> {
        let attachment = match self.get_attachment(attachment_id).await? {
            Some(a) => a,
            None => return Ok(None),
        };

        let data = std::fs::read(&attachment.path)
            .map_err(|e| format!("Failed to read attachment file: {}", e))?;
        Ok(Some(data))
    }

    pub async fn list_attachments(
        &self,
        session_id: &str,
        limit: Option<usize>,
    ) -> Result<Vec<Attachment>, String> {
        let mut sql = r#"
            SELECT ma.*, m.conversation_id
            FROM message_attachments ma
            JOIN messages m ON m.id = ma.message_id
            WHERE m.conversation_id = ?
            ORDER BY ma.created_at DESC
        "#
        .to_string();

        if let Some(limit) = limit {
            sql.push_str(&format!(" LIMIT {}", limit));
        }

        let result = self
            .db
            .query(&sql, vec![serde_json::json!(session_id)])
            .await?;

        Ok(result.rows.iter().map(row_to_attachment).collect())
    }

    pub async fn delete_attachment(&self, attachment_id: &str) -> Result<(), String> {
        if let Some(attachment) = self.get_attachment(attachment_id).await? {
            let _ = std::fs::remove_file(&attachment.path);
            if let Some(parent) = Path::new(&attachment.path).parent() {
                let _ = std::fs::remove_dir(parent);
            }
        }

        self.db
            .execute(
                "DELETE FROM message_attachments WHERE id = ?",
                vec![serde_json::json!(attachment_id)],
            )
            .await?;
        Ok(())
    }

    pub async fn delete_session_attachments(&self, session_id: &str) -> Result<u64, String> {
        let attachments = self.list_attachments(session_id, None).await?;
        for attachment in &attachments {
            let _ = std::fs::remove_file(&attachment.path);
            if let Some(parent) = Path::new(&attachment.path).parent() {
                let _ = std::fs::remove_dir(parent);
            }
        }

        let result = self
            .db
            .execute(
                r#"
                DELETE FROM message_attachments
                WHERE message_id IN (
                    SELECT id FROM messages WHERE conversation_id = ?
                )
                "#,
                vec![serde_json::json!(session_id)],
            )
            .await?;

        Ok(result.rows_affected)
    }

    pub async fn get_session_attachments_size(&self, session_id: &str) -> Result<i64, String> {
        let result = self
            .db
            .query(
                r#"
                SELECT COALESCE(SUM(ma.size), 0) as total_size
                FROM message_attachments ma
                JOIN messages m ON m.id = ma.message_id
                WHERE m.conversation_id = ?
                "#,
                vec![serde_json::json!(session_id)],
            )
            .await?;

        Ok(result
            .rows
            .first()
            .and_then(|row| row.get("total_size"))
            .and_then(|v| v.as_i64())
            .unwrap_or(0))
    }

    pub async fn attachment_exists(&self, attachment_id: &str) -> Result<bool, String> {
        let result = self
            .db
            .query(
                "SELECT 1 as exists_flag FROM message_attachments WHERE id = ? LIMIT 1",
                vec![serde_json::json!(attachment_id)],
            )
            .await?;
        Ok(!result.rows.is_empty())
    }

    async fn ensure_holder_message(
        &self,
        session_id: &str,
        created_at: i64,
    ) -> Result<String, String> {
        let holder_id = format!("attachment-holder:{}", session_id);
        let existing = self
            .db
            .query(
                "SELECT id FROM messages WHERE id = ?",
                vec![serde_json::json!(&holder_id)],
            )
            .await?;
        if existing.rows.is_empty() {
            self.db
                .execute(
                    r#"
                    INSERT INTO messages (
                        id, conversation_id, role, content, timestamp, assistant_id, position_index
                    ) VALUES (?, ?, 'system', ?, ?, NULL,
                        COALESCE((SELECT MAX(position_index) + 1 FROM messages WHERE conversation_id = ?), 0)
                    )
                    "#,
                    vec![
                        serde_json::json!(&holder_id),
                        serde_json::json!(session_id),
                        serde_json::json!("[attachment-holder]"),
                        serde_json::json!(to_db_timestamp(created_at)),
                        serde_json::json!(session_id),
                    ],
                )
                .await?;
        }
        Ok(holder_id)
    }
}

fn attachment_type(mime_type: &str, _filename: &str) -> &'static str {
    if mime_type.starts_with("image/") {
        "image"
    } else {
        "file"
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

fn row_to_attachment(row: &serde_json::Value) -> Attachment {
    Attachment {
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
        message_id: row
            .get("message_id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        filename: row
            .get("filename")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        mime_type: row
            .get("mime_type")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        size: row.get("size").and_then(|v| v.as_i64()).unwrap_or(0),
        path: row
            .get("file_path")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        created_at: row
            .get("created_at")
            .and_then(|v| v.as_i64())
            .map(from_db_timestamp)
            .unwrap_or(0),
        origin: AttachmentOrigin::UserUpload,
    }
}
