// Shell utility functions for cross-platform command execution

/// Windows flag to prevent console window from appearing when spawning processes.
/// This prevents flashing cmd.exe windows in GUI applications.
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Create a new `std::process::Command` with console window hidden on Windows.
///
/// On Windows, this sets the `CREATE_NO_WINDOW` creation flag to prevent
/// a console window from flashing when spawning child processes.
/// On other platforms, this is equivalent to `std::process::Command::new()`.
pub fn new_command(program: &str) -> std::process::Command {
    let mut cmd = std::process::Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Create a new `tokio::process::Command` with console window hidden on Windows.
///
/// On Windows, this sets the `CREATE_NO_WINDOW` creation flag to prevent
/// a console window from flashing when spawning child processes.
/// On other platforms, this is equivalent to `tokio::process::Command::new()`.
pub fn new_async_command(program: &str) -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new(program);
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Get the shell executable path for Windows, handling COMSPEC environment variable
/// with proper quote trimming
#[cfg(windows)]
pub fn get_windows_shell() -> String {
    let shell = std::env::var("COMSPEC")
        .map(|s| s.trim_matches('"').to_string())
        .unwrap_or_else(|_| "cmd.exe".to_string());

    // Validate shell path is not empty after trimming
    if shell.is_empty() {
        "cmd.exe".to_string()
    } else {
        shell
    }
}

/// Check if the shell is PowerShell
/// Available on all platforms for use in cross-platform code
pub fn is_powershell(shell: &str) -> bool {
    shell.to_lowercase().contains("powershell") || shell.to_lowercase().contains("pwsh")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(windows)]
    fn test_get_windows_shell_default() {
        // Save original COMSPEC
        let original = std::env::var("COMSPEC").ok();

        // Test with no COMSPEC set
        std::env::remove_var("COMSPEC");
        let shell = get_windows_shell();
        assert_eq!(shell, "cmd.exe");

        // Restore original
        if let Some(val) = original {
            std::env::set_var("COMSPEC", val);
        }
    }

    #[test]
    #[cfg(windows)]
    fn test_get_windows_shell_with_quotes() {
        // Save original COMSPEC
        let original = std::env::var("COMSPEC").ok();

        // Test with quoted path (common Windows issue)
        std::env::set_var("COMSPEC", "\"C:\\Windows\\System32\\cmd.exe\"");
        let shell = get_windows_shell();
        assert_eq!(shell, "C:\\Windows\\System32\\cmd.exe");
        assert!(!shell.contains('"'));

        // Restore original
        if let Some(val) = original {
            std::env::set_var("COMSPEC", val);
        } else {
            std::env::remove_var("COMSPEC");
        }
    }

    #[test]
    #[cfg(windows)]
    fn test_get_windows_shell_without_quotes() {
        // Save original COMSPEC
        let original = std::env::var("COMSPEC").ok();

        // Test with normal path
        std::env::set_var("COMSPEC", "C:\\Windows\\System32\\cmd.exe");
        let shell = get_windows_shell();
        assert_eq!(shell, "C:\\Windows\\System32\\cmd.exe");

        // Restore original
        if let Some(val) = original {
            std::env::set_var("COMSPEC", val);
        } else {
            std::env::remove_var("COMSPEC");
        }
    }

    #[test]
    #[cfg(windows)]
    fn test_get_windows_shell_empty_after_trim() {
        // Save original COMSPEC
        let original = std::env::var("COMSPEC").ok();

        // Test with just quotes (edge case)
        std::env::set_var("COMSPEC", "\"\"");
        let shell = get_windows_shell();
        assert_eq!(shell, "cmd.exe");

        // Restore original
        if let Some(val) = original {
            std::env::set_var("COMSPEC", val);
        } else {
            std::env::remove_var("COMSPEC");
        }
    }

    #[test]
    fn test_is_powershell() {
        assert!(is_powershell("powershell"));
        assert!(is_powershell("powershell.exe"));
        assert!(is_powershell(
            "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
        ));
        assert!(is_powershell("pwsh"));
        assert!(is_powershell("pwsh.exe"));
        assert!(is_powershell("PowerShell")); // case insensitive
        assert!(is_powershell("POWERSHELL")); // case insensitive

        assert!(!is_powershell("cmd.exe"));
        assert!(!is_powershell("bash"));
        assert!(!is_powershell("zsh"));
    }

    #[test]
    #[cfg(windows)]
    fn test_get_windows_shell_powershell() {
        // Save original COMSPEC
        let original = std::env::var("COMSPEC").ok();

        // Test with PowerShell path
        std::env::set_var(
            "COMSPEC",
            "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
        );
        let shell = get_windows_shell();
        assert!(is_powershell(&shell));

        // Restore original
        if let Some(val) = original {
            std::env::set_var("COMSPEC", val);
        } else {
            std::env::remove_var("COMSPEC");
        }
    }
}
