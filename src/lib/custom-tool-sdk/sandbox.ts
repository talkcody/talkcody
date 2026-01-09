import { logger } from '@/lib/logger';
import type { ExecutionLog, PlaygroundPermission } from '@/types/playground';
import type { ToolExecuteContext } from '@/types/tool';

/**
 * Sandbox configuration
 */
export interface SandboxConfig {
  allowedPermissions: PlaygroundPermission[];
  timeout: number;
  workingDirectory?: string;
  enableMocking?: boolean;
}

/**
 * Permission request callback
 */
export type PermissionRequestCallback = (
  permission: PlaygroundPermission,
  toolName: string
) => Promise<boolean>;

/**
 * Tool Sandbox - Provides secure execution environment for tools
 */
export class ToolSandbox {
  private config: SandboxConfig;
  private logs: ExecutionLog[] = [];
  private requestPermission: PermissionRequestCallback;

  constructor(config: SandboxConfig, requestPermission: PermissionRequestCallback) {
    this.config = config;
    this.requestPermission = requestPermission;
  }

  /**
   * Check if a permission is allowed
   */
  private hasPermission(permission: PlaygroundPermission): boolean {
    return this.config.allowedPermissions.includes(permission);
  }

  /**
   * Request a permission from user
   */
  async checkPermission(permission: PlaygroundPermission): Promise<boolean> {
    if (this.hasPermission(permission)) {
      this.addLog('info', `Permission already granted: ${permission}`);
      return true;
    }

    this.addLog('info', `Requesting permission: ${permission}`);
    const granted = await this.requestPermission(permission, 'Playground Tool');

    if (granted) {
      this.config.allowedPermissions.push(permission);
      this.addLog('info', `Permission granted: ${permission}`);
    } else {
      this.addLog('warn', `Permission denied: ${permission}`);
    }

    return granted;
  }

  /**
   * Add an execution log
   */
  private addLog(level: ExecutionLog['level'], message: string, data?: unknown): void {
    const log: ExecutionLog = {
      id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      level,
      message,
      data,
    };
    this.logs.push(log);
  }

  /**
   * Get all execution logs
   */
  getLogs(): ExecutionLog[] {
    return [...this.logs];
  }

  /**
   * Clear all logs
   */
  clearLogs(): void {
    this.logs = [];
  }

  /**
   * Execute a function with timeout and permission checks
   */
  async executeSafely<T>(
    fn: () => Promise<T>,
    requiredPermissions: PlaygroundPermission[],
    toolName: string
  ): Promise<{ result: T; error?: string }> {
    const startTime = Date.now();
    this.addLog('info', `Starting execution for tool: ${toolName}`);

    try {
      // Check all required permissions
      for (const permission of requiredPermissions) {
        const granted = await this.checkPermission(permission);
        if (!granted) {
          throw new Error(`Permission denied: ${permission}`);
        }
      }

      // Execute with timeout
      const result = await this.withTimeout(fn(), this.config.timeout);

      const duration = Date.now() - startTime;
      this.addLog('info', `Execution completed successfully in ${duration}ms`);

      return { result };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.addLog('error', `Execution failed: ${errorMessage}`);
      logger.error('[ToolSandbox] Execution failed', { error, duration });
      return { result: undefined as T, error: errorMessage };
    }
  }

  /**
   * Execute a function with timeout
   */
  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Execution timeout after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]);
  }

  /**
   * Create execution context for tool
   */
  createExecutionContext(): ToolExecuteContext {
    return {
      taskId: `playground_${Date.now()}`,
      toolId: 'playground_tool',
    };
  }

  /**
   * Get current sandbox config
   */
  getConfig(): Readonly<SandboxConfig> {
    return { ...this.config };
  }

  /**
   * Update sandbox config
   */
  updateConfig(updates: Partial<SandboxConfig>): void {
    this.config = {
      ...this.config,
      ...updates,
    };
    this.addLog('info', 'Sandbox configuration updated', updates);
  }
}

/**
 * Default sandbox factory
 */
export function createSandbox(
  config: SandboxConfig,
  requestPermission: PermissionRequestCallback
): ToolSandbox {
  return new ToolSandbox(config, requestPermission);
}

/**
 * Default permission request handler for playground
 * This should be replaced with actual UI dialog
 */
export async function defaultPermissionRequest(
  permission: PlaygroundPermission,
  toolName: string
): Promise<boolean> {
  logger.info('[ToolSandbox] Permission request (auto-granted in playground)', {
    permission,
    toolName,
  });
  // In playground, we auto-grant permissions for development convenience
  // In production, this should show a dialog to the user
  return true;
}
