// Shell utility functions for cross-platform command execution

/// Windows flag to prevent console window from appearing when spawning processes.
/// This prevents flashing cmd.exe windows in GUI applications.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Create a new `std::process::Command` with console window hidden on Windows.
///
/// On Windows, this sets the `CREATE_NO_WINDOW` creation flag to prevent
/// a console window from flashing when spawning child processes.
/// On other platforms, this is equivalent to `std::process::Command::new()`.
pub fn new_command(program: &str) -> std::process::Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut cmd = std::process::Command::new(program);
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new(program)
    }
}

/// Create a new `tokio::process::Command` with console window hidden on Windows.
///
/// On Windows, this sets the `CREATE_NO_WINDOW` creation flag to prevent
/// a console window from flashing when spawning child processes.
/// On other platforms, this is equivalent to `tokio::process::Command::new()`.
pub fn new_async_command(program: &str) -> tokio::process::Command {
    #[cfg(windows)]
    {
        let mut cmd = tokio::process::Command::new(program);
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd
    }
    #[cfg(not(windows))]
    {
        tokio::process::Command::new(program)
    }
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

    #[cfg(windows)]
    use std::sync::{Mutex, OnceLock};

    #[cfg(windows)]
    static COMSPEC_TEST_MUTEX: OnceLock<Mutex<()>> = OnceLock::new();

    #[cfg(windows)]
    struct ComspecGuard {
        original: Option<String>,
    }

    #[cfg(windows)]
    impl Drop for ComspecGuard {
        fn drop(&mut self) {
            if let Some(value) = self.original.as_deref() {
                std::env::set_var("COMSPEC", value);
            } else {
                std::env::remove_var("COMSPEC");
            }
        }
    }

    #[cfg(windows)]
    fn with_comspec<T>(value: Option<&str>, test: impl FnOnce() -> T) -> T {
        let _lock = COMSPEC_TEST_MUTEX
            .get_or_init(|| Mutex::new(()))
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let _guard = ComspecGuard {
            original: std::env::var("COMSPEC").ok(),
        };

        if let Some(value) = value {
            std::env::set_var("COMSPEC", value);
        } else {
            std::env::remove_var("COMSPEC");
        }

        test()
    }

    #[test]
    #[cfg(windows)]
    fn test_get_windows_shell_default() {
        with_comspec(None, || {
            let shell = get_windows_shell();
            assert_eq!(shell, "cmd.exe");
        });
    }

    #[test]
    #[cfg(windows)]
    fn test_get_windows_shell_with_quotes() {
        with_comspec(Some("\"C:\\Windows\\System32\\cmd.exe\""), || {
            let shell = get_windows_shell();
            assert_eq!(shell, "C:\\Windows\\System32\\cmd.exe");
            assert!(!shell.contains('"'));
        });
    }

    #[test]
    #[cfg(windows)]
    fn test_get_windows_shell_without_quotes() {
        with_comspec(Some("C:\\Windows\\System32\\cmd.exe"), || {
            let shell = get_windows_shell();
            assert_eq!(shell, "C:\\Windows\\System32\\cmd.exe");
        });
    }

    #[test]
    #[cfg(windows)]
    fn test_get_windows_shell_empty_after_trim() {
        with_comspec(Some("\"\""), || {
            let shell = get_windows_shell();
            assert_eq!(shell, "cmd.exe");
        });
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
        with_comspec(
            Some("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"),
            || {
                let shell = get_windows_shell();
                assert!(is_powershell(&shell));
            },
        );
    }
}
