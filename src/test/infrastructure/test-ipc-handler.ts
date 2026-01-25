/**
 * Test IPC Handler
 *
 * Unified entry point for mocking Tauri IPC calls.
 * Uses @tauri-apps/api/mocks to intercept invoke() calls and route them to appropriate adapters.
 */

import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { type DatabaseConfig, TestDatabaseAdapter } from './adapters/test-database-adapter';
import { type FileSystemConfig, TestFileSystemAdapter } from './adapters/test-file-system-adapter';
import { type ShellConfig, TestShellAdapter } from './adapters/test-shell-adapter';

export interface TestEnvironmentConfig {
  /** Database configuration */
  database?: DatabaseConfig;
  /** File system configuration */
  fileSystem?: FileSystemConfig;
  /** Shell command configuration */
  shell?: ShellConfig;
  /** Enable debug logging */
  debug?: boolean;
}

export type IPCCommandHandler = (cmd: string, args: unknown) => unknown;

export class TestIPCHandler {
  private dbAdapter: TestDatabaseAdapter;
  private fsAdapter: TestFileSystemAdapter;
  private shellAdapter: TestShellAdapter;
  private debug: boolean;
  private customHandlers: Map<string, IPCCommandHandler>;

  constructor(config: TestEnvironmentConfig = {}) {
    this.debug = config.debug ?? false;
    this.customHandlers = new Map();

    // Initialize adapters
    this.dbAdapter = new TestDatabaseAdapter(config.database);
    this.fsAdapter = new TestFileSystemAdapter(config.fileSystem);
    this.shellAdapter = new TestShellAdapter(config.shell);
  }

  /**
   * Set up mockIPC to intercept all invoke() calls
   */
  setup(): void {
    mockIPC((cmd, args) => {
      return this.handleCommand(cmd, args as Record<string, unknown>);
    });

    if (this.debug) {
      console.log('[TestIPCHandler] Setup complete');
    }
  }

  /**
   * Clean up and restore original IPC behavior
   */
  teardown(): void {
    clearMocks();
    this.dbAdapter.close();
    this.fsAdapter.cleanup();

    if (this.debug) {
      console.log('[TestIPCHandler] Teardown complete');
    }
  }

  /**
   * Register a custom handler for a specific command
   */
  registerHandler(cmd: string, handler: IPCCommandHandler): void {
    this.customHandlers.set(cmd, handler);
  }

  /**
   * Remove a custom handler
   */
  removeHandler(cmd: string): void {
    this.customHandlers.delete(cmd);
  }

  /**
   * Get the database adapter for direct access
   */
  getDatabase(): TestDatabaseAdapter {
    return this.dbAdapter;
  }

  /**
   * Get the file system adapter for direct access
   */
  getFileSystem(): TestFileSystemAdapter {
    return this.fsAdapter;
  }

  /**
   * Get the shell adapter for direct access
   */
  getShell(): TestShellAdapter {
    return this.shellAdapter;
  }

  /**
   * Route IPC commands to appropriate handlers
   */
  private handleCommand(cmd: string, args: Record<string, unknown>): unknown {
    if (this.debug) {
      console.log('[IPC]', cmd, JSON.stringify(args).slice(0, 200));
    }

    // Check for custom handlers first
    if (this.customHandlers.has(cmd)) {
      return this.customHandlers.get(cmd)!(cmd, args);
    }

    // Database commands
    if (cmd === 'db_connect') {
      return this.dbAdapter.connect();
    }
    if (cmd === 'db_execute') {
      return this.dbAdapter.execute(args as { sql: string; params?: unknown[] });
    }
    if (cmd === 'db_query') {
      return this.dbAdapter.query(args as { sql: string; params?: unknown[] });
    }
    if (cmd === 'db_batch') {
      return this.dbAdapter.batch(args as { statements: Array<[string, unknown[]]> });
    }

    // File search commands
    if (cmd === 'search_files_fast') {
      return this.fsAdapter.searchFiles(
        args as { query: string; rootPath: string; maxResults?: number }
      );
    }
    if (cmd === 'search_file_content') {
      return this.fsAdapter.searchContent(
        args as { query: string; rootPath: string; fileTypes?: string[]; excludeDirs?: string[] }
      );
    }

    // Shell command
    if (cmd === 'execute_user_shell') {
      return this.shellAdapter.execute(
        args as { command: string; cwd?: string; timeoutMs?: number }
      );
    }

    // Git commands (often called via invoke)
    if (cmd === 'git_get_status') {
      return this.handleGitStatus(args);
    }
    if (cmd === 'git_is_repository') {
      return this.handleGitIsRepository(args);
    }

    // File watching (no-op in tests)
    if (cmd === 'start_file_watching' || cmd === 'stop_file_watching') {
      return null;
    }
    if (cmd === 'start_window_file_watching' || cmd === 'stop_window_file_watching') {
      return null;
    }

    // Window management (no-op in tests)
    if (cmd === 'get_current_window_label') {
      return 'main';
    }
    if (cmd === 'create_project_window' || cmd === 'focus_project_window') {
      return null;
    }
    if (cmd === 'get_all_project_windows') {
      return [];
    }
    if (cmd === 'check_project_window_exists') {
      return false;
    }

    // Code navigation (return empty results)
    if (cmd.startsWith('code_nav_')) {
      return this.handleCodeNavigation(cmd, args);
    }

    // Directory tree (return empty)
    if (cmd === 'build_directory_tree' || cmd === 'load_directory_children') {
      return { children: [] };
    }
    if (cmd === 'clear_directory_cache' || cmd === 'invalidate_directory_path') {
      return null;
    }

    // Glob search
    if (cmd === 'search_files_by_glob') {
      return [];
    }

    // List files
    if (cmd === 'list_project_files') {
      return [];
    }

    // PTY commands (return mock responses)
    if (cmd === 'pty_spawn') {
      return { pty_id: `test-pty-${Date.now()}` };
    }
    if (cmd === 'pty_write' || cmd === 'pty_resize' || cmd === 'pty_kill') {
      return null;
    }

    // Network proxy (return empty response)
    if (cmd === 'proxy_fetch') {
      return { status: 200, headers: {}, body: '' };
    }

    // Skill commands
    if (cmd === 'create_skill_tarball' || cmd === 'extract_skill_tarball') {
      return null;
    }

    // Lint commands
    if (cmd === 'run_lint') {
      return { diagnostics: [] };
    }
    if (cmd === 'check_lint_runtime') {
      return true;
    }

    // Default: log warning and return null
    if (this.debug) {
      console.warn('[IPC] Unhandled command:', cmd);
    }
    return null;
  }

  /**
   * Handle git_get_status command
   */
  private handleGitStatus(_args: Record<string, unknown>): unknown {
    return {
      branch: 'main',
      is_clean: true,
      staged: [],
      unstaged: [],
      untracked: [],
    };
  }

  /**
   * Handle git_is_repository command
   */
  private handleGitIsRepository(_args: Record<string, unknown>): boolean {
    return true;
  }

  /**
   * Handle code navigation commands
   */
  private handleCodeNavigation(cmd: string, _args: Record<string, unknown>): unknown {
    if (cmd === 'code_nav_find_definition') {
      return [];
    }
    if (cmd === 'code_nav_find_references_hybrid') {
      return [];
    }
    if (cmd === 'code_nav_get_indexed_files') {
      return [];
    }
    if (cmd === 'code_nav_get_index_metadata') {
      return null;
    }
    // For index/clear/save/load commands
    return null;
  }
}
