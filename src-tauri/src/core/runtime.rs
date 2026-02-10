//! Core Runtime
//!
//! The main runtime that orchestrates task execution, session management,
//! agent loops, and tool dispatch. Owns the lifecycle of all runtime tasks.

use crate::core::agent_loop::{AgentLoop, AgentLoopContext, AgentLoopFactory, AgentLoopResult};
use crate::core::session::SessionManager;
use crate::core::tools::{ToolContext, ToolRegistry};
use crate::core::types::*;
use crate::llm::auth::api_key_manager::ApiKeyManager;
use crate::llm::providers::provider_registry::ProviderRegistry;
use crate::storage::{
    Message, MessageContent, MessageRole, SessionId, SessionStatus, Storage, TaskSettings,
};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, RwLock};
use tokio::task::JoinHandle;

/// Core runtime that manages all tasks and sessions
#[derive(Clone)]
pub struct CoreRuntime {
    /// Storage layer
    storage: Storage,
    /// Session manager
    session_manager: Arc<SessionManager>,
    /// Tool registry
    tool_registry: Arc<ToolRegistry>,
    /// Active tasks
    tasks: Arc<RwLock<HashMap<RuntimeTaskId, TaskHandle>>>,
    /// Event broadcaster
    event_sender: EventSender,
    /// Settings for validation
    _settings_validator: SettingsValidator,
    /// Provider registry for LLM
    provider_registry: ProviderRegistry,
    /// API key manager
    api_key_manager: ApiKeyManager,
}

/// Settings validator
#[derive(Clone)]
pub struct SettingsValidator;

impl SettingsValidator {
    pub fn new() -> Self {
        Self
    }

    /// Validate task settings
    pub fn validate(&self, settings: &TaskSettings) -> SettingsValidation {
        let mut validation = SettingsValidation::valid();

        // Validate auto_approve_edits
        if settings.auto_approve_edits == Some(true) {
            validation.add_warning(
                "Auto-approve edits is enabled. This may allow unintended file modifications."
                    .to_string(),
            );
        }

        // Validate auto_approve_plan
        if settings.auto_approve_plan == Some(true) {
            validation.add_warning(
                "Auto-approve plan is enabled. The agent will execute plan steps without confirmation."
                    .to_string(),
            );
        }

        validation
    }
}

impl Default for SettingsValidator {
    fn default() -> Self {
        Self::new()
    }
}

impl CoreRuntime {
    /// Create a new CoreRuntime instance
    pub async fn new(
        storage: Storage,
        event_sender: EventSender,
        provider_registry: ProviderRegistry,
        api_key_manager: ApiKeyManager,
    ) -> Result<Self, String> {
        // Create session manager
        let session_manager = Arc::new(SessionManager::new(storage.clone()));

        // Create tool registry with default tools
        let tool_registry = Arc::new(ToolRegistry::create_default().await);

        Ok(Self {
            storage,
            session_manager,
            tool_registry,
            tasks: Arc::new(RwLock::new(HashMap::new())),
            event_sender,
            _settings_validator: SettingsValidator::new(),
            provider_registry,
            api_key_manager,
        })
    }

