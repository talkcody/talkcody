# TalkCody Multi-Window Implementation Guide

## Overview

TalkCody supports VSCode-like multi-window functionality, allowing users to open multiple projects in different windows simultaneously.

## Core Features

### Implemented Features

1. **Multi-Window Management**
   - Each window can open a different project
   - Windows are fully isolated with independent file trees, open files, and state
   - Prevents the same project from opening in multiple windows (automatically focuses existing window)

2. **UI Entry Points**
   - Keyboard shortcut: `Cmd+Shift+N` (macOS) or `Ctrl+Shift+N` (Windows/Linux)
   - Project list: Each project card has a menu -> "Open in New Window"

3. **Window Restoration**
   - Automatically restores all windows opened before the app was closed on restart
   - Each window restores its opened project

4. **Resource Management**
   - Automatically cleans up file watchers when windows close
   - Each window has its own independent file watcher instance

## Architecture

### Backend (Rust/Tauri)

#### Files

- **`src-tauri/src/window_manager.rs`**: Core window management module
  - `WindowRegistry`: Registry managing state for all windows
  - `WindowState`: State structure for each window (project_id, root_path, file_watcher)
  - `WindowInfo`: Serializable window information for frontend
  - `create_window()`: Creates new window, automatically detects duplicates and focuses existing
  - `cleanup_all_watchers()`: Cleanup method for application exit
  - **Auto-cleanup mechanism**: Window close listener and stale data detection

#### Commands

The following Tauri commands are registered in `src-tauri/src/lib.rs`:

```rust
create_project_window       // Create project window
get_all_project_windows     // Get all windows
get_current_window_label    // Get current window label
check_project_window_exists // Check if project is already open
focus_project_window        // Focus specified window
close_project_window        // Close window
update_window_project       // Update window project info
start_window_file_watching  // Start window file watching
stop_window_file_watching   // Stop window file watching
```

#### Configuration

- **`src-tauri/tauri.conf.json`**:
  - Main window label set to "main"
  - Default window size: 1200x800
  - `withGlobalTauri` enabled

- **`src-tauri/Cargo.toml`**:
  - Added `cocoa` dependency (for macOS window focusing)

### Frontend (TypeScript/React)

#### Files

1. **Context & Hooks**
   - `src/contexts/window-context.tsx`: Window context providing window label information
   - `src/hooks/use-global-shortcuts.ts`: Global keyboard shortcut support (handles `newWindow` action)

2. **Services**
   - `src/services/window-manager-service.ts`: Window management service wrapping all window operations
   - `src/services/window-restore-service.ts`: Window restoration service handling state persistence and recovery

3. **State Management**
   - `src/lib/window-state-store.ts`: Window state persistence (using tauri-plugin-fs)
   - `src/stores/window-scoped-repository-store.tsx`: Window-scoped repository store

4. **Initialization**
   - `src/components/initialization-screen.tsx`: Initialization screen resolving new window state access issues

#### Modified Files

1. **`src/app.tsx`**
   - Integrates `WindowProvider` and `RepositoryStoreProvider`
   - Adds keyboard shortcut support via `useGlobalShortcuts`
   - Implements window restoration logic (after initialization completes)
   - Saves window state before closing

2. **`src/pages/projects-page.tsx`**
   - Project card has dropdown menu button
   - Implements "Open in New Window" functionality

## Usage Guide

### Creating a New Window

**Method 1: Using Keyboard Shortcut**
- macOS: `Cmd+Shift+N`
- Windows/Linux: `Ctrl+Shift+N`

**Method 2: From Project List**
1. Navigate to Projects view
2. Click the `⋮` menu button on the project card
3. Select "Open in New Window"

### Window Behavior

- **Duplicate Opening Detection**: If you try to open a project already open in another window, it will automatically focus that window instead of creating a new one
- **Independent State**: Each window has independent file tree, open files, conversation history, etc.
- **Auto Restore**: After app restart, all previously opened windows and projects are automatically restored

