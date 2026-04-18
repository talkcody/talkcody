use crate::walker::{validate_path_in_workspace, WalkerConfig, WorkspaceWalker};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::time::UNIX_EPOCH;

/// Default maximum number of results to return from glob search
const DEFAULT_MAX_GLOB_RESULTS: usize = 100;
/// Prevent combinatorial blow-ups when expanding brace patterns.
const MAX_BRACE_EXPANSIONS: usize = 256;
type BraceGroup<'a> = (usize, usize, Vec<&'a str>);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlobResult {
    pub path: String,
    /// Canonical (resolved) path - resolves symlinks to their real location
    /// Used for security validation to prevent symlink attacks
    pub canonical_path: String,
    pub is_directory: bool,
    pub modified_time: u64,
}

#[derive(Default)]
pub struct HighPerformanceGlob {}

impl HighPerformanceGlob {
    pub fn new() -> Self {
        Self::default()
    }

    /// High-performance glob pattern matching with results sorted by modification time
    ///
    /// # Arguments
    /// * `pattern` - Glob pattern to match files against
    /// * `root_path` - Root directory to search from
    /// * `max_results` - Maximum number of results to return (to prevent excessive output)
    pub fn search_files_by_glob(
        &self,
        pattern: &str,
        root_path: &str,
        max_results: usize,
    ) -> Result<Vec<GlobResult>, String> {
        if pattern.trim().is_empty() {
            return Ok(vec![]);
        }

        // Use unified walker module with glob-optimized configuration
        let config = WalkerConfig::for_glob(root_path);
        let workspace_walker = WorkspaceWalker::new(root_path, config);
        let workspace_root = workspace_walker.workspace_root().cloned();
        let walker = workspace_walker.build();
        let mut results = Vec::new();

        for result in walker {
            // Early termination if we have enough results
            if results.len() >= max_results {
                break;
            }

            if let Ok(entry) = result {
                // Skip root directory
                if entry.depth() == 0 {
                    continue;
                }

                let path = entry.path();
                let path_str = path.to_string_lossy().to_string();

                // Use glob pattern matching
                if self.matches_glob_pattern(&path_str, pattern, root_path) {
                    // Get canonical path (resolves symlinks) for security validation
                    // If canonicalize fails (e.g., broken symlink), use the original path
                    let canonical_path = path
                        .canonicalize()
                        .map(|p| p.to_string_lossy().to_string())
                        .unwrap_or_else(|_| path_str.clone());

                    // Validate path stays within workspace (security check)
                    if let Some(ref ws_root) = workspace_root {
                        if !validate_path_in_workspace(path, ws_root) {
                            continue;
                        }
                    }

                    // Get modification time
                    let modified_time = if let Ok(metadata) = path.metadata() {
                        if let Ok(modified) = metadata.modified() {
                            if let Ok(duration) = modified.duration_since(UNIX_EPOCH) {
                                duration.as_secs()
                            } else {
                                0
                            }
                        } else {
                            0
                        }
                    } else {
                        0
                    };

                    results.push(GlobResult {
                        path: path_str,
                        canonical_path,
                        is_directory: path.is_dir(),
                        modified_time,
                    });
                }
            }
        }

        // Sort by modification time (descending - most recent first)
        results.par_sort_unstable_by(|a, b| b.modified_time.cmp(&a.modified_time));

        // Ensure we don't exceed limit after sorting
        results.truncate(max_results);

        Ok(results)
    }

    /// Match glob pattern against file path
    fn matches_glob_pattern(&self, file_path: &str, pattern: &str, root_path: &str) -> bool {
        // Convert absolute path to relative path for matching
        let relative_path = if file_path.starts_with(root_path) {
            let root_len = root_path.len();
            let mut rel_path = &file_path[root_len..];
            // Remove leading slash if present
            if rel_path.starts_with('/') || rel_path.starts_with('\\') {
                rel_path = &rel_path[1..];
            }
            rel_path
        } else {
            file_path
        };

        // Normalize path separators for cross-platform compatibility
        // Windows uses \ while patterns typically use /
        let normalized_path = relative_path.replace('\\', "/");
        let normalized_pattern = pattern.replace('\\', "/");

        self.glob_match(&normalized_path, &normalized_pattern)
    }

