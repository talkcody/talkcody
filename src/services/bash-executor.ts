import { invoke } from '@tauri-apps/api/core';
import { isAbsolute, join } from '@tauri-apps/api/path';
import { logger } from '@/lib/logger';
import { isPathWithinProjectDirectory } from '@/lib/utils/path-security';
import { taskFileService } from '@/services/task-file-service';
import { getEffectiveWorkspaceRoot } from '@/services/workspace-root-service';

// Result from Rust backend execute_user_shell command
interface TauriShellResult {
  stdout: string;
  stderr: string;
  code: number;
  timed_out: boolean;
  idle_timed_out: boolean;
  pid: number | null;
}

// Result from Rust backend search_files_by_glob command
interface GlobResult {
  path: string;
  /** Canonical (resolved) path - resolves symlinks to their real location */
  canonical_path: string;
  is_directory: boolean;
  modified_time: number;
}

export interface BashResult {
  success: boolean;
  message: string;
  command: string;
  output?: string;
  error?: string;
  outputFilePath?: string;
  errorFilePath?: string;
  outputTruncated?: boolean;
  errorTruncated?: boolean;
  exit_code?: number;
  timed_out?: boolean;
  idle_timed_out?: boolean;
  pid?: number | null;
  taskId?: string; // Background task ID if running in background
  isBackground?: boolean; // Whether command is running in background
}

// Commands where output IS the result - need full output (max 10000 chars)
const OUTPUT_IS_RESULT_PATTERNS = [
  /^git\s+(status|log|diff|show|branch|remote|config|rev-parse|ls-files|blame|describe|tag)/,
  /^(ls|dir|find|tree|exa|lsd)\b/,
  /^(cat|head|tail|grep|rg|ag|ack|sed|awk)\b/,
  /^(curl|wget|http|httpie)\b/,
  /^(echo|printf)\b/,
  /^(pwd|whoami|hostname|uname|id|groups)\b/,
  /^(env|printenv|set)\b/,
  /^(which|where|type|command)\b/,
  /^(jq|yq|xq)\b/, // JSON/YAML processors
  /^(wc|sort|uniq|cut|tr|column)\b/, // Text processing
  /^(date|cal|uptime)\b/,
  /^(df|du|free|top|ps|lsof)\b/, // System info
  /^(npm\s+(list|ls|outdated|view|info|search))\b/,
  /^(yarn\s+(list|info|why))\b/,
  /^(bun\s+(pm\s+ls|pm\s+cache))\b/,
  /^(cargo\s+(tree|metadata|search))\b/,
  /^(pip\s+(list|show|freeze))\b/,
  /^(docker\s+(ps|images|inspect|logs))\b/,
];

// Build/test commands - minimal output on success
const BUILD_TEST_PATTERNS = [
  /^(npm|yarn|pnpm|bun)\s+(run\s+)?(test|build|lint|check|typecheck|tsc|compile)/,
  /^(cargo|rustc)\s+(test|build|check|clippy)/,
  /^(go)\s+(test|build|vet)/,
  /^(pytest|jest|vitest|mocha|ava|tap)\b/,
  /^(make|cmake|ninja)\b/,
  /^(tsc|eslint|prettier|biome)\b/,
  /^(gradle|mvn|ant)\b/,
  /^(dotnet)\s+(build|test|run)/,
];

type OutputStrategy = 'full' | 'minimal' | 'default';

const MAX_OUTPUT_CHARS = 10000;
const MAX_ERROR_CHARS = 10000;
const MAX_FAILURE_STDOUT_CHARS = 5000;

/**
 * Determine output strategy based on command type
 */
function getOutputStrategy(command: string): OutputStrategy {
  const trimmedCommand = command.trim();

  if (OUTPUT_IS_RESULT_PATTERNS.some((re) => re.test(trimmedCommand))) {
    return 'full';
  }
  if (BUILD_TEST_PATTERNS.some((re) => re.test(trimmedCommand))) {
    return 'minimal';
  }
  return 'default';
}

