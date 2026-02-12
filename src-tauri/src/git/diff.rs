use super::types::{DiffHunk, DiffLine, DiffLineType, FileDiff, GitFileStatus};
use git2::{Diff, DiffOptions, Error as GitError, Repository};
use lazy_static::lazy_static;
use lru::LruCache;
use std::num::NonZeroUsize;
use std::sync::Mutex;

lazy_static! {
    /// LRU cache for line changes to avoid repeated expensive git diff operations
    /// Cache key format: "{repo_path}:{file_path}"
    static ref LINE_CHANGES_CACHE: Mutex<LruCache<String, Vec<(u32, DiffLineType)>>> =
        Mutex::new(LruCache::new(NonZeroUsize::new(100).unwrap()));
}

/// Gets the diff for a specific file in the working directory vs HEAD
pub fn get_file_diff(repo: &Repository, file_path: &str) -> Result<FileDiff, GitError> {
    let mut opts = DiffOptions::new();
    opts.pathspec(file_path);

    // Get HEAD tree
    let head = repo.head()?;
    let head_tree = head.peel_to_tree()?;

    // Create diff between HEAD and working directory
    let diff = repo.diff_tree_to_workdir_with_index(Some(&head_tree), Some(&mut opts))?;

    parse_diff(diff, file_path)
}

/// Parses a git2::Diff into our FileDiff structure
fn parse_diff(diff: Diff, file_path: &str) -> Result<FileDiff, GitError> {
    use std::cell::RefCell;
    use std::rc::Rc;

    let hunks = Rc::new(RefCell::new(Vec::new()));
    let additions = Rc::new(RefCell::new(0usize));
    let deletions = Rc::new(RefCell::new(0usize));
    let old_path = Rc::new(RefCell::new(None));
    let status = Rc::new(RefCell::new(GitFileStatus::Modified));

    let hunks_clone = hunks.clone();
    let additions_clone = additions.clone();
    let deletions_clone = deletions.clone();
    let old_path_clone = old_path.clone();
    let status_clone = status.clone();

    diff.foreach(
        &mut |delta, _progress| {
            // Determine file status
            *status_clone.borrow_mut() = match delta.status() {
                git2::Delta::Added => GitFileStatus::Added,
                git2::Delta::Deleted => GitFileStatus::Deleted,
                git2::Delta::Modified => GitFileStatus::Modified,
                git2::Delta::Renamed => {
                    *old_path_clone.borrow_mut() = delta
                        .old_file()
                        .path()
                        .and_then(|p| p.to_str())
                        .map(|s| s.to_string());
                    GitFileStatus::Renamed
                }
                git2::Delta::Conflicted => GitFileStatus::Conflicted,
                _ => GitFileStatus::Modified,
            };
            true
        },
        None,
        Some(&mut |_delta, hunk| {
            let lines = Vec::new();

            let hunk_info = DiffHunk {
                old_start: hunk.old_start(),
                old_lines: hunk.old_lines(),
                new_start: hunk.new_start(),
                new_lines: hunk.new_lines(),
                header: String::from_utf8_lossy(hunk.header()).to_string(),
                lines,
            };

            hunks_clone.borrow_mut().push(hunk_info);
            true
        }),
        Some(&mut |_delta, _hunk, line| {
            let line_type = match line.origin() {
                '+' => {
                    *additions_clone.borrow_mut() += 1;
                    DiffLineType::Addition
                }
                '-' => {
                    *deletions_clone.borrow_mut() += 1;
                    DiffLineType::Deletion
                }
                _ => DiffLineType::Context,
            };

            let content = String::from_utf8_lossy(line.content()).to_string();

            let diff_line = DiffLine {
                line_type,
                old_line_number: line.old_lineno(),
                new_line_number: line.new_lineno(),
                content,
            };

            // Add line to the last hunk
            if let Some(last_hunk) = hunks_clone.borrow_mut().last_mut() {
                last_hunk.lines.push(diff_line);
            }

            true
        }),
    )?;

    let final_old_path = old_path.borrow().clone();
    let final_status = status.borrow().clone();
    let final_hunks = hunks.borrow().clone();
    let final_additions = *additions.borrow();
    let final_deletions = *deletions.borrow();

    Ok(FileDiff {
        path: file_path.to_string(),
        old_path: final_old_path,
        status: final_status,
        hunks: final_hunks,
        additions: final_additions,
        deletions: final_deletions,
    })
}