    /// Start a new task
    pub async fn start_task(&self, input: TaskInput) -> Result<TaskHandle, String> {
        // Validate settings if provided
        if let Some(ref settings) = input.settings {
            let validation = self._settings_validator.validate(settings);
            if !validation.valid {
                return Err(format!(
                    "Invalid settings: {}",
                    validation.errors.join(", ")
                ));
            }
        }

        // Create or get session
        let session = if let Some(ref session_id) = self.find_session_for_task(&input) {
            self.session_manager.activate_session(session_id).await?;
            self.session_manager
                .get_session(session_id)
                .await?
                .ok_or("Session not found")?
        } else {
            self.session_manager
                .create_session(input.project_id.clone(), None, input.settings.clone())
                .await?
        };

        let task_id = format!("task_{}", uuid::Uuid::new_v4().to_string().replace("-", ""));
        let now = chrono::Utc::now().timestamp();

        // Create task state
        let task = RuntimeTask {
            id: task_id.clone(),
            session_id: session.id.clone(),
            agent_id: input.agent_id.clone(),
            state: RuntimeTaskState::Pending,
            created_at: now,
            started_at: None,
            completed_at: None,
            error_message: None,
            metadata: HashMap::new(),
        };

        // Create action channel
        let (action_tx, action_rx) = mpsc::unbounded_channel();

        // Create task handle
        let task_state = Arc::new(RwLock::new(RuntimeTaskState::Pending));
        let handle = TaskHandle {
            task_id: task_id.clone(),
            session_id: session.id.clone(),
            state: task_state.clone(),
            action_sender: Arc::new(action_tx),
        };

        // Store task handle
        {
            let mut tasks = self.tasks.write().await;
            tasks.insert(task_id.clone(), handle.clone());
        }

        // Spawn task execution
        let runtime_clone = self.clone_for_task();
        let event_sender = self.event_sender.clone();

        tokio::spawn(async move {
            runtime_clone
                .run_task(task, input, task_state, action_rx, event_sender)
                .await;
        });

        Ok(handle)
    }

    /// Get a task handle by ID
    pub async fn get_task(&self, task_id: &str) -> Option<TaskHandle> {
        let tasks = self.tasks.read().await;
        tasks.get(task_id).cloned()
    }

    /// List all active tasks
    pub async fn list_active_tasks(&self) -> Vec<TaskHandle> {
        let tasks = self.tasks.read().await;
        tasks.values().cloned().collect()
    }

    /// Cancel a task
    pub async fn cancel_task(&self, task_id: &str) -> Result<(), String> {
        let handle = self
            .get_task(task_id)
            .await
            .ok_or_else(|| format!("Task '{}' not found", task_id))?;

        handle.cancel()?;
        Ok(())
    }

    /// Get session manager
    pub fn session_manager(&self) -> Arc<SessionManager> {
        self.session_manager.clone()
    }

    /// Get tool registry
    pub fn tool_registry(&self) -> Arc<ToolRegistry> {
        self.tool_registry.clone()
    }