// List of dangerous command patterns that should be blocked
// Note: rm -rf is NOT blocked here - it's validated by validateRmCommand() which checks:
// 1. Workspace root exists
// 2. Directory is inside a Git repository
// 3. All target paths are within workspace
// Note: rm with wildcards is now handled by validateWildcardRmCommand() which:
// 1. Expands wildcards using Rust backend glob
// 2. Validates all expanded paths are within workspace
const DANGEROUS_PATTERNS = [
  // File system destruction - rm patterns that are always dangerous
  /\brm\b.*\s\.(?:\/)?(?:\s|$)/i, // rm . or rm -rf . (current directory)
  /rmdir\s+.*-.*r/i, // rmdir with recursive

  // Other file deletion commands
  /\bunlink\s+/i,
  /\bshred\s+/i,
  /\btruncate\s+.*-[sS]\s*0/i, // truncate to zero (case-insensitive -s flag)

  // find + delete combinations
  /\bfind\s+.*-[dD][eE][lL][eE][tT][eE]/i,
  /\bfind\s+.*-[eE][xX][eE][cC]\s+rm/i,
  /\bfind\s+.*\|\s*xargs\s+rm/i,

  // File content clearing
  /^>\s*\S+/i, // > file (clear file)
  /cat\s+\/dev\/null\s*>/i, // cat /dev/null > file

  // Git dangerous operations
  /\bgit\s+clean\s+-[fdFD]/i,
  /\bgit\s+reset\s+--hard/i,

  // mv to dangerous locations
  /\bmv\s+.*\/dev\/null/i,

  // Format commands (disk formatting, not code formatters)
  /mkfs\./i,
  /\bformat\s+[a-zA-Z]:/i, // Windows format drive command (format C:, format D:, etc.)
  /fdisk/i,
  /parted/i,
  /gparted/i,

  // System control
  /shutdown/i,
  /reboot/i,
  /halt/i,
  /poweroff/i,
  /init\s+[016]/i,

  // Dangerous dd operations
  /dd\s+.*of=\/dev/i,

  // Permission changes that could be dangerous
  /chmod\s+.*777\s+\//i,
  /chmod\s+.*-[rR].*777/i,
  /chown\s+.*-[rR].*root/i,

  // Network and system modification
  /iptables/i,
  /ufw\s+.*disable/i,
  /systemctl\s+.*stop/i,
  /service\s+.*stop/i,

  // Package managers with dangerous operations
  /apt\s+.*purge/i,
  /yum\s+.*remove/i,
  /brew\s+.*uninstall.*--force/i,

  // Disk operations
  /mount\s+.*\/dev/i,
  /umount\s+.*-[fF]/i,
  /fsck\s+.*-[yY]/i,

  // Process killing
  /killall\s+.*-9/i,
  /pkill\s+.*-9.*init/i,

  // Cron modifications
  /crontab\s+.*-[rR]/i,

  // History manipulation
  /history\s+.*-[cC]/i,
  />\s*~\/\.bash_history/i,

  // Dangerous redirections
  />\s*\/dev\/sd[a-z]/i,
  />\s*\/dev\/nvme/i,
  />\s*\/etc\//i,

  // Kernel and system files
  /modprobe\s+.*-[rR]/i,
  /insmod/i,
  /rmmod/i,

  // Dangerous curl/wget operations
  /curl\s+.*\|\s*(sh|bash|zsh)/i,
  /wget\s+.*-[oO].*\|\s*(sh|bash|zsh)/i,
];

// Additional dangerous commands (exact matches)
const DANGEROUS_COMMANDS = [
  'dd',
  'mkfs',
  'fdisk',
  'parted',
  'gparted',
  'shutdown',
  'reboot',
  'halt',
  'poweroff',
  'su',
  'sudo su',
  'unlink',
  'shred',
  'truncate',
];

/**
 * BashExecutor - handles bash command execution with safety checks
 */
export class BashExecutor {
  private readonly logger = logger;

