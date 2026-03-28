use std::path::PathBuf;

#[derive(Clone, Debug)]
pub struct ServerConfig {
    pub workspace_root: PathBuf,
    pub data_root: PathBuf,
    pub attachments_root: PathBuf,
    /// Host to bind (e.g., "0.0.0.0")
    pub host: String,
    /// Port to bind (e.g., 8080)
    pub port: u16,
    /// CORS allowed origins (comma-separated). Default: empty (no CORS restriction in MVP)
    pub allowed_origins: Vec<String>,
    /// API key for simple auth (optional in MVP)
    pub api_key: Option<String>,
}

impl ServerConfig {
    pub fn new(workspace_root: PathBuf, data_root: PathBuf) -> Self {
        let attachments_root = data_root.join("attachments");
        Self {
            workspace_root,
            data_root,
            attachments_root,
            host: std::env::var("HOST").unwrap_or_else(|_| "0.0.0.0".to_string()),
            port: std::env::var("PORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(8080),
            allowed_origins: std::env::var("ALLOWED_ORIGINS")
                .ok()
                .map(|s| s.split(',').map(|p| p.trim().to_string()).collect())
                .unwrap_or_default(),
            api_key: std::env::var("API_KEY").ok().filter(|k| !k.is_empty()),
        }
    }
}
