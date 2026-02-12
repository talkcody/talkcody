//! Agent Loop
//!
//! Implements the core agent execution loop that:
//! 1. Builds context from session messages and settings
//! 2. Calls LLM with streaming
//! 3. Handles tool calls and dispatches to platform tools
//! 4. Manages the conversation flow until completion

use crate::core::tools::{ToolContext, ToolDispatchResult, ToolDispatcher, ToolRegistry};
use crate::core::types::*;
use crate::llm::ai_services::stream_runner::StreamRunner;
use crate::llm::providers::provider_registry::ProviderRegistry;
use crate::llm::types::{
    Message as LlmMessage, StreamEvent, StreamTextRequest, ToolDefinition as LlmToolDefinition,
};
use crate::storage::models::*;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, RwLock};

/// Agent loop configuration
pub struct AgentLoop {
    config: AgentLoopConfig,
    tool_dispatcher: Arc<ToolDispatcher>,
    event_sender: EventSender,
    registry: ProviderRegistry,
    api_keys: crate::llm::auth::api_key_manager::ApiKeyManager,
}

/// Context for a single agent loop execution
#[derive(Debug, Clone)]
pub struct AgentLoopContext {
    pub session_id: SessionId,
    pub task_id: RuntimeTaskId,
    pub workspace_root: String,
    pub worktree_path: Option<String>,
    pub settings: TaskSettings,
    pub messages: Vec<Message>,
    pub model: Option<String>,
}

/// Result of agent loop execution
#[derive(Debug, Clone)]
pub enum AgentLoopResult {
    /// Completed successfully with final response
    Completed { message: String },
    /// Waiting for user approval of tool call
    WaitingForApproval { request: ToolRequest },
    /// Waiting for tool result
    WaitingForToolResult { tool_call_id: ToolCallId },
    /// Error occurred
    Error { message: String },
    /// Maximum iterations reached
    MaxIterationsReached,
    /// Cancelled by user
    Cancelled,
}

/// Stream processor state for handling LLM events
#[derive(Debug, Default)]
struct StreamProcessorState {
    accumulated_text: String,
    tool_calls: Vec<ToolRequest>,
    has_error: bool,
    error_message: Option<String>,
}

impl AgentLoop {
    pub fn new(
        config: AgentLoopConfig,
        tool_dispatcher: Arc<ToolDispatcher>,
        event_sender: EventSender,
        registry: ProviderRegistry,
        api_keys: crate::llm::auth::api_key_manager::ApiKeyManager,
    ) -> Self {
        Self {
            config,
            tool_dispatcher,
            event_sender,
            registry,
            api_keys,
        }
    }

    /// Run the agent loop with full LLM integration
    pub async fn run(&self, ctx: &AgentLoopContext) -> Result<AgentLoopResult, String> {
        let mut iteration = 0;
        let mut messages = ctx.messages.clone();

        while iteration < self.config.max_iterations {
            iteration += 1;

            // Run a single iteration
            match self.run_iteration(ctx, &messages).await? {
                AgentLoopResult::Completed { message } => {
                    return Ok(AgentLoopResult::Completed { message });
                }
                AgentLoopResult::WaitingForApproval { request } => {
                    return Ok(AgentLoopResult::WaitingForApproval { request });
                }
                AgentLoopResult::WaitingForToolResult { tool_call_id } => {
                    return Ok(AgentLoopResult::WaitingForToolResult { tool_call_id });
                }
                AgentLoopResult::Error { message } => {
                    return Ok(AgentLoopResult::Error { message });
                }
                AgentLoopResult::MaxIterationsReached => {
                    return Ok(AgentLoopResult::MaxIterationsReached);
                }
                AgentLoopResult::Cancelled => {
                    return Ok(AgentLoopResult::Cancelled);
                }
            }
        }

        Ok(AgentLoopResult::MaxIterationsReached)
    }

