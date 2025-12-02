use crate::constants::{is_code_extension, is_code_filename, should_exclude_dir};
use grep::regex::{RegexMatcher, RegexMatcherBuilder};
use grep::searcher::{BinaryDetection, SearcherBuilder};
use grep::searcher::sinks::UTF8;
use ignore::WalkBuilder;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::ffi::OsStr;
use std::path::{Path};
use std::sync::{Arc, Mutex};

/// Maximum line length before truncation (in characters)
const MAX_LINE_LENGTH: usize = 200;
/// Number of characters to keep around the match when truncating
const CONTEXT_CHARS: usize = 80;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchMatch {
    pub line_number: u64,
    pub line_content: String,
    pub byte_offset: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub file_path: String,
    pub matches: Vec<SearchMatch>,
}

pub struct RipgrepSearch {
    max_results: usize,
    max_matches_per_file: usize,
    file_types: Option<HashSet<String>>,
    exclude_dirs: Option<HashSet<String>>,
}

impl Default for RipgrepSearch {
    fn default() -> Self {
        Self {
            max_results: 100,
            max_matches_per_file: 10,
            file_types: None,
            exclude_dirs: None,
        }
    }
}

impl RipgrepSearch {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_max_results(mut self, max_results: usize) -> Self {
        self.max_results = max_results;
        self
    }

    pub fn with_max_matches_per_file(mut self, max_matches_per_file: usize) -> Self {
        self.max_matches_per_file = max_matches_per_file;
        self
    }

    pub fn with_file_types(mut self, file_types: Option<Vec<String>>) -> Self {
        self.file_types = file_types.map(|types| {
            types.into_iter()
                .map(|t| t.to_lowercase())
                .collect()
        });
        self
    }

    pub fn with_exclude_dirs(mut self, exclude_dirs: Option<Vec<String>>) -> Self {
        self.exclude_dirs = exclude_dirs.map(|dirs| {
            dirs.into_iter().collect()
        });
        self
    }

    #[inline]
    fn is_valid_file(&self, path: &Path) -> bool {
        // If file_types is specified, use it for filtering
        if let Some(ref file_types) = self.file_types {
            if let Some(ext) = path.extension().and_then(OsStr::to_str) {
                return file_types.contains(&ext.to_lowercase());
            }
            // If file has no extension and file_types is specified, skip it
            return false;
        }

        // Otherwise, use the default code file detection
        self.is_code_file(path)
    }

    #[inline]
    fn is_code_file(&self, path: &Path) -> bool {
        // Fast path: check extension first
        if let Some(ext) = path.extension().and_then(OsStr::to_str) {
            return is_code_extension(ext);
        }

        // Slower path: check filename for files without extensions
        if let Some(filename) = path.file_name().and_then(OsStr::to_str) {
            return is_code_filename(filename);
        }

        false
    }

    /// Find the largest valid char boundary <= index
    #[inline]
    fn floor_char_boundary(s: &str, index: usize) -> usize {
        if index >= s.len() {
            return s.len();
        }
        let mut i = index;
        while i > 0 && !s.is_char_boundary(i) {
            i -= 1;
        }
        i
    }

    /// Find the smallest valid char boundary >= index
    #[inline]
    fn ceil_char_boundary(s: &str, index: usize) -> usize {
        if index >= s.len() {
            return s.len();
        }
        let mut i = index;
        while i < s.len() && !s.is_char_boundary(i) {
            i += 1;
        }
        i
    }