### Closing Windows

- Simply close the window directly
- Window state is automatically saved for next restoration

## API Usage Examples

### JavaScript/TypeScript

```typescript
import { WindowManagerService } from '@/services/window-manager-service';

// Create new window
const label = await WindowManagerService.createProjectWindow();

// Open project in new window
await WindowManagerService.openProjectInWindow(rootPath, projectId);

// Check if project is already open
const existingWindow = await WindowManagerService.checkProjectWindowExists(rootPath);

// Focus window
await WindowManagerService.focusWindow(windowLabel);

// Get all windows
const windows = await WindowManagerService.getAllWindows();

// Update window project info
await WindowManagerService.updateWindowProject(label, projectId, rootPath);

// Start/stop file watching
await WindowManagerService.startWindowFileWatching(windowLabel, path);
await WindowManagerService.stopWindowFileWatching(windowLabel);
```

### Rust

```rust
use window_manager::{WindowRegistry, create_window};

// Usage in Tauri command
#[tauri::command]
fn my_command(
    app_handle: AppHandle,
    state: State<AppState>,
) -> Result<String, String> {
    // Create new window
    let label = create_window(
        &app_handle,
        &state.window_registry,
        Some(project_id),
        Some(root_path)
    )?;

    Ok(label)
}
```

## Technical Details

### State Isolation

Each window achieves state isolation through:

1. **Zustand Store**: Uses `createStore` to create window-scoped stores
2. **React Context**: Provided to component tree via Context (`RepositoryStoreProvider`)
3. **Window Label**: Uses unique window label (e.g., `window-1234567890`) as identifier

### Initialization Mechanism

**Background**: Each new window is an independent JavaScript context with initialization race conditions

**Solution - Initialization Guard**:
```typescript
// Ensure all services are ready before rendering components
if (isInitializing || initError) {
  return <InitializationScreen error={initError} />;
}

return <MainContent ... />;
```

**Initialization Order**:
1. **InitializationManager**: Handles all critical store initialization
2. **Parallel initialization**: Non-critical services loaded in background
3. **Completion check**: Only finish initialization when all services are ready

**Key Advantages**:
- Deterministic initialization: No race conditions
- User-friendly experience: Shows clear loading state
- Error handling: Displays clear error message with Reload button on failure

### Window Lifecycle

```
Create → Initialize → Open Project → Use → Close → Cleanup Resources
  ↓         ↓            ↓           ↓      ↓           ↓
Register  Set State   Load Files   User    Save      Unregister
                                  Actions  State     Window
```

### Persistence Mechanism

- Uses `tauri-plugin-fs` to save window state to local file (`windows-state.json`)
- Stored content: window label, project ID, root path, position and size
- Automatically saves on window close, restores on startup

### Window Management Mechanism

**Background**: Window registry may retain stale data when windows close, causing subsequent operations to fail

**Solution - Dual Insurance Mechanism**:

1. **Active Cleanup (Window Close Listener)**:
```rust
// Automatically cleanup registry when window closes
window.on_window_event(move |event| {
    if let tauri::WindowEvent::Destroyed = event {
        window_registry.unregister_window(&label)?;
    }
});
```

2. **Passive Cleanup (Stale Data Detection)**:
```rust
if let Some(window) = app_handle.get_webview_window(&existing_label) {
    // Window exists, focus normally
    window.set_focus()?;
} else {
    // Window doesn't exist, cleanup stale data
    window_registry.unregister_window(&existing_label)?;
    // Continue creating new window
}
```

**Core Design Principles**:
- **Defensive Programming**: Don't trust external state, always verify resource validity
- **Auto Cleanup**: Use event listeners to prevent resource leaks
- **Fault Tolerance**: Even if active cleanup fails, passive cleanup handles the problem

## Testing Recommendations

### Functional Tests