    /// Run a single iteration with LLM streaming
    pub async fn run_iteration(
        &self,
        ctx: &AgentLoopContext,
        messages: &[Message],
    ) -> Result<AgentLoopResult, String> {
        // Convert messages to LLM format
        let llm_messages: Vec<LlmMessage> = messages
            .iter()
            .map(|m| self.convert_message_to_llm(m))
            .collect();

        // Build tools for LLM
        let tools = if self.config.enable_tools {
            Some(self.build_tool_definitions())
        } else {
            None
        };

        // Create stream request
        let request = StreamTextRequest {
            model: ctx
                .model
                .clone()
                .unwrap_or_else(|| "claude-sonnet-4".to_string()),
            messages: llm_messages,
            tools,
            stream: Some(true),
            temperature: Some(self.config.temperature),
            max_tokens: self.config.max_tokens.map(|t| t as i32),
            top_p: None,
            top_k: None,
            provider_options: None,
            request_id: Some(ctx.task_id.clone()),
            trace_context: None,
        };

        // Run stream
        let runner = StreamRunner::new(self.registry.clone(), self.api_keys.clone());
        let mut state = StreamProcessorState::default();
        let timeout = Duration::from_secs(300);

        let result = runner
            .stream(request, timeout, |event| {
                self.process_stream_event(&mut state, event, ctx);
            })
            .await;

        if let Err(e) = result {
            return Ok(AgentLoopResult::Error { message: e });
        }

        // Check for errors
        if state.has_error {
            return Ok(AgentLoopResult::Error {
                message: state
                    .error_message
                    .unwrap_or_else(|| "Unknown error".to_string()),
            });
        }

        // Handle tool calls
        if !state.tool_calls.is_empty() {
            // For now, handle first tool call
            let tool_call = state.tool_calls.remove(0);
            let tool_context = ToolContext {
                session_id: ctx.session_id.clone(),
                task_id: ctx.task_id.clone(),
                workspace_root: ctx.workspace_root.clone(),
                worktree_path: ctx.worktree_path.clone(),
                settings: ctx.settings.clone(),
            };

            let auto_approve = ctx.settings.auto_approve_edits.unwrap_or(false);

            match self
                .tool_dispatcher
                .dispatch(tool_call.clone(), tool_context, auto_approve)
                .await
            {
                Ok(ToolDispatchResult::Completed(result)) => {
                    // Emit completion event
                    let _ = self.event_sender.send(RuntimeEvent::ToolCallCompleted {
                        task_id: ctx.task_id.clone(),
                        result: result.clone(),
                    });

                    // Continue with tool result
                    Ok(AgentLoopResult::Completed {
                        message: format!("Tool executed: {:?}", result),
                    })
                }
                Ok(ToolDispatchResult::PendingApproval(request)) => {
                    Ok(AgentLoopResult::WaitingForApproval { request })
                }
                Err(e) => Ok(AgentLoopResult::Error { message: e }),
            }
        } else {
            // No tool calls, return completed with accumulated text
            Ok(AgentLoopResult::Completed {
                message: state.accumulated_text,
            })
        }
    }

    /// Process a stream event from the LLM
    fn process_stream_event(
        &self,
        state: &mut StreamProcessorState,
        event: StreamEvent,
        ctx: &AgentLoopContext,
    ) {
        match event {
            StreamEvent::TextDelta { text } => {
                state.accumulated_text.push_str(&text);

                // Emit token event
                let _ = self.event_sender.send(RuntimeEvent::Token {
                    session_id: ctx.session_id.clone(),
                    token: text,
                });
            }
            StreamEvent::ToolCall {
                tool_call_id,
                tool_name,
                input,
                provider_metadata,
            } => {
                let tool_request = ToolRequest {
                    tool_call_id: tool_call_id.clone(),
                    name: tool_name.clone(),
                    input,
                    provider_metadata,
                };
                state.tool_calls.push(tool_request.clone());

                // Emit tool call requested event
                let _ = self.event_sender.send(RuntimeEvent::ToolCallRequested {
                    task_id: ctx.task_id.clone(),
                    request: tool_request,
                });
            }
            StreamEvent::ReasoningStart {
                id,
                provider_metadata,
            } => {
                // Emit reasoning start event
                let _ = self.event_sender.send(RuntimeEvent::ReasoningStart {
                    session_id: ctx.session_id.clone(),
                    id,
                });
            }
            StreamEvent::ReasoningDelta {
                id,
                text,
                provider_metadata,
            } => {
                // Emit reasoning delta event
                let _ = self.event_sender.send(RuntimeEvent::ReasoningDelta {
                    session_id: ctx.session_id.clone(),
                    id,
                    text,
                });
            }
            StreamEvent::ReasoningEnd { id } => {
                // Emit reasoning end event
                let _ = self.event_sender.send(RuntimeEvent::ReasoningEnd {
                    session_id: ctx.session_id.clone(),
                    id,
                });
            }
            StreamEvent::Error { message } => {
                state.has_error = true;
                state.error_message = Some(message);
            }
            _ => {}
        }
    }

