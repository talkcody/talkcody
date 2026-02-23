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
    /// Optional LLM state for tools that need AI services (image generation, etc.)
    pub llm_state: Option<Arc<LlmState>>,
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

use crate::llm::auth::api_key_manager::LlmState;
use crate::tools::{
    ask_user_questions, bash_tool, call_agent, code_search, edit_file, exit_plan_mode, github_pr,
    glob_tool, image_generation, install_skill, list_files, read_file, todo_write, web_fetch,
    web_search, write_file,
};

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

/// Execute a tool by name using the dedicated tool modules
async fn execute_tool_by_name(
    name: &str,
    request: ToolRequest,
    ctx: ToolContext,
) -> ToolExecutionOutput {
    // Route to appropriate tool module based on name
    let result: ToolExecutionOutput = match name {
        // File tools
        "readFile" | "read_file" => {
            let file_path = request
                .input
                .get("file_path")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let start_line = request
                .input
                .get("start_line")
                .and_then(|v| v.as_u64())
                .map(|v| v as usize);
            let line_count = request
                .input
                .get("line_count")
                .and_then(|v| v.as_u64())
                .map(|v| v as usize);

            let result = read_file::execute(file_path, start_line, line_count, &ctx).await;
            ToolExecutionOutput {
                success: result.success,
                data: serde_json::to_value(&result).unwrap_or_default(),
                error: if result.success {
                    None
                } else {
                    Some(result.message)
                },
            }
        }
        "writeFile" | "write_file" => {
            let file_path = request
                .input
                .get("file_path")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let content = request
                .input
                .get("content")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            // Backend always auto-approves
            let result = write_file::execute(file_path, content, false, &ctx).await;
            ToolExecutionOutput {
                success: result.success,
                data: serde_json::to_value(&result).unwrap_or_default(),
                error: if result.success {
                    None
                } else {
                    Some(result.message)
                },
            }
        }
        "editFile" | "edit_file" => {
            let file_path = request
                .input
                .get("file_path")
                .and_then(|v| v.as_str())
                .unwrap_or("");

            let edits: Vec<edit_file::EditBlock> = request
                .input
                .get("edits")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|e| {
                            Some(edit_file::EditBlock {
                                old_string: e.get("old_string")?.as_str()?.to_string(),
                                new_string: e.get("new_string")?.as_str()?.to_string(),
                            })
                        })
                        .collect()
                })
                .unwrap_or_default();

            // Backend always auto-approves
            let result = edit_file::execute(file_path, edits, false, &ctx).await;
            ToolExecutionOutput {
                success: result.success,
                data: serde_json::to_value(&result).unwrap_or_default(),
                error: if result.success {
                    None
                } else {
                    Some(result.message)
                },
            }
        }
        "listFiles" | "list_files" | "list_directory" => {
            let directory_path = request
                .input
                .get("directory_path")
                .or_else(|| request.input.get("path"))
                .and_then(|v| v.as_str())
                .unwrap_or(".");
            let max_depth = request
                .input
                .get("max_depth")
                .and_then(|v| v.as_u64())
                .map(|v| v as usize);

            let result = list_files::execute(directory_path, max_depth, &ctx).await;
            ToolExecutionOutput {
                success: result.success,
                data: serde_json::to_value(&result).unwrap_or_default(),
                error: result.error,
            }
        }
        // Search tools
        "codeSearch" | "code_search" | "search_files" => {
            let pattern = request
                .input
                .get("pattern")
                .or_else(|| request.input.get("query"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let path = request
                .input
                .get("path")
                .and_then(|v| v.as_str())
                .unwrap_or(&ctx.workspace_root);
            let file_types: Option<Vec<String>> = request
                .input
                .get("file_types")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(String::from))
                        .collect()
                });

            let result = code_search::execute(pattern, path, file_types, &ctx).await;
            ToolExecutionOutput {
                success: result.success,
                data: serde_json::to_value(&result).unwrap_or_default(),
                error: result.error,
            }
        }
        "glob" => {
            let pattern = request
                .input
                .get("pattern")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let path = request.input.get("path").and_then(|v| v.as_str());

            let result = glob_tool::execute(pattern, path, &ctx).await;
            ToolExecutionOutput {
                success: result.success,
                data: serde_json::json!({"result": result.result}),
                error: result.error,
            }
        }
        // Shell tool
        "bash" | "execute_shell" | "executeShell" => {
            let command = request
                .input
                .get("command")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let run_in_background = request
                .input
                .get("runInBackground")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);

            let result = bash_tool::execute(command, run_in_background, &ctx).await;
            ToolExecutionOutput {
                success: result.success,
                data: serde_json::to_value(&result).unwrap_or_default(),
                error: result.error,
            }
        }
        // LSP tool
        "lsp" => {
            // For now, return a placeholder - full LSP implementation would require LSP client
            ToolExecutionOutput {
                success: true,
                data: serde_json::json!({"message": "LSP tool executed (placeholder - full implementation requires LSP client setup"}),
                error: None,
            }
        }
        // Web tools
        "webFetch" | "web_fetch" => {
            if let Some(url) = request.input.get("url").and_then(|v| v.as_str()) {
                match web_fetch::execute_web_fetch(url, &ctx, &request.tool_call_id).await {
                    Ok(result) => ToolExecutionOutput {
                        success: true,
                        data: serde_json::to_value(&result).unwrap_or_default(),
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
                    error: Some("No URL provided".to_string()),
                }
            }
        }
        "webSearch" | "web_search" => {
            if let Some(query) = request.input.get("query").and_then(|v| v.as_str()) {
                match web_search::execute_web_search(query).await {
                    Ok(results) => ToolExecutionOutput {
                        success: true,
                        data: serde_json::to_value(&results).unwrap_or_default(),
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
        // GitHub PR tool
        "githubPR" | "github_pr" => {
            let url = request
                .input
                .get("url")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let action = request
                .input
                .get("action")
                .and_then(|v| v.as_str())
                .unwrap_or("info");
            let page = request
                .input
                .get("page")
                .and_then(|v| v.as_u64())
                .map(|v| v as u32);
            let per_page = request
                .input
                .get("perPage")
                .and_then(|v| v.as_u64())
                .map(|v| v as u32);
            let filename_filter = request.input.get("filenameFilter").and_then(|v| v.as_str());

            let result =
                github_pr::execute(url, action, page, per_page, filename_filter, &ctx).await;
            ToolExecutionOutput {
                success: result.success,
                data: serde_json::to_value(&result).unwrap_or_default(),
                error: result.error,
            }
        }
        // Image Generation tool
        "imageGeneration" | "image_generation" => {
            let prompt = request
                .input
                .get("prompt")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let size = request.input.get("size").and_then(|v| v.as_str());
            let quality = request.input.get("quality").and_then(|v| v.as_str());
            let n = request
                .input
                .get("n")
                .and_then(|v| v.as_u64())
                .map(|v| v as u32);

            let result = image_generation::execute(prompt, size, quality, n, &ctx).await;
            ToolExecutionOutput {
                success: result.success,
                data: serde_json::to_value(&result).unwrap_or_default(),
                error: result.error,
            }
        }
        // Agent tools
        "callAgent" | "call_agent" => {
            let agent_id = request
                .input
                .get("agentId")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let task = request
                .input
                .get("task")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let context = request.input.get("context").and_then(|v| v.as_str());
            let targets: Option<Vec<String>> = request
                .input
                .get("targets")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(String::from))
                        .collect()
                });

            let result = call_agent::execute(agent_id, task, context, targets, &ctx).await;
            ToolExecutionOutput {
                success: result.success,
                data: serde_json::to_value(&result).unwrap_or_default(),
                error: result.error,
            }
        }
        // Todo tool
        "todoWrite" | "todo_write" => {
            let todos: Vec<todo_write::TodoItem> = request
                .input
                .get("todos")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| {
                            Some(todo_write::TodoItem {
                                id: v.get("id")?.as_str()?.to_string(),
                                content: v.get("content")?.as_str()?.to_string(),
                                status: v.get("status")?.as_str()?.to_string(),
                            })
                        })
                        .collect()
                })
                .unwrap_or_default();

            let result = todo_write::execute(todos, &ctx).await;
            ToolExecutionOutput {
                success: result.success,
                data: serde_json::to_value(&result).unwrap_or_default(),
                error: result.error,
            }
        }
        // Ask user tool
        "askUserQuestions" | "ask_user_questions" => {
            let questions: Vec<ask_user_questions::Question> = request
                .input
                .get("questions")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| {
                            Some(ask_user_questions::Question {
                                id: v.get("id")?.as_str()?.to_string(),
                                question: v.get("question")?.as_str()?.to_string(),
                                header: v.get("header")?.as_str()?.to_string(),
                                options: v
                                    .get("options")?
                                    .as_array()?
                                    .iter()
                                    .filter_map(|o| {
                                        Some(ask_user_questions::QuestionOption {
                                            label: o.get("label")?.as_str()?.to_string(),
                                            description: o
                                                .get("description")?
                                                .as_str()?
                                                .to_string(),
                                        })
                                    })
                                    .collect(),
                                multi_select: v.get("multiSelect")?.as_bool()?,
                            })
                        })
                        .collect()
                })
                .unwrap_or_default();

            let result = ask_user_questions::execute(questions, &ctx).await;
            ToolExecutionOutput {
                success: result.success,
                data: serde_json::to_value(&result).unwrap_or_default(),
                error: result.error,
            }
        }
        // Exit plan mode
        "exitPlanMode" | "exit_plan_mode" => {
            let plan = request
                .input
                .get("plan")
                .and_then(|v| v.as_str())
                .unwrap_or("");

            match exit_plan_mode::execute(plan, &ctx).await {
                Ok(result) => ToolExecutionOutput {
                    success: true,
                    data: serde_json::to_value(&result).unwrap_or_default(),
                    error: None,
                },
                Err(e) => ToolExecutionOutput {
                    success: false,
                    data: serde_json::Value::Null,
                    error: Some(e),
                },
            }
        }
        // Install Skill tool
        "installSkill" | "install_skill" => {
            let repository = request
                .input
                .get("repository")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let path = request
                .input
                .get("path")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let skill_id = request.input.get("skillId").and_then(|v| v.as_str());

            let result = install_skill::execute(repository, path, skill_id, &ctx).await;
            ToolExecutionOutput {
                success: result.success,
                data: serde_json::to_value(&result).unwrap_or_default(),
                error: if result.success {
                    None
                } else {
                    Some(result.message)
                },
            }
        }
        // Test Custom Tool
        "test_custom_tool" | "test_custom" => {
            // Return placeholder - full implementation would require custom tool compiler
            ToolExecutionOutput {
                success: false,
                data: serde_json::Value::Null,
                error: Some("test_custom_tool requires custom tool compiler which is not fully implemented in backend mode".to_string()),
            }
        }
        // Git tools (via platform)
        "git_status" | "gitStatus" => {
            let platform = crate::platform::Platform::new();
            let platform_ctx =
                platform.create_context(&ctx.workspace_root, ctx.worktree_path.as_deref());
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
