//! TalkCody API Service Binary (Server Mode with Telegram Bot)
//!
//! This binary runs the Rust backend as a standalone API service for server deployment.
//! It includes:
//! - REST API for chat and sessions (OpenAI-compatible)
//! - Telegram Bot integration (long-polling)
//! - SQLite persistence
//!
//! ## Environment Variables
//!
//! Required:
//! - `TELEGRAM_BOT_TOKEN` - BotFather token for Telegram integration
//!
//! Optional:
//! - `HOST` - Bind host (default: 0.0.0.0)
//! - `PORT` - Bind port (default: 8080)
//! - `DATA_ROOT` - Data directory (default: ~/.local/share/talkcody)
//! - `WORKSPACE_ROOT` - Workspace directory (default: ~/talkcody-workspace)
//! - `TELEGRAM_ALLOWED_CHAT_IDS` - Comma-separated whitelist (empty = allow all)
//! - `API_KEY` - Simple API key for HTTP endpoints
//! - `RUST_LOG` - Log level (default: info)

use std::net::SocketAddr;
use std::path::PathBuf;
use tokio::net::TcpListener;
use tower_http::cors::{Any, CorsLayer};

use talkcody_core::core::types::RuntimeEvent;
use talkcody_server::config::ServerConfig;
use talkcody_server::routes;
use talkcody_server::state::ServerStateFactory;
use talkcody_server::telegram::maybe_spawn_bot;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize logging
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .format_timestamp_millis()
        .init();

    log::info!("╔══════════════════════════════════════════════════════════════╗");
    log::info!("║           TalkCody Server - Telegram Edition                 ║");
    log::info!("╚══════════════════════════════════════════════════════════════╝");

    // Load configuration from environment
    let (config, bind_addr) = load_config_from_env()?;

    // Ensure data directories exist
    std::fs::create_dir_all(&config.data_root)?;
    std::fs::create_dir_all(&config.attachments_root)?;
    std::fs::create_dir_all(&config.workspace_root)?;

    log::info!("[Config] Data root: {:?}", config.data_root);
    log::info!("[Config] Workspace root: {:?}", config.workspace_root);
    log::info!("[Config] Server will bind to: {}", bind_addr);

    // Create event channel (for runtime -> HTTP SSE)
    let (event_tx, _event_rx) = tokio::sync::mpsc::unbounded_channel::<RuntimeEvent>();

    // Create server state (runtime, storage, etc.)
    let state = ServerStateFactory::create(config.clone(), event_tx.clone())
        .await
        .map_err(|e| format!("Failed to create server state: {}", e))?;

    log::info!("[Runtime] Core runtime initialized");

    // Spawn Telegram Bot if configured
    let telegram_bot = maybe_spawn_bot(
        std::sync::Arc::new(state.runtime.clone()),
        state.storage.clone(),
        event_tx,
        config.data_root.clone(),
    );

    if telegram_bot.is_some() {
        log::info!("[Telegram] Bot spawned successfully");
    } else {
        log::warn!("[Telegram] Bot not configured (set TELEGRAM_BOT_TOKEN to enable)");
    }

    // Build router with CORS
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = routes::router(state.clone()).layer(cors);

    // Create TCP listener
    let listener = TcpListener::bind(bind_addr)
        .await
        .map_err(|e| format!("Failed to bind to {}: {}", bind_addr, e))?;

    let actual_addr = listener.local_addr()?;
    log::info!("");
    log::info!("🚀 TalkCody Server ready!");
    log::info!("   HTTP API: http://{}", actual_addr);
    log::info!("   Health:   http://{}/health", actual_addr);
    log::info!("   Chat:     http://{}/v1/chat", actual_addr);
    log::info!("");

    // Keep the server running
    axum::serve(listener, app)
        .await
        .map_err(|e| format!("Server error: {}", e))?;

    Ok(())
}

/// Load configuration from environment variables
fn load_config_from_env() -> Result<(ServerConfig, SocketAddr), String> {
    // Data directories
    let data_root = std::env::var("DATA_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            dirs::data_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join("talkcody")
        });

    let workspace_root = std::env::var("WORKSPACE_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            dirs::home_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join("talkcody-workspace")
        });

    let config = ServerConfig::new(workspace_root, data_root);

    let bind_addr: SocketAddr = format!("{}:{}", config.host, config.port)
        .parse()
        .map_err(|e| format!("Invalid bind address: {}", e))?;

    Ok((config, bind_addr))
}
