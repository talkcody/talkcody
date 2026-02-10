//! Stop Hook
//!
//! Checks if the task should stop based on criteria in the response.

use super::{CompletionHook, HookContext, HookResult};

/// Stop hook that checks for stop signals
pub struct StopHook;

impl StopHook {
    pub fn new() -> Self {
        Self
    }

    /// Check if the response indicates completion
    fn is_complete(&self, text: &str) -> bool {
        let stop_signals = [
            "<complete>",
            "</complete>",
            "Task completed",
            "Done.",
            "Finished.",
        ];

        stop_signals.iter().any(|signal| text.contains(signal))
    }
}

#[async_trait::async_trait]
impl CompletionHook for StopHook {
    fn name(&self) -> &str {
        "stop"
    }

    async fn should_run(&self, _ctx: &HookContext) -> bool {
        true // Always run
    }

    async fn execute(&self, ctx: &HookContext) -> Result<HookResult, String> {
        if self.is_complete(&ctx.full_text) {
            Ok(HookResult::Stop {
                reason: "Stop signal detected".to_string(),
            })
        } else {
            Ok(HookResult::Continue {
                message: ctx.full_text.clone(),
            })
        }
    }
}

impl Default for StopHook {
    fn default() -> Self {
        Self::new()
    }
}