    /// Simple glob pattern matching implementation
    /// Supports: *, **, ?, [abc], [a-z], and brace expansion like {a,b,c}
    fn glob_match(&self, path: &str, pattern: &str) -> bool {
        if let Some(expanded_patterns) = self.expand_brace_patterns(pattern) {
            return expanded_patterns
                .iter()
                .any(|expanded_pattern| self.glob_match_without_braces(path, expanded_pattern));
        }

        // Malformed brace patterns fall back to literal matching behavior.
        self.glob_match_without_braces(path, pattern)
    }

    fn glob_match_without_braces(&self, path: &str, pattern: &str) -> bool {
        // Handle ** patterns specially
        if pattern.contains("**") {
            return self.glob_match_with_recursive(path, pattern);
        }

        // Simple glob matching without **
        self.simple_glob_match(path, pattern)
    }

    fn expand_brace_patterns(&self, pattern: &str) -> Option<Vec<String>> {
        let mut expanded_patterns = Vec::new();

        self.expand_brace_patterns_recursive(pattern, &mut expanded_patterns)
            .then_some(expanded_patterns)
    }

    fn expand_brace_patterns_recursive(
        &self,
        pattern: &str,
        expanded_patterns: &mut Vec<String>,
    ) -> bool {
        match self.find_brace_group(pattern) {
            Ok(Some((start, end, options))) => {
                for option in options {
                    if expanded_patterns.len() >= MAX_BRACE_EXPANSIONS {
                        return false;
                    }

                    let expanded_pattern =
                        format!("{}{}{}", &pattern[..start], option, &pattern[end + 1..]);

                    if !self.expand_brace_patterns_recursive(&expanded_pattern, expanded_patterns) {
                        return false;
                    }
                }

                true
            }
            Ok(None) => {
                expanded_patterns.push(pattern.to_string());
                expanded_patterns.len() <= MAX_BRACE_EXPANSIONS
            }
            Err(()) => false,
        }
    }

