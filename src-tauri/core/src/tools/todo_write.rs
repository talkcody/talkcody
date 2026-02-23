//! Todo Write Tool
//!
//! Write or update todo items for task tracking.
//! Matches TypeScript todo-write-tool.tsx logic.

use crate::core::tools::ToolContext;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TodoItem {
    pub id: String,
    pub content: String,
    pub status: String, // "pending", "in_progress", "completed"
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoWriteResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub todos: Vec<TodoItem>,
}

/// Execute todoWrite tool
///
/// In backend-only mode, this validates the todos and returns them.
/// In a full implementation, this would persist todos to a file.
pub async fn execute(todos: Vec<TodoItem>, ctx: &ToolContext) -> TodoWriteResult {
    // Validate todos

    // Check for duplicate IDs
    let mut ids = HashSet::new();
    for todo in &todos {
        if !ids.insert(&todo.id) {
            return TodoWriteResult {
                success: false,
                error: Some(format!("Duplicate todo IDs found: {}", todo.id)),
                todos,
            };
        }
    }

    // Check for multiple in_progress tasks
    let in_progress_count = todos.iter().filter(|t| t.status == "in_progress").count();

    if in_progress_count > 1 {
        return TodoWriteResult {
            success: false,
            error: Some("Only one task can be in_progress at a time".to_string()),
            todos,
        };
    }

    // Validate each todo
    for todo in &todos {
        if todo.content.trim().is_empty() {
            return TodoWriteResult {
                success: false,
                error: Some(format!("Todo with ID \"{}\" has empty content", todo.id)),
                todos,
            };
        }

        if !["pending", "in_progress", "completed"].contains(&todo.status.as_str()) {
            return TodoWriteResult {
                success: false,
                error: Some(format!(
                    "Invalid status \"{}\" for todo \"{}\"",
                    todo.status, todo.id
                )),
                todos,
            };
        }
    }

    // In backend-only mode without persistence, we just validate and return
    // In a full implementation, this would save to a file using file_todo_service

    log::info!(
        "TodoWrite for task {}: {} todos updated",
        ctx.task_id,
        todos.len()
    );

    TodoWriteResult {
        success: true,
        error: None,
        todos,
    }
}
