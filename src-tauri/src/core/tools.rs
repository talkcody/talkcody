//! Tool Registry and Dispatch
//!
//! Provides a registry of available tools and dispatch mechanism for tool execution.
//! Tools execute on the backend host (filesystem, git, shell, LSP, search).

use crate::core::types::*;
use crate::storage::models::*;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

/// Tool execution context passed to all tool handlers
#[derive(Debug, Clone)]
pub struct ToolContext {
    pub session_id: SessionId,
    pub task_id: RuntimeTaskId,
    pub workspace_root: String,
    pub worktree_path: Option<String>,
    pub settings: TaskSettings,
}

/// Result of tool execution
#[derive(Debug, Clone)]
pub struct ToolExecutionOutput {
    pub success: bool,
    pub data: serde_json::Value,
    pub error: Option<String>,
}

/// Tool handler function type
pub type ToolHandler = Arc<
    dyn Fn(ToolRequest, ToolContext) -> futures_util::future::BoxFuture<'static, ToolExecutionOutput>
        + Send
        + Sync,
>;

use futures_util::future::BoxFuture;

/// Tool registry containing all available tools
pub struct ToolRegistry {
    tools: RwLock<HashMap<String, ToolDefinition>>,
    handlers: RwLock<HashMap<String, ToolHandler>>,
}

impl ToolRegistry {
    pub fn new() -> Self {
        Self {
            tools: RwLock::new(HashMap::new()),
            handlers: RwLock::new(HashMap::new()),
        }
    }

    /// Register a new tool
    pub async fn register(
        &self,
        definition: ToolDefinition,
        handler: ToolHandler,
    ) -> Result<(), String> {
        let name = definition.name.clone();

        let mut tools = self.tools.write().await;
        if tools.contains_key(&name) {
            return Err(format!("Tool '{}' already registered", name));
        }

        tools.insert(name.clone(), definition);
        drop(tools);

        let mut handlers = self.handlers.write().await;
        handlers.insert(name, handler);

        Ok(())
    }

    /// Unregister a tool
    pub async fn unregister(&self, name: &str) -> Result<(), String> {
        let mut tools = self.tools.write().await;
        if tools.remove(name).is_none() {
            return Err(format!("Tool '{}' not found", name));
        }
        drop(tools);

        let mut handlers = self.handlers.write().await;
        handlers.remove(name);

        Ok(())
    }

    /// Get tool definition
    pub async fn get_definition(&self, name: &str) -> Option<ToolDefinition> {
        let tools = self.tools.read().await;
        tools.get(name).cloned()
    }

    /// List all registered tools
    pub async fn list_tools(&self) -> Vec<ToolDefinition> {
        let tools = self.tools.read().await;
        tools.values().cloned().collect()
    }

    /// Check if a tool requires approval
    pub async fn requires_approval(&self, name: &str) -> bool {
        let tools = self.tools.read().await;
        tools
            .get(name)
            .map(|def| def.requires_approval)
            .unwrap_or(true) // Default to requiring approval for unknown tools
    }

    /// Execute a tool
    pub async fn execute(&self, request: ToolRequest, context: ToolContext) -> ToolResult {
        let handler = {
            let handlers = self.handlers.read().await;
            match handlers.get(&request.name) {
                Some(h) => h.clone(),
                None => {
                    return ToolResult {
                        tool_call_id: request.tool_call_id,
                        success: false,
                        output: serde_json::Value::Null,
                        error: Some(format!("Tool '{}' not found", request.name)),
                    };
                }
            }
        };

        let output = handler(request.clone(), context).await;

        ToolResult {
            tool_call_id: request.tool_call_id,
            success: output.success,
            output: output.data,
            error: output.error,
        }
    }