  /**
   * Extract command parts excluding heredoc content
   * Heredoc syntax: << DELIMITER or <<- DELIMITER or << 'DELIMITER' or << "DELIMITER"
   * Content between << DELIMITER and DELIMITER should not be checked as commands
   * But commands AFTER the heredoc delimiter MUST be checked
   *
   * For <<- (indented heredoc), the closing delimiter can have leading tabs
   */
  private extractCommandExcludingHeredocContent(command: string): string {
    // Match heredoc start: << or <<- followed by optional quotes and delimiter
    const heredocMatch = command.match(/(<<-?)\s*['"]?(\w+)['"]?/);
    if (!heredocMatch) {
      return command;
    }

    const heredocOperator = heredocMatch[1] ?? '';
    const delimiter = heredocMatch[2] ?? '';
    const heredocStartIndex = command.indexOf(heredocOperator);
    const isIndented = heredocOperator === '<<-';

    // Get the part before heredoc
    const beforeHeredoc = command.slice(0, heredocStartIndex);

    // Find the end of heredoc (delimiter on its own line)
    // For <<- heredocs, the delimiter can have leading tabs
    // Handle both LF and CRLF line endings
    const afterHeredocStart = command.slice(heredocStartIndex + heredocMatch[0].length);
    const delimiterPattern = new RegExp(
      `\\r?\\n${isIndented ? '\\t*' : ''}${delimiter}\\s*(?:\\r?\\n|$)`
    );
    const delimiterMatch = afterHeredocStart.match(delimiterPattern);

    if (!delimiterMatch || delimiterMatch.index === undefined) {
      // No closing delimiter found, only check the part before heredoc
      return beforeHeredoc;
    }

    // Get commands after the heredoc delimiter
    const afterHeredoc = afterHeredocStart.slice(delimiterMatch.index + delimiterMatch[0].length);

    // Recursively process in case there are more heredocs
    const processedAfter = this.extractCommandExcludingHeredocContent(afterHeredoc);

    return `${beforeHeredoc} ${processedAfter}`;
  }

  /**
   * Check if a command is dangerous
   */
  private isDangerousCommand(command: string): {
    dangerous: boolean;
    reason?: string;
  } {
    // Extract command excluding heredoc content - heredoc content should not be checked
    // but commands after heredoc must still be checked
    const commandToCheck = this.extractCommandExcludingHeredocContent(command);
    const lowerCommand = commandToCheck.toLowerCase();
    const trimmedCommand = lowerCommand.trim();

    // Check for exact dangerous commands
    for (const dangerousCmd of DANGEROUS_COMMANDS) {
      if (trimmedCommand.startsWith(`${dangerousCmd} `) || trimmedCommand === dangerousCmd) {
        return {
          dangerous: true,
          reason: `Command "${dangerousCmd}" is not allowed for security reasons`,
        };
      }
    }

    // Check for dangerous patterns (patterns are case-insensitive)
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(commandToCheck)) {
        return {
          dangerous: true,
          reason: 'Command matches dangerous pattern and is not allowed for security reasons',
        };
      }
    }

    // Check for multiple command chaining with dangerous commands
    // Only split on actual command separators: && || ;
    // Don't split on single | as it's used in sed patterns and pipes
    // Use commandToCheck to avoid splitting heredoc content
    if (
      commandToCheck.includes('&&') ||
      commandToCheck.includes('||') ||
      commandToCheck.includes(';')
    ) {
      const parts = commandToCheck.split(/\s*(?:&&|\|\||;)\s*/);
      for (const part of parts) {
        const partCheck = this.isDangerousCommand(part.trim());
        if (partCheck.dangerous) {
          return partCheck;
        }
      }
    }

    return { dangerous: false };
  }

  /**
   * Extract paths from rm command
   * Returns an array of paths that the rm command targets
   */
  private extractRmPaths(command: string): string[] {
    // Match rm command with optional flags (case-insensitive)
    // rm [-options] path1 [path2 ...]
    const rmMatch = command.match(/\brm\s+(.+)/i);
    if (!rmMatch) {
      return [];
    }

    const args = rmMatch[1] ?? '';
    const paths: string[] = [];

    // Split by spaces, but respect quoted strings
    const parts = args.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];