/// Gets line-level changes for Monaco editor gutter indicators
/// Returns a vector of (line_number, change_type) tuples
/// Uses LRU cache to avoid repeated expensive git diff operations
pub fn get_line_changes(
    repo: &Repository,
    file_path: &str,
) -> Result<Vec<(u32, DiffLineType)>, GitError> {
    // Create cache key from repo path and file path
    let repo_path = repo.path().to_string_lossy().to_string();
    let cache_key = format!("{}:{}", repo_path, file_path);

    // Check cache first
    if let Ok(mut cache) = LINE_CHANGES_CACHE.lock() {
        if let Some(cached_changes) = cache.get(&cache_key) {
            log::debug!("Cache hit for line changes: {}", file_path);
            return Ok(cached_changes.clone());
        }
    }

    log::debug!("Cache miss for line changes: {}, computing...", file_path);

    // Compute line changes
    let file_diff = get_file_diff(repo, file_path)?;

    let mut changes = Vec::new();

    for hunk in file_diff.hunks {
        // Track the current line number in the new file
        let mut current_new_line = hunk.new_start;

        for line in hunk.lines {
            match line.line_type {
                DiffLineType::Addition => {
                    if let Some(line_num) = line.new_line_number {
                        changes.push((line_num, DiffLineType::Addition));
                        current_new_line = line_num + 1;
                    }
                }
                DiffLineType::Deletion => {
                    // For deletions, show the marker at the current position in the new file
                    // This is where the deleted lines would have been
                    changes.push((current_new_line, DiffLineType::Deletion));
                    // Don't increment current_new_line for deletions since the line doesn't exist
                }
                DiffLineType::Context => {
                    // Context lines exist in both files, move to next line
                    if let Some(line_num) = line.new_line_number {
                        current_new_line = line_num + 1;
                    }
                }
            }
        }
    }

    // Store in cache
    if let Ok(mut cache) = LINE_CHANGES_CACHE.lock() {
        cache.put(cache_key, changes.clone());
        log::debug!(
            "Cached line changes for: {} ({} changes)",
            file_path,
            changes.len()
        );
    }

    Ok(changes)
}

/// Generates raw diff text for all changed files (working directory vs HEAD)
/// Returns a string similar to `git diff` output, suitable for AI processing
pub fn get_raw_diff_text(repo: &Repository) -> Result<String, GitError> {
    let mut opts = DiffOptions::new();

    // Get HEAD tree
    let head = repo.head()?;
    let head_tree = head.peel_to_tree()?;

    // Create diff between HEAD and working directory (includes staged and unstaged)
    let diff = repo.diff_tree_to_workdir_with_index(Some(&head_tree), Some(&mut opts))?;

    format_diff_as_text(diff)
}

