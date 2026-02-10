//! Core Runtime Module
//!
//! The core runtime manages task lifecycle, session management, agent loops,
//! and tool execution. This module is the heart of the cloud backend.

pub mod agent_loop;
pub mod completion_hooks;
pub mod runtime;
pub mod session;
pub mod tool_definitions;
pub mod tool_dependency_analyzer;
pub mod tool_name_normalizer;
pub mod tools;
pub mod types;

// Re-export main types for convenience
pub use agent_loop::{AgentLoop, AgentLoopContext, AgentLoopFactory, AgentLoopResult};
pub use runtime::{CoreRuntime, SettingsValidator};
pub use session::{SessionManager, SessionState};
pub use tool_name_normalizer::{is_known_tool_name, normalize_tool_name};
pub use tools::{ToolContext, ToolDispatcher, ToolExecutionOutput, ToolHandler, ToolRegistry};
pub use types::*;

/// Initialize the core runtime with storage
pub async fn init_runtime(
    storage: crate::storage::Storage,
    event_sender: types::EventSender,
) -> Result<CoreRuntime, String> {
    let provider_registry = crate::llm::providers::provider_registry::ProviderRegistry::default();
    let db = storage.settings.get_db();
    let api_key_manager =
        crate::llm::auth::api_key_manager::ApiKeyManager::new(db, std::path::PathBuf::from("."));
    CoreRuntime::new(storage, event_sender, provider_registry, api_key_manager).await
}