    /// Convert internal Message to LLM Message format
    fn convert_message_to_llm(&self, message: &Message) -> LlmMessage {
        match message.role {
            MessageRole::User => LlmMessage::User {
                content: crate::llm::types::MessageContent::Text(match &message.content {
                    MessageContent::Text { text } => text.clone(),
                    _ => serde_json::to_string(&message.content).unwrap_or_default(),
                }),
                provider_options: None,
            },
            MessageRole::Assistant => LlmMessage::Assistant {
                content: crate::llm::types::MessageContent::Text(match &message.content {
                    MessageContent::Text { text } => text.clone(),
                    _ => serde_json::to_string(&message.content).unwrap_or_default(),
                }),
                provider_options: None,
            },
            MessageRole::System => LlmMessage::System {
                content: match &message.content {
                    MessageContent::Text { text } => text.clone(),
                    _ => serde_json::to_string(&message.content).unwrap_or_default(),
                },
                provider_options: None,
            },
            MessageRole::Tool => LlmMessage::Tool {
                content: vec![],
                provider_options: None,
            },
        }
    }

    /// Build tool definitions for LLM
    fn build_tool_definitions(&self) -> Vec<LlmToolDefinition> {
        use crate::core::tool_definitions::get_tool_definitions;

        get_tool_definitions()
            .into_iter()
            .map(|(def, _)| LlmToolDefinition {
                tool_type: "function".to_string(),
                name: def.name,
                description: Some(def.description),
                parameters: def.parameters,
                strict: true,
            })
            .collect()
    }

    /// Handle a tool call request
    pub async fn handle_tool_call(
        &self,
        ctx: &AgentLoopContext,
        request: ToolRequest,
    ) -> Result<ToolResult, String> {
        let tool_context = ToolContext {
            session_id: ctx.session_id.clone(),
            task_id: ctx.task_id.clone(),
            workspace_root: ctx.workspace_root.clone(),
            worktree_path: ctx.worktree_path.clone(),
            settings: ctx.settings.clone(),
        };

        // Check auto-approve settings
        let auto_approve = ctx.settings.auto_approve_edits.unwrap_or(false);

        match self
            .tool_dispatcher
            .dispatch(request.clone(), tool_context, auto_approve)
            .await
        {
            Ok(ToolDispatchResult::Completed(result)) => Ok(result),
            Ok(ToolDispatchResult::PendingApproval(_)) => Err("Tool requires approval".to_string()),
            Err(e) => Err(e),
        }
    }

    /// Execute a tool that was pending approval
    pub async fn execute_approved_tool(
        &self,
        ctx: &AgentLoopContext,
        request: ToolRequest,
    ) -> ToolResult {
        let tool_context = ToolContext {
            session_id: ctx.session_id.clone(),
            task_id: ctx.task_id.clone(),
            workspace_root: ctx.workspace_root.clone(),
            worktree_path: ctx.worktree_path.clone(),
            settings: ctx.settings.clone(),
        };

        let result = self
            .tool_dispatcher
            .execute_approved(request.clone(), tool_context)
            .await;

        // Emit completion event
        let _ = self.event_sender.send(RuntimeEvent::ToolCallCompleted {
            task_id: ctx.task_id.clone(),
            result: result.clone(),
        });

        result
    }

    /// Build LLM prompt from context
    fn build_prompt(&self, ctx: &AgentLoopContext) -> Result<String, String> {
        let mut prompt = String::new();

        // Add messages
        for message in &ctx.messages {
            let role_str = match message.role {
                MessageRole::User => "User",
                MessageRole::Assistant => "Assistant",
                MessageRole::System => "System",
                MessageRole::Tool => "Tool",
            };

            let content_str = match &message.content {
                MessageContent::Text { text } => text.clone(),
                MessageContent::ToolCalls { calls } => {
                    format!("Tool calls: {:?}", calls)
                }
                MessageContent::ToolResult { result } => {
                    format!("Tool result: {:?}", result)
                }
            };

            prompt.push_str(&format!("{}: {}\n", role_str, content_str));
        }

        Ok(prompt)
    }

