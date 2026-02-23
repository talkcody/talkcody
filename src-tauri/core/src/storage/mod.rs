//! Storage Layer for Cloud Backend
//!
//! Provides SQLite repositories for:
//! - chat_history.db: Sessions, messages, events, attachments
//! - agents.db: Agent configurations and agent-session associations  
//! - settings.db: Application settings and task-specific settings
//!
//! All repositories use the shared Database abstraction from database.rs

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
    /// Create a new Storage instance with database connections
    ///
    /// # Arguments
    /// * `data_root` - Root directory for database files
    /// * `attachments_root` - Root directory for attachment file storage
    pub async fn new(data_root: PathBuf, attachments_root: PathBuf) -> Result<Self, String> {
        // Create database file paths
        let chat_history_path = data_root.join("chat_history.db");
        let agents_path = data_root.join("agents.db");
        let settings_path = data_root.join("settings.db");

        // Create and connect to each database
        let chat_history_db = Arc::new(Database::new(
            chat_history_path.to_string_lossy().to_string(),
        ));
        chat_history_db
            .connect()
            .await
            .map_err(|e| format!("Failed to connect to chat_history.db: {}", e))?;

        let agents_db = Arc::new(Database::new(agents_path.to_string_lossy().to_string()));
        agents_db
            .connect()
            .await
            .map_err(|e| format!("Failed to connect to agents.db: {}", e))?;

        let settings_db = Arc::new(Database::new(settings_path.to_string_lossy().to_string()));
        settings_db
            .connect()
            .await
            .map_err(|e| format!("Failed to connect to settings.db: {}", e))?;

        // Run migrations for all databases
        migrations::run_all_migrations(&chat_history_db, &agents_db, &settings_db)
            .await
            .map_err(|e| format!("Failed to run database migrations: {}", e))?;

        // Create repositories
        // Clone chat_history_db for attachments (both use the same DB)
        let chat_history_db_for_attachments = chat_history_db.clone();
        let chat_history = ChatHistoryRepository::new(chat_history_db);
        let agents = AgentsRepository::new(agents_db);
        let settings = SettingsRepository::new(settings_db);
        let attachments =
            AttachmentsRepository::new(chat_history_db_for_attachments, attachments_root);

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

        // Verify databases were created
        assert!(temp_dir.path().join("chat_history.db").exists());
        assert!(temp_dir.path().join("agents.db").exists());
        assert!(temp_dir.path().join("settings.db").exists());
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