    fn find_brace_group<'a>(&self, pattern: &'a str) -> Result<Option<BraceGroup<'a>>, ()> {
        let mut in_character_class = false;
        let mut brace_start = None;
        let mut nested_brace_depth = 0;
        let mut option_start = 0;
        let mut options = Vec::new();

        for (idx, ch) in pattern.char_indices() {
            match ch {
                '[' if brace_start.is_none() => in_character_class = true,
                ']' if brace_start.is_none() => in_character_class = false,
                '{' if !in_character_class => {
                    if brace_start.is_none() {
                        brace_start = Some(idx);
                        option_start = idx + ch.len_utf8();
                        options.clear();
                    } else {
                        nested_brace_depth += 1;
                    }
                }
                ',' if brace_start.is_some() && nested_brace_depth == 0 => {
                    options.push(&pattern[option_start..idx]);
                    option_start = idx + ch.len_utf8();
                }
                '}' if brace_start.is_some() => {
                    if nested_brace_depth == 0 {
                        options.push(&pattern[option_start..idx]);

                        return if options.len() > 1 {
                            Ok(Some((brace_start.unwrap_or(0), idx, options)))
                        } else {
                            Ok(None)
                        };
                    }

                    nested_brace_depth -= 1;
                }
                _ => {}
            }
        }

        if brace_start.is_some() {
            Err(())
        } else {
            Ok(None)
        }
    }

    /// Handle ** recursive patterns
    fn glob_match_with_recursive(&self, path: &str, pattern: &str) -> bool {
        let parts: Vec<&str> = pattern.split("**").collect();

        if parts.len() == 1 {
            return self.simple_glob_match(path, pattern);
        }

        // Handle patterns like "src/**/*.ts"
        let prefix = parts[0];
        let suffix = parts.get(1).map_or("", |v| *v);

        // Remove trailing slash from prefix
        let prefix = prefix.trim_end_matches('/').trim_end_matches('\\');
        // Remove leading slash from suffix
        let suffix = suffix.trim_start_matches('/').trim_start_matches('\\');

        // Check if path starts with prefix (if any)
        let after_prefix = if prefix.is_empty() {
            path
        } else if let Some(pos) = path.find(prefix) {
            if pos == 0
                || path.chars().nth(pos - 1) == Some('/')
                || path.chars().nth(pos - 1) == Some('\\')
            {
                &path[pos + prefix.len()..]
            } else {
                return false;
            }
        } else {
            return false;
        };

        // If no suffix, any file under prefix matches
        if suffix.is_empty() {
            return true;
        }

        // Check if any part of the remaining path matches the suffix
        let after_prefix = after_prefix
            .trim_start_matches('/')
            .trim_start_matches('\\');

        // Try matching suffix against the file name
        if let Some(file_name) = after_prefix.split('/').next_back() {
            if self.simple_glob_match(file_name, suffix) {
                return true;
            }
        }

        // Try matching suffix against the full remaining path
        self.simple_glob_match(after_prefix, suffix)
    }

    /// Simple glob matching without **
    fn simple_glob_match(&self, text: &str, pattern: &str) -> bool {
        let text_chars: Vec<char> = text.chars().collect();
        let pattern_chars: Vec<char> = pattern.chars().collect();

        self.glob_match_recursive(&text_chars, &pattern_chars, 0, 0)
    }

    /// Recursive glob matching implementation
    fn glob_match_recursive(
        &self,
        text: &[char],
        pattern: &[char],
        text_idx: usize,
        pattern_idx: usize,
    ) -> bool {
        // End of pattern
        if pattern_idx >= pattern.len() {
            return text_idx >= text.len();
        }

        // End of text but pattern remains
        if text_idx >= text.len() {
            // Check if remaining pattern is all '*'
            return pattern[pattern_idx..].iter().all(|&c| c == '*');
        }

        let pattern_char = pattern[pattern_idx];
        let text_char = text[text_idx];

        match pattern_char {
            '*' => {
                // Try matching zero characters
                if self.glob_match_recursive(text, pattern, text_idx, pattern_idx + 1) {
                    return true;
                }
                // Try matching one or more characters
                self.glob_match_recursive(text, pattern, text_idx + 1, pattern_idx)
            }
            '?' => {
                // Match any single character
                self.glob_match_recursive(text, pattern, text_idx + 1, pattern_idx + 1)
            }
            '[' => {
                // Character class matching [abc] or [a-z]
                if let Some(end_idx) = pattern[pattern_idx + 1..].iter().position(|&c| c == ']') {
                    let class_content = &pattern[pattern_idx + 1..pattern_idx + 1 + end_idx];
                    let matches = self.matches_char_class(text_char, class_content);
                    if matches {
                        self.glob_match_recursive(
                            text,
                            pattern,
                            text_idx + 1,
                            pattern_idx + 2 + end_idx,
                        )
                    } else {
                        false
                    }
                } else {
                    // Invalid character class, treat as literal
                    pattern_char == text_char
                        && self.glob_match_recursive(text, pattern, text_idx + 1, pattern_idx + 1)
                }
            }
            _ => {
                // Literal character match
                pattern_char == text_char
                    && self.glob_match_recursive(text, pattern, text_idx + 1, pattern_idx + 1)
            }
        }
    }

    /// Match character against character class like [abc] or [a-z]
    fn matches_char_class(&self, ch: char, class_content: &[char]) -> bool {
        let mut i = 0;
        while i < class_content.len() {
            if i + 2 < class_content.len() && class_content[i + 1] == '-' {
                // Range like a-z
                let start = class_content[i];
                let end = class_content[i + 2];
                if ch >= start && ch <= end {
                    return true;
                }
                i += 3;
            } else {
                // Single character
                if ch == class_content[i] {
                    return true;
                }
                i += 1;
            }
        }
        false
    }
}