    /// Truncate a long line while preserving context around the match.
    /// If the line is shorter than MAX_LINE_LENGTH, returns it unchanged.
    /// Otherwise, finds the match position and keeps CONTEXT_CHARS characters
    /// on each side, adding "..." to indicate truncation.
    fn truncate_line_with_context(line: &str, query: &str) -> String {
        let trimmed = line.trim_end();
        if trimmed.len() <= MAX_LINE_LENGTH {
            return trimmed.to_string();
        }

        // Find match position (case insensitive)
        let lower_line = trimmed.to_lowercase();
        let lower_query = query.to_lowercase();

        if let Some(match_pos) = lower_line.find(&lower_query) {
            // Calculate range to keep, preserving context around the match
            let start = match_pos.saturating_sub(CONTEXT_CHARS);
            let end = (match_pos + query.len() + CONTEXT_CHARS).min(trimmed.len());

            // Ensure we don't cut in the middle of a UTF-8 character
            let start = Self::floor_char_boundary(trimmed, start);
            let end = Self::ceil_char_boundary(trimmed, end);

            let mut result = String::new();
            if start > 0 {
                result.push_str("...");
            }
            result.push_str(&trimmed[start..end]);
            if end < trimmed.len() {
                result.push_str("...");
            }
            result
        } else {
            // If match not found (possibly regex), truncate from the beginning
            let end = Self::floor_char_boundary(trimmed, MAX_LINE_LENGTH.min(trimmed.len()));
            format!("{}...", &trimmed[..end])
        }
    }

    pub fn search_content(&self, query: &str, root_path: &str) -> Result<Vec<SearchResult>, String> {
        if query.is_empty() {
            return Ok(vec![]);
        }

        // Create regex matcher once with proper builder pattern
        let matcher = Arc::new(
            RegexMatcherBuilder::new()
                .case_insensitive(true)
                .line_terminator(Some(b'\n'))
                .build(query)
                .map_err(|e| format!("Failed to create regex matcher: {}", e))?
        );

        // Build walker with proper gitignore support and optimizations
        let mut walker_builder = WalkBuilder::new(root_path);

        walker_builder
            .hidden(true)          // Skip hidden files by default
            .git_ignore(false)     // Don't use .gitignore files (search all files)
            .git_global(false)     // Don't use global gitignore
            .git_exclude(false)    // Don't use .git/info/exclude
            .ignore(true)          // Use .ignore files
            .parents(true)         // Search parent directories for ignore files
            .max_depth(Some(20));  // Reasonable depth limit

        // Add custom exclude directories as overrides if specified
        if let Some(ref exclude_dirs) = self.exclude_dirs {
            for dir in exclude_dirs {
                // Add each exclude directory as an override
                walker_builder.add_custom_ignore_filename(format!("!{}/", dir));
            }
        }

        let exclude_dirs_clone = self.exclude_dirs.clone();
        let walker = walker_builder
            .filter_entry(move |entry| {
                let path = entry.path();

                // Quick directory filtering
                if path.is_dir() {
                    let dir_name = path.file_name()
                        .and_then(OsStr::to_str)
                        .unwrap_or("");

                    // Check custom exclude_dirs
                    if let Some(ref exclude_dirs) = exclude_dirs_clone {
                        if exclude_dirs.contains(dir_name) {
                            return false;
                        }
                    }

                    // Check default excluded directories
                    return !should_exclude_dir(dir_name);
                }

                true
            })
            .build();

        // Collect files in parallel batches
        let files: Vec<_> = walker
            .filter_map(|entry| entry.ok())
            .filter(|entry| {
                let path = entry.path();
                path.is_file() && self.is_valid_file(path)
            })
            .collect();

        // Shared state for results
        let results = Arc::new(Mutex::new(Vec::new()));
        let total_results = Arc::new(Mutex::new(0usize));
        let max_results = self.max_results;
        let max_matches_per_file = self.max_matches_per_file;

        // Process files in parallel
        files.par_iter().for_each(|entry| {
            // Early termination check
            {
                let count = total_results.lock().unwrap();
                if *count >= max_results {
                    return;
                }
            }

            let path = entry.path();
            let matcher_clone = Arc::clone(&matcher);

            match self.search_in_file_fast(&*matcher_clone, path, max_matches_per_file, query) {
                Ok(Some(result)) => {
                    if !result.matches.is_empty() {
                        let mut results_guard = results.lock().unwrap();
                        let mut count_guard = total_results.lock().unwrap();

                        if *count_guard < max_results {
                            results_guard.push(result);
                            *count_guard += 1;
                        }
                    }
                }
                Ok(None) => {} // No matches
                Err(_) => {} // Skip errors silently for performance
            }
        });

        let final_results = results.lock().unwrap().clone();
        Ok(final_results)
    }