1. **Basic Functionality**
   - [ ] Create new window via keyboard shortcut
   - [ ] Open project in new window from project card menu
   - [ ] Open multiple projects simultaneously (different windows)
   - [ ] Try to reopen the same project (should focus instead of creating new window)

2. **State Isolation**
   - [ ] Open file in Window A, Window B should not show it
   - [ ] Expand directory in Window A's file tree, Window B should not sync
   - [ ] Each window's conversation history is independent

3. **Initialization Validation**
   - [ ] New window briefly shows "Initializing TalkCody..."
   - [ ] New window Projects page data displays correctly
   - [ ] New window Settings API keys display correctly
   - [ ] New window Chat conversation history displays correctly
   - [ ] Quickly create 5 windows consecutively, all initialize correctly

4. **Window Cleanup Validation**
   - [ ] After closing window, reopen same project - system auto-cleans stale data
   - [ ] Expected log: "Window ... is in registry but doesn't exist, cleaning up"
   - [ ] After opening/closing multiple windows, registry remains consistent
   - [ ] Quickly close and reopen project (5 times), no errors occur

5. **Window Restoration**
   - [ ] Open multiple windows and projects
   - [ ] Close app normally (Cmd+Q)
   - [ ] Restart application
   - [ ] Verify all windows and projects are restored

6. **Resource Management**
   - [ ] After closing window, check logs confirm file watcher stopped
   - [ ] Open multiple windows, modify files in each, verify file watchers work independently

7. **Keyboard Shortcuts**
   - [ ] Cmd+Shift+N (macOS) creates new window
   - [ ] Ctrl+Shift+N (Windows/Linux) creates new window

### Edge Case Tests

1. **Error Handling**
   - [ ] Try to open non-existent project path
   - [ ] Behavior during network exceptions
   - [ ] Behavior when disk space is insufficient
   - [ ] Simulate initialization failure scenario (database connection lost)
   - [ ] Verify initialization failure shows error message and Reload button

2. **Initialization Race Condition Tests**
   - [ ] Quickly navigate to different pages (Projects → Settings → Chat) to test data access
   - [ ] Quick operations during initialization (clicking multiple buttons)
   - [ ] Verify initialization screen correctly blocks user operations

3. **Window Lifecycle Tests**
   - [ ] Create window → immediately close → immediately recreate (no delay)
   - [ ] Multiple windows close simultaneously, verify registry cleanup doesn't conflict
   - [ ] Recovery after abnormal close (force quit) then restart app

4. **Performance Tests**
   - [ ] Performance with 10+ windows open
   - [ ] Performance of each window opening large projects
   - [ ] Window restoration speed
   - [ ] Performance impact of large-scale stale data cleanup

5. **Resource Management Tests**
   - [ ] After closing window, check logs confirm file watcher stopped
   - [ ] Memory monitoring: memory properly released after opening/closing multiple windows
   - [ ] Concurrent file modification: multiple windows modify same project file simultaneously

## Important Fixes

### Fix 1: New Window Cannot Access Persisted State

**Problem**: New window shows "failed to load projects" error after opening, Settings page API keys all lost, Chat conversation history empty.

**Root Cause**:
- Each window is an independent JavaScript context
- Multiple independent async initializations have race conditions
- Components start accessing data before services finish initializing

**Solution**: Implement initialization guard
- Added `InitializationScreen` component showing loading state
- Unified all initialization logic using `initializationManager`
- Only render main content after all services are initialized

**Fix Result**:
- ✅ New window briefly shows "Initializing TalkCody..."
- ✅ After initialization completes, all data accessible normally
- ✅ Completely resolved race condition causing initialization failure

### Fix 2: Window Registry Stale Data Prevents Opening New Windows

**Problem**: After closing window, trying to reopen same project reports "Window not found: window-xxxx"

**Root Cause**:
- When window closes, registry window record wasn't cleaned up
- Subsequent operations think window still exists, try to focus non-existent window
- State sync issue: registry state inconsistent with actual window state

