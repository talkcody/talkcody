use crate::core::CoreRuntime;
use crate::platform::Platform;
use crate::storage::Storage;
use crate::streaming::StreamingManager;
use std::sync::Arc;
use tokio::sync::RwLock;

/// Server state shared across all request handlers
#[derive(Clone)]
pub struct ServerState {
    pub config: super::config::ServerConfig,
    pub runtime: CoreRuntime,
    pub storage: Storage,
    pub platform: Platform,
    pub streaming: Arc<RwLock<StreamingManager>>,
}

impl ServerState {
    pub fn new(
        config: super::config::ServerConfig,
        runtime: CoreRuntime,
        storage: Storage,
    ) -> Self {
        let platform = Platform::new();
        let streaming = Arc::new(RwLock::new(StreamingManager::new()));

        Self {
            config,
            runtime,
            storage,
            platform,
            streaming,
        }
    }

    /// Get the runtime reference
    pub fn runtime(&self) -> &CoreRuntime {
        &self.runtime
    }

    /// Get the storage reference
    pub fn storage(&self) -> &Storage {
        &self.storage
    }

    /// Get the platform reference
    pub fn platform(&self) -> &Platform {
        &self.platform
    }

    /// Get the streaming manager
    pub fn streaming(&self) -> Arc<RwLock<StreamingManager>> {
        self.streaming.clone()
    }
}

/// Factory for creating server state with all dependencies
pub struct ServerStateFactory;

impl ServerStateFactory {
    /// Create server state with the given configuration
    pub async fn create(
        config: super::config::ServerConfig,
        event_sender: crate::core::types::EventSender,
    ) -> Result<ServerState, String> {
        // Create storage
        let storage =
            Storage::new(config.data_root.clone(), config.attachments_root.clone()).await?;

        // Create provider registry and API key manager
        let provider_registry =
            crate::llm::providers::provider_registry::ProviderRegistry::default();
        let db = storage.settings.get_db();
        let api_key_manager =
            crate::llm::auth::api_key_manager::ApiKeyManager::new(db, config.data_root.clone());

        // Create runtime
        let runtime = CoreRuntime::new(
            storage.clone(),
            event_sender,
            provider_registry,
            api_key_manager,
        )
        .await?;

        Ok(ServerState::new(config, runtime, storage))
    }
}
