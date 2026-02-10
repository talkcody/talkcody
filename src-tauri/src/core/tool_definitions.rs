//! Tool Definitions
//!
//! Canonical tool definitions matching TS tool registry.
//! All tool names use camelCase to match TypeScript conventions.

use crate::core::types::ToolDefinition;
use serde_json::json;

/// Tool category for dependency analysis
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolCategory {
    Read,
    Write,
    Edit,
    Other,
}

/// Tool metadata for dependency analysis and execution
#[derive(Debug, Clone)]
pub struct ToolMetadata {
    pub category: ToolCategory,
    pub can_concurrent: bool,
    pub file_operation: bool,
    pub requires_approval: bool,
    pub render_doing_ui: bool,
}

/// Get all canonical tool definitions with metadata
pub fn get_tool_definitions() -> Vec<(ToolDefinition, ToolMetadata)> {
    vec![
        // Read tools
        (
            ToolDefinition {
                name: "readFile".to_string(),
                description: "Read the contents of a file at the specified path.".to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "file_path": {
                            "type": "string",
                            "description": "The path of the file to read"
                        },
                        "offset": {
                            "type": "integer",
                            "description": "The line number to start reading from (1-indexed)"
                        },
                        "limit": {
                            "type": "integer",
                            "description": "The number of lines to read"
                        }
                    },
                    "required": ["file_path"]
                }),
                requires_approval: false,
            },
            ToolMetadata {
                category: ToolCategory::Read,
                can_concurrent: true,
                file_operation: true,
                requires_approval: false,
                render_doing_ui: true,
            },
        ),
        // Write tools
        (
            ToolDefinition {
                name: "writeFile".to_string(),
                description: "Create a new file or overwrite an existing file with new content."
                    .to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "file_path": {
                            "type": "string",
                            "description": "The path where the file should be written"
                        },
                        "content": {
                            "type": "string",
                            "description": "The content to write to the file"
                        }
                    },
                    "required": ["file_path", "content"]
                }),
                requires_approval: true,
            },
            ToolMetadata {
                category: ToolCategory::Write,
                can_concurrent: false,
                file_operation: true,
                requires_approval: true,
                render_doing_ui: true,
            },
        ),
        // Edit tools
        (
            ToolDefinition {
                name: "editFile".to_string(),
                description: "Make edits to an existing file using search and replace.".to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "file_path": {
                            "type": "string",
                            "description": "The path of the file to edit"
                        },
                        "edits": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "old_string": {
                                        "type": "string",
                                        "description": "The text to search for"
                                    },
                                    "new_string": {
                                        "type": "string",
                                        "description": "The text to replace with"
                                    }
                                },
                                "required": ["old_string", "new_string"]
                            }
                        }
                    },
                    "required": ["file_path", "edits"]
                }),
                requires_approval: true,
            },
            ToolMetadata {
                category: ToolCategory::Edit,
                can_concurrent: false,
                file_operation: true,
                requires_approval: true,
                render_doing_ui: true,
            },
        ),
        // Search tools
        (
            ToolDefinition {
                name: "codeSearch".to_string(),
                description: "Fast text search across the codebase using ripgrep.".to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "The search query (regex supported)"
                        },
                        "path": {
                            "type": "string",
                            "description": "The directory to search in"
                        }
                    },
                    "required": ["query"]
                }),
                requires_approval: false,
            },
            ToolMetadata {
                category: ToolCategory::Read,
                can_concurrent: true,
                file_operation: false,
                requires_approval: false,
                render_doing_ui: true,
            },
        ),
        (
            ToolDefinition {
                name: "glob".to_string(),
                description: "Fast file pattern matching tool that works with any codebase size."
                    .to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "pattern": {
                            "type": "string",
                            "description": "The glob pattern to match (e.g., '**/*.ts')"
                        },
                        "path": {
                            "type": "string",
                            "description": "The directory to search in"
                        }
                    },
                    "required": ["pattern"]
                }),
                requires_approval: false,
            },
            ToolMetadata {
                category: ToolCategory::Read,
                can_concurrent: true,
                file_operation: false,
                requires_approval: false,
                render_doing_ui: true,
            },
        ),
        (
            ToolDefinition {
                name: "listFiles".to_string(),
                description: "List files and directories in the specified path.".to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "The path to list"
                        }
                    },
                    "required": ["path"]
                }),
                requires_approval: false,
            },
            ToolMetadata {
                category: ToolCategory::Read,
                can_concurrent: true,
                file_operation: false,
                requires_approval: false,
                render_doing_ui: true,
            },
        ),
        // Shell tool
        (
            ToolDefinition {
                name: "bash".to_string(),
                description: "Execute a bash command.".to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "command": {
                            "type": "string",
                            "description": "The bash command to execute"
                        },
                        "cwd": {
                            "type": "string",
                            "description": "The working directory for the command"
                        }
                    },
                    "required": ["command"]
                }),
                requires_approval: true,
            },
            ToolMetadata {
                category: ToolCategory::Other,
                can_concurrent: false,
                file_operation: false,
                requires_approval: true,
                render_doing_ui: true,
            },
        ),
        // LSP tool
        (
            ToolDefinition {
                name: "lsp".to_string(),
                description:
                    "Language Server Protocol operations (go to definition, find references, etc.)."
                        .to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "operation": {
                            "type": "string",
                            "enum": ["goto_definition", "find_references", "hover", "document_symbols", "workspace_symbols"],
                            "description": "The LSP operation to perform"
                        },
                        "file_path": {
                            "type": "string",
                            "description": "The file path for the operation"
                        },
                        "line": {
                            "type": "integer",
                            "description": "The line number (0-indexed)"
                        },
                        "character": {
                            "type": "integer",
                            "description": "The character position (0-indexed)"
                        }
                    },
                    "required": ["operation", "file_path", "line", "character"]
                }),
                requires_approval: false,
            },
            ToolMetadata {
                category: ToolCategory::Read,
                can_concurrent: true,
                file_operation: false,
                requires_approval: false,
                render_doing_ui: true,
            },
        ),
        // Web tools
        (
            ToolDefinition {
                name: "webFetch".to_string(),
                description: "Fetch content from a URL.".to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "url": {
                            "type": "string",
                            "description": "The URL to fetch"
                        }
                    },
                    "required": ["url"]
                }),
                requires_approval: false,
            },
            ToolMetadata {
                category: ToolCategory::Read,
                can_concurrent: true,
                file_operation: false,
                requires_approval: false,
                render_doing_ui: true,
            },
        ),
        (
            ToolDefinition {
                name: "webSearch".to_string(),
                description: "Search the web for information.".to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "The search query"
                        }
                    },
                    "required": ["query"]
                }),
                requires_approval: false,
            },
            ToolMetadata {
                category: ToolCategory::Read,
                can_concurrent: true,
                file_operation: false,
                requires_approval: false,
                render_doing_ui: true,
            },
        ),
        // Agent tools
        (
            ToolDefinition {
                name: "callAgent".to_string(),
                description: "Call another agent to perform a specialized task.".to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "agent": {
                            "type": "string",
                            "description": "The name of the agent to call"
                        },
                        "prompt": {
                            "type": "string",
                            "description": "The prompt/context for the agent"
                        }
                    },
                    "required": ["agent", "prompt"]
                }),
                requires_approval: false,
            },
            ToolMetadata {
                category: ToolCategory::Other,
                can_concurrent: false,
                file_operation: false,
                requires_approval: false,
                render_doing_ui: true,
            },
        ),
        // Todo tool
        (
            ToolDefinition {
                name: "todoWrite".to_string(),
                description: "Write or update todo items for task tracking.".to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "todos": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "id": {
                                        "type": "string",
                                        "description": "The todo ID"
                                    },
                                    "content": {
                                        "type": "string",
                                        "description": "The todo content"
                                    },
                                    "status": {
                                        "type": "string",
                                        "enum": ["pending", "in_progress", "completed"],
                                        "description": "The todo status"
                                    }
                                },
                                "required": ["id", "content", "status"]
                            }
                        }
                    },
                    "required": ["todos"]
                }),
                requires_approval: false,
            },
            ToolMetadata {
                category: ToolCategory::Other,
                can_concurrent: false,
                file_operation: false,
                requires_approval: false,
                render_doing_ui: true,
            },
        ),
        // Ask user tool
        (
            ToolDefinition {
                name: "askUserQuestions".to_string(),
                description: "Ask the user questions to gather required information.".to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "questions": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "id": {
                                        "type": "string",
                                        "description": "The question ID"
                                    },
                                    "question": {
                                        "type": "string",
                                        "description": "The question text"
                                    }
                                },
                                "required": ["id", "question"]
                            }
                        }
                    },
                    "required": ["questions"]
                }),
                requires_approval: false,
            },
            ToolMetadata {
                category: ToolCategory::Other,
                can_concurrent: false,
                file_operation: false,
                requires_approval: false,
                render_doing_ui: true,
            },
        ),
        // Exit plan mode
        (
            ToolDefinition {
                name: "exitPlanMode".to_string(),
                description: "Exit plan mode and return to normal operation.".to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {},
                    "additionalProperties": false
                }),
                requires_approval: false,
            },
            ToolMetadata {
                category: ToolCategory::Other,
                can_concurrent: false,
                file_operation: false,
                requires_approval: false,
                render_doing_ui: false,
            },
        ),
        // GitHub PR
        (
            ToolDefinition {
                name: "githubPR".to_string(),
                description: "Create a GitHub pull request.".to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "title": {
                            "type": "string",
                            "description": "The PR title"
                        },
                        "body": {
                            "type": "string",
                            "description": "The PR body"
                        },
                        "branch": {
                            "type": "string",
                            "description": "The branch to merge"
                        }
                    },
                    "required": ["title", "branch"]
                }),
                requires_approval: true,
            },
            ToolMetadata {
                category: ToolCategory::Write,
                can_concurrent: false,
                file_operation: false,
                requires_approval: true,
                render_doing_ui: true,
            },
        ),
    ]
}
