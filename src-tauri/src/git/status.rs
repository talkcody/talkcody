use super::repository::get_current_branch;
use super::types::{FileStatus, GitFileStatus, GitStatus};
use git2::{Error as GitError, Repository, Status, StatusOptions};

/// Gets the Git status of the repository
pub fn get_repository_status(repo: &Repository) -> Result<GitStatus, GitError> {
    let mut opts = StatusOptions::new();
    opts.include_untracked(true);
    opts.recurse_untracked_dirs(true);

    let statuses = repo.statuses(Some(&mut opts))?;

    let mut modified = Vec::new();
    let mut staged = Vec::new();
    let mut untracked = Vec::new();
    let mut conflicted = Vec::new();

    for entry in statuses.iter() {
        let path = entry.path().unwrap_or("").to_string();
        let status = entry.status();

        // Check for conflicts first
        if status.is_conflicted() {
            conflicted.push(path.clone());
            continue;
        }

        // Check index (staged) changes
        if status.intersects(
            Status::INDEX_NEW
                | Status::INDEX_MODIFIED
                | Status::INDEX_DELETED
                | Status::INDEX_RENAMED
                | Status::INDEX_TYPECHANGE,
        ) {
            let git_status = status_to_git_file_status(status, true);
            staged.push(FileStatus {
                path: path.clone(),
                status: git_status,
                staged: true,
            });
        }

        // Check working tree (unstaged) changes
        if status.intersects(
            Status::WT_MODIFIED | Status::WT_DELETED | Status::WT_RENAMED | Status::WT_TYPECHANGE,
        ) {
            let git_status = status_to_git_file_status(status, false);
            modified.push(FileStatus {
                path: path.clone(),
                status: git_status,
                staged: false,
            });
        }

        // Check for untracked files
        if status.is_wt_new() {
            untracked.push(path);
        }
    }

    let changes_count = modified.len() + staged.len() + untracked.len() + conflicted.len();

    let branch = get_current_branch(repo).ok();

    Ok(GitStatus {
        branch,
        modified,
        staged,
        untracked,
        conflicted,
        changes_count,
    })
}

/// Converts git2::Status to GitFileStatus
fn status_to_git_file_status(status: Status, is_staged: bool) -> GitFileStatus {
    if is_staged {
        if status.is_index_new() {
            GitFileStatus::Added
        } else if status.is_index_modified() {
            GitFileStatus::Modified
        } else if status.is_index_deleted() {
            GitFileStatus::Deleted
        } else if status.is_index_renamed() {
            GitFileStatus::Renamed
        } else {
            GitFileStatus::Modified
        }
    } else {
        if status.is_wt_modified() {
            GitFileStatus::Modified
        } else if status.is_wt_deleted() {
            GitFileStatus::Deleted
        } else if status.is_wt_renamed() {
            GitFileStatus::Renamed
        } else if status.is_wt_new() {
            GitFileStatus::Untracked
        } else {
            GitFileStatus::Modified
        }
    }
}

