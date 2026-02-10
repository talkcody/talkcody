//! Tool name normalization utilities
//!
//! Normalizes tool identifiers to the canonical camelCase names used by the TS runtime.
//! Accepts legacy snake_case and dash-case aliases for backward compatibility.

use std::collections::HashMap;

/// Canonical tool names used by the TS runtime.
pub const CANONICAL_TOOL_NAMES: &[&str] = &[
    "readFile",
    "writeFile",
    "editFile",
    "glob",
    "codeSearch",
    "listFiles",
    "lsp",
    "bash",
    "webFetch",
    "webSearch",
    "callAgent",
    "todoWrite",
    "askUserQuestions",
    "exitPlanMode",
    "githubPR",
];

/// Normalize a tool name to the canonical camelCase identifier.
///
/// If the name is unknown, returns the trimmed original name.
pub fn normalize_tool_name(name: &str) -> String {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let lower = trimmed.to_ascii_lowercase();
    if let Some(canonical) = legacy_aliases().get(lower.as_str()) {
        return canonical.to_string();
    }

    // If already canonical, keep as-is to preserve casing.
    if CANONICAL_TOOL_NAMES.iter().any(|tool| *tool == trimmed) {
        return trimmed.to_string();
    }

    trimmed.to_string()
}

/// Returns true if the tool name is known (canonical or legacy alias).
pub fn is_known_tool_name(name: &str) -> bool {
    let normalized = normalize_tool_name(name);
    CANONICAL_TOOL_NAMES.iter().any(|tool| *tool == normalized)
}

fn legacy_aliases() -> HashMap<&'static str, &'static str> {
    HashMap::from([
        ("read_file", "readFile"),
        ("read-file", "readFile"),
        ("write_file", "writeFile"),
        ("write-file", "writeFile"),
        ("edit_file", "editFile"),
        ("edit-file", "editFile"),
        ("search_files", "codeSearch"),
        ("code_search", "codeSearch"),
        ("code-search", "codeSearch"),
        ("list_files", "listFiles"),
        ("list-files", "listFiles"),
        ("list_directory", "listFiles"),
        ("glob_tool", "glob"),
        ("glob-tool", "glob"),
        ("execute_shell", "bash"),
        ("execute-shell", "bash"),
        ("bash_tool", "bash"),
        ("bash-tool", "bash"),
        ("web_fetch", "webFetch"),
        ("web-fetch", "webFetch"),
        ("web_search", "webSearch"),
        ("web-search", "webSearch"),
        ("call_agent", "callAgent"),
        ("call-agent", "callAgent"),
        ("todo_write", "todoWrite"),
        ("todo-write", "todoWrite"),
        ("ask_user_questions", "askUserQuestions"),
        ("ask-user-questions", "askUserQuestions"),
        ("exit_plan_mode", "exitPlanMode"),
        ("exit-plan-mode", "exitPlanMode"),
        ("github_pr", "githubPR"),
        ("github-pr", "githubPR"),
        ("lsp", "lsp"),
    ])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_aliases_to_canonical() {
        assert_eq!(normalize_tool_name("read_file"), "readFile");
        assert_eq!(normalize_tool_name("write-file"), "writeFile");
        assert_eq!(normalize_tool_name("code_search"), "codeSearch");
        assert_eq!(normalize_tool_name("list_directory"), "listFiles");
        assert_eq!(normalize_tool_name("execute_shell"), "bash");
        assert_eq!(normalize_tool_name("web_fetch"), "webFetch");
        assert_eq!(normalize_tool_name("web_search"), "webSearch");
        assert_eq!(normalize_tool_name("call_agent"), "callAgent");
    }

    #[test]
    fn preserves_canonical_names() {
        assert_eq!(normalize_tool_name("readFile"), "readFile");
        assert_eq!(normalize_tool_name("webFetch"), "webFetch");
        assert_eq!(normalize_tool_name("githubPR"), "githubPR");
    }

    #[test]
    fn unknown_tool_passes_through() {
        assert_eq!(normalize_tool_name("customTool"), "customTool");
    }

    #[test]
    fn empty_name_returns_empty() {
        assert_eq!(normalize_tool_name(""), "");
    }
}
