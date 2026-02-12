use axum::routing::{delete, get, patch, post};
use axum::Router;

use crate::server::state::ServerState;

pub mod actions;
pub mod chat;
pub mod files;
pub mod health;
pub mod messages;
pub mod sessions;
pub mod tasks;

pub fn router(state: ServerState) -> Router {
    Router::new()
        // Health check
        .route("/health", get(health::health_check))
        // Chat (must be before /v1/sessions to avoid conflicts)
        .route("/v1/chat", post(chat::chat))
        // Sessions
        .route("/v1/sessions", post(sessions::create_session))
        .route("/v1/sessions", get(sessions::list_sessions))
        .route("/v1/sessions/:id", get(sessions::get_session))
        .route("/v1/sessions/:id", delete(sessions::delete_session))
        .route("/v1/sessions/:id/events", get(sessions::session_events))
        .route(
            "/v1/sessions/:id/settings",
            get(sessions::get_session_settings),
        )
        .route(
            "/v1/sessions/:id/settings",
            post(sessions::update_session_settings),
        )
        // Messages
        .route("/v1/sessions/:id/messages", post(messages::create_message))
        .route("/v1/sessions/:id/messages", get(messages::get_messages))
        // Tasks
        .route("/v1/tasks", post(tasks::create_task))
        .route("/v1/tasks", get(tasks::list_tasks))
        .route("/v1/tasks/:id", get(tasks::get_task))
        .route("/v1/tasks/:id", patch(tasks::patch_task))
        // Actions
        .route("/v1/sessions/:id/actions", post(actions::create_action))
        // Files
        .route("/v1/sessions/:id/files", post(files::upload_file))
        .route("/v1/sessions/:id/files", get(files::list_files))
        .route(
            "/v1/sessions/:session_id/files/:file_id",
            get(files::get_file),
        )
        .route(
            "/v1/sessions/:session_id/files/:file_id/download",
            get(files::download_file),
        )
        .with_state(state)
}
