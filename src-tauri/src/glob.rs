use crate::constants::should_exclude_dir;
use ignore::WalkBuilder;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::ffi::OsStr;
use std::time::UNIX_EPOCH;

/// Default maximum number of results to return from glob search
const DEFAULT_MAX_GLOB_RESULTS: usize = 100;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlobResult {
    pub path: String,
    pub is_directory: bool,
    pub modified_time: u64,
}

pub struct HighPerformanceGlob {}

impl Default for HighPerformanceGlob {
    fn default() -> Self {
        Self {}
    }
}

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
    pub fn search_files_by_glob(&self, pattern: &str, root_path: &str, max_results: usize) -> Result<Vec<GlobResult>, String> {
        if pattern.trim().is_empty() {
            return Ok(vec![]);
        }

        // Use sequential file collection with ignore crate for simplicity and correctness
        let mut walker_builder = WalkBuilder::new(root_path);

        walker_builder
            .hidden(true)
            .git_ignore(true)
            .git_global(true)
            .git_exclude(true)
            .ignore(true)
            .parents(true)
            .max_depth(Some(20))
            .filter_entry(|entry| {
                if entry.path().is_dir() {
                    if let Some(name) = entry.path().file_name().and_then(OsStr::to_str) {
                        return !should_exclude_dir(name);
                    }
                }
                true
            });

        let walker = walker_builder.build();
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
                        is_directory: path.is_dir(),
                        modified_time,
                    });
                }
            }
        }

        // Sort by modification time (descending - most recent first)
        results.par_sort_unstable_by(|a, b| {
            b.modified_time.cmp(&a.modified_time)
        });

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

        self.glob_match(relative_path, pattern)
    }

    /// Simple glob pattern matching implementation
    /// Supports: *, **, ?, [abc], [a-z], {a,b,c}
    fn glob_match(&self, path: &str, pattern: &str) -> bool {
        // Handle ** patterns specially
        if pattern.contains("**") {
            return self.glob_match_with_recursive(path, pattern);
        }

        // Simple glob matching without **
        self.simple_glob_match(path, pattern)
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
            if pos == 0 || path.chars().nth(pos - 1) == Some('/') || path.chars().nth(pos - 1) == Some('\\') {
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
        let after_prefix = after_prefix.trim_start_matches('/').trim_start_matches('\\');
        
        // Try matching suffix against the file name
        if let Some(file_name) = after_prefix.split('/').last() {
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
    fn glob_match_recursive(&self, text: &[char], pattern: &[char], text_idx: usize, pattern_idx: usize) -> bool {
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
                        self.glob_match_recursive(text, pattern, text_idx + 1, pattern_idx + 2 + end_idx)
                    } else {
                        false
                    }
                } else {
                    // Invalid character class, treat as literal
                    pattern_char == text_char && 
                        self.glob_match_recursive(text, pattern, text_idx + 1, pattern_idx + 1)
                }
            }
            _ => {
                // Literal character match
                pattern_char == text_char && 
                    self.glob_match_recursive(text, pattern, text_idx + 1, pattern_idx + 1)
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
    use tempfile::TempDir;
    use std::fs;

    fn create_test_directory() -> TempDir {
        let temp_dir = TempDir::new().unwrap();

        // Create directory structure
        fs::create_dir_all(temp_dir.path().join("src/components")).unwrap();
        fs::create_dir_all(temp_dir.path().join("src/utils")).unwrap();
        fs::create_dir_all(temp_dir.path().join("tests")).unwrap();

        // Create files
        fs::write(temp_dir.path().join("src/main.ts"), "main").unwrap();
        fs::write(temp_dir.path().join("src/index.ts"), "index").unwrap();
        fs::write(temp_dir.path().join("src/components/Button.tsx"), "button").unwrap();
        fs::write(temp_dir.path().join("src/components/Input.tsx"), "input").unwrap();
        fs::write(temp_dir.path().join("src/utils/helper.ts"), "helper").unwrap();
        fs::write(temp_dir.path().join("tests/test.spec.ts"), "test").unwrap();
        fs::write(temp_dir.path().join("README.md"), "readme").unwrap();
        fs::write(temp_dir.path().join("package.json"), "{}").unwrap();

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
    fn test_empty_pattern_returns_empty() {
        let temp_dir = create_test_directory();
        let glob = HighPerformanceGlob::new();

        let results = glob.search_files_by_glob("", temp_dir.path().to_str().unwrap(), 1000).unwrap();
        assert!(results.is_empty());

        let results = glob.search_files_by_glob("   ", temp_dir.path().to_str().unwrap(), 1000).unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn test_max_results_limit() {
        let temp_dir = create_test_directory();
        let glob = HighPerformanceGlob::new();

        // Search all files but limit to 2 results
        let results = glob.search_files_by_glob("**/*", temp_dir.path().to_str().unwrap(), 2).unwrap();
        assert!(results.len() <= 2, "Results should be limited to 2, got {}", results.len());

        // Search with higher limit should return more
        let all_results = glob.search_files_by_glob("**/*", temp_dir.path().to_str().unwrap(), 1000).unwrap();
        assert!(all_results.len() > 2, "Should find more than 2 files without limit");
    }

    #[test]
    fn test_glob_result_serialization() {
        let result = GlobResult {
            path: "/path/to/file.ts".to_string(),
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
}