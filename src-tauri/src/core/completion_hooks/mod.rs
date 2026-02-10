//! Completion Hooks
//!
//! Hooks that run after a successful agent loop completion (no tool calls).
//! Ported from TypeScript completion-hooks.ts and ralph-loop-service.ts

use async_trait::async_trait;

pub mod auto_review;
pub mod ralph_loop;
pub mod stop_hook;

pub use auto_review::AutoReviewHook;
pub use ralph_loop::RalphLoopHook;
pub use stop_hook::StopHook;

use crate::core::types::*;
use crate::storage::models::*;

/// Hook context passed to completion hooks
#[derive(Debug, Clone)]
pub struct HookContext {
    pub task_id: RuntimeTaskId,
    pub session_id: SessionId,
    pub messages: Vec<Message>,
    pub full_text: String,
    pub settings: TaskSettings,
}

/// Result of a completion hook
#[derive(Debug, Clone)]
pub enum HookResult {
    /// Continue with the result
    Continue { message: String },
    /// Stop the loop
    Stop { reason: String },
    /// Trigger a new iteration
    Iterate { context: String },
}

/// Completion hook trait
#[async_trait::async_trait]
pub trait CompletionHook: Send + Sync {
    /// Get the hook name
    fn name(&self) -> &str;

    /// Evaluate whether this hook should run
    async fn should_run(&self, ctx: &HookContext) -> bool;

    /// Execute the hook
    async fn execute(&self, ctx: &HookContext) -> Result<HookResult, String>;
}

/// Pipeline of completion hooks
pub struct CompletionHookPipeline {
    hooks: Vec<Box<dyn CompletionHook>>,
}

impl CompletionHookPipeline {
    pub fn new() -> Self {
        Self { hooks: vec![] }
    }

    /// Add a hook to the pipeline
    pub fn add_hook(&mut self, hook: Box<dyn CompletionHook>) {
        self.hooks.push(hook);
    }

    /// Run all hooks in sequence
    pub async fn run(&self, ctx: &HookContext) -> Result<HookResult, String> {
        for hook in &self.hooks {
            if hook.should_run(ctx).await {
                match hook.execute(ctx).await {
                    Ok(HookResult::Stop { .. }) => {
                        // Stop early if a hook requests it
                        return hook.execute(ctx).await;
                    }
                    Ok(result) => {
                        // Continue with other hooks
                        if let HookResult::Continue { .. } = result {
                            continue;
                        }
                        return Ok(result);
                    }
                    Err(e) => return Err(e),
                }
            }
        }

        Ok(HookResult::Continue {
            message: ctx.full_text.clone(),
        })
    }
}

impl Default for CompletionHookPipeline {
    fn default() -> Self {
        Self::new()
    }
}
