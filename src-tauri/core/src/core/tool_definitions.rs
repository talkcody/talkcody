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
                            "description": "The file path to read. Use absolute path for workspace files, or $RESOURCE/... prefix for bundled resources like PPT style guides. The $RESOURCE prefix MUST be used exactly as-is, do not convert to absolute path."
                        },
                        "start_line": {
                            "type": "integer",
                            "description": "Starting line number (1-indexed). If specified, only reads from this line onwards"
                        },
                        "line_count": {
                            "type": "integer",
                            "description": "Number of lines to read from start_line. If not specified, reads to end of file"
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
                render_doing_ui: false,
            },
        ),
        // Write tools
        (
            ToolDefinition {
                name: "writeFile".to_string(),
                description: "Create a new file or overwrite an existing file with new content.".to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "file_path": {
                            "type": "string",
                            "description": "The absolute path of file you want to write"
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
                description: "Edit an existing file with one or more text replacements.".to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "file_path": {
                            "type": "string",
                            "description": "The absolute path of file you want to edit"
                        },
                        "edits": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "old_string": {
                                        "type": "string",
                                        "description": "EXACT text to replace. Must match perfectly including whitespace. Include 3-5 lines of context."
                                    },
                                    "new_string": {
                                        "type": "string",
                                        "description": "Replacement text. Can be empty to delete. Must have correct indentation."
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
                        "pattern": {
                            "type": "string",
                            "description": "The regular expression pattern to search for in file contents"
                        },
                        "path": {
                            "type": "string",
                            "description": "The absolute path to the directory to search in"
                        },
                        "file_types": {
                            "type": "array",
                            "items": { "type": "string" },
                            "description": "File extensions to search (e.g., [\"ts\", \"tsx\", \"js\"])"
                        }
                    },
                    "required": ["pattern", "path"]
                }),
                requires_approval: false,
            },
            ToolMetadata {
                category: ToolCategory::Read,
                can_concurrent: true,
                file_operation: false,
                requires_approval: false,
                render_doing_ui: false,
            },
        ),
        (
            ToolDefinition {
                name: "glob".to_string(),
                description: "Fast file pattern matching tool that works with any codebase size.".to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "pattern": {
                            "type": "string",
                            "description": "The glob pattern to match files against (e.g., \"**/*.ts\")"
                        },
                        "path": {
                            "type": "string",
                            "description": "The directory to search in. Defaults to the current working directory."
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
                render_doing_ui: false,
            },
        ),
        (
            ToolDefinition {
                name: "listFiles".to_string(),
                description: "List files and directories in the specified directory.".to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "directory_path": {
                            "type": "string",
                            "description": "The absolute path to the directory you want to list"
                        },
                        "max_depth": {
                            "type": "integer",
                            "description": "Maximum depth for recursive listing (default: 3)"
                        }
                    },
                    "required": ["directory_path"]
                }),
                requires_approval: false,
            },
            ToolMetadata {
                category: ToolCategory::Read,
                can_concurrent: true,
                file_operation: false,
                requires_approval: false,
                render_doing_ui: false,
            },
        ),
        // Shell tool
        (
            ToolDefinition {
                name: "bash".to_string(),
                description: "Execute shell commands safely on the system.".to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "command": {
                            "type": "string",
                            "description": "The bash command to execute. Supports $RESOURCE/ prefix for bundled resources"
                        },
                        "runInBackground": {
                            "type": "boolean",
                            "description": "Run command in background and return task ID"
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
                description: "Language Server Protocol operations (go to definition, find references, etc.).".to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "operation": {
                            "type": "string",
                            "enum": ["goToDefinition", "findReferences", "hover", "documentSymbol", "workspaceSymbol", "goToImplementation", "prepareCallHierarchy", "incomingCalls", "outgoingCalls"],
                            "description": "The LSP operation to perform"
                        },
                        "filePath": {
                            "type": "string",
                            "description": "The file path for the operation"
                        },
                        "line": {
                            "type": "integer",
                            "description": "The line number (1-based, as shown in editors)"
                        },
                        "character": {
                            "type": "integer",
                            "description": "The character offset (1-based, as shown in editors)"
                        },
                        "query": {
                            "type": "string",
                            "description": "Query string for workspace symbols"
                        }
                    },
                    "required": ["operation"]
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
        // GitHub PR tool
        (
            ToolDefinition {
                name: "githubPR".to_string(),
                description: "Fetch GitHub Pull Request information using GitHub REST API.".to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "url": {
                            "type": "string",
                            "description": "Full GitHub PR URL (e.g., https://github.com/owner/repo/pull/123)"
                        },
                        "action": {
                            "type": "string",
                            "enum": ["info", "files", "diff", "comments"],
                            "description": "The type of PR data to fetch"
                        },
                        "page": {
                            "type": "integer",
                            "description": "Page number for pagination (starts from 1). Only for files/diff actions."
                        },
                        "perPage": {
                            "type": "integer",
                            "description": "Items per page (max 100, default 30). Only for files/diff actions."
                        },
                        "filenameFilter": {
                            "type": "string",
                            "description": "Glob pattern to filter files (e.g., \"*.ts\", \"src/**\"). Only for files/diff actions."
                        }
                    },
                    "required": ["url", "action"]
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
        // Image Generation tool
        (
            ToolDefinition {
                name: "imageGeneration".to_string(),
                description: "Generate images using AI image generation models.".to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "prompt": {
                            "type": "string",
                            "description": "Detailed description of the image to generate. Be specific about style, colors, composition, and content."
                        },
                        "size": {
                            "type": "string",
                            "description": "Optional: Image size. Supported: \"1024x1024\" (square), \"1792x1024\" (landscape/best for PPT), \"1024x1792\" (portrait). Default: \"1024x1024\""
                        },
                        "quality": {
                            "type": "string",
                            "description": "Optional: Image quality - \"standard\" (default) or \"hd\"/\"high\" (better quality, slower)"
                        },
                        "n": {
                            "type": "integer",
                            "description": "Optional: Number of images to generate (1-4). Default: 1"
                        }
                    },
                    "required": ["prompt"]
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
        // Agent tools
        (
            ToolDefinition {
                name: "callAgent".to_string(),
                description: "Call a registered sub-agent for a focused task. Subagents start with empty context.".to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "agentId": {
                            "type": "string",
                            "description": "The id of the registered agent to call"
                        },
                        "task": {
                            "type": "string",
                            "description": "The instruction or task to be executed by the agent"
                        },
                        "context": {
                            "type": "string",
                            "description": "Relevant context for solving this task. For example, the file path that needs to be modified and created"
                        },
                        "targets": {
                            "type": "array",
                            "items": { "type": "string" },
                            "description": "Optional resource targets (files/modules) this sub-agent will touch. Use to avoid conflicts and enable safe parallel execution."
                        }
                    },
                    "required": ["agentId", "task"]
                }),
                requires_approval: false,
            },
            ToolMetadata {
                category: ToolCategory::Other,
                can_concurrent: true,
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
                render_doing_ui: false,
            },
        ),
        // Ask user tool
        (
            ToolDefinition {
                name: "askUserQuestions".to_string(),
                description: "Ask the user one or more questions to gather additional information needed to complete the task.".to_string(),
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
                                        "description": "Unique identifier for the question"
                                    },
                                    "question": {
                                        "type": "string",
                                        "description": "The question text to display"
                                    },
                                    "header": {
                                        "type": "string",
                                        "description": "Short header/title for the tab (max 12 chars recommended)"
                                    },
                                    "options": {
                                        "type": "array",
                                        "items": {
                                            "type": "object",
                                            "properties": {
                                                "label": {
                                                    "type": "string",
                                                    "description": "The label/text for this option"
                                                },
                                                "description": {
                                                    "type": "string",
                                                    "description": "Description of what this option means"
                                                }
                                            },
                                            "required": ["label", "description"]
                                        }
                                    },
                                    "multiSelect": {
                                        "type": "boolean",
                                        "description": "Whether to allow multiple selections"
                                    }
                                },
                                "required": ["id", "question", "header", "options", "multiSelect"]
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
                description: "Present an implementation plan to the user for review and approval. This tool is REQUIRED in Plan Mode before making any file modifications.".to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "plan": {
                            "type": "string",
                            "description": "The implementation plan in Markdown format"
                        }
                    },
                    "required": ["plan"]
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
        // Install Skill tool
        (
            ToolDefinition {
                name: "installSkill".to_string(),
                description: "Install a skill from a GitHub repository into ~/.talkcody/skills.".to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "repository": {
                            "type": "string",
                            "description": "GitHub repository in \"owner/repo\" format"
                        },
                        "path": {
                            "type": "string",
                            "description": "Path to skill in repository, e.g. \"skills/my-skill\""
                        },
                        "skillId": {
                            "type": "string",
                            "description": "Optional skill identifier (defaults to directory name)"
                        }
                    },
                    "required": ["repository", "path"]
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
        // Test Custom Tool
        (
            ToolDefinition {
                name: "test_custom_tool".to_string(),
                description: "Validate a custom tool file (compile, execute, render)".to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "file_path": {
                            "type": "string",
                            "description": "Absolute path to the custom tool file"
                        },
                        "params": {
                            "type": "object",
                            "description": "Execution params for the custom tool"
                        }
                    },
                    "required": ["file_path"]
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
    ]
}
