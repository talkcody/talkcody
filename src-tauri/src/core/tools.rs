//! Tool Registry and Dispatch
//!
//! Provides a registry of available tools and dispatch mechanism for tool execution.
//! Tools execute on the backend host (filesystem, git, shell, LSP, search).

use crate::core::types::*;
use crate::platform::types::PlatformResult;
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
    dyn Fn(ToolRequest, ToolContext) -> futures::future::BoxFuture<'static, ToolExecutionOutput>
        + Send
        + Sync,
>;

use futures::future::BoxFuture;

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
        let normalized_name = crate::core::tool_name_normalizer::normalize_tool_name(name);
        let tools = self.tools.read().await;
        tools.get(&normalized_name).cloned()
    }

    /// List all registered tools
    pub async fn list_tools(&self) -> Vec<ToolDefinition> {
        let tools = self.tools.read().await;
        tools.values().cloned().collect()
    }

    /// Check if a tool requires approval
    pub async fn requires_approval(&self, name: &str) -> bool {
        let normalized_name = crate::core::tool_name_normalizer::normalize_tool_name(name);
        let tools = self.tools.read().await;
        tools
            .get(&normalized_name)
            .map(|def| def.requires_approval)
            .unwrap_or(true) // Default to requiring approval for unknown tools
    }

    /// Execute a tool
    pub async fn execute(&self, request: ToolRequest, context: ToolContext) -> ToolResult {
        let normalized_name = crate::core::tool_name_normalizer::normalize_tool_name(&request.name);
        let request = ToolRequest {
            name: normalized_name,
            ..request
        };

        let handler = {
            let handlers = self.handlers.read().await;
            match handlers.get(&request.name) {
                Some(h) => h.clone(),
                None => {
                    return ToolResult {
                        tool_call_id: request.tool_call_id,
                        name: Some(request.name.clone()),
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
            name: Some(request.name),
            success: output.success,
            output: output.data,
            error: output.error,
        }
    }

    /// Create default tool registry with built-in tools
    pub async fn create_default() -> Self {
        let registry = Self::new();

        // Register tools from canonical definitions
        let definitions = crate::core::tool_definitions::get_tool_definitions();

        for tool_def in definitions {
            let name = tool_def.0.name.clone();
            let handler: ToolHandler = Arc::new(
                move |req: crate::core::types::ToolRequest, ctx: ToolContext| {
                    let name = name.clone();
                    Box::pin(async move {
                        // Route to platform implementation
                        execute_tool_by_name(&name, req, ctx).await
                    })
                },
            );

            let _ = registry.register(tool_def.0, handler).await;
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
        let normalized_name = crate::core::tool_name_normalizer::normalize_tool_name(&request.name);
        let request = ToolRequest {
            name: normalized_name,
            ..request
        };

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

/// Execute a tool by name using the platform
async fn execute_tool_by_name(
    name: &str,
    request: ToolRequest,
    ctx: ToolContext,
) -> ToolExecutionOutput {
    let platform = crate::platform::Platform::new();
    let platform_ctx = platform.create_context(&ctx.workspace_root, ctx.worktree_path.as_deref());

    // Map camelCase tool name to platform tool name
    // All arms return ToolExecutionOutput directly for consistency
    let result: ToolExecutionOutput = match name {
        "readFile" | "read_file" => {
            let path = request
                .input
                .get("file_path")
                .and_then(|v| v.as_str())
                .or_else(|| request.input.get("path").and_then(|v| v.as_str()))
                .unwrap_or("");
            let platform_result = platform.filesystem.read_file(path, &platform_ctx).await;
            ToolExecutionOutput {
                success: platform_result.success,
                data: serde_json::to_value(&platform_result.data).unwrap_or_default(),
                error: platform_result.error,
            }
        }
        "writeFile" | "write_file" => {
            let path = request
                .input
                .get("file_path")
                .and_then(|v| v.as_str())
                .or_else(|| request.input.get("path").and_then(|v| v.as_str()))
                .unwrap_or("");
            let content = request
                .input
                .get("content")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let platform_result = platform
                .filesystem
                .write_file(path, content, &platform_ctx)
                .await;
            ToolExecutionOutput {
                success: platform_result.success,
                data: serde_json::to_value(&platform_result.data).unwrap_or_default(),
                error: platform_result.error,
            }
        }
        "editFile" | "edit_file" => {
            // Edit file using platform
            let path = request
                .input
                .get("file_path")
                .and_then(|v| v.as_str())
                .or_else(|| request.input.get("path").and_then(|v| v.as_str()))
                .unwrap_or("");
            if let Some(edits) = request.input.get("edits").and_then(|v| v.as_array()) {
                // Read current content
                let read_result = platform.filesystem.read_file(path, &platform_ctx).await;
                if read_result.success {
                    if let Some(content) = read_result.data {
                        let mut new_content = content;
                        for edit in edits {
                            if let (Some(old_str), Some(new_str)) = (
                                edit.get("old_string").and_then(|v| v.as_str()),
                                edit.get("new_string").and_then(|v| v.as_str()),
                            ) {
                                new_content = new_content.replace(old_str, new_str);
                            }
                        }
                        let write_result = platform
                            .filesystem
                            .write_file(path, &new_content, &platform_ctx)
                            .await;
                        ToolExecutionOutput {
                            success: write_result.success,
                            data: serde_json::to_value(&write_result.data).unwrap_or_default(),
                            error: write_result.error,
                        }
                    } else {
                        ToolExecutionOutput {
                            success: false,
                            data: serde_json::Value::Null,
                            error: Some("Failed to read file content".to_string()),
                        }
                    }
                } else {
                    ToolExecutionOutput {
                        success: false,
                        data: serde_json::Value::Null,
                        error: Some("Failed to read file for editing".to_string()),
                    }
                }
            } else {
                ToolExecutionOutput {
                    success: false,
                    data: serde_json::Value::Null,
                    error: Some("No edits provided".to_string()),
                }
            }
        }
        "glob" => {
            // Glob implementation using walkdir
            if let Some(pattern) = request.input.get("pattern").and_then(|v| v.as_str()) {
                use std::path::Path;

                // Simple glob implementation - convert pattern to suffix matching
                let files: Vec<String> = std::fs::read_dir(&ctx.workspace_root)
                    .ok()
                    .into_iter()
                    .flatten()
                    .filter_map(|e| e.ok())
                    .filter(|e| {
                        let name = e.file_name().to_string_lossy().to_string();
                        // Very simple pattern matching
                        if pattern.starts_with("**/*.") {
                            let ext = &pattern[4..]; // Get extension after "**/*."
                            name.ends_with(ext)
                        } else if pattern.starts_with("*.") {
                            let ext = &pattern[2..]; // Get extension after "*."
                            name.ends_with(ext)
                        } else {
                            name.contains(pattern)
                        }
                    })
                    .map(|e| e.path().to_string_lossy().to_string())
                    .collect();

                ToolExecutionOutput {
                    success: true,
                    data: serde_json::json!(files),
                    error: None,
                }
            } else {
                ToolExecutionOutput {
                    success: false,
                    data: serde_json::Value::Null,
                    error: Some("No pattern provided".to_string()),
                }
            }
        }
        "codeSearch" | "search_files" => {
            if let Some(query) = request.input.get("query").and_then(|v| v.as_str()) {
                let search_result = crate::search::RipgrepSearch::new()
                    .with_max_results(50)
                    .search_content(query, &ctx.workspace_root);
                match search_result {
                    Ok(results) => ToolExecutionOutput {
                        success: true,
                        data: serde_json::json!(results),
                        error: None,
                    },
                    Err(e) => ToolExecutionOutput {
                        success: false,
                        data: serde_json::Value::Null,
                        error: Some(e),
                    },
                }
            } else {
                ToolExecutionOutput {
                    success: false,
                    data: serde_json::Value::Null,
                    error: Some("No query provided".to_string()),
                }
            }
        }
        "listFiles" | "list_files" | "list_directory" => {
            let path = request
                .input
                .get("path")
                .and_then(|v| v.as_str())
                .unwrap_or(".");
            let platform_result = platform
                .filesystem
                .list_directory(path, &platform_ctx)
                .await;
            ToolExecutionOutput {
                success: platform_result.success,
                data: serde_json::to_value(&platform_result.data).unwrap_or_default(),
                error: platform_result.error,
            }
        }
        "bash" | "execute_shell" | "executeShell" => {
            let command = request
                .input
                .get("command")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let cwd = request.input.get("cwd").and_then(|v| v.as_str());
            let platform_result = platform.shell.execute(command, cwd, &platform_ctx).await;
            ToolExecutionOutput {
                success: platform_result.success,
                data: serde_json::to_value(&platform_result.data).unwrap_or_default(),
                error: platform_result.error,
            }
        }
        "lsp" => {
            // LSP operations - return placeholder for now
            ToolExecutionOutput {
                success: true,
                data: serde_json::json!({"message": "LSP tool executed"}),
                error: None,
            }
        }
        "webFetch" | "web_fetch" => {
            if let Some(url) = request.input.get("url").and_then(|v| v.as_str()) {
                // Perform HTTP fetch
                match reqwest::get(url).await {
                    Ok(response) => match response.text().await {
                        Ok(text) => ToolExecutionOutput {
                            success: true,
                            data: serde_json::json!({"content": text}),
                            error: None,
                        },
                        Err(e) => ToolExecutionOutput {
                            success: false,
                            data: serde_json::Value::Null,
                            error: Some(format!("Failed to read response: {}", e)),
                        },
                    },
                    Err(e) => ToolExecutionOutput {
                        success: false,
                        data: serde_json::Value::Null,
                        error: Some(format!("Failed to fetch: {}", e)),
                    },
                }
            } else {
                ToolExecutionOutput {
                    success: false,
                    data: serde_json::Value::Null,
                    error: Some("No URL provided".to_string()),
                }
            }
        }
        "webSearch" | "web_search" => {
            // Web search - return placeholder
            ToolExecutionOutput {
                success: true,
                data: serde_json::json!({"results": [], "message": "Web search placeholder"}),
                error: None,
            }
        }
        "callAgent" | "call_agent" => {
            // Call agent - return placeholder
            ToolExecutionOutput {
                success: true,
                data: serde_json::json!({"message": "Agent execution placeholder"}),
                error: None,
            }
        }
        "todoWrite" | "todo_write" => ToolExecutionOutput {
            success: true,
            data: serde_json::json!({"message": "Todo write placeholder"}),
            error: None,
        },
        "askUserQuestions" | "ask_user_questions" => ToolExecutionOutput {
            success: true,
            data: serde_json::json!({"message": "Ask user questions placeholder"}),
            error: None,
        },
        "exitPlanMode" | "exit_plan_mode" => ToolExecutionOutput {
            success: true,
            data: serde_json::json!({"exited": true}),
            error: None,
        },
        "githubPR" | "github_pr" => ToolExecutionOutput {
            success: true,
            data: serde_json::json!({"message": "GitHub PR placeholder"}),
            error: None,
        },
        "git_status" | "gitStatus" => {
            let platform_result = platform.git.get_status(&platform_ctx).await;
            ToolExecutionOutput {
                success: platform_result.success,
                data: serde_json::to_value(&platform_result.data).unwrap_or_default(),
                error: platform_result.error,
            }
        }
        _ => ToolExecutionOutput {
            success: false,
            data: serde_json::Value::Null,
            error: Some(format!("Unknown tool: {}", name)),
        },
    };

    result
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