/// Gets a map of all file statuses in the repository
/// Returns a map of file path to (status, is_staged)
pub fn get_all_file_statuses(
    repo: &Repository,
) -> Result<std::collections::HashMap<String, (GitFileStatus, bool)>, GitError> {
    let mut opts = StatusOptions::new();
    opts.include_untracked(true);
    opts.recurse_untracked_dirs(true);

    let statuses = repo.statuses(Some(&mut opts))?;
    let mut result = std::collections::HashMap::new();

    for entry in statuses.iter() {
        let path = entry.path().unwrap_or("").to_string();
        let status = entry.status();

        if status.is_conflicted() {
            result.insert(path, (GitFileStatus::Conflicted, false));
            continue;
        }

        // Prioritize staged status
        if status.intersects(
            Status::INDEX_NEW
                | Status::INDEX_MODIFIED
                | Status::INDEX_DELETED
                | Status::INDEX_RENAMED,
        ) {
            let git_status = status_to_git_file_status(status, true);
            result.insert(path.clone(), (git_status, true));
        } else if status.intersects(Status::WT_MODIFIED | Status::WT_DELETED | Status::WT_RENAMED) {
            let git_status = status_to_git_file_status(status, false);
            result.insert(path.clone(), (git_status, false));
        } else if status.is_wt_new() {
            result.insert(path, (GitFileStatus::Untracked, false));
        }
    }

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
        std::fs::write(&readme, "# Initial").unwrap();

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
    fn test_get_repository_status_clean() {
        let temp_dir = create_temp_git_repo_with_commit();

        let repo = Repository::open(temp_dir.path()).unwrap();
        let status = get_repository_status(&repo).unwrap();

        assert!(status.modified.is_empty());
        assert!(status.staged.is_empty());
        assert!(status.untracked.is_empty());
        assert!(status.conflicted.is_empty());
        assert_eq!(status.changes_count, 0);
    }

    #[test]
    fn test_get_repository_status_with_modified_file() {
        let temp_dir = create_temp_git_repo_with_commit();

        // Modify README.md
        let readme = temp_dir.path().join("README.md");
        std::fs::write(&readme, "# Modified content").unwrap();

        let repo = Repository::open(temp_dir.path()).unwrap();
        let status = get_repository_status(&repo).unwrap();

        assert_eq!(status.modified.len(), 1);
        assert_eq!(status.modified[0].path, "README.md");
        assert!(matches!(status.modified[0].status, GitFileStatus::Modified));
        assert!(!status.modified[0].staged);
        assert_eq!(status.changes_count, 1);
    }

    #[test]
    fn test_get_repository_status_with_untracked_file() {
        let temp_dir = create_temp_git_repo_with_commit();

        // Create a new untracked file
        let new_file = temp_dir.path().join("new_file.txt");
        std::fs::write(&new_file, "new content").unwrap();

        let repo = Repository::open(temp_dir.path()).unwrap();
        let status = get_repository_status(&repo).unwrap();

        assert_eq!(status.untracked.len(), 1);
        assert_eq!(status.untracked[0], "new_file.txt");
        assert_eq!(status.changes_count, 1);
    }

    #[test]
    fn test_get_repository_status_with_staged_file() {
        let temp_dir = create_temp_git_repo_with_commit();

        // Create and stage a new file
        let new_file = temp_dir.path().join("staged.txt");
        std::fs::write(&new_file, "staged content").unwrap();

        crate::shell_utils::new_command("git")
            .args(["add", "staged.txt"])
            .current_dir(temp_dir.path())
            .output()
            .unwrap();

        let repo = Repository::open(temp_dir.path()).unwrap();
        let status = get_repository_status(&repo).unwrap();

        assert_eq!(status.staged.len(), 1);
        assert_eq!(status.staged[0].path, "staged.txt");
        assert!(matches!(status.staged[0].status, GitFileStatus::Added));
        assert!(status.staged[0].staged);
    }

    #[test]
    fn test_get_repository_status_with_deleted_file() {
        let temp_dir = create_temp_git_repo_with_commit();

        // Delete README.md
        let readme = temp_dir.path().join("README.md");
        std::fs::remove_file(&readme).unwrap();

        let repo = Repository::open(temp_dir.path()).unwrap();
        let status = get_repository_status(&repo).unwrap();

        assert_eq!(status.modified.len(), 1);
        assert_eq!(status.modified[0].path, "README.md");
        assert!(matches!(status.modified[0].status, GitFileStatus::Deleted));
    }

    #[test]
    fn test_get_all_file_statuses_empty() {
        let temp_dir = create_temp_git_repo_with_commit();

        let repo = Repository::open(temp_dir.path()).unwrap();
        let statuses = get_all_file_statuses(&repo).unwrap();

        assert!(statuses.is_empty());
    }

    #[test]
    fn test_get_all_file_statuses_with_changes() {
        let temp_dir = create_temp_git_repo_with_commit();

        // Create untracked file
        let untracked = temp_dir.path().join("untracked.txt");
        std::fs::write(&untracked, "untracked").unwrap();

        // Modify and stage a file
        let readme = temp_dir.path().join("README.md");
        std::fs::write(&readme, "# Modified").unwrap();

        crate::shell_utils::new_command("git")
            .args(["add", "README.md"])
            .current_dir(temp_dir.path())
            .output()
            .unwrap();

        let repo = Repository::open(temp_dir.path()).unwrap();
        let statuses = get_all_file_statuses(&repo).unwrap();

        assert_eq!(statuses.len(), 2);

        // Check untracked file
        let (untracked_status, is_staged) = statuses.get("untracked.txt").unwrap();
        assert!(matches!(untracked_status, GitFileStatus::Untracked));
        assert!(!is_staged);

        // Check staged modified file
        let (readme_status, is_staged) = statuses.get("README.md").unwrap();
        assert!(matches!(readme_status, GitFileStatus::Modified));
        assert!(is_staged);
    }

    #[test]
    fn test_status_to_git_file_status_staged() {
        // Test staged new file
        let status = status_to_git_file_status(Status::INDEX_NEW, true);
        assert!(matches!(status, GitFileStatus::Added));

        // Test staged modified file
        let status = status_to_git_file_status(Status::INDEX_MODIFIED, true);
        assert!(matches!(status, GitFileStatus::Modified));

        // Test staged deleted file
        let status = status_to_git_file_status(Status::INDEX_DELETED, true);
        assert!(matches!(status, GitFileStatus::Deleted));

        // Test staged renamed file
        let status = status_to_git_file_status(Status::INDEX_RENAMED, true);
        assert!(matches!(status, GitFileStatus::Renamed));
    }

    #[test]
    fn test_status_to_git_file_status_unstaged() {
        // Test working tree modified
        let status = status_to_git_file_status(Status::WT_MODIFIED, false);
        assert!(matches!(status, GitFileStatus::Modified));

        // Test working tree deleted
        let status = status_to_git_file_status(Status::WT_DELETED, false);
        assert!(matches!(status, GitFileStatus::Deleted));

        // Test working tree new (untracked)
        let status = status_to_git_file_status(Status::WT_NEW, false);
        assert!(matches!(status, GitFileStatus::Untracked));
    }

    #[test]
    fn test_repository_status_has_branch_info() {
        let temp_dir = create_temp_git_repo_with_commit();

        let repo = Repository::open(temp_dir.path()).unwrap();
        let status = get_repository_status(&repo).unwrap();

        assert!(status.branch.is_some());
        let branch = status.branch.unwrap();
        assert!(branch.name == "main" || branch.name == "master");
    }
}
