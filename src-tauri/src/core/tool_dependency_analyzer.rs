//! Tool Dependency Analyzer
//!
//! Analyzes tool calls and generates execution plans based on dependencies.
//! Ported from TypeScript tool-dependency-analyzer.ts

use crate::core::tool_definitions::{ToolCategory, ToolMetadata};
use crate::core::types::ToolRequest;
use serde_json::Value;
use std::collections::{HashMap, HashSet};

/// Execution stage - a logical phase in the execution plan
#[derive(Debug, Clone)]
pub struct ExecutionStage {
    /// Stage name (e.g., 'read-stage', 'write-edit-stage')
    pub name: String,
    /// Human-readable description
    pub description: String,
    /// Groups within this stage
    pub groups: Vec<ExecutionGroup>,
}

/// Execution group - a set of tools that can be executed together
#[derive(Debug, Clone)]
pub struct ExecutionGroup {
    /// Unique identifier for this group
    pub id: String,
    /// Whether tools in this group can run concurrently
    pub concurrent: bool,
    /// Optional max concurrency cap for the group
    pub max_concurrency: Option<usize>,
    /// Tool calls in this group
    pub tools: Vec<ToolRequest>,
    /// Target files for file operations (if applicable)
    pub target_files: Vec<String>,
    /// Reason for this grouping (for logging/debugging)
    pub reason: String,
}

/// Complete execution plan with multiple stages
#[derive(Debug, Clone)]
pub struct ExecutionPlan {
    /// All execution stages
    pub stages: Vec<ExecutionStage>,
    /// Summary statistics
    pub summary: ExecutionSummary,
}

/// Execution summary statistics
#[derive(Debug, Clone)]
pub struct ExecutionSummary {
    pub total_tools: usize,
    pub total_stages: usize,
    pub total_groups: usize,
    pub concurrent_groups: usize,
}

/// Tool dependency analyzer
pub struct ToolDependencyAnalyzer;

impl ToolDependencyAnalyzer {
    pub fn new() -> Self {
        Self
    }

    /// Analyze tool calls and generate an execution plan
    pub fn analyze(
        &self,
        tool_calls: Vec<ToolRequest>,
        tool_metadata: &HashMap<String, ToolMetadata>,
    ) -> ExecutionPlan {
        if tool_calls.is_empty() {
            return ExecutionPlan {
                stages: vec![],
                summary: ExecutionSummary {
                    total_tools: 0,
                    total_stages: 0,
                    total_groups: 0,
                    concurrent_groups: 0,
                },
            };
        }

        // Categorize tools
        let categorized = self.categorize_tool_calls(&tool_calls, tool_metadata);

        // Build stages based on categories
        let mut stages: Vec<ExecutionStage> = vec![];
        let mut total_tools = 0;
        let mut total_groups = 0;
        let mut concurrent_groups = 0;

        // Stage 1: Read operations (always concurrent)
        if !categorized.read.is_empty() {
            let (read_groups, read_tools, read_concurrent) =
                self.create_read_groups(&categorized.read, tool_metadata);

            total_tools += read_tools;
            total_groups += read_groups.len();
            concurrent_groups += read_concurrent;

            stages.push(ExecutionStage {
                name: "read-stage".to_string(),
                description: "Read file contents and gather context".to_string(),
                groups: read_groups,
            });
        }

        // Stage 2: Write/Edit operations (group by target file)
        let write_edit_tools: Vec<ToolRequest> = categorized
            .write
            .into_iter()
            .chain(categorized.edit.into_iter())
            .collect();

        if !write_edit_tools.is_empty() {
            let (write_groups, write_tools, write_concurrent) =
                self.create_write_edit_groups(&write_edit_tools, tool_metadata);

            total_tools += write_tools;
            total_groups += write_groups.len();
            // Write groups are sequential by default for safety

            stages.push(ExecutionStage {
                name: "write-edit-stage".to_string(),
                description: "Write and edit files (sequential for safety)".to_string(),
                groups: write_groups,
            });
        }

        // Stage 3: Other operations (bash, etc.)
        if !categorized.other.is_empty() {
            let (other_groups, other_tools, other_concurrent) =
                self.create_other_groups(&categorized.other, tool_metadata);

            total_tools += other_tools;
            total_groups += other_groups.len();
            concurrent_groups += other_concurrent;

            stages.push(ExecutionStage {
                name: "other-stage".to_string(),
                description: "Execute other operations".to_string(),
                groups: other_groups,
            });
        }

        ExecutionPlan {
            stages,
            summary: ExecutionSummary {
                total_tools,
                total_stages: total_groups, // Simplified
                total_groups,
                concurrent_groups,
            },
        }
    }

    /// Categorize tool calls by their category
    fn categorize_tool_calls(
        &self,
        tool_calls: &[ToolRequest],
        tool_metadata: &HashMap<String, ToolMetadata>,
    ) -> CategorizedTools {
        let mut read = vec![];
        let mut write = vec![];
        let mut edit = vec![];
        let mut other = vec![];

        for tool_call in tool_calls {
            let metadata = tool_metadata.get(&tool_call.name);
            let category = metadata.map(|m| &m.category);

            match category {
                Some(ToolCategory::Read) => read.push(tool_call.clone()),
                Some(ToolCategory::Write) => write.push(tool_call.clone()),
                Some(ToolCategory::Edit) => edit.push(tool_call.clone()),
                _ => other.push(tool_call.clone()),
            }
        }

        CategorizedTools {
            read,
            write,
            edit,
            other,
        }
    }