    fn search_in_file_fast(
        &self,
        matcher: &RegexMatcher,
        file_path: &Path,
        max_matches: usize,
        query: &str,
    ) -> Result<Option<SearchResult>, String> {
        let mut matches = Vec::with_capacity(max_matches.min(10)); // Pre-allocate reasonable capacity

        // Create searcher with optimized settings
        let mut searcher = SearcherBuilder::new()
            .binary_detection(BinaryDetection::quit(b'\x00'))
            .line_number(true)
            .build();

        let mut match_count = 0;

        let result = searcher.search_path(
            matcher,
            file_path,
            UTF8(|lnum, line| {
                if match_count >= max_matches {
                    return Ok(false); // Early termination
                }

                matches.push(SearchMatch {
                    line_number: lnum,
                    line_content: Self::truncate_line_with_context(line, query),
                    byte_offset: 0,
                });

                match_count += 1;
                Ok(true)
            }),
        );

        match result {
            Ok(_) => {
                if matches.is_empty() {
                    Ok(None)
                } else {
                    Ok(Some(SearchResult {
                        file_path: file_path.to_string_lossy().to_string(),
                        matches,
                    }))
                }
            }
            Err(_) => Ok(None), // Return None instead of error for better performance
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use std::fs;

    fn create_test_search_directory() -> TempDir {
        let temp_dir = TempDir::new().unwrap();

        // Create directory structure
        fs::create_dir_all(temp_dir.path().join("src")).unwrap();
        fs::create_dir_all(temp_dir.path().join("tests")).unwrap();

        // Create files with searchable content
        fs::write(
            temp_dir.path().join("src/main.rs"),
            "fn main() {\n    println!(\"Hello, world!\");\n}\n"
        ).unwrap();

        fs::write(
            temp_dir.path().join("src/lib.rs"),
            "pub fn greet() {\n    println!(\"Hello from lib!\");\n}\n\npub fn farewell() {\n    println!(\"Goodbye!\");\n}\n"
        ).unwrap();

        fs::write(
            temp_dir.path().join("tests/test.rs"),
            "fn test_hello() {\n    assert!(true);\n}\n"
        ).unwrap();

        fs::write(
            temp_dir.path().join("README.md"),
            "# Hello World\n\nThis is a test project.\n"
        ).unwrap();

        temp_dir
    }

    #[test]
    fn test_ripgrep_search_new() {
        let search = RipgrepSearch::new();
        assert_eq!(search.max_results, 100);
        assert_eq!(search.max_matches_per_file, 10);
        assert!(search.file_types.is_none());
        assert!(search.exclude_dirs.is_none());
    }

    #[test]
    fn test_ripgrep_search_default() {
        let search = RipgrepSearch::default();
        assert_eq!(search.max_results, 100);
        assert_eq!(search.max_matches_per_file, 10);
    }

    #[test]
    fn test_with_max_results() {
        let search = RipgrepSearch::new().with_max_results(50);
        assert_eq!(search.max_results, 50);
    }

    #[test]
    fn test_with_max_matches_per_file() {
        let search = RipgrepSearch::new().with_max_matches_per_file(5);
        assert_eq!(search.max_matches_per_file, 5);
    }

    #[test]
    fn test_with_file_types() {
        let search = RipgrepSearch::new()
            .with_file_types(Some(vec!["rs".to_string(), "js".to_string()]));

        assert!(search.file_types.is_some());
        let types = search.file_types.unwrap();
        assert!(types.contains("rs"));
        assert!(types.contains("js"));
    }

    #[test]
    fn test_with_file_types_none() {
        let search = RipgrepSearch::new().with_file_types(None);
        assert!(search.file_types.is_none());
    }

    #[test]
    fn test_with_exclude_dirs() {
        let search = RipgrepSearch::new()
            .with_exclude_dirs(Some(vec!["node_modules".to_string(), "target".to_string()]));

        assert!(search.exclude_dirs.is_some());
        let dirs = search.exclude_dirs.unwrap();
        assert!(dirs.contains("node_modules"));
        assert!(dirs.contains("target"));
    }

    #[test]
    fn test_search_empty_query() {
        let temp_dir = create_test_search_directory();
        let search = RipgrepSearch::new();

        let results = search.search_content("", temp_dir.path().to_str().unwrap()).unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn test_search_simple_pattern() {
        let temp_dir = create_test_search_directory();
        let search = RipgrepSearch::new();

        let results = search.search_content("println", temp_dir.path().to_str().unwrap()).unwrap();
        assert!(!results.is_empty(), "Should find println in files");

        // Verify we found matches in the expected files
        let file_paths: Vec<&str> = results.iter().map(|r| r.file_path.as_str()).collect();
        assert!(file_paths.iter().any(|p| p.contains("main.rs")));
        assert!(file_paths.iter().any(|p| p.contains("lib.rs")));
    }

    #[test]
    fn test_search_case_insensitive() {
        let temp_dir = create_test_search_directory();
        let search = RipgrepSearch::new();

        // Search should be case insensitive
        let results_lower = search.search_content("hello", temp_dir.path().to_str().unwrap()).unwrap();
        let results_upper = search.search_content("HELLO", temp_dir.path().to_str().unwrap()).unwrap();

        assert!(!results_lower.is_empty());
        assert!(!results_upper.is_empty());
    }

    #[test]
    fn test_search_result_structure() {
        let temp_dir = create_test_search_directory();
        let search = RipgrepSearch::new();

        let results = search.search_content("main", temp_dir.path().to_str().unwrap()).unwrap();

        for result in &results {
            assert!(!result.file_path.is_empty());
            for match_item in &result.matches {
                assert!(match_item.line_number > 0);
                assert!(!match_item.line_content.is_empty());
            }
        }
    }

    #[test]
    fn test_max_results_limit() {
        let temp_dir = create_test_search_directory();
        let search = RipgrepSearch::new().with_max_results(1);

        let results = search.search_content("fn", temp_dir.path().to_str().unwrap()).unwrap();
        assert!(results.len() <= 1);
    }

    #[test]
    fn test_max_matches_per_file_limit() {
        let temp_dir = create_test_search_directory();
        let search = RipgrepSearch::new().with_max_matches_per_file(1);

        let results = search.search_content("println", temp_dir.path().to_str().unwrap()).unwrap();

        for result in &results {
            assert!(result.matches.len() <= 1);
        }
    }

    #[test]
    fn test_file_type_filter() {
        let temp_dir = create_test_search_directory();
        let search = RipgrepSearch::new()
            .with_file_types(Some(vec!["rs".to_string()]));

        let results = search.search_content("Hello", temp_dir.path().to_str().unwrap()).unwrap();

        // Should only find matches in .rs files, not .md
        for result in &results {
            assert!(result.file_path.ends_with(".rs"),
                "Expected only .rs files, got: {}", result.file_path);
        }
    }

    #[test]
    fn test_search_match_serialization() {
        let match_item = SearchMatch {
            line_number: 42,
            line_content: "fn test() {}".to_string(),
            byte_offset: 100,
        };

        let json = serde_json::to_string(&match_item).unwrap();
        assert!(json.contains("\"line_number\":42"));
        assert!(json.contains("\"line_content\":\"fn test() {}\""));
        assert!(json.contains("\"byte_offset\":100"));

        let parsed: SearchMatch = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.line_number, 42);
        assert_eq!(parsed.line_content, "fn test() {}");
    }

    #[test]
    fn test_search_result_serialization() {
        let result = SearchResult {
            file_path: "/path/to/file.rs".to_string(),
            matches: vec![
                SearchMatch {
                    line_number: 1,
                    line_content: "fn main() {}".to_string(),
                    byte_offset: 0,
                },
            ],
        };

        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"file_path\":\"/path/to/file.rs\""));
        assert!(json.contains("\"matches\":["));

        let parsed: SearchResult = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.file_path, "/path/to/file.rs");
        assert_eq!(parsed.matches.len(), 1);
    }

    #[test]
    fn test_is_code_file_by_extension() {
        let search = RipgrepSearch::new();

        assert!(search.is_code_file(Path::new("test.rs")));
        assert!(search.is_code_file(Path::new("test.js")));
        assert!(search.is_code_file(Path::new("test.py")));
        assert!(search.is_code_file(Path::new("test.ts")));
        assert!(!search.is_code_file(Path::new("test.exe")));
        assert!(!search.is_code_file(Path::new("test.png")));
    }

    #[test]
    fn test_is_code_file_by_filename() {
        let search = RipgrepSearch::new();

        assert!(search.is_code_file(Path::new("Dockerfile")));
        assert!(search.is_code_file(Path::new("Makefile")));
        assert!(!search.is_code_file(Path::new("unknown_file")));
    }

    #[test]
    fn test_builder_pattern_chaining() {
        let search = RipgrepSearch::new()
            .with_max_results(50)
            .with_max_matches_per_file(5)
            .with_file_types(Some(vec!["rs".to_string()]))
            .with_exclude_dirs(Some(vec!["target".to_string()]));

        assert_eq!(search.max_results, 50);
        assert_eq!(search.max_matches_per_file, 5);
        assert!(search.file_types.is_some());
        assert!(search.exclude_dirs.is_some());
    }

    #[test]
    fn test_truncate_line_short_line_unchanged() {
        // Lines shorter than MAX_LINE_LENGTH should not be truncated
        let short_line = "fn main() { println!(\"Hello, world!\"); }";
        let result = RipgrepSearch::truncate_line_with_context(short_line, "main");
        assert_eq!(result, short_line);
    }

    #[test]
    fn test_truncate_line_preserves_match_context() {
        // Create a line longer than MAX_LINE_LENGTH with the match in the middle
        let prefix = "a".repeat(150);
        let suffix = "b".repeat(150);
        let long_line = format!("{}FINDME{}", prefix, suffix);

        let result = RipgrepSearch::truncate_line_with_context(&long_line, "FINDME");

        // Result should contain the match
        assert!(result.contains("FINDME"), "Result should contain the match");
        // Result should have truncation markers
        assert!(result.starts_with("..."), "Should have leading ellipsis");
        assert!(result.ends_with("..."), "Should have trailing ellipsis");
        // Result should be shorter than original
        assert!(result.len() < long_line.len(), "Result should be truncated");
    }

    #[test]
    fn test_truncate_line_match_at_beginning() {
        // Match at the beginning of a long line
        let suffix = "x".repeat(300);
        let long_line = format!("FINDME{}", suffix);

        let result = RipgrepSearch::truncate_line_with_context(&long_line, "FINDME");

        // Result should contain the match and not start with ellipsis
        assert!(result.contains("FINDME"));
        assert!(!result.starts_with("..."), "Should not have leading ellipsis when match is at start");
        assert!(result.ends_with("..."), "Should have trailing ellipsis");
    }

    #[test]
    fn test_truncate_line_match_at_end() {
        // Match at the end of a long line
        let prefix = "x".repeat(300);
        let long_line = format!("{}FINDME", prefix);

        let result = RipgrepSearch::truncate_line_with_context(&long_line, "FINDME");

        // Result should contain the match and not end with ellipsis
        assert!(result.contains("FINDME"));
        assert!(result.starts_with("..."), "Should have leading ellipsis");
        assert!(!result.ends_with("..."), "Should not have trailing ellipsis when match is at end");
    }

    #[test]
    fn test_truncate_line_case_insensitive() {
        // Test case insensitive matching for truncation
        let prefix = "a".repeat(150);
        let suffix = "b".repeat(150);
        let long_line = format!("{}findme{}", prefix, suffix);

        let result = RipgrepSearch::truncate_line_with_context(&long_line, "FINDME");

        // Should still find the match case-insensitively
        assert!(result.contains("findme"));
    }

    #[test]
    fn test_truncate_line_no_match_fallback() {
        // When no match is found (e.g., regex pattern), should truncate from beginning
        let long_line = "x".repeat(300);

        let result = RipgrepSearch::truncate_line_with_context(&long_line, "NOTFOUND");

        // Should truncate from beginning and add ellipsis
        assert!(result.ends_with("..."));
        assert!(result.len() <= MAX_LINE_LENGTH + 3); // +3 for "..."
    }
}