pub mod config;
pub mod routes;
pub mod state;
pub mod streaming_bridge;
pub mod types;

use std::net::SocketAddr;
use tokio::net::TcpListener;

use crate::core::types::EventSender;
use crate::security::api_key_middleware;
use crate::server::state::ServerStateFactory;

pub use config::ServerConfig;
pub use state::ServerState;

pub struct ServerHandle {
    pub addr: SocketAddr,
}

pub async fn start_server(
    config: ServerConfig,
    event_sender: EventSender,
) -> Result<ServerHandle, String> {
    // Create server state with all dependencies
    let state = ServerStateFactory::create(config, event_sender)
        .await
        .map_err(|e| format!("Failed to create server state: {}", e))?;

    // Build router with API key middleware
    let app = routes::router(state.clone()).layer(axum::middleware::from_fn_with_state(
        state,
        api_key_middleware,
    ));

    // Bind to any available port
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .map_err(|e| format!("Failed to bind server: {}", e))?;

    let addr = listener
        .local_addr()
        .map_err(|e| format!("Failed to read server address: {}", e))?;

    log::info!("Cloud backend server starting on {}", addr);

    // Spawn server
    tokio::spawn(async move {
        if let Err(error) = axum::serve(listener, app).await {
            log::error!("Cloud backend server error: {}", error);
        }
    });

    Ok(ServerHandle { addr })
}
