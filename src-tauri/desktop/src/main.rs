// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Fix PATH environment variable for GUI apps
    // This ensures user's shell config (e.g., ~/.zshrc) is loaded
    let _ = fix_path_env::fix();

    let args: Vec<String> = std::env::args().collect();
    if talkcody_desktop_lib::scheduled_tasks::is_runner_mode(&args) {
        // Run as a headless scheduled-task runner — NO GUI window, NO Dock icon.
        talkcody_desktop_lib::scheduled_tasks::run_headless_runner();
    } else {
        talkcody_desktop_lib::run()
    }
}
