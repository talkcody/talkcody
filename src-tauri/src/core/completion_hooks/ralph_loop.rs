//! Ralph Loop Hook
//!
//! Implements the Ralph loop that can trigger additional iterations
//! for comprehensive task completion.

use super::{CompletionHook, HookContext, HookResult};

/// Ralph loop hook for task evaluation
pub struct RalphLoopHook {
    max_iterations: u32,
}

impl RalphLoopHook {
    pub fn new() -> Self {
        Self { max_iterations: 3 }
    }

    pub fn with_max_iterations(max_iterations: u32) -> Self {
        Self { max_iterations }
    }

    /// Check if task needs more work
    fn needs_more_work(&self, text: &str) -> bool {
        // Check for incomplete indicators
        let incomplete_signals = [
            "I need to",
            "Let me",
            "Next, I should",
            "I should also",
            "Additionally",
        ];

        incomplete_signals
            .iter()
            .any(|signal| text.contains(signal))
    }
}

#[async_trait::async_trait]
impl CompletionHook for RalphLoopHook {
    fn name(&self) -> &str {
        "ralph"
    }

    async fn should_run(&self, ctx: &HookContext) -> bool {
        // Check if Ralph loop is enabled in settings
        ctx.settings
            .extra
            .get("ralphLoopEnabled")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
    }

    async fn execute(&self, ctx: &HookContext) -> Result<HookResult, String> {
        if self.needs_more_work(&ctx.full_text) {
            Ok(HookResult::Iterate {
                context: "Task appears incomplete, continuing with next steps".to_string(),
            })
        } else {
            Ok(HookResult::Continue {
                message: ctx.full_text.clone(),
            })
        }
    }
}

impl Default for RalphLoopHook {
    fn default() -> Self {
        Self::new()
    }
}
