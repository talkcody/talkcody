//! Session Manager
//!
//! Manages session lifecycle, message handling, and session state persistence.
//! Coordinates with storage layer for persistence and runtime for execution.

use crate::storage::{Message, Session, SessionId, SessionStatus, Storage, TaskSettings};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

/// Session manager handles session lifecycle and operations
pub struct SessionManager {
    storage: Storage,
    active_sessions: RwLock<HashMap<SessionId, Arc<RwLock<SessionState>>>>,
}

/// In-memory state for an active session
#[derive(Debug, Clone)]
pub struct SessionState {
    pub session: Session,
    pub settings: TaskSettings,
    pub message_count: usize,
    pub is_active: bool,
}

impl SessionManager {
    pub fn new(storage: Storage) -> Self {
        Self {
            storage,
            active_sessions: RwLock::new(HashMap::new()),
        }
    }

    /// Create a new session
    pub async fn create_session(
        &self,
        project_id: Option<String>,
        title: Option<String>,
        settings: Option<TaskSettings>,
    ) -> Result<Session, String> {
        let now = chrono::Utc::now().timestamp();
        let session_id = format!("sess_{}", uuid::Uuid::new_v4().to_string().replace("-", ""));

        let session = Session {
            id: session_id.clone(),
            project_id,
            title: title.or_else(|| Some("New Session".to_string())),
            status: SessionStatus::Created,
            created_at: now,
            updated_at: now,
            last_event_id: None,
            metadata: None,
        };

        // Persist session
        self.storage.chat_history.create_session(&session).await?;

        // Store settings if provided
        let settings_for_state = if let Some(ref settings) = settings {
            self.storage
                .settings
                .set_task_settings(&session_id, settings)
                .await?;
            settings.clone()
        } else {
            TaskSettings::default()
        };

        // Add to active sessions
        let state = SessionState {
            session: session.clone(),
            settings: settings_for_state,
            message_count: 0,
            is_active: true,
        };

        let mut active = self.active_sessions.write().await;
        active.insert(session_id, Arc::new(RwLock::new(state)));

        Ok(session)
    }

    /// Get a session by ID
    pub async fn get_session(&self, session_id: &str) -> Result<Option<Session>, String> {
        // First check active sessions
        let active = self.active_sessions.read().await;
        if let Some(state) = active.get(session_id) {
            let state = state.read().await;
            return Ok(Some(state.session.clone()));
        }
        drop(active);

        // Fall back to storage
        self.storage.chat_history.get_session(session_id).await
    }

    /// Get session state (including settings)
    pub async fn get_session_state(
        &self,
        session_id: &str,
    ) -> Result<Option<SessionState>, String> {
        let active = self.active_sessions.read().await;
        if let Some(state) = active.get(session_id) {
            let state = state.read().await;
            return Ok(Some(state.clone()));
        }
        drop(active);

        // Load from storage
        let session = match self.storage.chat_history.get_session(session_id).await? {
            Some(s) => s,
            None => return Ok(None),
        };

        let settings = self
            .storage
            .settings
            .get_task_settings_or_default(session_id)
            .await?;
        let message_count = self
            .storage
            .chat_history
            .get_messages(session_id, None, None)
            .await?
            .len();

        Ok(Some(SessionState {
            session,
            settings,
            message_count,
            is_active: false,
        }))
    }

    /// Activate a session (load into memory)
    pub async fn activate_session(&self, session_id: &str) -> Result<SessionState, String> {
        let mut active = self.active_sessions.write().await;

        // Check if already active
        if let Some(state) = active.get(session_id) {
            let mut state = state.write().await;
            state.is_active = true;
            return Ok(state.clone());
        }

        // Load from storage
        let session = match self.storage.chat_history.get_session(session_id).await? {
            Some(s) => s,
            None => return Err(format!("Session '{}' not found", session_id)),
        };

        let settings = self
            .storage
            .settings
            .get_task_settings_or_default(session_id)
            .await?;
        let message_count = self
            .storage
            .chat_history
            .get_messages(session_id, None, None)
            .await?
            .len();

        let state = SessionState {
            session: session.clone(),
            settings,
            message_count,
            is_active: true,
        };

        let state_arc = Arc::new(RwLock::new(state.clone()));
        active.insert(session_id.to_string(), state_arc);

        Ok(state)
    }

    /// Deactivate a session (remove from memory, keep in storage)
    pub async fn deactivate_session(&self, session_id: &str) -> Result<(), String> {
        let mut active = self.active_sessions.write().await;
        active.remove(session_id);
        Ok(())
    }

    /// Update session status
    pub async fn update_session_status(
        &self,
        session_id: &str,
        status: SessionStatus,
        last_event_id: Option<&str>,
    ) -> Result<(), String> {
        // Update in storage
        self.storage
            .chat_history
            .update_session_status(session_id, status, last_event_id)
            .await?;

        // Update in memory if active
        let active = self.active_sessions.read().await;
        if let Some(state) = active.get(session_id) {
            let mut state = state.write().await;
            state.session.status = status;
            if let Some(event_id) = last_event_id {
                state.session.last_event_id = Some(event_id.to_string());
            }
        }

        Ok(())
    }

    /// Update session title
    pub async fn update_session_title(&self, session_id: &str, title: &str) -> Result<(), String> {
        self.storage
            .chat_history
            .update_session_title(session_id, title)
            .await?;

        let active = self.active_sessions.read().await;
        if let Some(state) = active.get(session_id) {
            let mut state = state.write().await;
            state.session.title = Some(title.to_string());
        }

        Ok(())
    }

