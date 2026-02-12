//! TalkCody API Service Binary
//!
//! This binary runs the Rust backend as a standalone API service for fly.io deployment.
//! It reads configuration from environment variables and starts the Axum server.

use std::net::SocketAddr;
use std::path::PathBuf;
use tokio::net::TcpListener;
use tower_http::cors::{Any, CorsLayer};

use tauri_app_lib::core::types::RuntimeEvent;
use tauri_app_lib::server::config::ServerConfig;
use tauri_app_lib::server::routes;
use tauri_app_lib::server::state::ServerStateFactory;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize logging
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .format_timestamp_millis()
        .init();

    log::info!("Starting TalkCody API Service...");

    // Load configuration from environment
    let (config, bind_addr) = load_config_from_env()?;

    // Ensure data directories exist
    std::fs::create_dir_all(&config.data_root)?;
    std::fs::create_dir_all(&config.attachments_root)?;
    std::fs::create_dir_all(&config.workspace_root)?;

    log::info!("Loaded config: {:?}", config);
    log::info!("Server will bind to: {}", bind_addr);

    // Create event channel
    let (event_tx, _event_rx) = tokio::sync::mpsc::unbounded_channel::<RuntimeEvent>();

    // Create server state
    let state = ServerStateFactory::create(config.clone(), event_tx)
        .await
        .map_err(|e| format!("Failed to create server state: {}", e))?;

    log::info!("Server state created successfully");

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
    log::info!("TalkCody API Service listening on http://{}", actual_addr);
    log::info!("Health check: http://{}/health", actual_addr);
    log::info!("Chat endpoint: http://{}/v1/chat", actual_addr);

    // Start server
    axum::serve(listener, app)
        .await
        .map_err(|e| format!("Server error: {}", e))?;

    Ok(())
}

/// Load configuration from environment variables
fn load_config_from_env() -> Result<(ServerConfig, SocketAddr), String> {
    // Server binding
    let host = std::env::var("HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
    let port: u16 = std::env::var("PORT")
        .unwrap_or_else(|_| "8080".to_string())
        .parse()
        .map_err(|e| format!("Invalid PORT: {}", e))?;

    let addr: SocketAddr = format!("{}:{}", host, port)
        .parse()
        .map_err(|e| format!("Invalid address: {}", e))?;

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

    Ok((config, addr))
}