/// Formats a git2::Diff as human-readable text similar to `git diff` output
fn format_diff_as_text(diff: Diff) -> Result<String, GitError> {
    use std::cell::RefCell;
    use std::rc::Rc;

    let output = Rc::new(RefCell::new(String::new()));
    let output_file = output.clone();
    let output_hunk = output.clone();
    let output_line = output.clone();

    diff.foreach(
        &mut |delta, _progress| {
            let mut out = output_file.borrow_mut();

            // File header
            let status = match delta.status() {
                git2::Delta::Added => "new file",
                git2::Delta::Deleted => "deleted",
                git2::Delta::Modified => "modified",
                git2::Delta::Renamed => "renamed",
                _ => "changed",
            };

            let new_path = delta
                .new_file()
                .path()
                .and_then(|p| p.to_str())
                .unwrap_or("unknown");
            let old_path = delta
                .old_file()
                .path()
                .and_then(|p| p.to_str())
                .unwrap_or("unknown");

            out.push_str(&format!(
                "diff --git a/{} b/{} ({})\n",
                old_path, new_path, status
            ));

            if delta.status() == git2::Delta::Renamed {
                out.push_str(&format!("rename from {}\n", old_path));
                out.push_str(&format!("rename to {}\n", new_path));
            }

            out.push_str(&format!("--- a/{}\n", old_path));
            out.push_str(&format!("+++ b/{}\n", new_path));

            true
        },
        None,
        Some(&mut |_delta, hunk| {
            let mut out = output_hunk.borrow_mut();
            out.push_str(&String::from_utf8_lossy(hunk.header()));
            true
        }),
        Some(&mut |_delta, _hunk, line| {
            let mut out = output_line.borrow_mut();

            let prefix = match line.origin() {
                '+' => '+',
                '-' => '-',
                ' ' => ' ',
                _ => ' ',
            };

            let content = String::from_utf8_lossy(line.content());
            out.push(prefix);
            out.push_str(&content);

            // Ensure line ends with newline
            if !content.ends_with('\n') {
                out.push('\n');
            }

            true
        }),
    )?;

    let result = output.borrow().clone();
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;
    use tempfile::TempDir;

    /// Helper to create a temporary git repository with initial commit
    fn create_temp_git_repo_with_commit() -> TempDir {
        let temp_dir = TempDir::new().unwrap();

        crate::shell_utils::new_command("git")
            .args(["init"])
            .current_dir(temp_dir.path())
            .output()
            .expect("Failed to initialize git repo");

        crate::shell_utils::new_command("git")
            .args(["config", "user.email", "test@example.com"])
            .current_dir(temp_dir.path())
            .output()
            .expect("Failed to configure git email");

        crate::shell_utils::new_command("git")
            .args(["config", "user.name", "Test User"])
            .current_dir(temp_dir.path())
            .output()
            .expect("Failed to configure git name");

        // Create initial commit
        let readme = temp_dir.path().join("README.md");
        std::fs::write(&readme, "# Initial\nLine 2\nLine 3\n").unwrap();

        crate::shell_utils::new_command("git")
            .args(["add", "."])
            .current_dir(temp_dir.path())
            .output()
            .unwrap();

        crate::shell_utils::new_command("git")
            .args(["commit", "-m", "Initial commit"])
            .current_dir(temp_dir.path())
            .output()
            .unwrap();

        temp_dir
    }

    #[test]
    fn test_get_file_diff_modified() {
        let temp_dir = create_temp_git_repo_with_commit();

        // Modify README.md
        let readme = temp_dir.path().join("README.md");
        std::fs::write(&readme, "# Modified\nLine 2\nLine 3\nLine 4\n").unwrap();

        let repo = Repository::open(temp_dir.path()).unwrap();
        let diff = get_file_diff(&repo, "README.md").unwrap();

        assert_eq!(diff.path, "README.md");
        assert!(matches!(diff.status, GitFileStatus::Modified));
        assert!(diff.additions > 0 || diff.deletions > 0);
    }

    #[test]
    fn test_get_file_diff_with_additions() {
        let temp_dir = create_temp_git_repo_with_commit();

        // Add lines to README.md
        let readme = temp_dir.path().join("README.md");
        std::fs::write(
            &readme,
            "# Initial\nLine 2\nLine 3\nNew Line 4\nNew Line 5\n",
        )
        .unwrap();

        let repo = Repository::open(temp_dir.path()).unwrap();
        let diff = get_file_diff(&repo, "README.md").unwrap();

        assert!(
            diff.additions >= 2,
            "Expected at least 2 additions, got {}",
            diff.additions
        );
    }

    #[test]
    fn test_get_file_diff_with_deletions() {
        let temp_dir = create_temp_git_repo_with_commit();

        // Delete lines from README.md
        let readme = temp_dir.path().join("README.md");
        std::fs::write(&readme, "# Initial\n").unwrap();

        let repo = Repository::open(temp_dir.path()).unwrap();
        let diff = get_file_diff(&repo, "README.md").unwrap();

        assert!(
            diff.deletions >= 2,
            "Expected at least 2 deletions, got {}",
            diff.deletions
        );
    }

    #[test]
    fn test_get_line_changes() {
        let temp_dir = create_temp_git_repo_with_commit();

        // Modify README.md
        let readme = temp_dir.path().join("README.md");
        std::fs::write(&readme, "# Modified Title\nLine 2\nLine 3\nNew Line 4\n").unwrap();

        let repo = Repository::open(temp_dir.path()).unwrap();
        let changes = get_line_changes(&repo, "README.md").unwrap();

        // Should have some line changes
        assert!(!changes.is_empty(), "Expected some line changes");

        // Check that changes contain the expected types
        let has_addition = changes
            .iter()
            .any(|(_, t)| matches!(t, DiffLineType::Addition));
        let has_deletion = changes
            .iter()
            .any(|(_, t)| matches!(t, DiffLineType::Deletion));

        assert!(
            has_addition || has_deletion,
            "Expected addition or deletion changes"
        );
    }

    #[test]
    fn test_get_line_changes_cache() {
        let temp_dir = create_temp_git_repo_with_commit();

        // Modify README.md
        let readme = temp_dir.path().join("README.md");
        std::fs::write(&readme, "# Modified\nLine 2\nLine 3\n").unwrap();

        let repo = Repository::open(temp_dir.path()).unwrap();

        // First call - should compute
        let changes1 = get_line_changes(&repo, "README.md").unwrap();

        // Second call - should use cache
        let changes2 = get_line_changes(&repo, "README.md").unwrap();

        // Results should be the same
        assert_eq!(changes1.len(), changes2.len());
    }

    #[test]
    fn test_file_diff_hunks() {
        let temp_dir = create_temp_git_repo_with_commit();

        // Create a file with multiple sections
        let code_file = temp_dir.path().join("code.rs");
        std::fs::write(&code_file, "fn main() {\n    println!(\"hello\");\n}\n").unwrap();

        crate::shell_utils::new_command("git")
            .args(["add", "code.rs"])
            .current_dir(temp_dir.path())
            .output()
            .unwrap();

        crate::shell_utils::new_command("git")
            .args(["commit", "-m", "Add code.rs"])
            .current_dir(temp_dir.path())
            .output()
            .unwrap();

        // Modify the file
        std::fs::write(
            &code_file,
            "fn main() {\n    println!(\"goodbye\");\n    // comment\n}\n",
        )
        .unwrap();

        let repo = Repository::open(temp_dir.path()).unwrap();
        let diff = get_file_diff(&repo, "code.rs").unwrap();

        // Should have at least one hunk
        assert!(!diff.hunks.is_empty(), "Expected at least one hunk");

        // Each hunk should have lines
        for hunk in &diff.hunks {
            assert!(!hunk.lines.is_empty(), "Hunk should have lines");
            assert!(!hunk.header.is_empty(), "Hunk should have header");
        }
    }

    #[test]
    fn test_diff_line_type_addition() {
        let temp_dir = create_temp_git_repo_with_commit();

        let readme = temp_dir.path().join("README.md");
        std::fs::write(&readme, "# Initial\nLine 2\nLine 3\nNew added line\n").unwrap();

        let repo = Repository::open(temp_dir.path()).unwrap();
        let diff = get_file_diff(&repo, "README.md").unwrap();

        // Check that we have addition lines in hunks
        let has_addition_line = diff
            .hunks
            .iter()
            .flat_map(|h| &h.lines)
            .any(|l| matches!(l.line_type, DiffLineType::Addition));

        assert!(has_addition_line, "Should have at least one addition line");
    }

    #[test]
    fn test_diff_line_numbers() {
        let temp_dir = create_temp_git_repo_with_commit();

        let readme = temp_dir.path().join("README.md");
        std::fs::write(&readme, "# Initial\nModified line 2\nLine 3\n").unwrap();

        let repo = Repository::open(temp_dir.path()).unwrap();
        let diff = get_file_diff(&repo, "README.md").unwrap();

        // Check that lines have proper line numbers
        for hunk in &diff.hunks {
            for line in &hunk.lines {
                match line.line_type {
                    DiffLineType::Addition => {
                        assert!(
                            line.new_line_number.is_some(),
                            "Addition should have new line number"
                        );
                    }
                    DiffLineType::Deletion => {
                        assert!(
                            line.old_line_number.is_some(),
                            "Deletion should have old line number"
                        );
                    }
                    DiffLineType::Context => {
                        // Context lines should have both
                        assert!(
                            line.old_line_number.is_some() || line.new_line_number.is_some(),
                            "Context should have line numbers"
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn test_get_raw_diff_text() {
        let temp_dir = create_temp_git_repo_with_commit();

        // Modify README.md
        let readme = temp_dir.path().join("README.md");
        std::fs::write(&readme, "# Modified\nLine 2\nLine 3\nLine 4\n").unwrap();

        let repo = Repository::open(temp_dir.path()).unwrap();
        let diff_text = get_raw_diff_text(&repo).unwrap();

        // Should contain git diff header
        assert!(
            diff_text.contains("diff --git"),
            "Should contain git diff header"
        );
        assert!(diff_text.contains("README.md"), "Should contain file name");

        // Should contain additions and deletions
        assert!(diff_text.contains('+'), "Should contain additions");
        assert!(diff_text.contains('-'), "Should contain deletions");
    }

    #[test]
    fn test_get_raw_diff_text_empty_when_no_changes() {
        let temp_dir = create_temp_git_repo_with_commit();

        // No changes made
        let repo = Repository::open(temp_dir.path()).unwrap();
        let diff_text = get_raw_diff_text(&repo).unwrap();

        // Should be empty when no changes
        assert!(diff_text.is_empty(), "Should be empty when no changes");
    }

    #[test]
    fn test_get_raw_diff_text_multiple_files() {
        let temp_dir = create_temp_git_repo_with_commit();

        // Modify README.md
        let readme = temp_dir.path().join("README.md");
        std::fs::write(&readme, "# Modified\n").unwrap();

        // Create and commit a new file first, then modify it
        let code_file = temp_dir.path().join("code.rs");
        std::fs::write(&code_file, "fn main() {}\n").unwrap();

        crate::shell_utils::new_command("git")
            .args(["add", "code.rs"])
            .current_dir(temp_dir.path())
            .output()
            .unwrap();

        crate::shell_utils::new_command("git")
            .args(["commit", "-m", "Add code.rs"])
            .current_dir(temp_dir.path())
            .output()
            .unwrap();

        // Now modify both files
        std::fs::write(&readme, "# Modified Again\n").unwrap();
        std::fs::write(&code_file, "fn main() { println!(\"hello\"); }\n").unwrap();

        let repo = Repository::open(temp_dir.path()).unwrap();
        let diff_text = get_raw_diff_text(&repo).unwrap();

        // Should contain both files
        assert!(diff_text.contains("README.md"), "Should contain README.md");
        assert!(diff_text.contains("code.rs"), "Should contain code.rs");
    }
}
