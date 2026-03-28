//! Storage Layer for TalkCody
//!
//! Provides unified SQLite repository access for talkcody.db
//! This is shared between Desktop (TypeScript) and Server (Rust) modes.
//!
//! Table schema is based on src/services/database/turso-schema.ts

pub mod agents;
pub mod attachments;
pub mod chat_history;
pub mod migrations;
pub mod models;
pub mod settings;

use crate::database::Database;
use std::path::PathBuf;
use std::sync::Arc;

pub use agents::{AgentUpdates, AgentsRepository};
pub use attachments::AttachmentsRepository;
pub use chat_history::ChatHistoryRepository;
pub use models::*;
pub use settings::SettingsRepository;

/// Main storage manager that owns all repositories
/// Provides unified access to all database operations
#[derive(Clone)]
pub struct Storage {
    /// Chat history repository (chat_history.db)
    pub chat_history: ChatHistoryRepository,
    /// Agents repository (agents.db)
    pub agents: AgentsRepository,
    /// Settings repository (settings.db)
    pub settings: SettingsRepository,
    /// Attachments repository (chat_history.db + filesystem)
    pub attachments: AttachmentsRepository,
}

impl Storage {
    /// Create a new Storage instance with unified talkcody.db
    ///
    /// # Arguments
    /// * `data_root` - Root directory for database files
    /// * `attachments_root` - Root directory for attachment file storage
    pub async fn new(data_root: PathBuf, attachments_root: PathBuf) -> Result<Self, String> {
        // Use unified talkcody.db (shared with TypeScript frontend)
        let db_path = data_root.join("talkcody.db");
        let db = Arc::new(Database::new(db_path.to_string_lossy().to_string()));
        db.connect()
            .await
            .map_err(|e| format!("Failed to connect to talkcody.db: {}", e))?;

        // Run unified migrations
        let registry = migrations::talkcody_db::talkcody_migrations();
        let runner = migrations::MigrationRunner::new(&db, &registry);
        runner
            .migrate()
            .await
            .map_err(|e| format!("Failed to run talkcody.db migrations: {}", e))?;

        // Create repositories (all using the same db)
        let db_for_attachments = db.clone();
        let chat_history = ChatHistoryRepository::new(db.clone());
        let agents = AgentsRepository::new(db.clone());
        let settings = SettingsRepository::new(db.clone());
        let attachments = AttachmentsRepository::new(db_for_attachments, attachments_root);

        Ok(Self {
            chat_history,
            agents,
            settings,
            attachments,
        })
    }

    /// Run database migrations manually (useful for testing or upgrades)
    pub async fn run_migrations(&self) -> Result<(), String> {
        // Note: This is a no-op if migrations were already run during new()
        // In a real implementation, we might want to store the Database references
        // to allow re-running migrations
        Ok(())
    }
}

/// Storage configuration for creating Storage instances
#[derive(Debug, Clone)]
pub struct StorageConfig {
    pub data_root: PathBuf,
    pub attachments_root: PathBuf,
}

impl StorageConfig {
    pub fn new(data_root: PathBuf) -> Self {
        let attachments_root = data_root.join("attachments");
        Self {
            data_root,
            attachments_root,
        }
    }

    pub fn with_attachments_root(mut self, path: PathBuf) -> Self {
        self.attachments_root = path;
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[tokio::test]
    async fn test_storage_creation() {
        let temp_dir = TempDir::new().unwrap();
        let storage = Storage::new(
            temp_dir.path().to_path_buf(),
            temp_dir.path().join("attachments"),
        )
        .await;

        assert!(storage.is_ok());

        let _storage = storage.unwrap();

        // Verify unified database was created
        assert!(temp_dir.path().join("talkcody.db").exists());
    }

    #[tokio::test]
    async fn test_storage_operations() {
        let temp_dir = TempDir::new().unwrap();
        let storage = Storage::new(
            temp_dir.path().to_path_buf(),
            temp_dir.path().join("attachments"),
        )
        .await
        .unwrap();

        // Test creating a session
        let session = Session {
            id: "test-session".to_string(),
            project_id: Some("project-1".to_string()),
            title: Some("Test Session".to_string()),
            status: SessionStatus::Created,
            created_at: chrono::Utc::now().timestamp(),
            updated_at: chrono::Utc::now().timestamp(),
            last_event_id: None,
            metadata: None,
        };

        storage
            .chat_history
            .create_session(&session)
            .await
            .expect("Failed to create session");

        let retrieved = storage
            .chat_history
            .get_session("test-session")
            .await
            .expect("Failed to get session");

        assert!(retrieved.is_some());
        assert_eq!(retrieved.unwrap().id, "test-session");
    }
}
