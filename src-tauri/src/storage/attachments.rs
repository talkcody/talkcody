//! Attachments Repository
//! Handles CRUD operations for file attachments in chat_history.db
//! Also manages file system operations for attachment storage

use crate::database::Database;
use crate::storage::models::{Attachment, AttachmentId, AttachmentOrigin, SessionId};
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

    /// Get the storage path for an attachment
    fn attachment_path(&self, attachment_id: &str) -> PathBuf {
        // Use first 2 chars of ID as subdirectory to avoid too many files in one dir
        let prefix = &attachment_id[..2.min(attachment_id.len())];
        self.storage_root.join(prefix).join(attachment_id)
    }

    /// Create attachment metadata record and store file
    pub async fn create_attachment(
        &self,
        attachment: &Attachment,
        data: &[u8],
    ) -> Result<(), String> {
        // Ensure storage directory exists
        let file_path = self.attachment_path(&attachment.id);
        if let Some(parent) = file_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create attachment directory: {}", e))?;
        }

        // Write file atomically using temp file + rename
        let temp_path = file_path.with_extension("tmp");
        std::fs::write(&temp_path, data)
            .map_err(|e| format!("Failed to write attachment file: {}", e))?;
        std::fs::rename(&temp_path, &file_path)
            .map_err(|e| format!("Failed to finalize attachment file: {}", e))?;

        // Create database record
        let sql = r#"
            INSERT INTO attachments (id, session_id, message_id, filename, mime_type, size, path, created_at, origin)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        "#;

        self.db
            .execute(
                sql,
                vec![
                    serde_json::json!(attachment.id),
                    serde_json::json!(attachment.session_id),
                    serde_json::json!(attachment.message_id),
                    serde_json::json!(attachment.filename),
                    serde_json::json!(attachment.mime_type),
                    serde_json::json!(attachment.size),
                    serde_json::json!(file_path.to_string_lossy()),
                    serde_json::json!(attachment.created_at),
                    serde_json::json!(attachment.origin.as_str()),
                ],
            )
            .await?;

        Ok(())
    }

    /// Get attachment metadata by ID
    pub async fn get_attachment(&self, attachment_id: &str) -> Result<Option<Attachment>, String> {
        let result = self
            .db
            .query(
                "SELECT * FROM attachments WHERE id = ?",
                vec![serde_json::json!(attachment_id)],
            )
            .await?;

        Ok(result.rows.first().map(|row| row_to_attachment(row)))
    }

    /// Read attachment file data
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

    /// List attachments for a session
    pub async fn list_attachments(
        &self,
        session_id: &str,
        limit: Option<usize>,
    ) -> Result<Vec<Attachment>, String> {
        let mut sql =
            "SELECT * FROM attachments WHERE session_id = ? ORDER BY created_at DESC".to_string();

        if let Some(limit) = limit {
            sql.push_str(&format!(" LIMIT {}", limit));
        }

        let result = self
            .db
            .query(&sql, vec![serde_json::json!(session_id)])
            .await?;

        Ok(result.rows.iter().map(row_to_attachment).collect())
    }

    /// Delete attachment (metadata and file)
    pub async fn delete_attachment(&self, attachment_id: &str) -> Result<(), String> {
        // Get attachment info first
        if let Some(attachment) = self.get_attachment(attachment_id).await? {
            // Delete file
            let _ = std::fs::remove_file(&attachment.path);

            // Delete parent directory if empty
            if let Some(parent) = Path::new(&attachment.path).parent() {
                let _ = std::fs::remove_dir(parent);
            }
        }

        // Delete database record
        self.db
            .execute(
                "DELETE FROM attachments WHERE id = ?",
                vec![serde_json::json!(attachment_id)],
            )
            .await?;

        Ok(())
    }

    /// Delete all attachments for a session
    pub async fn delete_session_attachments(&self, session_id: &str) -> Result<u64, String> {
        // Get all attachments first
        let attachments = self.list_attachments(session_id, None).await?;

        // Delete files
        for attachment in attachments {
            let _ = std::fs::remove_file(&attachment.path);
            if let Some(parent) = Path::new(&attachment.path).parent() {
                let _ = std::fs::remove_dir(parent);
            }
        }

        // Delete database records
        let result = self
            .db
            .execute(
                "DELETE FROM attachments WHERE session_id = ?",
                vec![serde_json::json!(session_id)],
            )
            .await?;

        Ok(result.rows_affected)
    }

    /// Get total size of attachments for a session
    pub async fn get_session_attachments_size(&self, session_id: &str) -> Result<i64, String> {
        let result = self
            .db
            .query(
                "SELECT COALESCE(SUM(size), 0) as total_size FROM attachments WHERE session_id = ?",
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

    /// Check if attachment exists
    pub async fn attachment_exists(&self, attachment_id: &str) -> Result<bool, String> {
        let result = self
            .db
            .query(
                "SELECT 1 as exists_flag FROM attachments WHERE id = ? LIMIT 1",
                vec![serde_json::json!(attachment_id)],
            )
            .await?;

        Ok(!result.rows.is_empty())
    }
}

// ============== Row Conversion ==============

fn row_to_attachment(row: &serde_json::Value) -> Attachment {
    Attachment {
        id: row
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        session_id: row
            .get("session_id")
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
            .get("path")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        created_at: row.get("created_at").and_then(|v| v.as_i64()).unwrap_or(0),
        origin: row
            .get("origin")
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse().ok())
            .unwrap_or(AttachmentOrigin::UserUpload),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::Database;
    use tempfile::TempDir;

    async fn create_test_repo() -> (AttachmentsRepository, TempDir) {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");
        let db = Arc::new(Database::new(db_path.to_string_lossy().to_string()));
        db.connect()
            .await
            .expect("Failed to connect to test database");

        // Run migrations
        let migrations = super::super::migrations::chat_history_migrations();
        let runner = super::super::migrations::MigrationRunner::new(&db, &migrations);
        runner.init().await.expect("Failed to init migrations");
        runner.migrate().await.expect("Failed to run migrations");

        // Create test sessions to satisfy foreign key constraints
        let now = chrono::Utc::now().timestamp();
        let sessions = vec!["session-1", "session-list", "session-del"];
        for session_id in sessions {
            db.execute(
                "INSERT INTO sessions (id, project_id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                vec![
                    serde_json::json!(session_id),
                    serde_json::json!(None::<String>),
                    serde_json::json!("Test Session"),
                    serde_json::json!("created"),
                    serde_json::json!(now),
                    serde_json::json!(now),
                ],
            )
            .await
            .expect("Failed to create test session");
        }

        let storage_root = temp_dir.path().join("attachments");
        let repo = AttachmentsRepository::new(db, storage_root);

        (repo, temp_dir)
    }

    #[tokio::test]
    async fn test_create_and_get_attachment() {
        let (repo, _temp) = create_test_repo().await;

        let attachment = Attachment {
            id: "att-1".to_string(),
            session_id: "session-1".to_string(),
            message_id: None,
            filename: "test.txt".to_string(),
            mime_type: "text/plain".to_string(),
            size: 12,
            path: "".to_string(), // Will be set by create_attachment
            created_at: chrono::Utc::now().timestamp(),
            origin: AttachmentOrigin::UserUpload,
        };

        let data = b"Hello World!";
        repo.create_attachment(&attachment, data)
            .await
            .expect("Failed to create attachment");

        let retrieved = repo
            .get_attachment("att-1")
            .await
            .expect("Failed to get attachment")
            .expect("Attachment should exist");

        assert_eq!(retrieved.id, "att-1");
        assert_eq!(retrieved.filename, "test.txt");
        assert_eq!(retrieved.size, 12);
    }

    #[tokio::test]
    async fn test_read_attachment_data() {
        let (repo, _temp) = create_test_repo().await;

        let attachment = Attachment {
            id: "att-2".to_string(),
            session_id: "session-1".to_string(),
            message_id: None,
            filename: "data.bin".to_string(),
            mime_type: "application/octet-stream".to_string(),
            size: 4,
            path: "".to_string(),
            created_at: chrono::Utc::now().timestamp(),
            origin: AttachmentOrigin::ToolOutput,
        };

        let data = vec![0x00, 0x01, 0x02, 0x03];
        repo.create_attachment(&attachment, &data)
            .await
            .expect("Failed to create attachment");

        let retrieved_data = repo
            .read_attachment_data("att-2")
            .await
            .expect("Failed to read data")
            .expect("Data should exist");

        assert_eq!(retrieved_data, data);
    }

    #[tokio::test]
    async fn test_list_attachments() {
        let (repo, _temp) = create_test_repo().await;

        for i in 0..3 {
            let attachment = Attachment {
                id: format!("att-{}", i),
                session_id: "session-list".to_string(),
                message_id: None,
                filename: format!("file{}.txt", i),
                mime_type: "text/plain".to_string(),
                size: 10,
                path: "".to_string(),
                created_at: chrono::Utc::now().timestamp() + i as i64,
                origin: AttachmentOrigin::UserUpload,
            };
            repo.create_attachment(&attachment, b"content")
                .await
                .expect("Failed to create attachment");
        }

        let attachments = repo
            .list_attachments("session-list", None)
            .await
            .expect("Failed to list attachments");

        assert_eq!(attachments.len(), 3);
    }

    #[tokio::test]
    async fn test_delete_attachment() {
        let (repo, _temp) = create_test_repo().await;

        let attachment = Attachment {
            id: "att-delete".to_string(),
            session_id: "session-del".to_string(),
            message_id: None,
            filename: "delete.txt".to_string(),
            mime_type: "text/plain".to_string(),
            size: 5,
            path: "".to_string(),
            created_at: chrono::Utc::now().timestamp(),
            origin: AttachmentOrigin::UserUpload,
        };

        repo.create_attachment(&attachment, b"hello")
            .await
            .expect("Failed to create attachment");

        repo.delete_attachment("att-delete")
            .await
            .expect("Failed to delete attachment");

        let retrieved = repo
            .get_attachment("att-delete")
            .await
            .expect("Failed to get attachment");

        assert!(retrieved.is_none());
    }
}
