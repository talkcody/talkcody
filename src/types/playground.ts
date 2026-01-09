import type { CustomToolDefinition } from './custom-tool';

/**
 * Playground status
 */
export type PlaygroundStatus = 'idle' | 'compiling' | 'executing' | 'error' | 'success';

/**
 * Execution result status
 */
export type ExecutionStatus = 'success' | 'error' | 'timeout';

/**
 * Permission type for playground tools
 */
export type PlaygroundPermission = 'fs' | 'net' | 'command';

/**
 * Execution log entry
 */
export interface ExecutionLog {
  id: string;
  timestamp: number;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  data?: unknown;
}

/**
 * Execution result
 */
export interface ExecutionResult {
  status: ExecutionStatus;
  output?: unknown;
  error?: string;
  duration: number;
  logs: ExecutionLog[];
}

/**
 * Execution record in history
 */
export interface ExecutionRecord {
  id: string;
  timestamp: number;
  params: Record<string, unknown>;
  result: ExecutionResult;
  grantedPermissions: PlaygroundPermission[];
}

/**
 * Compile result
 */
export interface CompileResult {
  success: boolean;
  tool?: CustomToolDefinition;
  error?: string;
  warnings?: string[];
  duration: number;
}

/**
 * Parameter preset for quick testing
 */
export interface ParameterPreset {
  id: string;
  name: string;
  description?: string;
  params: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

/**
 * Playground configuration
 */
export interface PlaygroundConfig {
  allowedPermissions: PlaygroundPermission[];
  timeout: number;
  workingDirectory?: string;
  enableMocking: boolean;
}

/**
 * Tool template for creating new tools
 */
export interface ToolTemplate {
  id: string;
  name: string;
  description: string;
  sourceCode: string;
  category: 'basic' | 'network' | 'file' | 'command';
  icon?: string;
}
