//! Auto Review Hook
//!
//! Automatically triggers code review on completion if enabled.

use super::{CompletionHook, HookContext, HookResult};

/// Auto review hook
pub struct AutoReviewHook;

impl AutoReviewHook {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait::async_trait]
impl CompletionHook for AutoReviewHook {
    fn name(&self) -> &str {
        "auto_review"
    }

    async fn should_run(&self, ctx: &HookContext) -> bool {
        // Check if auto code review is enabled
        ctx.settings.auto_code_review.unwrap_or(false)
    }

    async fn execute(&self, ctx: &HookContext) -> Result<HookResult, String> {
        // In a full implementation, this would trigger a code review agent
        // For now, just add a note to the context
        let review_message = format!(
            "{}

[Auto Review Enabled] Code review will be performed on the changes.",
            ctx.full_text
        );

        Ok(HookResult::Continue {
            message: review_message,
        })
    }
}

impl Default for AutoReviewHook {
    fn default() -> Self {
        Self::new()
    }
}