    /// Create default tool registry with built-in tools
    pub async fn create_default() -> Self {
        let registry = Self::new();

        // Register built-in tools
        // Note: Actual tool implementations would be added here
        // For now, we register placeholder definitions

        let tools = vec![
            ToolDefinition {
                name: "read_file".to_string(),
                description: "Read the contents of a file".to_string(),
                parameters: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Path to the file"
                        }
                    },
                    "required": ["path"]
                }),
                requires_approval: false,
            },
            ToolDefinition {
                name: "write_file".to_string(),
                description: "Write content to a file".to_string(),
                parameters: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Path to the file"
                        },
                        "content": {
                            "type": "string",
                            "description": "Content to write"
                        }
                    },
                    "required": ["path", "content"]
                }),
                requires_approval: true,
            },
            ToolDefinition {
                name: "search_files".to_string(),
                description: "Search for files matching a pattern".to_string(),
                parameters: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "pattern": {
                            "type": "string",
                            "description": "Search pattern"
                        },
                        "path": {
                            "type": "string",
                            "description": "Directory to search in"
                        }
                    },
                    "required": ["pattern"]
                }),
                requires_approval: false,
            },
            ToolDefinition {
                name: "execute_shell".to_string(),
                description: "Execute a shell command".to_string(),
                parameters: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "command": {
                            "type": "string",
                            "description": "Command to execute"
                        },
                        "cwd": {
                            "type": "string",
                            "description": "Working directory"
                        }
                    },
                    "required": ["command"]
                }),
                requires_approval: true,
            },
            ToolDefinition {
                name: "git_status".to_string(),
                description: "Get git repository status".to_string(),
                parameters: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Repository path"
                        }
                    }
                }),
                requires_approval: false,
            },
        ];

        for tool in tools {
            let name = tool.name.clone();
            let handler: ToolHandler = Arc::new(
                move |_req: crate::core::types::ToolRequest, _ctx: ToolContext| {
                    let name = name.clone();
                    Box::pin(async move {
                        // Placeholder implementation
                        ToolExecutionOutput {
                            success: true,
                            data: serde_json::json!({
                                "message": format!("Tool '{}' executed (placeholder)", name)
                            }),
                            error: None,
                        }
                    })
                },
            );

            let _ = registry.register(tool, handler).await;
        }

        registry
    }
}

impl Default for ToolRegistry {
    fn default() -> Self {
        // This is a synchronous default, so we can't register tools here
        // Use create_default() instead
        Self::new()
    }
}

/// Tool dispatcher that manages tool execution with approval workflow
pub struct ToolDispatcher {
    registry: Arc<ToolRegistry>,
}

impl ToolDispatcher {
    pub fn new(registry: Arc<ToolRegistry>) -> Self {
        Self { registry }
    }

    /// Dispatch a tool execution request
    /// Returns ToolCallRequested event if approval is required, otherwise executes immediately
    pub async fn dispatch(
        &self,
        request: ToolRequest,
        context: ToolContext,
        auto_approve: bool,
    ) -> Result<ToolDispatchResult, String> {
        // Check if tool requires approval
        let requires_approval = self.registry.requires_approval(&request.name).await;

        if requires_approval && !auto_approve {
            // Return pending for approval
            Ok(ToolDispatchResult::PendingApproval(request))
        } else {
            // Execute immediately
            let result = self.registry.execute(request, context).await;
            Ok(ToolDispatchResult::Completed(result))
        }
    }

    /// Execute a tool that was pending approval
    pub async fn execute_approved(&self, request: ToolRequest, context: ToolContext) -> ToolResult {
        self.registry.execute(request, context).await
    }
}

/// Result of tool dispatch
#[derive(Debug, Clone)]
pub enum ToolDispatchResult {
    /// Tool executed immediately
    Completed(ToolResult),
    /// Tool requires user approval
    PendingApproval(ToolRequest),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_tool_registry() {
        let registry = ToolRegistry::new();

        let tool = ToolDefinition {
            name: "test_tool".to_string(),
            description: "A test tool".to_string(),
            parameters: serde_json::json!({}),
            requires_approval: false,
        };

        let handler: ToolHandler = Arc::new(|_req, _ctx| {
            Box::pin(async move {
                ToolExecutionOutput {
                    success: true,
                    data: serde_json::json!({"result": "ok"}),
                    error: None,
                }
            })
        });

        registry
            .register(tool, handler)
            .await
            .expect("Failed to register tool");

        let definition = registry.get_definition("test_tool").await;
        assert!(definition.is_some());
        assert_eq!(definition.unwrap().name, "test_tool");
    }

    #[tokio::test]
    async fn test_tool_registry_duplicate() {
        let registry = ToolRegistry::new();

        let tool = ToolDefinition {
            name: "dup_tool".to_string(),
            description: "Test".to_string(),
            parameters: serde_json::json!({}),
            requires_approval: false,
        };

        let handler: ToolHandler = Arc::new(|_req, _ctx| {
            Box::pin(async move {
                ToolExecutionOutput {
                    success: true,
                    data: serde_json::json!({}),
                    error: None,
                }
            })
        });

        registry
            .register(tool.clone(), handler.clone())
            .await
            .expect("First register should succeed");
        let result = registry.register(tool, handler).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_default_registry() {
        let registry = ToolRegistry::create_default().await;

        let tools = registry.list_tools().await;
        assert!(!tools.is_empty());

        // Check that read_file doesn't require approval
        let read_file_def = registry.get_definition("read_file").await;
        assert!(read_file_def.is_some());
        assert!(!read_file_def.unwrap().requires_approval);

        // Check that write_file requires approval
        let write_file_def = registry.get_definition("write_file").await;
        assert!(write_file_def.is_some());
        assert!(write_file_def.unwrap().requires_approval);
    }
}
