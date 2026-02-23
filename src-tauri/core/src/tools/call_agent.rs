//! Call Agent Tool
//!
//! Call a registered sub-agent for a focused task.
//! Matches TypeScript call-agent-tool.tsx logic.

use crate::core::tools::ToolContext;
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CallAgentResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Execute callAgent tool
///
/// In backend-only mode without full agent registry access,
/// this returns an informative error about the limitation.
pub async fn execute(
    agent_id: &str,
    task: &str,
    _context: Option<&str>,
    _targets: Option<Vec<String>>,
    _ctx: &ToolContext,
) -> CallAgentResult {
    // In backend mode without full agent registry, we cannot call other agents
    // This would require access to the AgentRegistry and the ability to spawn nested agent loops

    CallAgentResult {
        success: false,
        message: None,
        error: Some(format!(
            "callAgent tool is not fully supported in backend-only mode. \
            Would have called agent '{}' with task: {}. \
            In a full application, this would spawn a nested agent execution. \
            Consider implementing the task directly or using direct tool calls instead.",
            agent_id,
            if task.len() > 50 { &task[..50] } else { task }
        )),
    }
}