    /// Create read groups (all concurrent)
    fn create_read_groups(
        &self,
        tools: &[ToolRequest],
        _tool_metadata: &HashMap<String, ToolMetadata>,
    ) -> (Vec<ExecutionGroup>, usize, usize) {
        // All read operations can run concurrently
        let group = ExecutionGroup {
            id: "read-group-1".to_string(),
            concurrent: true,
            max_concurrency: None,
            tools: tools.to_vec(),
            target_files: self.extract_target_files(tools),
            reason: "Read operations are safe to run concurrently".to_string(),
        };

        (vec![group], tools.len(), 1)
    }

    /// Create write/edit groups (sequential by target file for safety)
    fn create_write_edit_groups(
        &self,
        tools: &[ToolRequest],
        _tool_metadata: &HashMap<String, ToolMetadata>,
    ) -> (Vec<ExecutionGroup>, usize, usize) {
        // Group by target file
        let mut file_groups: HashMap<String, Vec<ToolRequest>> = HashMap::new();
        let mut no_target_tools = vec![];

        for tool in tools {
            let targets = self.extract_target_files(&[tool.clone()]);
            if targets.is_empty() {
                no_target_tools.push(tool.clone());
            } else {
                for target in targets {
                    file_groups.entry(target).or_default().push(tool.clone());
                }
            }
        }

        let mut groups = vec![];
        let mut group_id = 0;

        // Create a group for each target file (sequential execution)
        for (file, file_tools) in file_groups {
            group_id += 1;
            groups.push(ExecutionGroup {
                id: format!("write-group-{}", group_id),
                concurrent: false, // Sequential for safety
                max_concurrency: Some(1),
                target_files: vec![file],
                tools: file_tools,
                reason: "Write/edit operations on same file must run sequentially".to_string(),
            });
        }

        // Add tools without targets to a separate group
        if !no_target_tools.is_empty() {
            group_id += 1;
            groups.push(ExecutionGroup {
                id: format!("write-group-{}", group_id),
                concurrent: false,
                max_concurrency: Some(1),
                target_files: vec![],
                tools: no_target_tools,
                reason: "Write/edit operations without declared targets".to_string(),
            });
        }

        (groups, tools.len(), 0)
    }

    /// Create other groups (bash, etc.)
    fn create_other_groups(
        &self,
        tools: &[ToolRequest],
        _tool_metadata: &HashMap<String, ToolMetadata>,
    ) -> (Vec<ExecutionGroup>, usize, usize) {
        // By default, other operations run sequentially for safety
        let group = ExecutionGroup {
            id: "other-group-1".to_string(),
            concurrent: false,
            max_concurrency: Some(1),
            tools: tools.to_vec(),
            target_files: vec![],
            reason: "Other operations run sequentially for safety".to_string(),
        };

        (vec![group], tools.len(), 0)
    }

    /// Extract target file paths from tool input
    fn extract_target_files(&self, tools: &[ToolRequest]) -> Vec<String> {
        let mut targets = vec![];

        for tool in tools {
            // Try common file path fields
            if let Some(path) = tool.input.get("path").and_then(|v| v.as_str()) {
                targets.push(path.to_string());
            } else if let Some(file_path) = tool.input.get("file_path").and_then(|v| v.as_str()) {
                targets.push(file_path.to_string());
            } else if let Some(filePath) = tool.input.get("filePath").and_then(|v| v.as_str()) {
                targets.push(filePath.to_string());
            }
        }

        targets
    }
}

/// Categorized tool calls
struct CategorizedTools {
    read: Vec<ToolRequest>,
    write: Vec<ToolRequest>,
    edit: Vec<ToolRequest>,
    other: Vec<ToolRequest>,
}

impl Default for ToolDependencyAnalyzer {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_empty_tool_calls() {
        let analyzer = ToolDependencyAnalyzer::new();
        let metadata = HashMap::new();
        let plan = analyzer.analyze(vec![], &metadata);

        assert!(plan.stages.is_empty());
        assert_eq!(plan.summary.total_tools, 0);
    }

    #[test]
    fn test_read_tools_concurrent() {
        let analyzer = ToolDependencyAnalyzer::new();
        let mut metadata = HashMap::new();
        metadata.insert(
            "readFile".to_string(),
            ToolMetadata {
                category: ToolCategory::Read,
                can_concurrent: true,
                file_operation: true,
                requires_approval: false,
                render_doing_ui: true,
            },
        );

        let tools = vec![
            ToolRequest {
                tool_call_id: "1".to_string(),
                name: "readFile".to_string(),
                input: serde_json::json!({"path": "/file1.ts"}),
                provider_metadata: None,
            },
            ToolRequest {
                tool_call_id: "2".to_string(),
                name: "readFile".to_string(),
                input: serde_json::json!({"path": "/file2.ts"}),
                provider_metadata: None,
            },
        ];

        let plan = analyzer.analyze(tools, &metadata);
        assert_eq!(plan.stages.len(), 1);
        assert_eq!(plan.stages[0].groups.len(), 1);
        assert!(plan.stages[0].groups[0].concurrent);
    }
}