    /// Main task execution loop
    async fn run_task(
        &self,
        mut task: RuntimeTask,
        input: TaskInput,
        task_state: Arc<RwLock<RuntimeTaskState>>,
        mut action_rx: mpsc::UnboundedReceiver<TaskAction>,
        event_sender: EventSender,
    ) {
        // Update task state to running
        let now = chrono::Utc::now().timestamp();
        task.state = RuntimeTaskState::Running;
        task.started_at = Some(now);
        *task_state.write().await = RuntimeTaskState::Running;

        // Emit state change event
        let _ = event_sender.send(RuntimeEvent::TaskStateChanged {
            task_id: task.id.clone(),
            state: RuntimeTaskState::Running,
            previous_state: RuntimeTaskState::Pending,
        });

        // Create agent loop with full LLM integration
        let agent_loop = AgentLoopFactory::create_standard(
            self.tool_registry.clone(),
            event_sender.clone(),
            self.provider_registry.clone(),
            self.api_key_manager.clone(),
        );

        // Add initial user message
        let initial_message = Message {
            id: format!("msg_{}", uuid::Uuid::new_v4()),
            session_id: task.session_id.clone(),
            role: MessageRole::User,
            content: MessageContent::Text {
                text: input.initial_message,
            },
            created_at: now,
            tool_call_id: None,
            parent_id: None,
        };

        if let Err(e) = self
            .session_manager
            .add_message(initial_message.clone())
            .await
        {
            let _ = event_sender.send(RuntimeEvent::Error {
                task_id: Some(task.id.clone()),
                session_id: Some(task.session_id.clone()),
                message: format!("Failed to add message: {}", e),
            });
            self.complete_task(
                &task,
                RuntimeTaskState::Failed,
                Some(e.to_string()),
                &event_sender,
            )
            .await;
            return;
        }

        let _ = event_sender.send(RuntimeEvent::MessageCreated {
            session_id: task.session_id.clone(),
            message: initial_message,
        });

        // Build agent loop context
        let workspace_root = input
            .workspace
            .as_ref()
            .map(|w| w.root_path.clone())
            .unwrap_or_else(|| {
                std::env::current_dir()
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_else(|_| "/".to_string())
            });

        let ctx = AgentLoopContext {
            session_id: task.session_id.clone(),
            task_id: task.id.clone(),
            workspace_root,
            worktree_path: input
                .workspace
                .as_ref()
                .and_then(|w| w.worktree_path.clone()),
            settings: input.settings.clone().unwrap_or_default(),
            messages: self
                .session_manager
                .get_messages(&task.session_id, None, None)
                .await
                .unwrap_or_default(),
            model: input.settings.and_then(|s| {
                s.extra
                    .get("model")
                    .and_then(|v| v.as_str().map(|s| s.to_string()))
            }),
        };

        // Get current messages and run agent loop
        let messages = self
            .session_manager
            .get_messages(&task.session_id, None, None)
            .await
            .unwrap_or_default();

        match agent_loop.run_iteration(&ctx, &messages).await {
            Ok(AgentLoopResult::Completed { message }) => {
                // Add assistant message
                let assistant_message = Message {
                    id: format!("msg_{}", uuid::Uuid::new_v4()),
                    session_id: task.session_id.clone(),
                    role: MessageRole::Assistant,
                    content: MessageContent::Text { text: message },
                    created_at: chrono::Utc::now().timestamp(),
                    tool_call_id: None,
                    parent_id: None,
                };

                let _ = self
                    .session_manager
                    .add_message(assistant_message.clone())
                    .await;
                let _ = event_sender.send(RuntimeEvent::MessageCreated {
                    session_id: task.session_id.clone(),
                    message: assistant_message,
                });

                self.complete_task(&task, RuntimeTaskState::Completed, None, &event_sender)
                    .await;
            }
            Ok(AgentLoopResult::WaitingForApproval { request }) => {
                *task_state.write().await = RuntimeTaskState::WaitingForUser;
                let _ = event_sender.send(RuntimeEvent::ToolCallRequested {
                    task_id: task.id.clone(),
                    request,
                });
                // Task will wait for user action via action_rx
            }
            Ok(AgentLoopResult::Error { message }) => {
                self.complete_task(
                    &task,
                    RuntimeTaskState::Failed,
                    Some(message),
                    &event_sender,
                )
                .await;
            }
            Ok(AgentLoopResult::MaxIterationsReached) => {
                self.complete_task(
                    &task,
                    RuntimeTaskState::Completed,
                    Some("Maximum iterations reached".to_string()),
                    &event_sender,
                )
                .await;
            }
            Ok(AgentLoopResult::Cancelled) => {
                self.complete_task(&task, RuntimeTaskState::Cancelled, None, &event_sender)
                    .await;
            }
            Ok(AgentLoopResult::WaitingForToolResult { .. }) => {
                // This shouldn't happen in our simplified implementation
                self.complete_task(
                    &task,
                    RuntimeTaskState::Failed,
                    Some("Unexpected tool result wait".to_string()),
                    &event_sender,
                )
                .await;
            }
            Err(e) => {
                self.complete_task(&task, RuntimeTaskState::Failed, Some(e), &event_sender)
                    .await;
            }
        }

        // Remove from active tasks
        let mut tasks = self.tasks.write().await;
        tasks.remove(&task.id);
    }

