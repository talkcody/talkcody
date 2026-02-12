use git2::{Error as GitError, Repository};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

// ============================================================================
// Constants
// ============================================================================

/// Maximum number of worktrees in the pool
const MAX_POOL_SIZE: u32 = 3;

/// Branch name prefix for worktree branches
const BRANCH_PREFIX: &str = "talkcody-pool";

// ============================================================================
// Types
// ============================================================================

/// Information about a single worktree in the pool
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeInfo {
    /// Index in the pool (0, 1, 2)
    pub pool_index: u32,
    /// Absolute path to the worktree directory
    pub path: String,
    /// Branch name (e.g., "talkcody-pool-0")
    pub branch: String,
    /// Whether this worktree is currently in use
    pub in_use: bool,
    /// ID of the task using this worktree (if any)
    pub task_id: Option<String>,
    /// Base commit hash when the worktree was acquired
    pub base_commit: String,
    /// Number of uncommitted changes in the worktree
    pub changes_count: usize,
}

/// Status of the entire worktree pool for a project
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreePoolStatus {
    /// Path to the main project
    pub project_path: String,
    /// Path to the pool directory
    pub pool_dir: String,
    /// Main branch name (e.g., "main" or "master")
    pub main_branch: String,
    /// Current HEAD commit of main branch
    pub head_commit: String,
    /// List of worktrees in the pool
    pub worktrees: Vec<WorktreeInfo>,
    /// Number of worktrees currently in use
    pub in_use_count: usize,
}

/// Result of a merge operation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeResult {
    /// Whether the merge was successful
    pub success: bool,
    /// Commit hash of the merge commit (if successful)
    pub merged_commit: Option<String>,
    /// Whether there are conflicts
    pub has_conflicts: bool,
    /// List of files with conflicts
    pub conflicted_files: Vec<String>,
    /// Human-readable message about the result
    pub message: String,
}

/// Result of a sync (rebase) operation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    /// Whether the sync was successful
    pub success: bool,
    /// Commit hash after sync (if successful)
    pub synced_commit: Option<String>,
    /// Whether there are conflicts
    pub has_conflicts: bool,
    /// List of files with conflicts
    pub conflicted_files: Vec<String>,
    /// Human-readable message about the result
    pub message: String,
}

/// Changes in a worktree compared to its base
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeChanges {
    /// Path to the worktree
    pub worktree_path: String,
    /// Base commit when worktree was acquired
    pub base_commit: String,
    /// Current HEAD commit in the worktree
    pub current_commit: String,
    /// List of modified files
    pub modified_files: Vec<String>,
    /// List of newly added files
    pub added_files: Vec<String>,
    /// List of deleted files
    pub deleted_files: Vec<String>,
    /// Whether there are uncommitted changes in working directory
    pub has_uncommitted_changes: bool,
}

// ============================================================================
// In-Memory State (for task_id tracking)
// ============================================================================

lazy_static::lazy_static! {
    /// Maps project_path -> (pool_index -> task_id)
    static ref WORKTREE_TASK_MAP: Mutex<HashMap<String, HashMap<u32, String>>> = Mutex::new(HashMap::new());
}

// ============================================================================
// Helper Functions
// ============================================================================

/// Get the default worktree root directory (~/.talkcody)
pub fn get_default_worktree_root() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join(".talkcody")
}

/// Get the pool directory path for a project
/// If custom_root is provided and non-empty, use it; otherwise use default (~/.talkcody)
fn get_pool_dir(project_path: &str, custom_root: Option<&str>) -> PathBuf {
    let project_path = Path::new(project_path);
    let project_name = project_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("project");

    let root = match custom_root {
        Some(path) if !path.is_empty() => PathBuf::from(path),
        _ => get_default_worktree_root(),
    };

    root.join(project_name)
}

/// Get the path for a specific worktree in the pool
fn get_worktree_path(project_path: &str, pool_index: u32, custom_root: Option<&str>) -> PathBuf {
    get_pool_dir(project_path, custom_root).join(format!("pool-{}", pool_index))
}

/// Get the branch name for a pool index
fn get_branch_name(pool_index: u32) -> String {
    format!("{}-{}", BRANCH_PREFIX, pool_index)
}

/// Get the current HEAD commit hash
fn get_head_commit(repo: &Repository) -> Result<String, GitError> {
    let head = repo.head()?;
    let commit = head.peel_to_commit()?;
    Ok(commit.id().to_string())
}

/// Get the main branch name (main or master)
fn get_main_branch_name(repo: &Repository) -> Result<String, GitError> {
    // Try "main" first, then "master"
    for branch_name in &["main", "master"] {
        if repo
            .find_branch(branch_name, git2::BranchType::Local)
            .is_ok()
        {
            return Ok(branch_name.to_string());
        }
    }

    // Fall back to current branch
    let head = repo.head()?;
    if head.is_branch() {
        Ok(head.shorthand().unwrap_or("main").to_string())
    } else {
        Ok("main".to_string())
    }
}

/// Count changes in a worktree
fn count_worktree_changes(worktree_path: &str) -> usize {
    let output = crate::shell_utils::new_command("git")
        .args(["status", "--porcelain"])
        .current_dir(worktree_path)
        .output();

    match output {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            stdout.lines().count()
        }
        Err(_) => 0,
    }
}

/// Check if a worktree exists at the given path
fn worktree_exists(worktree_path: &Path) -> bool {
    worktree_path.exists() && worktree_path.join(".git").exists()
}

/// Get task_id for a worktree from in-memory state
fn get_task_id(project_path: &str, pool_index: u32) -> Option<String> {
    let map = WORKTREE_TASK_MAP.lock().ok()?;
    map.get(project_path)
        .and_then(|pool_map| pool_map.get(&pool_index))
        .cloned()
}

