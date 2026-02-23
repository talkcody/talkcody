use std::collections::HashMap;
use std::env;
use std::sync::Arc;
use talkcody_core::core::types::{EventSender, RuntimeEvent};
use talkcody_core::core::CoreRuntime;
use talkcody_core::llm::auth::api_key_manager::ApiKeyManager;
use talkcody_core::llm::providers::provider_registry::ProviderRegistry;
use talkcody_core::platform::Platform;
use talkcody_core::storage::Storage;
use talkcody_core::streaming::StreamingManager;
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

async fn bootstrap_provider_api_keys_from_env(
    api_key_manager: &ApiKeyManager,
    provider_registry: &ProviderRegistry,
) -> Result<(), String> {
    const PREFIX: &str = "PROVIDER_API_KEY_";
    let mut providers_by_suffix: HashMap<String, String> = HashMap::new();

    for provider in provider_registry.providers() {
        providers_by_suffix.insert(provider.id.to_ascii_lowercase(), provider.id);
    }

    let mut matched = 0usize;
    let mut updated = 0usize;

    let env_vars: Vec<(String, String)> = env::vars().collect();

    for (key, value) in env_vars {
        if !key.to_ascii_uppercase().starts_with(PREFIX) {
            continue;
        }

        let suffix = match key.get(PREFIX.len()..) {
            Some(suffix) => suffix.trim(),
            None => continue,
        };

        if suffix.is_empty() {
            log::warn!(
                "[ServerState] Skipping env var with empty provider id: {}",
                key
            );
            continue;
        }

        let provider_id = match providers_by_suffix.get(&suffix.to_ascii_lowercase()) {
            Some(provider_id) => provider_id.as_str(),
            None => {
                log::warn!(
                    "[ServerState] Unknown provider id in env var {} (suffix={})",
                    key,
                    suffix
                );
                continue;
            }
        };

        let trimmed_value = value.trim();
        if trimmed_value.is_empty() {
            log::warn!(
                "[ServerState] Skipping empty API key in env for provider {}",
                provider_id
            );
            continue;
        }

        matched += 1;

        let setting_key = format!("api_key_{}", provider_id);
        if let Ok(existing) = api_key_manager.get_setting(&setting_key).await {
            if existing.as_deref() == Some(trimmed_value) {
                continue;
            }
        }

        if let Err(error) = api_key_manager
            .set_setting(&setting_key, trimmed_value)
            .await
        {
            log::error!(
                "[ServerState] Failed to persist API key for provider {}: {}",
                provider_id,
                error
            );
            continue;
        }

        updated += 1;
    }

    if matched > 0 {
        log::info!(
            "[ServerState] Bootstrapped {} provider API keys from env (updated {})",
            matched,
            updated
        );
    }

    Ok(())
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
        let provider_registry = ProviderRegistry::default();
        let db = storage.settings.get_db();
        let api_key_manager = ApiKeyManager::new(db, config.data_root.clone());

        if let Err(error) =
            bootstrap_provider_api_keys_from_env(&api_key_manager, &provider_registry).await
        {
            log::warn!(
                "[ServerState] Failed to bootstrap provider API keys from env: {}",
                error
            );
        }

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
                let _ = broadcast_tx_for_task.send(event);
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
