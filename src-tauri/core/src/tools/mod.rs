//! Tool implementations
//!
//! All tools are implemented as separate modules to match TypeScript tool registry structure.
//! Each module provides an execute function that matches the corresponding TypeScript tool logic.

pub mod ask_user_questions;
pub mod bash_tool;
pub mod call_agent;
pub mod code_search;
pub mod edit_file;
pub mod exit_plan_mode;
pub mod github_pr;
pub mod glob_tool;
pub mod image_generation;
pub mod install_skill;
pub mod list_files;
pub mod read_file;
pub mod todo_write;
pub mod web_fetch;
pub mod web_search;
pub mod write_file;
