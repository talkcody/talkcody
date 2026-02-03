import { invoke } from '@tauri-apps/api/core';
import { logger } from '@/lib/logger';

// Module-level state for new window flag
let isNewWindowFlag = false;
let isNewWindowFlagChecked = false;

// Check URL parameters to determine if this is a new window
function checkUrlForNewWindowFlag(): boolean {
  if (typeof window === 'undefined') return false;

  try {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('isNewWindow') === 'true';
  } catch (error) {
    logger.error('Failed to check URL for new window flag:', error);
    return false;
  }
}

export interface WindowInfo {
  label: string;
  project_id?: string;
  root_path?: string;
  title: string;
}

export class WindowManagerService {
  private constructor() {}

  /**
   * Create a new window for a project
   * If the project is already open in another window, focus that window instead
   */
  static async createProjectWindow(
    projectId?: string,
    rootPath?: string,
    isNewWindow?: boolean
  ): Promise<string> {
    try {
      const label = await invoke<string>('create_project_window', {
        projectId,
        rootPath,
        isNewWindow,
      });
      return label;
    } catch (error) {
      logger.error('Failed to create project window:', error);
      throw error;
    }
  }

  /**
   * Check if this window was just created as a new window
   * Should be called once on window startup to determine if auto-loading should be skipped
   *
   * NOTE: This function does NOT clear the flag. Call clearNewWindowFlag() after
   * successfully detecting a new window to prevent other checks from seeing it.
   */
  static async checkNewWindowFlag(): Promise<boolean> {
    // Check only once per window lifecycle
    if (!isNewWindowFlagChecked) {
      isNewWindowFlagChecked = true;
      isNewWindowFlag = checkUrlForNewWindowFlag();
      if (isNewWindowFlag) {
        logger.info('[WindowManager] Detected new window from URL parameter');
      }
    }
    return isNewWindowFlag;
  }

  /**
   * Clear the new window flag - call this AFTER you're done checking
   */
  static async clearNewWindowFlag(): Promise<void> {
    isNewWindowFlag = false;
  }

  /**
   * Get all open windows
   */
  static async getAllWindows(): Promise<WindowInfo[]> {
    try {
      const windows = await invoke<WindowInfo[]>('get_all_project_windows');
      return windows;
    } catch (error) {
      logger.error('Failed to get all windows:', error);
      return [];
    }
  }

  /**
   * Get current window label
   */
  static async getCurrentWindowLabel(): Promise<string> {
    try {
      const label = await invoke<string>('get_current_window_label');
      return label;
    } catch (error) {
      logger.error('Failed to get current window label:', error);
      return 'main';
    }
  }

  /**
   * Get window project information
   */
  static async getWindowInfo(): Promise<{ projectId?: string; rootPath?: string } | null> {
    try {
      const info = await invoke<[string, string] | null>('get_window_info');
      if (info) {
        return {
          projectId: info[0],
          rootPath: info[1],
        };
      }
      return null;
    } catch (error) {
      logger.error('Failed to get window info:', error);
      return null;
    }
  }

  /**
   * Check if a project is already open in a window
   * Returns the window label if found, null otherwise
   */
  static async checkProjectWindowExists(rootPath: string): Promise<string | null> {
    try {
      const label = await invoke<string | null>('check_project_window_exists', {
        rootPath,
      });
      return label;
    } catch (error) {
      logger.error('Failed to check project window:', error);
      return null;
    }
  }

  /**
   * Focus a window by label
   */
  static async focusWindow(label: string): Promise<void> {
    try {
      await invoke('focus_project_window', { label });
    } catch (error) {
      logger.error('Failed to focus window:', error);
      throw error;
    }
  }

  /**
   * Update window's project information
   */
  static async updateWindowProject(
    label: string,
    projectId?: string,
    rootPath?: string
  ): Promise<void> {
    try {
      await invoke('update_window_project', {
        label,
        projectId,
        rootPath,
      });
    } catch (error) {
      logger.error('Failed to update window project:', error);
      throw error;
    }
  }

  /**
   * Start file watching for a window
   */
  static async startWindowFileWatching(windowLabel: string, path: string): Promise<void> {
    try {
      await invoke('start_window_file_watching', {
        windowLabel,
        path,
      });
    } catch (error) {
      logger.error('Failed to start window file watching:', error);
      throw error;
    }
  }

  /**
   * Stop file watching for a window
   */
  static async stopWindowFileWatching(windowLabel: string): Promise<void> {
    try {
      await invoke('stop_window_file_watching', {
        windowLabel,
      });
    } catch (error) {
      logger.error('Failed to stop window file watching:', error);
      throw error;
    }
  }

  /**
   * Open a project in a new window or focus existing window if already open
   */
  static async openProjectInWindow(
    rootPath: string,
    projectId?: string,
    forceNew: boolean = false,
    suppressFocus: boolean = false
  ): Promise<string> {
    // Check if project is already open
    if (!forceNew) {
      const existingLabel = await WindowManagerService.checkProjectWindowExists(rootPath);
      if (existingLabel) {
        // Skip focusing during restore to prevent focus flicker
        if (!suppressFocus) {
          await WindowManagerService.focusWindow(existingLabel);
        }
        return existingLabel;
      }
    }

    // Create new window with provided isNewWindow flag (defaults to false if reused, but openProjectInWindow typically implies isNewWindow behavior when creating)
    const label = await WindowManagerService.createProjectWindow(projectId, rootPath, forceNew);
    return label;
  }
}
