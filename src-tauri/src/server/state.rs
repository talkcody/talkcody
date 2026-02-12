use crate::core::types::{EventSender, RuntimeEvent};
use crate::core::CoreRuntime;
use crate::platform::Platform;
use crate::storage::Storage;
use crate::streaming::StreamingManager;
use std::sync::Arc;
use tokio::sync::{broadcast, mpsc, RwLock};

/// Server state shared across all request handlers
#[derive(Clone)]
pub struct ServerState {
    pub config: super::config::ServerConfig,
    pub runtime: CoreRuntime,
    pub storage: Storage,
    pub platform: Platform,
    pub streaming: Arc<RwLock<StreamingManager>>,
    pub event_broadcast: broadcast::Sender<RuntimeEvent>,
    pub event_receiver: Arc<tokio::sync::Mutex<broadcast::Receiver<RuntimeEvent>>>,
}

impl ServerState {
    pub fn new(
        config: super::config::ServerConfig,
        runtime: CoreRuntime,
        storage: Storage,
        event_broadcast: broadcast::Sender<RuntimeEvent>,
        event_receiver: broadcast::Receiver<RuntimeEvent>,
    ) -> Self {
        let platform = Platform::new();
        let streaming = Arc::new(RwLock::new(StreamingManager::new()));

        Self {
            config,
            runtime,
            storage,
            platform,
            streaming,
            event_broadcast,
            event_receiver: Arc::new(tokio::sync::Mutex::new(event_receiver)),
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
        event_sender: EventSender,
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

        // Create broadcast channel for SSE events
        let (broadcast_tx, broadcast_rx) = broadcast::channel::<RuntimeEvent>(100);

        // Create an event forwarding channel
        // We need a receiver to forward events from the runtime to broadcast
        let (forward_tx, mut forward_rx) = mpsc::unbounded_channel::<RuntimeEvent>();

        // Clone broadcast_tx for the forwarding task
        let broadcast_tx_for_task = broadcast_tx.clone();

        // Create a task to forward event_sender events to broadcast channel
        // The runtime will use event_sender, and we need to forward those to broadcast
        tokio::spawn(async move {
            while let Some(event) = forward_rx.recv().await {
                let _ = broadcast_tx_for_task.send(event.clone());
                log::debug!("Event forwarded to broadcast: {:?}", event);
            }
        });

        // Create the event sender that will be used by runtime
        let event_sender = forward_tx;

        // Create runtime
        let runtime = CoreRuntime::new(
            storage.clone(),
            event_sender,
            provider_registry,
            api_key_manager,
        )
        .await?;

        Ok(ServerState::new(
            config,
            runtime,
            storage,
            broadcast_tx,
            broadcast_rx,
        ))
    }
}
