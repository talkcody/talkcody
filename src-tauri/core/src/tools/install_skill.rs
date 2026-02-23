//! Install Skill Tool
//!
//! Install a skill from a GitHub repository into ~/.talkcody/skills.
//! Matches TypeScript install-skill-tool.tsx logic.

use crate::core::tools::ToolContext;
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallSkillResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skill_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub installed_path: Option<String>,
    pub message: String,
}

/// Execute installSkill tool
///
/// In backend-only mode, this provides a simplified implementation
/// that downloads and installs skills from GitHub.
pub async fn execute(
    repository: &str,
    path: &str,
    skill_id: Option<&str>,
    _ctx: &ToolContext,
) -> InstallSkillResult {
    // Parse repository (format: "owner/repo")
    let parts: Vec<&str> = repository.split('/').collect();
    if parts.len() != 2 {
        return InstallSkillResult {
            success: false,
            skill_name: None,
            installed_path: None,
            message: format!(
                "Invalid repository format: {}. Expected format: owner/repo",
                repository
            ),
        };
    }

    let owner = parts[0];
    let repo = parts[1];

    // Derive skill_id from path if not provided
    let skill_id = skill_id.map(|s| s.to_string()).unwrap_or_else(|| {
        path.split('/')
            .filter(|s| !s.is_empty())
            .last()
            .unwrap_or("unknown")
            .to_string()
    });

    // In backend-only mode without full skill service, we cannot install skills
    // This would require:
    // 1. GitHub API access or git clone capability
    // 2. File system access to ~/.talkcody/skills
    // 3. SKILL.md parsing and validation

    InstallSkillResult {
        success: false,
        skill_name: Some(skill_id.clone()),
        installed_path: None,
        message: format!(
            "installSkill tool requires full skill service which is not available in backend-only mode. \
            Would have installed skill '{}' from {}/{} at path '{}'. \
            In a full application, this would clone the skill repository and validate the SKILL.md file.",
            skill_id,
            owner,
            repo,
            path
        ),
    }
}
