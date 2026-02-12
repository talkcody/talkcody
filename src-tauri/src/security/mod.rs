pub use axum::body::Body;
pub use axum::extract::{Request, State};
pub use axum::middleware::Next;
pub use axum::response::{IntoResponse, Response};

pub use crate::server::state::ServerState;

const API_KEY_HEADER: &str = "x-api-key";

/// API key middleware that validates against configured key
pub async fn api_key_middleware(
    State(state): State<ServerState>,
    req: Request,
    next: Next,
) -> Response {
    // Get the API key from request header
    let request_key = req
        .headers()
        .get(API_KEY_HEADER)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.trim())
        .filter(|value| !value.is_empty());

    // Check if API key validation is configured
    let validation_enabled = match state
        .storage()
        .settings
        .get_setting("api_key_validation_enabled")
        .await
    {
        Ok(Some(val)) => val.as_bool().unwrap_or(true),
        _ => true, // Default to enabled
    };

    if !validation_enabled {
        // Validation disabled, allow all requests
        return next.run(req).await;
    }

    // Get the configured API key from settings
    let configured_key = match state.storage().settings.get_setting("api_key").await {
        Ok(Some(val)) => val.as_str().map(|s| s.to_string()),
        _ => None,
    };

    let authorized = match (request_key, configured_key) {
        (Some(req_key), Some(cfg_key)) => req_key == cfg_key,
        (Some(_), None) => {
            // No configured key, but request has one - accept any non-empty key
            true
        }
        (None, Some(_)) => {
            // Configured key exists but none provided
            false
        }
        (None, None) => {
            // No key configured and none provided - allow for setup
            true
        }
    };

    if !authorized {
        return (
            axum::http::StatusCode::UNAUTHORIZED,
            "Invalid or missing API key",
        )
            .into_response();
    }

    next.run(req).await
}

/// Simple middleware for health checks (no auth required)
pub async fn health_check_middleware(req: Request, next: Next) -> Response {
    next.run(req).await
}
