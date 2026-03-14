/**
 * Agent Execution Configuration
 *
 * Centralized configuration for multi-agent parallel execution.
 * These values can be adjusted based on API rate limits and system resources.
 */

export interface AgentExecutionConfig {
  /**
   * Maximum number of subagents that can run in parallel.
   * Default: 5
   *
   * Consider:
   * - API rate limits of your LLM provider
   * - System memory and CPU resources
   * - Network bandwidth
   */
  maxParallelSubagents: number;

  /**
   * Timeout in milliseconds for nested agent execution.
   * Default: 300000 (5 minutes)
   *
   * Consider:
   * - Complexity of typical agent tasks
   * - Network latency
   * - Model response times
   */
  nestedAgentTimeoutMs: number;

  /**
   * Whether to enable parallel execution for read agents.
   * When false, all agents will execute sequentially.
   * Default: true
   */
  enableParallelExecution: boolean;
}

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: AgentExecutionConfig = {
  maxParallelSubagents: 20,
  nestedAgentTimeoutMs: 5 * 60 * 1000, // 5 minutes
  enableParallelExecution: true,
};

/**
 * Current active configuration
 * This can be modified at runtime via updateConfig()
 */
let currentConfig: AgentExecutionConfig = { ...DEFAULT_CONFIG };

/**
 * Get the current agent execution configuration
 */
export function getAgentExecutionConfig(): Readonly<AgentExecutionConfig> {
  return currentConfig;
}

/**
 * Update the agent execution configuration
 * Only provided fields will be updated, others remain unchanged
 */
export function updateAgentExecutionConfig(
  partial: Partial<AgentExecutionConfig>
): AgentExecutionConfig {
  currentConfig = {
    ...currentConfig,
    ...partial,
  };
  return currentConfig;
}

/**
 * Reset configuration to defaults
 */
export function resetAgentExecutionConfig(): AgentExecutionConfig {
  currentConfig = { ...DEFAULT_CONFIG };
  return currentConfig;
}

/**
 * Get the default configuration (for reference)
 */
export function getDefaultAgentExecutionConfig(): Readonly<AgentExecutionConfig> {
  return DEFAULT_CONFIG;
}

// Export individual config getters for convenience
export function getMaxParallelSubagents(): number {
  return currentConfig.maxParallelSubagents;
}

export function getNestedAgentTimeoutMs(): number {
  return currentConfig.nestedAgentTimeoutMs;
}

export function isParallelExecutionEnabled(): boolean {
  return currentConfig.enableParallelExecution;
}