**Solution**:
- Stale data detection: Verify window actually exists before focusing
- Window close listener: Auto-cleanup registry when window destroyed
- WindowRegistry is cloneable: Use `Arc<Mutex<...>>` wrapper to support closures

**Defensive Programming Principles**:
- Don't trust state: Registry says window exists doesn't mean it actually exists
- Verify before use: Validate resource is actually usable before using it
- Auto cleanup: Use event listeners to auto-cleanup resources

**Fix Result**:
- ✅ Window close automatically cleans up registry
- ✅ Detects and cleans up historical stale data
- ✅ Users can normally reopen projects repeatedly
- ✅ Multi-window scenario works completely normally

## Known Limitations

1. **Single Instance Plugin**: Although multi-window is supported, it's still a single application instance
2. **Window Restoration Delay**: Window restoration starts immediately after main UI displays (when `isInitializing` becomes false)
3. **macOS Specific**: Window focusing uses macOS-specific API (cocoa)

## Troubleshooting

### Window Cannot Be Created

**Symptom**: Clicking "New Window" button has no response

**Solution**:
1. Check browser console for errors
2. Check Tauri logs: `~/Library/Logs/com.kangkaisen.talkcody/talkcody.log`
3. Confirm Rust backend commands are properly registered

### Window Restoration Fails

**Symptom**: Windows not restored after restart

**Solution**:
1. Check window state file: Look at `windows-state.json` in AppData directory
2. Confirm app was closed normally (use Cmd+Q instead of force quit)
3. Check logs for restoration errors

### New Window Shows "failed to load projects"

**Symptom**: New window's Projects page shows error, Settings API keys lost

**Diagnostic Steps**:
1. Check console for initialization errors
2. Check if network requests failed
3. Observe if "Initializing TalkCody..." shows too long

**Solution**:
1. Refresh new window (if initialization stuck)
2. Check Settings service initializes normally
3. Confirm all required services (Auth, Models, Agents) can initialize in parallel

### Window Registry Stale Data Error

**Symptom**: Error "Window not found: window-xxxx", cannot reopen closed project

**Diagnostic Steps**:
1. Check registry cleanup info in Tauri logs
2. Check if trying to reopen project immediately after closing window
3. Verify window close listener works properly

**Solution**:
1. System auto-cleans stale data, usually retrying solves it
2. If persistent, check window_manager.rs close listener logic
3. Confirm WindowRegistry correctly implements Clone trait

**Expected Log Behavior**:
```
[INFO] Project already open in window: window-1234, attempting to focus it
[WARN] Window window-1234 is in registry but doesn't exist, cleaning up
[INFO] Cleaned up stale window registration, will create new window
```

### Project Opens in Multiple Windows

**Symptom**: Same project opens in multiple windows instead of focusing existing window

**Solution**:
1. This is a bug, check `find_window_by_project` logic in `window_manager.rs`
2. Confirm backend window registry is properly maintained

## Future Improvements

1. **Cross-Window Communication**: Implement message passing between windows
2. **Window Layout**: Remember and restore window position and size
3. **Window Grouping**: Support window workspace or grouping functionality
4. **Better Window Management UI**: Display list of all open windows
5. **Drag & Drop Support**: Support dragging files/projects to windows

## Contributor Notes

When modifying multi-window functionality, please note:

1. **Keep Backend and Frontend in Sync**: Window state needs to be maintained on both Rust and TypeScript sides
2. **Test State Isolation**: Ensure state is completely isolated between windows
3. **Handle Window Close**: Always properly cleanup resources (file watcher, state, etc.)
4. **Update Documentation**: If API is modified, please update this document

## References

- [Tauri Multi-Window Documentation](https://tauri.app/v1/guides/features/multiwindow)
- [Zustand Documentation](https://zustand-demo.pmnd.rs/)
- [VSCode Window Restoration Behavior](https://code.visualstudio.com/docs/getstarted/settings#_window)