    for (const part of parts) {
      // Skip flags (start with -)
      if (part.startsWith('-')) {
        continue;
      }
      // Remove surrounding quotes if present
      const cleanPath = part.replace(/^["']|["']$/g, '');
      if (cleanPath) {
        paths.push(cleanPath);
      }
    }

    return paths;
  }

  /**
   * Check if a path is within the workspace directory
   */
  private async isPathWithinWorkspace(targetPath: string, workspaceRoot: string): Promise<boolean> {
    // Block tilde paths to prevent shell expansion escaping workspace
    // The shell expands ~ to the user's home directory, which is outside workspace
    if (targetPath.startsWith('~')) {
      return false;
    }

    // If the path is relative, it's relative to the workspace
    const isAbs = await isAbsolute(targetPath);
    if (!isAbs) {
      // Relative paths are allowed, but we need to resolve them first to check for ../ escapes
      const resolvedPath = await join(workspaceRoot, targetPath);
      return await isPathWithinProjectDirectory(resolvedPath, workspaceRoot);
    }

    // Check if the absolute path is within the workspace
    return await isPathWithinProjectDirectory(targetPath, workspaceRoot);
  }

  /**
   * Extract wildcard patterns from rm command arguments
   * Separates wildcards from explicit paths and flags
   */
  private extractWildcardPatterns(command: string): {
    wildcardPaths: string[];
    explicitPaths: string[];
    flags: string[];
    hasWildcards: boolean;
  } {
    // Match rm command with optional flags (case-insensitive)
    const rmMatch = command.match(/\brm\s+(.+)/i);
    if (!rmMatch) {
      return { wildcardPaths: [], explicitPaths: [], flags: [], hasWildcards: false };
    }

    const args = rmMatch[1] ?? '';
    const parts = args.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];

    const wildcardPaths: string[] = [];
    const explicitPaths: string[] = [];
    const flags: string[] = [];

    for (const part of parts) {
      if (part.startsWith('-')) {
        flags.push(part);
        continue;
      }

      const cleanPath = part.replace(/^["']|["']$/g, '');
      if (!cleanPath) continue;

      // Check for wildcard characters: *, ?, [, {
      if (/[*?[{]/.test(cleanPath)) {
        wildcardPaths.push(cleanPath);
      } else {
        explicitPaths.push(cleanPath);
      }
    }

    return {
      wildcardPaths,
      explicitPaths,
      flags,
      hasWildcards: wildcardPaths.length > 0,
    };
  }

  /**
   * Get the base path before wildcard characters
   * "../src/*.ts" -> "../src"
   * "*.ts" -> null (pattern starts with wildcard)
   * "/abs/path/**\/*.js" -> "/abs/path"
   */
  private getPatternBasePath(pattern: string): string | null {
    const wildcardIndex = pattern.search(/[*?[{]/);
    if (wildcardIndex === -1) return pattern;
    if (wildcardIndex === 0) return null;

    // Find the last directory separator before the wildcard
    const beforeWildcard = pattern.substring(0, wildcardIndex);
    const lastSep = Math.max(beforeWildcard.lastIndexOf('/'), beforeWildcard.lastIndexOf('\\'));

    // Handle root directory case: /* -> /
    if (lastSep === 0 && pattern.startsWith('/')) {
      return '/';
    }

    return lastSep > 0 ? beforeWildcard.substring(0, lastSep) : null;
  }

  /**
   * Expand wildcard patterns to actual file paths using Rust backend
   * Returns canonical (resolved) paths to prevent symlink attacks
   * Throws on error to fail closed (security principle)
   */
  private async expandWildcards(pattern: string, workspaceRoot: string): Promise<string[]> {
    const results = await invoke<GlobResult[]>('search_files_by_glob', {
      pattern,
      path: workspaceRoot,
      maxResults: 10000, // Safety limit
    });

    // Use canonical_path (resolved symlinks) for security validation
    // This prevents symlink attacks where a symlink inside workspace points to external files
    return results.map((r) => r.canonical_path);
  }

  /**
   * Validate rm command with wildcards
   * Expands wildcards and validates all resulting paths are within workspace
   */
  private async validateWildcardRmCommand(
    command: string,
    workspaceRoot: string
  ): Promise<{ allowed: boolean; reason?: string }> {
    const extracted = this.extractWildcardPatterns(command);

    if (!extracted.hasWildcards) {
      return { allowed: true }; // No wildcards, use existing validation
    }

    // Validate that wildcard patterns themselves don't escape workspace
    for (const pattern of extracted.wildcardPaths) {
      // Check for path traversal BEFORE the wildcard
      // e.g., "../../*.txt" or "/tmp/../home/*"
      const basePath = this.getPatternBasePath(pattern);
      if (basePath) {
        const isWithin = await this.isPathWithinWorkspace(basePath, workspaceRoot);
        if (!isWithin) {
          return {
            allowed: false,
            reason: `rm command blocked: wildcard pattern "${pattern}" references path outside workspace`,
          };
        }
      }
    }

    // Expand all wildcards and validate each expanded path
    for (const pattern of extracted.wildcardPaths) {
      // Resolve relative patterns against workspace root
      const isAbs = await isAbsolute(pattern);
      const fullPattern = isAbs ? pattern : await join(workspaceRoot, pattern);

      let expandedPaths: string[];
      try {
        expandedPaths = await this.expandWildcards(fullPattern, workspaceRoot);
      } catch {
        // Fail closed: if we can't expand the wildcard safely, block the command
        return {
          allowed: false,
          reason: `rm command blocked: failed to expand wildcard "${pattern}" safely`,
        };
      }

      // If pattern matches nothing, that's fine - no files to delete
      if (expandedPaths.length === 0) {
        continue;
      }

      // Validate EACH expanded path
      for (const expandedPath of expandedPaths) {
        const isWithin = await this.isPathWithinWorkspace(expandedPath, workspaceRoot);
        if (!isWithin) {
          return {
            allowed: false,
            reason: `rm command blocked: wildcard "${pattern}" would match "${expandedPath}" which is outside workspace`,
          };
        }
      }
    }

    // Also validate explicit paths
    for (const explicitPath of extracted.explicitPaths) {
      const isWithin = await this.isPathWithinWorkspace(explicitPath, workspaceRoot);
      if (!isWithin) {
        return {
          allowed: false,
          reason: `rm command blocked: path "${explicitPath}" is outside workspace`,
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Check if the command contains rm and validate the paths
   * Returns error message if rm is not allowed, null if allowed
   */
  private async validateRmCommand(
    command: string,
    workspaceRoot: string | null
  ): Promise<{ allowed: boolean; reason?: string }> {
    // Check if command contains rm (excluding heredoc content)
    const commandToCheck = this.extractCommandExcludingHeredocContent(command);

    // Simple check for rm command presence (case-insensitive)
    if (!/\brm\b/i.test(commandToCheck)) {
      return { allowed: true };
    }

    // If no workspace root is set, rm is not allowed
    if (!workspaceRoot) {
      return {
        allowed: false,
        reason: 'rm command is not allowed: no workspace root is set',
      };
    }

    // Check if workspace is a git repository by checking for .git directory
    try {
      const result = await invoke<TauriShellResult>('execute_user_shell', {
        command: 'git rev-parse --is-inside-work-tree',
        cwd: workspaceRoot,
        timeoutMs: 5000,
      });

      if (result.code !== 0 || result.stdout.trim() !== 'true') {
        return {
          allowed: false,
          reason: 'rm command is only allowed in git repositories',
        };
      }
    } catch {
      return {
        allowed: false,
        reason: 'rm command is only allowed in git repositories (git check failed)',
      };
    }

    // Extract and validate paths from rm command
    // Need to check each part of the command that might contain rm
    const commandParts = commandToCheck.split(/\s*(?:&&|\|\||;)\s*/);

    for (const part of commandParts) {
      const trimmedPart = part.trim();
      if (!/\brm\b/i.test(trimmedPart)) {
        continue;
      }

      // Check for wildcards first - use specialized validation
      const extracted = this.extractWildcardPatterns(trimmedPart);

      if (extracted.hasWildcards) {
        const wildcardResult = await this.validateWildcardRmCommand(trimmedPart, workspaceRoot);
        if (!wildcardResult.allowed) {
          return wildcardResult;
        }
        // Wildcard validation passed, continue to next part
        continue;
      }

      // No wildcards - use existing explicit path validation
      const paths = this.extractRmPaths(trimmedPart);

      if (paths.length === 0) {
        // rm without paths is likely an error, let it through and shell will handle it
        continue;
      }

      for (const targetPath of paths) {
        const isWithin = await this.isPathWithinWorkspace(targetPath, workspaceRoot);
        if (!isWithin) {
          return {
            allowed: false,
            reason: `rm command blocked: path "${targetPath}" is outside the workspace directory`,
          };
        }
      }
    }

    return { allowed: true };
  }

  async execute(
    command: string,
    taskId?: string,
    toolId?: string,
    contextRootPath?: string
  ): Promise<BashResult> {
    return this.executeWithTimeout(command, taskId, toolId, 300000, 60000, contextRootPath);
  }

  /**
   * Execute a bash command with custom timeouts
   */
  async executeWithTimeout(
    command: string,
    taskId: string | undefined,
    toolId: string | undefined,
    timeoutMs: number,
    idleTimeoutMs: number,
    contextRootPath?: string
  ): Promise<BashResult> {
    try {
      // Safety check
      const dangerCheck = this.isDangerousCommand(command);
      if (dangerCheck.dangerous) {
        this.logger.warn('Blocked dangerous command:', command);
        return {
          success: false,
          command,
          message: `Command blocked: ${dangerCheck.reason}`,
          error: dangerCheck.reason,
        };
      }

      this.logger.info('Executing bash command:', command);
      const rootPath = contextRootPath ?? (await getEffectiveWorkspaceRoot(taskId ?? ''));

      // Validate rm command paths
      const rmValidation = await this.validateRmCommand(command, rootPath || null);
      if (!rmValidation.allowed) {
        this.logger.warn('Blocked rm command:', command, rmValidation.reason);
        return {
          success: false,
          command,
          message: `Command blocked: ${rmValidation.reason}`,
          error: rmValidation.reason,
        };
      }
      if (rootPath) {
        this.logger.info('rootPath:', rootPath);
      } else {
        this.logger.info('No rootPath set, executing in default directory');
      }

      const result = await this.executeCommand(command, rootPath || null, timeoutMs, idleTimeoutMs);

      return await this.formatResult(result, command, taskId, toolId);
    } catch (error) {
      return this.handleError(error, command);
    }
  }

  /**
   * Execute command via Tauri backend
   * @param command - The command to execute
   * @param cwd - Working directory
   * @param timeoutMs - Maximum timeout in milliseconds (default: 120000 = 2 minutes)
   * @param idleTimeoutMs - Idle timeout in milliseconds (default: 5000 = 5 seconds)
   */
  private async executeCommand(
    command: string,
    cwd: string | null,
    timeoutMs?: number,
    idleTimeoutMs?: number
  ): Promise<TauriShellResult> {
    return await invoke<TauriShellResult>('execute_user_shell', {
      command,
      cwd,
      timeoutMs,
      idleTimeoutMs,
    });
  }

  /**
   * Check if a command is a search/grep command that returns exit code 1 when no matches found
   * These commands should be considered successful even with exit code 1
   *
   * Note: 'find' is NOT included because exit code 1 in find indicates an error
   * (e.g., permission denied), not just "no matches found".
   */
  private isSearchCommand(command: string): boolean {
    const trimmedCommand = command.trim();
    // rg, grep, ag, ack - return exit code 1 when no matches found (normal behavior)
    return /^(rg|grep|ag|ack)\b/.test(trimmedCommand);
  }

  /**
   * Format execution result based on command type strategy
   */
  private async formatResult(
    result: TauriShellResult,
    command: string,
    taskId: string | undefined,
    toolId: string | undefined
  ): Promise<BashResult> {
    // For search commands, exit code 1 means "no matches found" which is still a successful execution
    const isSearchCmd = this.isSearchCommand(command);
    const isSuccess =
      result.idle_timed_out ||
      result.timed_out ||
      result.code === 0 ||
      (isSearchCmd && result.code === 1);
    const strategy = getOutputStrategy(command);

    let message: string;
    let output: string | undefined;
    let error: string | undefined;
    let outputFilePath: string | undefined;
    let errorFilePath: string | undefined;
    let outputTruncated: boolean | undefined;
    let errorTruncated: boolean | undefined;

    const stdoutResult = async (maxChars: number) =>
      await this.processOutput(result.stdout, maxChars, taskId, toolId, 'stdout');
    const stderrResult = async (maxChars: number) =>
      await this.processOutput(result.stderr, maxChars, taskId, toolId, 'stderr');

    if (result.idle_timed_out) {
      message = `Command running in background (idle timeout after 5s). PID: ${result.pid ?? 'unknown'}`;
      const stdout = await stdoutResult(MAX_OUTPUT_CHARS);
      const stderr = await stderrResult(MAX_ERROR_CHARS);
      output = stdout.displayText;
      error = stderr.displayText;
      outputFilePath = stdout.filePath;
      errorFilePath = stderr.filePath;
      outputTruncated = stdout.truncated;
      errorTruncated = stderr.truncated;
    } else if (result.timed_out) {
      message = `Command timed out after max timeout. PID: ${result.pid ?? 'unknown'}`;
      const stdout = await stdoutResult(MAX_OUTPUT_CHARS);
      const stderr = await stderrResult(MAX_ERROR_CHARS);
      output = stdout.displayText;
      error = stderr.displayText;
      outputFilePath = stdout.filePath;
      errorFilePath = stderr.filePath;
      outputTruncated = stdout.truncated;
      errorTruncated = stderr.truncated;
    } else if (isSuccess) {
      message = 'Command executed successfully';

      const stderr = await stderrResult(MAX_ERROR_CHARS);
      error = stderr.displayText;
      errorFilePath = stderr.filePath;
      errorTruncated = stderr.truncated;

      switch (strategy) {
        case 'full': {
          const stdout = await stdoutResult(MAX_OUTPUT_CHARS);
          output = stdout.displayText;
          outputFilePath = stdout.filePath;
          outputTruncated = stdout.truncated;
          break;
        }
        case 'minimal': {
          const stdout = await stdoutResult(MAX_OUTPUT_CHARS);
          output = result.stdout.trim() ? '(output truncated on success)' : undefined;
          outputFilePath = stdout.filePath;
          outputTruncated = stdout.truncated;
          break;
        }
        default: {
          const stdout = await stdoutResult(MAX_OUTPUT_CHARS);
          output = stdout.displayText;
          outputFilePath = stdout.filePath;
          outputTruncated = stdout.truncated;
          break;
        }
      }
    } else {
      // Failure: always show full error information
      message = `Command failed with exit code ${result.code}`;
      if (result.stderr?.trim()) {
        const stderr = await stderrResult(MAX_ERROR_CHARS);
        error = stderr.displayText;
        errorFilePath = stderr.filePath;
        errorTruncated = stderr.truncated;
        if (result.stdout.trim()) {
          const stdout = await stdoutResult(MAX_FAILURE_STDOUT_CHARS);
          output = stdout.displayText;
          outputFilePath = stdout.filePath;
          outputTruncated = stdout.truncated;
        }
      } else {
        const stdout = await stdoutResult(MAX_OUTPUT_CHARS);
        output = stdout.displayText;
        outputFilePath = stdout.filePath;
        outputTruncated = stdout.truncated;
      }
    }

    return {
      success: isSuccess,
      command,
      message,
      output,
      error,
      outputFilePath,
      errorFilePath,
      outputTruncated,
      errorTruncated,
      exit_code: result.code,
      timed_out: result.timed_out,
      idle_timed_out: result.idle_timed_out,
      pid: result.pid,
    };
  }

  /**
   * Truncate output to max N characters (from the end)
   */
  private truncateByChars(text: string, maxChars: number): string | undefined {
    if (!text.trim()) {
      return undefined;
    }
    if (text.length > maxChars) {
      const truncatedCount = text.length - maxChars;
      return `... (${truncatedCount} chars truncated)\n${text.slice(-maxChars)}`;
    }
    return text;
  }

  private async processOutput(
    text: string,
    maxChars: number,
    taskId: string | undefined,
    toolId: string | undefined,
    suffix: string
  ): Promise<{ displayText?: string; filePath?: string; truncated: boolean }> {
    if (!text.trim()) {
      return { displayText: undefined, filePath: undefined, truncated: false };
    }

    if (text.length <= maxChars) {
      return { displayText: text, filePath: undefined, truncated: false };
    }

    const displayText = this.truncateByChars(text, maxChars);
    let filePath: string | undefined;

    if (taskId && toolId) {
      try {
        filePath = await taskFileService.saveOutput(taskId, toolId, text, suffix);
      } catch (error) {
        this.logger.warn('Failed to save bash output file', error);
      }
    }

    return { displayText, filePath, truncated: true };
  }

  /**
   * Handle execution errors
   */
  private handleError(error: unknown, command: string): BashResult {
    this.logger.error('Error executing bash command:', error);
    return {
      success: false,
      command,
      message: 'Error executing bash command',
      error: error instanceof Error ? error.message : String(error),
    };
  }

  /**
   * Execute a bash command in the background
   * @param command - The bash command to execute
   * @param taskId - The task ID for workspace root resolution
   * @param toolId - Optional tool use ID for output file naming
   * @param maxTimeoutMs - Optional timeout in milliseconds (default: 2 hours)
   */
  async executeInBackground(
    command: string,
    taskId: string,
    toolId: string,
    maxTimeoutMs?: number,
    contextRootPath?: string
  ): Promise<BashResult> {
    try {
      // Safety check
      const dangerCheck = this.isDangerousCommand(command);
      if (dangerCheck.dangerous) {
        this.logger.warn('Blocked dangerous command:', command);
        return {
          success: false,
          command,
          message: `Command blocked: ${dangerCheck.reason}`,
          error: dangerCheck.reason,
        };
      }

      this.logger.info('Executing background bash command:', command);
      const rootPath = contextRootPath ?? (await getEffectiveWorkspaceRoot(taskId));

      // Validate rm command paths
      const rmValidation = await this.validateRmCommand(command, rootPath || null);
      if (!rmValidation.allowed) {
        this.logger.warn('Blocked rm command:', command, rmValidation.reason);
        return {
          success: false,
          command,
          message: `Command blocked: ${rmValidation.reason}`,
          error: rmValidation.reason,
        };
      }

      // Import the background task store dynamically to avoid circular dependency
      const { useBackgroundTaskStore } = await import('@/stores/background-task-store');

      // Generate effective tool use ID
      const effectiveToolUseId = toolId?.trim()
        ? toolId.trim()
        : `bash_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

      // Spawn the background task
      const taskIdResult = await useBackgroundTaskStore
        .getState()
        .spawnTask(command, taskId, effectiveToolUseId, rootPath || undefined, maxTimeoutMs);

      this.logger.info('Background task spawned:', taskIdResult);

      return {
        success: true,
        command,
        message: `Command started in background (Task ID: ${taskIdResult})`,
        pid: undefined, // Will be available after first status refresh
        taskId: taskIdResult,
        isBackground: true,
      };
    } catch (error) {
      this.logger.error('Error executing background bash command:', error);
      return {
        success: false,
        command,
        message: 'Error executing background bash command',
        error: error instanceof Error ? error.message : String(error),
        isBackground: true,
      };
    }
  }
}

// Export singleton instance for convenience
export const bashExecutor = new BashExecutor();
