//! Exit Plan Mode Tool
//!
//! Present an implementation plan to the user for review and approval.
//! Matches TypeScript exit-plan-mode-tool.tsx logic.

use crate::core::tools::ToolContext;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExitPlanModeResult {
    pub action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub edited_plan: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub feedback: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan_file_path: Option<String>,
}

/// Execute exitPlanMode tool
///
/// In backend-only mode, this tool checks the auto_approve_plan setting.
/// If auto-approve is enabled, it auto-approves the plan.
/// Otherwise, it returns an error indicating that user interaction is required.
pub async fn execute(plan: &str, ctx: &ToolContext) -> Result<ExitPlanModeResult, String> {
    // Check if auto-approve is enabled
    let auto_approve = ctx.settings.auto_approve_plan.unwrap_or(false);

    if auto_approve {
        // Auto-approve the plan
        // In a full implementation, we'd save the plan to a file
        Ok(ExitPlanModeResult {
            action: "approve this plan, please implement it".to_string(),
            edited_plan: None,
            feedback: None,
            plan_file_path: None, // Would be set if we saved to file
        })
    } else {
        // Cannot proceed without user interaction
        Err(
            "exitPlanMode tool requires user approval which is not available in backend-only mode. \
            To enable auto-approval of plans, set auto_approve_plan to true in task settings. \
            In a full application, this would pause execution and wait for user review.".to_string()
        )
    }
}
