use super::types::BranchInfo;
use git2::{Error as GitError, Repository};
use std::path::Path;

/// Discovers a Git repository starting from the given path
/// This will search upward from the given path until a .git directory is found
pub fn discover_repository<P: AsRef<Path>>(path: P) -> Result<Repository, GitError> {
    Repository::discover(path)
}

/// Checks if the given path is a Git repository
pub fn is_git_repository<P: AsRef<Path>>(path: P) -> bool {
    Repository::open(path).is_ok()
}

/// Gets the current branch information
pub fn get_current_branch(repo: &Repository) -> Result<BranchInfo, GitError> {
    let head = repo.head()?;

    if head.is_branch() {
        let branch_name = head.shorthand().unwrap_or("unknown").to_string();

        // Get upstream information
        let (upstream, ahead, behind) = get_upstream_info(repo, &head)?;

        Ok(BranchInfo {
            name: branch_name,
            is_current: true,
            is_head: false,
            upstream,
            ahead,
            behind,
        })
    } else {
        // Detached HEAD state
        let oid = head
            .target()
            .ok_or_else(|| GitError::from_str("HEAD has no target"))?;

        Ok(BranchInfo {
            name: format!("detached at {}", &oid.to_string()[..7]),
            is_current: true,
            is_head: true,
            upstream: None,
            ahead: None,
            behind: None,
        })
    }
}

/// Gets upstream branch information and ahead/behind counts
fn get_upstream_info(
    repo: &Repository,
    reference: &git2::Reference,
) -> Result<(Option<String>, Option<usize>, Option<usize>), GitError> {
    // Try to get branch name to find upstream
    let branch_name = match reference.shorthand() {
        Some(name) => name,
        None => return Ok((None, None, None)),
    };

    let branch = match repo.find_branch(branch_name, git2::BranchType::Local) {
        Ok(b) => b,
        Err(_) => return Ok((None, None, None)),
    };

    match branch.upstream() {
        Ok(upstream_branch) => {
            let upstream_name = upstream_branch.name()?.map(|s| s.to_string());

            // Calculate ahead/behind
            let local_oid = reference
                .target()
                .ok_or_else(|| GitError::from_str("Local branch has no target"))?;

            let upstream_oid = upstream_branch
                .get()
                .target()
                .ok_or_else(|| GitError::from_str("Upstream branch has no target"))?;

            match repo.graph_ahead_behind(local_oid, upstream_oid) {
                Ok((ahead, behind)) => Ok((upstream_name, Some(ahead), Some(behind))),
                Err(_) => Ok((upstream_name, None, None)),
            }
        }
        Err(_) => {
            // No upstream branch
            Ok((None, None, None))
        }
    }
}

/// Gets the repository root path
pub fn get_repository_root(repo: &Repository) -> Option<String> {
    repo.workdir()
        .and_then(|path| path.to_str())
        .map(|s| s.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;
    use tempfile::TempDir;

    /// Helper to create a temporary git repository
    fn create_temp_git_repo() -> TempDir {
        let temp_dir = TempDir::new().unwrap();
        crate::shell_utils::new_command("git")
            .args(["init"])
            .current_dir(temp_dir.path())
            .output()
            .expect("Failed to initialize git repo");

        // Configure git user for the repo
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

        temp_dir
    }

    #[test]
    fn test_discover_repository_in_git_dir() {
        let temp_dir = create_temp_git_repo();

        let result = discover_repository(temp_dir.path());
        assert!(
            result.is_ok(),
            "Should discover repository in git directory"
        );

        let repo = result.unwrap();
        assert!(repo.workdir().is_some());
    }

    #[test]
    fn test_discover_repository_in_subdirectory() {
        let temp_dir = create_temp_git_repo();

        // Create a subdirectory
        let subdir = temp_dir.path().join("src").join("components");
        std::fs::create_dir_all(&subdir).unwrap();

        // Should discover repo from subdirectory
        let result = discover_repository(&subdir);
        assert!(
            result.is_ok(),
            "Should discover repository from subdirectory"
        );
    }

    #[test]
    fn test_discover_repository_not_found() {
        let temp_dir = TempDir::new().unwrap();
        // This is NOT a git repo

        let result = discover_repository(temp_dir.path());
        assert!(
            result.is_err(),
            "Should fail to discover repository in non-git directory"
        );
    }

    #[test]
    fn test_is_git_repository_true() {
        let temp_dir = create_temp_git_repo();

        assert!(
            is_git_repository(temp_dir.path()),
            "Should identify as git repository"
        );
    }

    #[test]
    fn test_is_git_repository_false() {
        let temp_dir = TempDir::new().unwrap();
        // This is NOT a git repo

        assert!(
            !is_git_repository(temp_dir.path()),
            "Should not identify as git repository"
        );
    }

    #[test]
    fn test_get_repository_root() {
        let temp_dir = create_temp_git_repo();

        let repo = Repository::open(temp_dir.path()).unwrap();
        let root = get_repository_root(&repo);

        assert!(root.is_some());
        let root_path = root.unwrap();
        assert!(root_path.contains(temp_dir.path().file_name().unwrap().to_str().unwrap()));
    }

    #[test]
    fn test_get_current_branch_on_main() {
        let temp_dir = create_temp_git_repo();

        // Create initial commit to have a valid HEAD
        let test_file = temp_dir.path().join("README.md");
        std::fs::write(&test_file, "# Test").unwrap();

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

        let repo = Repository::open(temp_dir.path()).unwrap();
        let branch = get_current_branch(&repo);

        assert!(branch.is_ok());
        let branch_info = branch.unwrap();
        // Branch could be "main" or "master" depending on git version
        assert!(
            branch_info.name == "main" || branch_info.name == "master",
            "Expected 'main' or 'master', got '{}'",
            branch_info.name
        );
        assert!(branch_info.is_current);
        assert!(!branch_info.is_head); // Not detached HEAD
    }

    #[test]
    fn test_get_current_branch_detached_head() {
        let temp_dir = create_temp_git_repo();

        // Create initial commit
        let test_file = temp_dir.path().join("README.md");
        std::fs::write(&test_file, "# Test").unwrap();

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

        // Detach HEAD
        crate::shell_utils::new_command("git")
            .args(["checkout", "--detach", "HEAD"])
            .current_dir(temp_dir.path())
            .output()
            .unwrap();

        let repo = Repository::open(temp_dir.path()).unwrap();
        let branch = get_current_branch(&repo);

        assert!(branch.is_ok());
        let branch_info = branch.unwrap();
        assert!(branch_info.name.starts_with("detached at"));
        assert!(branch_info.is_head); // Detached HEAD
    }

    #[test]
    fn test_get_current_branch_feature_branch() {
        let temp_dir = create_temp_git_repo();

        // Create initial commit on main
        let test_file = temp_dir.path().join("README.md");
        std::fs::write(&test_file, "# Test").unwrap();

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

        // Create and checkout feature branch
        crate::shell_utils::new_command("git")
            .args(["checkout", "-b", "feature/test-branch"])
            .current_dir(temp_dir.path())
            .output()
            .unwrap();

        let repo = Repository::open(temp_dir.path()).unwrap();
        let branch = get_current_branch(&repo);

        assert!(branch.is_ok());
        let branch_info = branch.unwrap();
        assert_eq!(branch_info.name, "feature/test-branch");
        assert!(branch_info.is_current);
    }
}