/// Set task_id for a worktree in in-memory state
fn set_task_id(project_path: &str, pool_index: u32, task_id: Option<String>) {
    if let Ok(mut map) = WORKTREE_TASK_MAP.lock() {
        let pool_map = map
            .entry(project_path.to_string())
            .or_insert_with(HashMap::new);
        if let Some(tid) = task_id {
            pool_map.insert(pool_index, tid);
        } else {
            pool_map.remove(&pool_index);
        }
    }
}

// ============================================================================
// Core Functions
// ============================================================================

/// Acquire a worktree from the pool
/// If the worktree exists and is clean, it will be reset to the current HEAD
/// If it exists but has uncommitted changes, returns an error (unless force=true)
/// If it doesn't exist, it will be created
pub fn acquire_worktree(
    project_path: &str,
    pool_index: u32,
    task_id: &str,
    force: bool,
    worktree_root: Option<&str>,
) -> Result<WorktreeInfo, String> {
    if pool_index >= MAX_POOL_SIZE {
        return Err(format!(
            "Pool index {} exceeds maximum pool size {}",
            pool_index, MAX_POOL_SIZE
        ));
    }

    let worktree_path = get_worktree_path(project_path, pool_index, worktree_root);
    let worktree_path_str = worktree_path.to_string_lossy().to_string();
    let branch_name = get_branch_name(pool_index);

    // Open the main repository
    let repo =
        Repository::open(project_path).map_err(|e| format!("Failed to open repository: {}", e))?;

    // Get current HEAD commit
    let head_commit =
        get_head_commit(&repo).map_err(|e| format!("Failed to get HEAD commit: {}", e))?;

    if worktree_exists(&worktree_path) {
        // Check for uncommitted changes before resetting
        let changes_count = count_worktree_changes(&worktree_path_str);

        if changes_count > 0 && !force {
            // Return special error format that frontend can parse
            return Err(format!(
                "WORKTREE_HAS_CHANGES:{}:{}",
                pool_index, changes_count
            ));
        }

        // Worktree exists and is clean (or force=true), reset it to HEAD
        log::info!("Resetting existing worktree at {}", worktree_path_str);

        if changes_count > 0 {
            log::warn!(
                "Force resetting worktree with {} uncommitted changes",
                changes_count
            );
        }

        // First reset to HEAD to unstage all changes (staged files become untracked)
        // This must happen BEFORE clean, otherwise staged new files won't be removed
        let output = crate::shell_utils::new_command("git")
            .args(["reset", "--hard", &head_commit])
            .current_dir(&worktree_path)
            .output()
            .map_err(|e| format!("Failed to reset worktree: {}", e))?;

        if !output.status.success() {
            return Err(format!(
                "Failed to reset worktree: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }

        // Then clean to remove untracked files (including files that were just unstaged by reset)
        // Use -ffd (double f) to also remove nested git repositories (e.g., CMake FetchContent deps)
        let output = crate::shell_utils::new_command("git")
            .args(["clean", "-ffd"])
            .current_dir(&worktree_path)
            .output()
            .map_err(|e| format!("Failed to clean worktree: {}", e))?;

        if !output.status.success() {
            log::warn!(
                "git clean warning: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }
    } else {
        // Create the pool directory if needed
        let pool_dir = get_pool_dir(project_path, worktree_root);
        fs::create_dir_all(&pool_dir)
            .map_err(|e| format!("Failed to create pool directory: {}", e))?;

        log::info!("Creating new worktree at {}", worktree_path_str);

        // Create the worktree with a new branch
        let output = crate::shell_utils::new_command("git")
            .args([
                "worktree",
                "add",
                "-b",
                &branch_name,
                &worktree_path_str,
                &head_commit,
            ])
            .current_dir(project_path)
            .output()
            .map_err(|e| format!("Failed to create worktree: {}", e))?;

        if !output.status.success() {
            // If branch already exists, try without -b
            let output = crate::shell_utils::new_command("git")
                .args(["worktree", "add", &worktree_path_str, &branch_name])
                .current_dir(project_path)
                .output()
                .map_err(|e| format!("Failed to create worktree: {}", e))?;

            if !output.status.success() {
                return Err(format!(
                    "Failed to create worktree: {}",
                    String::from_utf8_lossy(&output.stderr)
                ));
            }
        }
    }

    // Set task_id in memory
    set_task_id(project_path, pool_index, Some(task_id.to_string()));

    Ok(WorktreeInfo {
        pool_index,
        path: worktree_path_str,
        branch: branch_name,
        in_use: true,
        task_id: Some(task_id.to_string()),
        base_commit: head_commit,
        changes_count: 0,
    })
}

/// Release a worktree back to the pool (keeps directory, clears task association)
pub fn release_worktree(project_path: &str, pool_index: u32) -> Result<(), String> {
    if pool_index >= MAX_POOL_SIZE {
        return Err(format!(
            "Pool index {} exceeds maximum pool size {}",
            pool_index, MAX_POOL_SIZE
        ));
    }

    // Clear task_id in memory
    set_task_id(project_path, pool_index, None);

    log::info!(
        "Released worktree pool-{} for project {}",
        pool_index,
        project_path
    );

    Ok(())
}

/// Remove a worktree completely from the pool
pub fn remove_worktree(
    project_path: &str,
    pool_index: u32,
    worktree_root: Option<&str>,
) -> Result<(), String> {
    if pool_index >= MAX_POOL_SIZE {
        return Err(format!(
            "Pool index {} exceeds maximum pool size {}",
            pool_index, MAX_POOL_SIZE
        ));
    }

    let worktree_path = get_worktree_path(project_path, pool_index, worktree_root);
    let worktree_path_str = worktree_path.to_string_lossy().to_string();
    let branch_name = get_branch_name(pool_index);

    // Clear task_id first
    set_task_id(project_path, pool_index, None);

    if !worktree_exists(&worktree_path) {
        return Ok(()); // Already removed
    }

    // Remove the worktree using git
    let output = crate::shell_utils::new_command("git")
        .args(["worktree", "remove", "--force", &worktree_path_str])
        .current_dir(project_path)
        .output()
        .map_err(|e| format!("Failed to remove worktree: {}", e))?;

    if !output.status.success() {
        // Force remove the directory if git command fails
        log::warn!(
            "git worktree remove failed, forcing directory removal: {}",
            String::from_utf8_lossy(&output.stderr)
        );

        fs::remove_dir_all(&worktree_path)
            .map_err(|e| format!("Failed to remove worktree directory: {}", e))?;
    }

    // Try to delete the branch (may fail if not fully merged, that's ok)
    let _ = crate::shell_utils::new_command("git")
        .args(["branch", "-D", &branch_name])
        .current_dir(project_path)
        .output();

    log::info!(
        "Removed worktree pool-{} for project {}",
        pool_index,
        project_path
    );

    Ok(())
}

/// List all worktrees in the pool for a project
pub fn list_worktrees(
    project_path: &str,
    worktree_root: Option<&str>,
) -> Result<WorktreePoolStatus, String> {
    let repo =
        Repository::open(project_path).map_err(|e| format!("Failed to open repository: {}", e))?;

    let pool_dir = get_pool_dir(project_path, worktree_root);
    let main_branch =
        get_main_branch_name(&repo).map_err(|e| format!("Failed to get main branch: {}", e))?;
    let head_commit =
        get_head_commit(&repo).map_err(|e| format!("Failed to get HEAD commit: {}", e))?;

    let mut worktrees = Vec::new();
    let mut in_use_count = 0;

    for pool_index in 0..MAX_POOL_SIZE {
        let worktree_path = get_worktree_path(project_path, pool_index, worktree_root);
        let worktree_path_str = worktree_path.to_string_lossy().to_string();
        let branch_name = get_branch_name(pool_index);

        if worktree_exists(&worktree_path) {
            let task_id = get_task_id(project_path, pool_index);
            let in_use = task_id.is_some();
            let changes_count = count_worktree_changes(&worktree_path_str);

            // Get base commit from the worktree
            let base_commit = crate::shell_utils::new_command("git")
                .args(["rev-parse", "HEAD"])
                .current_dir(&worktree_path)
                .output()
                .ok()
                .and_then(|o| String::from_utf8(o.stdout).ok())
                .map(|s| s.trim().to_string())
                .unwrap_or_default();

            if in_use {
                in_use_count += 1;
            }

            worktrees.push(WorktreeInfo {
                pool_index,
                path: worktree_path_str,
                branch: branch_name,
                in_use,
                task_id,
                base_commit,
                changes_count,
            });
        }
    }

    Ok(WorktreePoolStatus {
        project_path: project_path.to_string(),
        pool_dir: pool_dir.to_string_lossy().to_string(),
        main_branch,
        head_commit,
        worktrees,
        in_use_count,
    })
}

/// Get changes in a worktree
pub fn get_worktree_changes(worktree_path: &str) -> Result<WorktreeChanges, String> {
    if !Path::new(worktree_path).exists() {
        return Err(format!("Worktree path does not exist: {}", worktree_path));
    }

    // Get current HEAD
    let current_commit = crate::shell_utils::new_command("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(worktree_path)
        .output()
        .map_err(|e| format!("Failed to get HEAD: {}", e))
        .and_then(|o| {
            String::from_utf8(o.stdout)
                .map(|s| s.trim().to_string())
                .map_err(|e| format!("Invalid UTF-8: {}", e))
        })?;

    // Get status
    let output = crate::shell_utils::new_command("git")
        .args(["status", "--porcelain"])
        .current_dir(worktree_path)
        .output()
        .map_err(|e| format!("Failed to get status: {}", e))?;

    let status_str = String::from_utf8_lossy(&output.stdout);
    let mut modified_files = Vec::new();
    let mut added_files = Vec::new();
    let mut deleted_files = Vec::new();

    for line in status_str.lines() {
        if line.len() < 3 {
            continue;
        }

        let status = &line[0..2];
        let file_path = line[3..].to_string();

        match status {
            " M" | "M " | "MM" => modified_files.push(file_path),
            "A " | " A" | "AA" => added_files.push(file_path),
            "D " | " D" | "DD" => deleted_files.push(file_path),
            "??" => added_files.push(file_path), // Untracked as added
            _ => modified_files.push(file_path), // Default to modified
        }
    }

    let has_uncommitted_changes =
        !modified_files.is_empty() || !added_files.is_empty() || !deleted_files.is_empty();

    Ok(WorktreeChanges {
        worktree_path: worktree_path.to_string(),
        base_commit: current_commit.clone(), // We don't track original base, use current
        current_commit,
        modified_files,
        added_files,
        deleted_files,
        has_uncommitted_changes,
    })
}

/// Commit all changes in a worktree
pub fn commit_worktree(worktree_path: &str, message: &str) -> Result<String, String> {
    if !Path::new(worktree_path).exists() {
        return Err(format!("Worktree path does not exist: {}", worktree_path));
    }

    // Stage all changes
    let output = crate::shell_utils::new_command("git")
        .args(["add", "-A"])
        .current_dir(worktree_path)
        .output()
        .map_err(|e| format!("Failed to stage changes: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "Failed to stage changes: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    // Commit
    let output = crate::shell_utils::new_command("git")
        .args(["commit", "-m", message])
        .current_dir(worktree_path)
        .output()
        .map_err(|e| format!("Failed to commit: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // Check if there's nothing to commit
        if stderr.contains("nothing to commit") {
            return Err("Nothing to commit".to_string());
        }
        return Err(format!("Failed to commit: {}", stderr));
    }

    // Get the new commit hash
    let output = crate::shell_utils::new_command("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(worktree_path)
        .output()
        .map_err(|e| format!("Failed to get commit hash: {}", e))?;

    let commit_hash = String::from_utf8_lossy(&output.stdout).trim().to_string();

    log::info!(
        "Committed changes in worktree {} with hash {}",
        worktree_path,
        commit_hash
    );

    Ok(commit_hash)
}

/// Merge a worktree's changes back to the main branch
pub fn merge_worktree_to_main(
    project_path: &str,
    pool_index: u32,
    commit_message: Option<&str>,
    worktree_root: Option<&str>,
) -> Result<MergeResult, String> {
    let worktree_path = get_worktree_path(project_path, pool_index, worktree_root);
    let worktree_path_str = worktree_path.to_string_lossy().to_string();
    let branch_name = get_branch_name(pool_index);

    if !worktree_exists(&worktree_path) {
        return Err(format!(
            "Worktree does not exist at pool index {}",
            pool_index
        ));
    }

    // First, commit any uncommitted changes in the worktree
    let changes = get_worktree_changes(&worktree_path_str)?;
    if changes.has_uncommitted_changes {
        let msg = commit_message.unwrap_or("Auto-commit before merge");
        match commit_worktree(&worktree_path_str, msg) {
            Ok(_) => log::info!("Auto-committed changes before merge"),
            Err(e) => {
                if !e.contains("Nothing to commit") {
                    return Err(format!("Failed to auto-commit: {}", e));
                }
            }
        }
    }

    // Open main repository
    let repo =
        Repository::open(project_path).map_err(|e| format!("Failed to open repository: {}", e))?;

    let main_branch =
        get_main_branch_name(&repo).map_err(|e| format!("Failed to get main branch: {}", e))?;

    // Checkout main branch in main repo
    let output = crate::shell_utils::new_command("git")
        .args(["checkout", &main_branch])
        .current_dir(project_path)
        .output()
        .map_err(|e| format!("Failed to checkout main branch: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "Failed to checkout main branch: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    // First try fast-forward merge (no merge commit needed)
    let ff_output = crate::shell_utils::new_command("git")
        .args(["merge", "--ff-only", &branch_name])
        .current_dir(project_path)
        .output()
        .map_err(|e| format!("Failed to merge: {}", e))?;

    let output = if ff_output.status.success() {
        // Fast-forward succeeded, no merge commit created
        log::info!("Fast-forward merge successful for {}", branch_name);
        ff_output
    } else {
        // Fast-forward not possible, fallback to regular merge with commit
        log::info!(
            "Fast-forward not possible for {}, creating merge commit",
            branch_name
        );
        let default_merge_msg = format!("Merge {} into {}", branch_name, main_branch);
        let merge_msg = commit_message.unwrap_or(&default_merge_msg);
        crate::shell_utils::new_command("git")
            .args(["merge", &branch_name, "-m", merge_msg])
            .current_dir(project_path)
            .output()
            .map_err(|e| format!("Failed to merge: {}", e))?
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();

        // Check for conflicts
        if stderr.contains("CONFLICT") || stderr.contains("Automatic merge failed") {
            // Get list of conflicted files
            let conflict_output = crate::shell_utils::new_command("git")
                .args(["diff", "--name-only", "--diff-filter=U"])
                .current_dir(project_path)
                .output()
                .ok();

            let conflicted_files = conflict_output
                .map(|o| {
                    String::from_utf8_lossy(&o.stdout)
                        .lines()
                        .map(|s| s.to_string())
                        .collect()
                })
                .unwrap_or_default();

            return Ok(MergeResult {
                success: false,
                merged_commit: None,
                has_conflicts: true,
                conflicted_files,
                message: "Merge has conflicts. Please resolve manually.".to_string(),
            });
        }

        return Err(format!("Merge failed: {}", stderr));
    }

    // Get the merge commit hash
    let head_commit =
        get_head_commit(&repo).map_err(|e| format!("Failed to get merge commit: {}", e))?;

    log::info!(
        "Successfully merged {} into {} with commit {}",
        branch_name,
        main_branch,
        head_commit
    );

    Ok(MergeResult {
        success: true,
        merged_commit: Some(head_commit),
        has_conflicts: false,
        conflicted_files: vec![],
        message: "Merge successful".to_string(),
    })
}

/// Abort an in-progress merge
pub fn abort_merge(project_path: &str) -> Result<(), String> {
    let output = crate::shell_utils::new_command("git")
        .args(["merge", "--abort"])
        .current_dir(project_path)
        .output()
        .map_err(|e| format!("Failed to abort merge: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "Failed to abort merge: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    log::info!("Merge aborted for project {}", project_path);
    Ok(())
}

/// Sync a worktree with the latest main branch using rebase
/// This brings the main branch's latest changes into the worktree
pub fn sync_worktree_from_main(
    project_path: &str,
    pool_index: u32,
    worktree_root: Option<&str>,
) -> Result<SyncResult, String> {
    let worktree_path = get_worktree_path(project_path, pool_index, worktree_root);
    let worktree_path_str = worktree_path.to_string_lossy().to_string();

    if !worktree_exists(&worktree_path) {
        return Err(format!(
            "Worktree does not exist at pool index {}",
            pool_index
        ));
    }

    // Get main branch's HEAD commit from project
    let repo =
        Repository::open(project_path).map_err(|e| format!("Failed to open repository: {}", e))?;

    let main_branch =
        get_main_branch_name(&repo).map_err(|e| format!("Failed to get main branch: {}", e))?;

    let main_head =
        get_head_commit(&repo).map_err(|e| format!("Failed to get main HEAD commit: {}", e))?;

    log::info!(
        "Syncing worktree pool-{} from main branch {} at commit {}",
        pool_index,
        main_branch,
        &main_head[..8]
    );

    // First, check if there are uncommitted changes - stash them if needed
    let changes = get_worktree_changes(&worktree_path_str)?;
    let had_uncommitted_changes = changes.has_uncommitted_changes;

    if had_uncommitted_changes {
        log::info!("Stashing uncommitted changes before rebase");
        let output = crate::shell_utils::new_command("git")
            .args(["stash", "push", "-m", "Auto-stash before sync"])
            .current_dir(&worktree_path)
            .output()
            .map_err(|e| format!("Failed to stash changes: {}", e))?;

        if !output.status.success() {
            log::warn!(
                "Failed to stash changes: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }
    }

    // Fetch latest from main repo to ensure we have the commits
    // The worktree shares the object store with main repo, so we need to reference the commit
    // Use origin/main or the main branch directly from the parent repo

    // Perform rebase onto main's HEAD
    let output = crate::shell_utils::new_command("git")
        .args(["rebase", &main_head])
        .current_dir(&worktree_path)
        .output()
        .map_err(|e| format!("Failed to rebase: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();

        // Check for conflicts
        if stderr.contains("CONFLICT") || stderr.contains("could not apply") {
            // Get list of conflicted files
            let conflict_output = crate::shell_utils::new_command("git")
                .args(["diff", "--name-only", "--diff-filter=U"])
                .current_dir(&worktree_path)
                .output()
                .ok();

            let conflicted_files = conflict_output
                .map(|o| {
                    String::from_utf8_lossy(&o.stdout)
                        .lines()
                        .map(|s| s.to_string())
                        .filter(|s| !s.is_empty())
                        .collect()
                })
                .unwrap_or_default();

            return Ok(SyncResult {
                success: false,
                synced_commit: None,
                has_conflicts: true,
                conflicted_files,
                message: "Rebase has conflicts. Please resolve manually or abort.".to_string(),
            });
        }

        // Abort the rebase if it failed for other reasons
        let _ = crate::shell_utils::new_command("git")
            .args(["rebase", "--abort"])
            .current_dir(&worktree_path)
            .output();

        return Err(format!("Rebase failed: {}", stderr));
    }

    // Pop stash if we had one
    if had_uncommitted_changes {
        log::info!("Restoring stashed changes after rebase");
        let output = crate::shell_utils::new_command("git")
            .args(["stash", "pop"])
            .current_dir(&worktree_path)
            .output();

        if let Ok(out) = output {
            if !out.status.success() {
                let stderr = String::from_utf8_lossy(&out.stderr);
                if stderr.contains("CONFLICT") {
                    // Get conflicted files from stash pop
                    let conflict_output = crate::shell_utils::new_command("git")
                        .args(["diff", "--name-only", "--diff-filter=U"])
                        .current_dir(&worktree_path)
                        .output()
                        .ok();

                    let conflicted_files = conflict_output
                        .map(|o| {
                            String::from_utf8_lossy(&o.stdout)
                                .lines()
                                .map(|s| s.to_string())
                                .filter(|s| !s.is_empty())
                                .collect()
                        })
                        .unwrap_or_default();

                    return Ok(SyncResult {
                        success: false,
                        synced_commit: None,
                        has_conflicts: true,
                        conflicted_files,
                        message:
                            "Rebase succeeded but stash pop has conflicts. Please resolve manually."
                                .to_string(),
                    });
                }
                log::warn!("Failed to pop stash: {}", stderr);
            }
        }
    }

    // Get new HEAD after rebase
    let new_head = crate::shell_utils::new_command("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(&worktree_path)
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string());

    log::info!(
        "Successfully synced worktree pool-{} to commit {:?}",
        pool_index,
        new_head
    );

    Ok(SyncResult {
        success: true,
        synced_commit: new_head,
        has_conflicts: false,
        conflicted_files: vec![],
        message: format!("Successfully synced with main branch ({})", &main_head[..8]),
    })
}

/// Abort an in-progress rebase in a worktree
pub fn abort_rebase(worktree_path: &str) -> Result<(), String> {
    if !Path::new(worktree_path).exists() {
        return Err(format!("Worktree path does not exist: {}", worktree_path));
    }

    let output = crate::shell_utils::new_command("git")
        .args(["rebase", "--abort"])
        .current_dir(worktree_path)
        .output()
        .map_err(|e| format!("Failed to abort rebase: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // It's okay if there's no rebase in progress
        if !stderr.contains("No rebase in progress") {
            return Err(format!("Failed to abort rebase: {}", stderr));
        }
    }

    log::info!("Rebase aborted for worktree {}", worktree_path);
    Ok(())
}

/// Continue a merge after conflicts are resolved
pub fn continue_merge(project_path: &str, message: Option<&str>) -> Result<MergeResult, String> {
    // Stage all resolved files
    let output = crate::shell_utils::new_command("git")
        .args(["add", "-A"])
        .current_dir(project_path)
        .output()
        .map_err(|e| format!("Failed to stage resolved files: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "Failed to stage resolved files: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    // Check if there are still conflicts
    let conflict_output = crate::shell_utils::new_command("git")
        .args(["diff", "--name-only", "--diff-filter=U"])
        .current_dir(project_path)
        .output()
        .map_err(|e| format!("Failed to check conflicts: {}", e))?;

    let remaining_conflicts: Vec<String> = String::from_utf8_lossy(&conflict_output.stdout)
        .lines()
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
        .collect();

    if !remaining_conflicts.is_empty() {
        return Ok(MergeResult {
            success: false,
            merged_commit: None,
            has_conflicts: true,
            conflicted_files: remaining_conflicts,
            message: "There are still unresolved conflicts".to_string(),
        });
    }

    // Complete the merge with commit
    let commit_msg = message.unwrap_or("Merge conflict resolved");
    let output = crate::shell_utils::new_command("git")
        .args(["commit", "-m", commit_msg])
        .current_dir(project_path)
        .output()
        .map_err(|e| format!("Failed to complete merge: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "Failed to complete merge: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    // Get the merge commit hash
    let repo =
        Repository::open(project_path).map_err(|e| format!("Failed to open repository: {}", e))?;

    let head_commit =
        get_head_commit(&repo).map_err(|e| format!("Failed to get merge commit: {}", e))?;

    log::info!("Merge continued and completed with commit {}", head_commit);

    Ok(MergeResult {
        success: true,
        merged_commit: Some(head_commit),
        has_conflicts: false,
        conflicted_files: vec![],
        message: "Merge completed successfully".to_string(),
    })
}

/// Clean up all worktrees for a project
pub fn cleanup_all_worktrees(
    project_path: &str,
    worktree_root: Option<&str>,
) -> Result<(), String> {
    log::info!("Cleaning up all worktrees for project {}", project_path);

    for pool_index in 0..MAX_POOL_SIZE {
        if let Err(e) = remove_worktree(project_path, pool_index, worktree_root) {
            log::warn!("Failed to remove worktree pool-{}: {}", pool_index, e);
            // Continue with other worktrees
        }
    }

    // Try to remove the pool directory if empty
    let pool_dir = get_pool_dir(project_path, worktree_root);
    if pool_dir.exists() {
        if let Ok(entries) = fs::read_dir(&pool_dir) {
            if entries.count() == 0 {
                let _ = fs::remove_dir(&pool_dir);
            }
        }
    }

    // Clear all task mappings for this project
    if let Ok(mut map) = WORKTREE_TASK_MAP.lock() {
        map.remove(project_path);
    }

    log::info!("Worktree cleanup completed for project {}", project_path);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn create_test_repo() -> TempDir {
        let temp_dir = TempDir::new().unwrap();
        crate::shell_utils::new_command("git")
            .args(["init"])
            .current_dir(temp_dir.path())
            .output()
            .expect("Failed to init git repo");

        crate::shell_utils::new_command("git")
            .args(["config", "user.email", "test@test.com"])
            .current_dir(temp_dir.path())
            .output()
            .unwrap();

        crate::shell_utils::new_command("git")
            .args(["config", "user.name", "Test User"])
            .current_dir(temp_dir.path())
            .output()
            .unwrap();

        // Create initial commit
        std::fs::write(temp_dir.path().join("README.md"), "# Test").unwrap();
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
    fn test_get_pool_dir() {
        let pool_dir = get_pool_dir("/home/user/projects/myapp", None);
        assert!(pool_dir.to_string_lossy().contains(".talkcody"));
        assert!(pool_dir.to_string_lossy().contains("myapp"));
    }

    #[test]
    fn test_get_branch_name() {
        assert_eq!(get_branch_name(0), "talkcody-pool-0");
        assert_eq!(get_branch_name(1), "talkcody-pool-1");
        assert_eq!(get_branch_name(2), "talkcody-pool-2");
    }

    #[test]
    fn test_acquire_and_release_worktree() {
        let temp_dir = create_test_repo();
        let project_path = temp_dir.path().to_string_lossy().to_string();

        // Acquire worktree
        let result = acquire_worktree(&project_path, 0, "task-123", false, None);
        assert!(result.is_ok(), "Failed to acquire worktree: {:?}", result);

        let info = result.unwrap();
        assert_eq!(info.pool_index, 0);
        assert!(info.in_use);
        assert_eq!(info.task_id, Some("task-123".to_string()));

        // Release worktree
        let release_result = release_worktree(&project_path, 0);
        assert!(release_result.is_ok());

        // Verify task_id is cleared
        assert!(get_task_id(&project_path, 0).is_none());

        // Clean up
        let _ = cleanup_all_worktrees(&project_path, None);
    }

    #[test]
    fn test_list_worktrees() {
        let temp_dir = create_test_repo();
        let project_path = temp_dir.path().to_string_lossy().to_string();

        // Initially no worktrees
        let status = list_worktrees(&project_path, None).unwrap();
        assert_eq!(status.worktrees.len(), 0);
        assert_eq!(status.in_use_count, 0);

        // Create a worktree
        let _ = acquire_worktree(&project_path, 0, "task-1", false, None);

        // Now should have one worktree
        let status = list_worktrees(&project_path, None).unwrap();
        assert_eq!(status.worktrees.len(), 1);
        assert_eq!(status.in_use_count, 1);

        // Clean up
        let _ = cleanup_all_worktrees(&project_path, None);
    }

    #[test]
    fn test_force_acquire_cleans_staged_new_files() {
        // This test verifies the fix for a bug where staged new files were not cleaned
        // when force-acquiring a worktree.
        //
        // The bug: If a new file was staged (git add), running `git clean -fd` first
        // wouldn't remove it (because it's not untracked), then `git reset --hard`
        // would unstage it (making it untracked), but clean had already run.
        //
        // The fix: Run `git reset --hard` first (to unstage), then `git clean -fd`
        // (to remove the now-untracked files).

        let temp_dir = create_test_repo();
        let project_path = temp_dir.path().to_string_lossy().to_string();

        // Step 1: Create and acquire a worktree
        let result = acquire_worktree(&project_path, 0, "task-1", false, None);
        assert!(result.is_ok(), "Failed to acquire worktree: {:?}", result);
        let worktree_info = result.unwrap();
        let worktree_path = &worktree_info.path;

        // Step 2: Create a new file in the worktree and stage it
        let new_file_path = Path::new(worktree_path).join("staged_new_file.txt");
        std::fs::write(&new_file_path, "This is a staged new file").unwrap();

        // Stage the new file with git add
        let output = crate::shell_utils::new_command("git")
            .args(["add", "staged_new_file.txt"])
            .current_dir(worktree_path)
            .output()
            .expect("Failed to stage file");
        assert!(output.status.success(), "Failed to stage file");

        // Verify the file is staged (should show as "A " in git status)
        let changes_count = count_worktree_changes(worktree_path);
        assert_eq!(changes_count, 1, "Should have 1 staged change");

        // Step 3: Release the worktree (simulates task completion)
        let release_result = release_worktree(&project_path, 0);
        assert!(release_result.is_ok());

        // Step 4: Try to acquire without force - should fail due to staged changes
        let result = acquire_worktree(&project_path, 0, "task-2", false, None);
        assert!(
            result.is_err(),
            "Should fail without force when there are staged changes"
        );
        let err = result.unwrap_err();
        assert!(
            err.contains("WORKTREE_HAS_CHANGES"),
            "Error should indicate worktree has changes: {}",
            err
        );

        // Step 5: Force acquire - should succeed and clean the staged file
        let result = acquire_worktree(&project_path, 0, "task-2", true, None);
        assert!(result.is_ok(), "Force acquire should succeed: {:?}", result);

        // Step 6: Verify the staged file was properly removed
        assert!(
            !new_file_path.exists(),
            "Staged new file should have been removed"
        );

        // Also verify changes_count is now 0
        let changes_count = count_worktree_changes(worktree_path);
        assert_eq!(
            changes_count, 0,
            "Worktree should have no changes after force acquire"
        );

        // Clean up
        let _ = cleanup_all_worktrees(&project_path, None);
    }

    #[test]
    fn test_force_acquire_cleans_modified_and_untracked_files() {
        // Test that force acquire also properly cleans:
        // - Modified tracked files
        // - Untracked files (not staged)
        // - Staged modifications to existing files

        let temp_dir = create_test_repo();
        let project_path = temp_dir.path().to_string_lossy().to_string();

        // Create and acquire a worktree
        let result = acquire_worktree(&project_path, 0, "task-1", false, None);
        assert!(result.is_ok());
        let worktree_info = result.unwrap();
        let worktree_path = &worktree_info.path;

        // Create various types of changes:

        // 1. Modify an existing tracked file (README.md)
        let readme_path = Path::new(worktree_path).join("README.md");
        std::fs::write(&readme_path, "Modified content").unwrap();

        // 2. Create an untracked file
        let untracked_path = Path::new(worktree_path).join("untracked.txt");
        std::fs::write(&untracked_path, "Untracked content").unwrap();

        // 3. Create and stage a new file
        let staged_path = Path::new(worktree_path).join("staged.txt");
        std::fs::write(&staged_path, "Staged content").unwrap();
        crate::shell_utils::new_command("git")
            .args(["add", "staged.txt"])
            .current_dir(worktree_path)
            .output()
            .unwrap();

        // Verify we have changes
        let changes_count = count_worktree_changes(worktree_path);
        assert!(
            changes_count >= 3,
            "Should have at least 3 changes, got {}",
            changes_count
        );

        // Release and force acquire
        release_worktree(&project_path, 0).unwrap();
        let result = acquire_worktree(&project_path, 0, "task-2", true, None);
        assert!(result.is_ok(), "Force acquire should succeed: {:?}", result);

        // Verify all changes are cleaned
        let changes_count = count_worktree_changes(worktree_path);
        assert_eq!(changes_count, 0, "All changes should be cleaned");

        // Verify files are in correct state
        let readme_content = std::fs::read_to_string(&readme_path).unwrap();
        assert_eq!(
            readme_content, "# Test",
            "README.md should be reset to original"
        );
        assert!(!untracked_path.exists(), "Untracked file should be removed");
        assert!(!staged_path.exists(), "Staged new file should be removed");

        // Clean up
        let _ = cleanup_all_worktrees(&project_path, None);
    }

    #[test]
    fn test_force_acquire_cleans_nested_git_repositories() {
        // Test that force acquire properly cleans directories containing nested .git repos.
        // This is common with CMake FetchContent dependencies that clone git repos.
        //
        // The fix: Use `git clean -ffd` (double f) instead of `git clean -fd`
        // to force removal of nested git repositories.

        let temp_dir = create_test_repo();
        let project_path = temp_dir.path().to_string_lossy().to_string();

        // Create and acquire a worktree
        let result = acquire_worktree(&project_path, 0, "task-1", false, None);
        assert!(result.is_ok());
        let worktree_info = result.unwrap();
        let worktree_path = &worktree_info.path;

        // Create a directory structure that simulates CMake FetchContent deps
        // with a nested .git directory
        let deps_dir = Path::new(worktree_path).join("_deps");
        let nested_repo_dir = deps_dir.join("some-lib-src");
        fs::create_dir_all(&nested_repo_dir).unwrap();

        // Initialize a nested git repository (simulating FetchContent clone)
        crate::shell_utils::new_command("git")
            .args(["init"])
            .current_dir(&nested_repo_dir)
            .output()
            .expect("Failed to init nested repo");

        // Create a file in the nested repo
        std::fs::write(nested_repo_dir.join("lib.c"), "// library code").unwrap();

        // Verify the nested .git exists
        assert!(
            nested_repo_dir.join(".git").exists(),
            "Nested .git should exist"
        );

        // Verify we have untracked changes (the _deps directory)
        let changes_count = count_worktree_changes(worktree_path);
        assert!(
            changes_count > 0,
            "Should have untracked changes from _deps"
        );

        // Release and force acquire
        release_worktree(&project_path, 0).unwrap();
        let result = acquire_worktree(&project_path, 0, "task-2", true, None);
        assert!(result.is_ok(), "Force acquire should succeed: {:?}", result);

        // Verify the nested git repository was properly removed
        assert!(
            !deps_dir.exists(),
            "_deps directory with nested .git should be removed"
        );

        // Verify changes_count is now 0
        let changes_count = count_worktree_changes(worktree_path);
        assert_eq!(
            changes_count, 0,
            "Worktree should have no changes after force acquire"
        );

        // Clean up
        let _ = cleanup_all_worktrees(&project_path, None);
    }

    #[test]
    fn test_merge_worktree_fast_forward() {
        // Test that merge uses fast-forward when possible (no merge commit created)
        let temp_dir = create_test_repo();
        let project_path = temp_dir.path().to_string_lossy().to_string();

        // Get the initial commit count on main
        let initial_commit_count = crate::shell_utils::new_command("git")
            .args(["rev-list", "--count", "HEAD"])
            .current_dir(&project_path)
            .output()
            .unwrap();
        let initial_count: i32 = String::from_utf8_lossy(&initial_commit_count.stdout)
            .trim()
            .parse()
            .unwrap();

        // Create and acquire a worktree
        let result = acquire_worktree(&project_path, 0, "task-1", false, None);
        assert!(result.is_ok(), "Failed to acquire worktree: {:?}", result);
        let worktree_info = result.unwrap();
        let worktree_path = &worktree_info.path;

        // Make changes in the worktree
        let new_file_path = Path::new(worktree_path).join("feature.txt");
        std::fs::write(&new_file_path, "New feature content").unwrap();

        // Commit the changes in the worktree
        crate::shell_utils::new_command("git")
            .args(["add", "."])
            .current_dir(worktree_path)
            .output()
            .unwrap();
        crate::shell_utils::new_command("git")
            .args(["commit", "-m", "feat: add new feature"])
            .current_dir(worktree_path)
            .output()
            .unwrap();

        // Merge worktree to main
        let merge_result = merge_worktree_to_main(&project_path, 0, None, None);
        assert!(
            merge_result.is_ok(),
            "Merge should succeed: {:?}",
            merge_result
        );
        let merge_result = merge_result.unwrap();
        assert!(merge_result.success, "Merge should be successful");
        assert!(!merge_result.has_conflicts, "Should have no conflicts");

        // Verify only one commit was added (fast-forward, no merge commit)
        let final_commit_count = crate::shell_utils::new_command("git")
            .args(["rev-list", "--count", "HEAD"])
            .current_dir(&project_path)
            .output()
            .unwrap();
        let final_count: i32 = String::from_utf8_lossy(&final_commit_count.stdout)
            .trim()
            .parse()
            .unwrap();

        assert_eq!(
            final_count,
            initial_count + 1,
            "Should have exactly 1 new commit (fast-forward), not 2 (with merge commit)"
        );

        // Verify the commit message is the feature commit, not a merge commit
        let last_commit_msg = crate::shell_utils::new_command("git")
            .args(["log", "-1", "--format=%s"])
            .current_dir(&project_path)
            .output()
            .unwrap();
        let commit_msg = String::from_utf8_lossy(&last_commit_msg.stdout)
            .trim()
            .to_string();
        assert_eq!(
            commit_msg, "feat: add new feature",
            "Last commit should be the feature commit, not a merge commit"
        );

        // Clean up
        let _ = cleanup_all_worktrees(&project_path, None);
    }

    #[test]
    fn test_merge_worktree_with_diverged_main() {
        // Test that merge creates a merge commit when main has diverged
        let temp_dir = create_test_repo();
        let project_path = temp_dir.path().to_string_lossy().to_string();

        // Create and acquire a worktree
        let result = acquire_worktree(&project_path, 0, "task-1", false, None);
        assert!(result.is_ok(), "Failed to acquire worktree: {:?}", result);
        let worktree_info = result.unwrap();
        let worktree_path = &worktree_info.path;

        // Make changes in the worktree
        let feature_file = Path::new(worktree_path).join("feature.txt");
        std::fs::write(&feature_file, "Feature content").unwrap();
        crate::shell_utils::new_command("git")
            .args(["add", "."])
            .current_dir(worktree_path)
            .output()
            .unwrap();
        crate::shell_utils::new_command("git")
            .args(["commit", "-m", "feat: add feature"])
            .current_dir(worktree_path)
            .output()
            .unwrap();

        // Make a commit on main (simulate another change)
        let main_file = Path::new(&project_path).join("main_change.txt");
        std::fs::write(&main_file, "Main branch change").unwrap();
        crate::shell_utils::new_command("git")
            .args(["add", "."])
            .current_dir(&project_path)
            .output()
            .unwrap();
        crate::shell_utils::new_command("git")
            .args(["commit", "-m", "chore: main branch change"])
            .current_dir(&project_path)
            .output()
            .unwrap();

        // Get commit count before merge
        let before_merge_count = crate::shell_utils::new_command("git")
            .args(["rev-list", "--count", "HEAD"])
            .current_dir(&project_path)
            .output()
            .unwrap();
        let before_count: i32 = String::from_utf8_lossy(&before_merge_count.stdout)
            .trim()
            .parse()
            .unwrap();

        // Merge worktree to main (should create merge commit since branches diverged)
        let merge_result = merge_worktree_to_main(&project_path, 0, None, None);
        assert!(
            merge_result.is_ok(),
            "Merge should succeed: {:?}",
            merge_result
        );
        let merge_result = merge_result.unwrap();
        assert!(merge_result.success, "Merge should be successful");

        // Verify a merge commit was created (2 commits added: feature + merge)
        let after_merge_count = crate::shell_utils::new_command("git")
            .args(["rev-list", "--count", "HEAD"])
            .current_dir(&project_path)
            .output()
            .unwrap();
        let after_count: i32 = String::from_utf8_lossy(&after_merge_count.stdout)
            .trim()
            .parse()
            .unwrap();

        assert_eq!(
            after_count,
            before_count + 2,
            "Should have 2 new commits (feature + merge commit) when branches diverged"
        );

        // Verify the last commit is a merge commit
        let last_commit_msg = crate::shell_utils::new_command("git")
            .args(["log", "-1", "--format=%s"])
            .current_dir(&project_path)
            .output()
            .unwrap();
        let commit_msg = String::from_utf8_lossy(&last_commit_msg.stdout)
            .trim()
            .to_string();
        assert!(
            commit_msg.contains("Merge"),
            "Last commit should be a merge commit, got: {}",
            commit_msg
        );

        // Clean up
        let _ = cleanup_all_worktrees(&project_path, None);
    }
}