#[tauri::command]
pub fn search_files_by_glob(
    pattern: String,
    path: Option<String>,
    max_results: Option<usize>,
) -> Result<Vec<GlobResult>, String> {
    let root_path = path.unwrap_or_else(|| ".".to_string());
    let limit = max_results.unwrap_or(DEFAULT_MAX_GLOB_RESULTS);

    let glob = HighPerformanceGlob::new();
    glob.search_files_by_glob(&pattern, &root_path, limit)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn create_test_directory() -> TempDir {
        let temp_dir = TempDir::new().unwrap();

        // Create directory structure
        fs::create_dir_all(temp_dir.path().join("src/components")).unwrap();
        fs::create_dir_all(temp_dir.path().join("src/config")).unwrap();
        fs::create_dir_all(temp_dir.path().join("src/utils")).unwrap();
        fs::create_dir_all(temp_dir.path().join("tests")).unwrap();
        fs::create_dir_all(temp_dir.path().join("db")).unwrap();
        fs::create_dir_all(temp_dir.path().join("assets")).unwrap();

        // Create files
        fs::write(temp_dir.path().join("src/main.ts"), "main").unwrap();
        fs::write(temp_dir.path().join("src/index.ts"), "index").unwrap();
        fs::write(temp_dir.path().join("src/components/Button.tsx"), "button").unwrap();
        fs::write(temp_dir.path().join("src/components/Input.tsx"), "input").unwrap();
        fs::write(temp_dir.path().join("src/config/app.js"), "app").unwrap();
        fs::write(temp_dir.path().join("src/utils/helper.ts"), "helper").unwrap();
        fs::write(temp_dir.path().join("tests/test.spec.ts"), "test").unwrap();
        fs::write(temp_dir.path().join("db/schema.sql"), "select 1;").unwrap();
        fs::write(temp_dir.path().join("README.md"), "readme").unwrap();
        fs::write(temp_dir.path().join("package.json"), "{}").unwrap();
        fs::write(temp_dir.path().join(".env"), "ENV=test").unwrap();
        fs::write(temp_dir.path().join("assets/logo.png"), "png").unwrap();

        temp_dir
    }

    #[test]
    fn test_simple_star_pattern() {
        let glob = HighPerformanceGlob::new();

        // Test *.ts pattern matching
        assert!(glob.simple_glob_match("main.ts", "*.ts"));
        assert!(glob.simple_glob_match("index.ts", "*.ts"));
        assert!(!glob.simple_glob_match("main.tsx", "*.ts"));
        assert!(!glob.simple_glob_match("main.js", "*.ts"));
    }

    #[test]
    fn test_question_mark_pattern() {
        let glob = HighPerformanceGlob::new();

        // Test ? pattern matching single character
        assert!(glob.simple_glob_match("file1.ts", "file?.ts"));
        assert!(glob.simple_glob_match("filea.ts", "file?.ts"));
        assert!(!glob.simple_glob_match("file12.ts", "file?.ts"));
        assert!(!glob.simple_glob_match("file.ts", "file?.ts"));
    }

    #[test]
    fn test_character_class() {
        let glob = HighPerformanceGlob::new();

        // Test [abc] pattern
        assert!(glob.simple_glob_match("filea.ts", "file[abc].ts"));
        assert!(glob.simple_glob_match("fileb.ts", "file[abc].ts"));
        assert!(glob.simple_glob_match("filec.ts", "file[abc].ts"));
        assert!(!glob.simple_glob_match("filed.ts", "file[abc].ts"));
    }

    #[test]
    fn test_character_range() {
        let glob = HighPerformanceGlob::new();

        // Test [a-z] pattern
        assert!(glob.simple_glob_match("filea.ts", "file[a-z].ts"));
        assert!(glob.simple_glob_match("filez.ts", "file[a-z].ts"));
        assert!(!glob.simple_glob_match("file1.ts", "file[a-z].ts"));
        assert!(!glob.simple_glob_match("fileA.ts", "file[a-z].ts"));
    }

    #[test]
    fn test_double_star_pattern() {
        let glob = HighPerformanceGlob::new();

        // Test **/*.ts pattern
        assert!(glob.glob_match("src/main.ts", "**/*.ts"));
        assert!(glob.glob_match("src/components/Button.ts", "**/*.ts"));
        assert!(glob.glob_match("deep/nested/file.ts", "**/*.ts"));
        assert!(!glob.glob_match("main.tsx", "**/*.ts"));
    }

    #[test]
    fn test_double_star_with_prefix() {
        let glob = HighPerformanceGlob::new();

        // Test src/**/*.ts pattern
        assert!(glob.glob_match("src/main.ts", "src/**/*.ts"));
        assert!(glob.glob_match("src/components/Button.ts", "src/**/*.ts"));
        assert!(!glob.glob_match("tests/test.ts", "src/**/*.ts"));
    }

    #[test]
    fn test_brace_expansion_matches_multiple_extensions() {
        let glob = HighPerformanceGlob::new();

        assert!(glob.glob_match("main.ts", "*.{ts,tsx}"));
        assert!(glob.glob_match("main.tsx", "*.{ts,tsx}"));
        assert!(!glob.glob_match("main.js", "*.{ts,tsx}"));
    }

    #[test]
    fn test_brace_expansion_with_recursive_glob() {
        let glob = HighPerformanceGlob::new();
        let pattern = "**/*.{ts,tsx,js,json,env,md,sql}";

        assert!(glob.glob_match("src/components/Button.tsx", pattern));
        assert!(glob.glob_match("src/config/app.js", pattern));
        assert!(glob.glob_match("db/schema.sql", pattern));
        assert!(glob.glob_match("README.md", pattern));
        assert!(glob.glob_match("package.json", pattern));
        assert!(glob.glob_match(".env", pattern));
        assert!(!glob.glob_match("assets/logo.png", pattern));
    }

    #[test]
    fn test_brace_expansion_with_multiple_groups() {
        let glob = HighPerformanceGlob::new();

        assert!(glob.glob_match("src/main.test.ts", "src/*.{test,spec}.{ts,tsx}"));
        assert!(glob.glob_match("src/main.spec.tsx", "src/*.{test,spec}.{ts,tsx}"));
        assert!(!glob.glob_match("src/main.unit.ts", "src/*.{test,spec}.{ts,tsx}"));
    }

    #[test]
    fn test_malformed_brace_pattern_falls_back_to_literal_matching() {
        let glob = HighPerformanceGlob::new();

        assert!(glob.glob_match("file.{ts,tsx", "file.{ts,tsx"));
        assert!(!glob.glob_match("file.ts", "file.{ts,tsx"));
    }

    #[test]
    fn test_empty_pattern_returns_empty() {
        let temp_dir = create_test_directory();
        let glob = HighPerformanceGlob::new();

        let results = glob
            .search_files_by_glob("", temp_dir.path().to_str().unwrap(), 1000)
            .unwrap();
        assert!(results.is_empty());

        let results = glob
            .search_files_by_glob("   ", temp_dir.path().to_str().unwrap(), 1000)
            .unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn test_max_results_limit() {
        let temp_dir = create_test_directory();
        let glob = HighPerformanceGlob::new();

        // Search all files but limit to 2 results
        let results = glob
            .search_files_by_glob("**/*", temp_dir.path().to_str().unwrap(), 2)
            .unwrap();
        assert!(
            results.len() <= 2,
            "Results should be limited to 2, got {}",
            results.len()
        );

        // Search with higher limit should return more
        let all_results = glob
            .search_files_by_glob("**/*", temp_dir.path().to_str().unwrap(), 1000)
            .unwrap();
        assert!(
            all_results.len() > 2,
            "Should find more than 2 files without limit"
        );
    }

    #[test]
    fn test_glob_result_serialization() {
        let result = GlobResult {
            path: "/path/to/file.ts".to_string(),
            canonical_path: "/path/to/file.ts".to_string(),
            is_directory: false,
            modified_time: 1700000000,
        };

        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"path\":\"/path/to/file.ts\""));
        assert!(json.contains("\"is_directory\":false"));
        assert!(json.contains("\"modified_time\":1700000000"));

        let parsed: GlobResult = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.path, "/path/to/file.ts");
        assert!(!parsed.is_directory);
    }

    #[test]
    fn test_glob_new() {
        let glob = HighPerformanceGlob::new();
        // Just verify it creates without panicking
        assert!(glob.simple_glob_match("test", "test"));
    }

    #[test]
    fn test_glob_default() {
        let glob = HighPerformanceGlob::default();
        assert!(glob.simple_glob_match("test", "test"));
    }

    #[test]
    fn test_literal_match() {
        let glob = HighPerformanceGlob::new();

        assert!(glob.simple_glob_match("exact_match", "exact_match"));
        assert!(!glob.simple_glob_match("exact_match", "different"));
        assert!(!glob.simple_glob_match("", "non_empty"));
    }

    #[test]
    fn test_matches_char_class_single() {
        let glob = HighPerformanceGlob::new();

        let class: Vec<char> = "abc".chars().collect();
        assert!(glob.matches_char_class('a', &class));
        assert!(glob.matches_char_class('b', &class));
        assert!(glob.matches_char_class('c', &class));
        assert!(!glob.matches_char_class('d', &class));
    }

    #[test]
    fn test_matches_char_class_range() {
        let glob = HighPerformanceGlob::new();

        let class: Vec<char> = "a-z".chars().collect();
        assert!(glob.matches_char_class('a', &class));
        assert!(glob.matches_char_class('m', &class));
        assert!(glob.matches_char_class('z', &class));
        assert!(!glob.matches_char_class('A', &class));
        assert!(!glob.matches_char_class('1', &class));
    }

    #[test]
    fn test_matches_char_class_mixed() {
        let glob = HighPerformanceGlob::new();

        let class: Vec<char> = "a-z0-9_".chars().collect();
        assert!(glob.matches_char_class('a', &class));
        assert!(glob.matches_char_class('5', &class));
        assert!(glob.matches_char_class('_', &class));
    }

    #[test]
    fn test_complex_pattern() {
        let glob = HighPerformanceGlob::new();

        // Test complex patterns
        assert!(glob.simple_glob_match("test_file_123.txt", "test_*_*.txt"));
        assert!(glob.simple_glob_match("a.b.c.txt", "*.txt"));
        assert!(glob.simple_glob_match("file", "*"));
    }

    #[test]
    fn test_multiple_stars() {
        let glob = HighPerformanceGlob::new();

        assert!(glob.simple_glob_match("a/b/c.txt", "*/*/*"));
        assert!(glob.simple_glob_match("one/two/three", "*/*/*"));
        assert!(!glob.simple_glob_match("a/b", "*/*/*"));
    }

    #[test]
    fn test_star_at_beginning() {
        let glob = HighPerformanceGlob::new();

        assert!(glob.simple_glob_match("anything.ts", "*.ts"));
        assert!(glob.simple_glob_match(".ts", "*.ts"));
        assert!(glob.simple_glob_match("ts", "*ts"));
    }

    #[test]
    fn test_star_in_middle() {
        let glob = HighPerformanceGlob::new();

        assert!(glob.simple_glob_match("test_file.ts", "test*.ts"));
        assert!(glob.simple_glob_match("test.ts", "test*.ts"));
        assert!(glob.simple_glob_match("testABC.ts", "test*.ts"));
    }

    #[test]
    fn test_hidden_directory_files() {
        // Test that files in hidden directories (like .talkcody) can be found
        let temp_dir = tempfile::TempDir::new().unwrap();

        // Create a hidden directory structure similar to .talkcody
        fs::create_dir_all(temp_dir.path().join(".talkcody/plan/subdir")).unwrap();
        fs::write(
            temp_dir.path().join(".talkcody/plan/plan_2024-01-01.md"),
            "plan content",
        )
        .unwrap();
        fs::write(
            temp_dir.path().join(".talkcody/plan/subdir/nested.md"),
            "nested content",
        )
        .unwrap();

        // Create regular files for comparison
        fs::write(temp_dir.path().join("visible.md"), "visible content").unwrap();

        let glob = HighPerformanceGlob::new();

        // Test searching for files in hidden directory
        let results = glob
            .search_files_by_glob("**/*.md", temp_dir.path().to_str().unwrap(), 1000)
            .unwrap();

        // Should find files in both hidden and visible directories
        let paths: Vec<String> = results.iter().map(|r| r.path.clone()).collect();

        assert!(!paths.is_empty(), "Should find at least some md files");

        // Check that files in .talkcody are included
        let has_hidden_file = paths.iter().any(|p| p.contains(".talkcody"));
        assert!(
            has_hidden_file,
            "Should find files in .talkcody directory. Paths: {:?}",
            paths
        );

        // Check that visible file is also found
        let has_visible_file = paths.iter().any(|p| p.contains("visible.md"));
        assert!(
            has_visible_file,
            "Should also find visible files. Paths: {:?}",
            paths
        );
    }

    #[test]
    fn test_search_specific_hidden_file() {
        // Test searching for a specific file in a hidden directory
        let temp_dir = tempfile::TempDir::new().unwrap();

        // Create .talkcody directory with a plan file
        fs::create_dir_all(temp_dir.path().join(".talkcody/plan")).unwrap();
        fs::write(
            temp_dir.path().join(".talkcody/plan/plan_2024-01-01.md"),
            "plan content",
        )
        .unwrap();

        let glob = HighPerformanceGlob::new();

        // Search for the specific plan file
        let results = glob
            .search_files_by_glob(
                ".talkcody/plan/*.md",
                temp_dir.path().to_str().unwrap(),
                1000,
            )
            .unwrap();

        assert_eq!(results.len(), 1, "Should find exactly one file");
        assert!(
            results[0].path.contains("plan_2024-01-01.md"),
            "Should find the plan file. Found: {}",
            results[0].path
        );
    }

    #[test]
    fn test_search_files_by_glob_with_brace_expansion() {
        let temp_dir = create_test_directory();
        let glob = HighPerformanceGlob::new();
        let results = glob
            .search_files_by_glob(
                "**/*.{ts,tsx,js,json,env,md,sql}",
                temp_dir.path().to_str().unwrap(),
                1000,
            )
            .unwrap();

        let paths: Vec<String> = results.iter().map(|result| result.path.clone()).collect();

        assert!(paths.iter().any(|path| path.ends_with("src/main.ts")));
        assert!(paths
            .iter()
            .any(|path| path.ends_with("src/components/Button.tsx")));
        assert!(paths.iter().any(|path| path.ends_with("src/config/app.js")));
        assert!(paths.iter().any(|path| path.ends_with("db/schema.sql")));
        assert!(paths.iter().any(|path| path.ends_with("README.md")));
        assert!(paths.iter().any(|path| path.ends_with("package.json")));
        assert!(paths.iter().any(|path| path.ends_with(".env")));
        assert!(!paths.iter().any(|path| path.ends_with("assets/logo.png")));
    }
}