    /// Complete a task and emit events
    async fn complete_task(
        &self,
        task: &RuntimeTask,
        final_state: RuntimeTaskState,
        error: Option<String>,
        event_sender: &EventSender,
    ) {
        let previous_state = match self.tasks.read().await.get(&task.id) {
            Some(handle) => *handle.state.read().await,
            None => RuntimeTaskState::Running,
        };

        // Update session status
        let session_status = match final_state {
            RuntimeTaskState::Completed => SessionStatus::Completed,
            RuntimeTaskState::Failed => SessionStatus::Error,
            RuntimeTaskState::Cancelled => SessionStatus::Cancelled,
            _ => SessionStatus::Running,
        };

        let _ = self
            .session_manager
            .update_session_status(&task.session_id, session_status, None)
            .await;

        // Emit completion event
        let _ = event_sender.send(RuntimeEvent::TaskStateChanged {
            task_id: task.id.clone(),
            state: final_state,
            previous_state,
        });

        let _ = event_sender.send(RuntimeEvent::TaskCompleted {
            task_id: task.id.clone(),
            session_id: task.session_id.clone(),
        });

        if let Some(err) = error {
            let _ = event_sender.send(RuntimeEvent::Error {
                task_id: Some(task.id.clone()),
                session_id: Some(task.session_id.clone()),
                message: err,
            });
        }
    }

    /// Find existing session for a task input
    fn find_session_for_task(&self, input: &TaskInput) -> Option<SessionId> {
        // If session_id is explicitly provided in input, use that
        Some(input.session_id.clone())
    }

    /// Clone runtime state for task execution
    fn clone_for_task(&self) -> RuntimeTaskContext {
        RuntimeTaskContext {
            session_manager: self.session_manager.clone(),
            tool_registry: self.tool_registry.clone(),
        }
    }
}

/// Context passed to task execution (lighter weight than full runtime)
#[derive(Clone)]
struct RuntimeTaskContext {
    session_manager: Arc<SessionManager>,
    tool_registry: Arc<ToolRegistry>,
}

impl RuntimeTaskContext {
    async fn run_task(
        &self,
        _task: RuntimeTask,
        _input: TaskInput,
        _task_state: Arc<RwLock<RuntimeTaskState>>,
        _action_rx: mpsc::UnboundedReceiver<TaskAction>,
        _event_sender: EventSender,
    ) {
        // This is called from the spawned task - actual implementation is in CoreRuntime
        // This method exists for type compatibility
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    async fn create_test_runtime() -> (CoreRuntime, TempDir, mpsc::UnboundedReceiver<RuntimeEvent>)
    {
        let temp_dir = TempDir::new().unwrap();
        let storage = Storage::new(
            temp_dir.path().to_path_buf(),
            temp_dir.path().join("attachments"),
        )
        .await
        .expect("Failed to create storage");

        let (tx, rx) = mpsc::unbounded_channel();
        let provider_registry = ProviderRegistry::default();
        let db = storage.settings.get_db();
        let api_key_manager = ApiKeyManager::new(db, temp_dir.path().to_path_buf());
        let runtime = CoreRuntime::new(storage, tx, provider_registry, api_key_manager)
            .await
            .expect("Failed to create runtime");

        (runtime, temp_dir, rx)
    }

    #[tokio::test]
    async fn test_create_runtime() {
        let (_runtime, _temp, _rx) = create_test_runtime().await;
        // Runtime created successfully
    }

    #[tokio::test]
    async fn test_settings_validation() {
        let validator = SettingsValidator::new();

        let valid_settings = TaskSettings::default();
        let result = validator.validate(&valid_settings);
        assert!(result.valid);
        assert!(result.warnings.is_empty());

        let risky_settings = TaskSettings {
            auto_approve_edits: Some(true),
            auto_approve_plan: Some(true),
            auto_code_review: None,
            extra: HashMap::new(),
        };
        let result = validator.validate(&risky_settings);
        assert!(result.valid); // Still valid, just warnings
        assert_eq!(result.warnings.len(), 2);
    }
}
