//! TalkCody Core Library
//!
//! This crate contains all the shared core functionality used by both
//! the desktop application and the API server.

pub mod core;
pub mod git;
pub mod integrations;
pub mod llm;
pub mod platform;
pub mod security;
pub mod storage;
pub mod streaming;
pub mod tools;
pub mod types;

// Shared utilities used by server/desktop
pub mod analytics;
pub mod background_tasks;
pub mod code_navigation;
pub mod constants;
pub mod database;
pub mod device_id;
pub mod directory_tree;
pub mod feishu_gateway;
pub mod file_search;
pub mod glob;
pub mod http_proxy;
pub mod lint;
pub mod list_files;
pub mod lsp;
pub mod oauth_callback_server;
pub mod script_executor;
pub mod search;
pub mod shell_utils;
pub mod telegram_gateway;
pub mod terminal;
pub mod walker;
pub mod websocket;

// Re-export commonly used types
pub use storage::models;
pub use types::*;

use std::path::PathBuf;

/// Core configuration
#[derive(Debug, Clone)]
pub struct CoreConfig {
    pub data_root: PathBuf,
    pub workspace_root: PathBuf,
}

impl CoreConfig {
    pub fn new(data_root: PathBuf, workspace_root: PathBuf) -> Self {
        Self {
            data_root,
            workspace_root,
        }
    }

    pub fn db_path(&self) -> PathBuf {
        self.data_root.join("talkcody.db")
    }

    pub fn attachments_path(&self) -> PathBuf {
        self.data_root.join("attachments")
    }
}