    /// Add a message to a session
    pub async fn add_message(&self, message: Message) -> Result<(), String> {
        // Persist message
        self.storage.chat_history.create_message(&message).await?;

        // Update in-memory state
        let active = self.active_sessions.read().await;
        if let Some(state) = active.get(&message.session_id) {
            let mut state = state.write().await;
            state.message_count += 1;
        }

        Ok(())
    }

    /// Get messages for a session
    pub async fn get_messages(
        &self,
        session_id: &str,
        limit: Option<usize>,
        before_id: Option<&str>,
    ) -> Result<Vec<Message>, String> {
        self.storage
            .chat_history
            .get_messages(session_id, limit, before_id)
            .await
    }

    /// List sessions with optional filters
    pub async fn list_sessions(
        &self,
        project_id: Option<&str>,
        status: Option<SessionStatus>,
        limit: Option<usize>,
        offset: Option<usize>,
    ) -> Result<Vec<Session>, String> {
        self.storage
            .chat_history
            .list_sessions(project_id, status, limit, offset)
            .await
    }

    /// Delete a session and all related data
    pub async fn delete_session(&self, session_id: &str) -> Result<(), String> {
        // Remove from active sessions
        let mut active = self.active_sessions.write().await;
        active.remove(session_id);
        drop(active);

        // Delete attachments
        self.storage
            .attachments
            .delete_session_attachments(session_id)
            .await?;

        // Delete from storage (cascades to messages and events)
        self.storage.chat_history.delete_session(session_id).await?;

        // Delete task settings
        self.storage
            .settings
            .delete_task_settings(session_id)
            .await?;

        Ok(())
    }

    /// Get or create session settings
    pub async fn get_or_create_settings(&self, session_id: &str) -> Result<TaskSettings, String> {
        match self.storage.settings.get_task_settings(session_id).await? {
            Some(settings) => Ok(settings),
            None => {
                let settings = TaskSettings::default();
                self.storage
                    .settings
                    .set_task_settings(session_id, &settings)
                    .await?;
                Ok(settings)
            }
        }
    }

    /// Update session settings
    pub async fn update_settings(
        &self,
        session_id: &str,
        updates: TaskSettings,
    ) -> Result<TaskSettings, String> {
        let settings = self
            .storage
            .settings
            .update_task_settings(session_id, updates)
            .await?;

        // Update in-memory state
        let active = self.active_sessions.read().await;
        if let Some(state) = active.get(session_id) {
            let mut state = state.write().await;
            state.settings = settings.clone();
        }

        Ok(settings)
    }

    /// Get active session IDs
    pub async fn get_active_session_ids(&self) -> Vec<SessionId> {
        let active = self.active_sessions.read().await;
        active.keys().cloned().collect()
    }

    /// Check if a session is active
    pub async fn is_session_active(&self, session_id: &str) -> bool {
        let active = self.active_sessions.read().await;
        active.contains_key(session_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::Storage;
    use tempfile::TempDir;

    async fn create_test_manager() -> (SessionManager, TempDir) {
        let temp_dir = TempDir::new().unwrap();
        let storage = Storage::new(
            temp_dir.path().to_path_buf(),
            temp_dir.path().join("attachments"),
        )
        .await
        .expect("Failed to create storage");

        let manager = SessionManager::new(storage);
        (manager, temp_dir)
    }

    #[tokio::test]
    async fn test_create_session() {
        let (manager, _temp) = create_test_manager().await;

        let session = manager
            .create_session(
                Some("project-1".to_string()),
                Some("Test Session".to_string()),
                None,
            )
            .await
            .expect("Failed to create session");

        assert_eq!(session.project_id, Some("project-1".to_string()));
        assert_eq!(session.title, Some("Test Session".to_string()));
        assert_eq!(session.status, SessionStatus::Created);
    }

    #[tokio::test]
    async fn test_get_session() {
        let (manager, _temp) = create_test_manager().await;

        let created = manager.create_session(None, None, None).await.unwrap();
        let retrieved = manager
            .get_session(&created.id)
            .await
            .expect("Failed to get session");

        assert!(retrieved.is_some());
        assert_eq!(retrieved.unwrap().id, created.id);
    }

    #[tokio::test]
    async fn test_session_activation() {
        let (manager, _temp) = create_test_manager().await;

        let session = manager.create_session(None, None, None).await.unwrap();

        // Session is active immediately after creation
        assert!(manager.is_session_active(&session.id).await);

        // Deactivate
        manager
            .deactivate_session(&session.id)
            .await
            .expect("Failed to deactivate");
        assert!(!manager.is_session_active(&session.id).await);

        // Reactivate
        let state = manager
            .activate_session(&session.id)
            .await
            .expect("Failed to activate");
        assert!(state.is_active);
        assert!(manager.is_session_active(&session.id).await);
    }

    #[tokio::test]
    async fn test_update_session_status() {
        let (manager, _temp) = create_test_manager().await;

        let session = manager.create_session(None, None, None).await.unwrap();
        manager.activate_session(&session.id).await.unwrap();

        manager
            .update_session_status(&session.id, SessionStatus::Running, Some("evt-1"))
            .await
            .expect("Failed to update status");

        let state = manager
            .get_session_state(&session.id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(state.session.status, SessionStatus::Running);
        assert_eq!(state.session.last_event_id, Some("evt-1".to_string()));
    }
}