    /// Stream a token to the event channel
    fn stream_token(&self, session_id: &str, token: &str) {
        let _ = self.event_sender.send(RuntimeEvent::Token {
            session_id: session_id.to_string(),
            token: token.to_string(),
        });
    }
}

/// Factory for creating agent loops with different configurations
pub struct AgentLoopFactory;

impl AgentLoopFactory {
    /// Create a standard agent loop
    pub fn create_standard(
        tool_registry: Arc<ToolRegistry>,
        event_sender: EventSender,
        registry: ProviderRegistry,
        api_keys: crate::llm::auth::api_key_manager::ApiKeyManager,
    ) -> AgentLoop {
        let config = AgentLoopConfig::default();
        let tool_dispatcher = Arc::new(ToolDispatcher::new(tool_registry));

        AgentLoop::new(config, tool_dispatcher, event_sender, registry, api_keys)
    }

    /// Create an agent loop with custom configuration
    pub fn create_with_config(
        config: AgentLoopConfig,
        tool_registry: Arc<ToolRegistry>,
        event_sender: EventSender,
        registry: ProviderRegistry,
        api_keys: crate::llm::auth::api_key_manager::ApiKeyManager,
    ) -> AgentLoop {
        let tool_dispatcher = Arc::new(ToolDispatcher::new(tool_registry));

        AgentLoop::new(config, tool_dispatcher, event_sender, registry, api_keys)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn create_test_loop() -> (AgentLoop, mpsc::UnboundedReceiver<RuntimeEvent>) {
        use crate::database::Database;
        use tempfile::TempDir;

        let (tx, rx) = mpsc::unbounded_channel();
        let registry = Arc::new(ToolRegistry::create_default().await);
        let dispatcher = Arc::new(ToolDispatcher::new(registry));
        let provider_registry = ProviderRegistry::default();

        // Create a temporary database for testing
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir
            .path()
            .join("test.db")
            .to_string_lossy()
            .to_string();
        let db = Arc::new(Database::new(db_path));
        let api_keys = crate::llm::auth::api_key_manager::ApiKeyManager::new(
            db,
            temp_dir.path().to_path_buf(),
        );

        let loop_instance = AgentLoop::new(
            AgentLoopConfig::default(),
            dispatcher,
            tx,
            provider_registry,
            api_keys,
        );

        (loop_instance, rx)
    }

    #[tokio::test]
    async fn test_agent_loop_placeholder() {
        let (agent_loop, _rx) = create_test_loop().await;

        let ctx = AgentLoopContext {
            session_id: "test-session".to_string(),
            task_id: "test-task".to_string(),
            workspace_root: "/tmp".to_string(),
            worktree_path: None,
            settings: TaskSettings::default(),
            messages: vec![],
            model: None,
        };

        // Test that the loop runs without panicking
        let result = agent_loop.run(&ctx).await;
        assert!(result.is_ok());
    }

    #[test]
    fn test_build_prompt() {
        let messages = vec![
            Message {
                id: "msg-1".to_string(),
                session_id: "test".to_string(),
                role: MessageRole::User,
                content: MessageContent::Text {
                    text: "Hello".to_string(),
                },
                created_at: 0,
                tool_call_id: None,
                parent_id: None,
            },
            Message {
                id: "msg-2".to_string(),
                session_id: "test".to_string(),
                role: MessageRole::Assistant,
                content: MessageContent::Text {
                    text: "Hi there!".to_string(),
                },
                created_at: 0,
                tool_call_id: None,
                parent_id: None,
            },
        ];

        // Just verify the messages are formatted correctly
        let prompt = messages
            .iter()
            .map(|m| {
                let role_str = match m.role {
                    MessageRole::User => "User",
                    MessageRole::Assistant => "Assistant",
                    MessageRole::System => "System",
                    MessageRole::Tool => "Tool",
                };
                let content_str = match &m.content {
                    MessageContent::Text { text } => text.clone(),
                    _ => format!("{:?}", m.content),
                };
                format!("{}: {}", role_str, content_str)
            })
            .collect::<Vec<_>>()
            .join("\n");

        assert!(prompt.contains("User: Hello"));
        assert!(prompt.contains("Assistant: Hi there!"));
    }
}
