/**
 * Agent Scenario Test Framework
 * Based on LangWatch Scenario pattern, simulating real user interactions
 *
 * @example
 * ```typescript
 * const result = await scenario()
 *   .user('Find all TODO comments')
 *   .agent()
 *   .assertToolCalled('grep', { pattern: 'TODO' })
 *   .assertOutputContains('found')
 *   .run(agentConfig);
 *
 * expect(result.success).toBe(true);
 * ```
 */

import type { AgentTrace } from '../evaluation/trace-recorder';

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

// ============================================
// Type Definitions
// ============================================

export type ScenarioStepType =
  | 'user'
  | 'agent'
  | 'assert-tool'
  | 'assert-output'
  | 'assert-no-tool'
  | 'assert-state'
  | 'wait'
  | 'custom';

export interface ScenarioStep {
  type: ScenarioStepType;
  data?: unknown;
}

export interface StepResult {
  step: ScenarioStep;
  passed: boolean;
  error?: string;
  duration?: number;
}

export interface ScenarioResult {
  /** Whether scenario succeeded */
  success: boolean;
  /** Results of each step */
  steps: StepResult[];
  /** Agent trace (if available) */
  trace?: AgentTrace;
  /** Total duration (ms) */
  duration: number;
  /** Error summary */
  errorSummary?: string;
}

export interface ToolCallRecord {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  result?: unknown;
}

export interface AgentResponse {
  output: string;
  toolCalls: ToolCallRecord[];
  trace?: AgentTrace;
}

export interface AgentConfig {
  /** Agent execution function */
  runAgent: (input: string) => Promise<AgentResponse>;
  /** Timeout (ms) */
  timeout?: number;
  /** Whether to stop on first assertion failure */
  stopOnFirstFailure?: boolean;
}

export interface ScenarioState {
  /** Agent output */
  output: string;
  /** Tool call records */
  toolCalls: ToolCallRecord[];
  /** User message history */
  userMessages: string[];
  /** Agent trace */
  trace?: AgentTrace;
}

// ============================================
// Scenario Builder
// ============================================

/**
 * Scenario Builder
 * Build test scenarios using fluent API
 */
export class ScenarioBuilder {
  private steps: ScenarioStep[] = [];
  private currentUserMessage = '';
  private name = 'Unnamed Scenario';
  private description = '';

  /**
   * Set scenario name
   */
  withName(name: string): this {
    this.name = name;
    return this;
  }

  /**
   * Set scenario description
   */
  withDescription(description: string): this {
    this.description = description;
    return this;
  }

  /**
   * Simulate user input
   */
  user(message: string): this {
    this.currentUserMessage = message;
    this.steps.push({ type: 'user', data: { message } });
    return this;
  }

  /**
   * Execute Agent
   */
  agent(): this {
    this.steps.push({ type: 'agent' });
    return this;
  }

  /**
   * Assert: tool was called
   * @param toolName Tool name
   * @param args Optional argument matching (partial match)
   */
  assertToolCalled(toolName: string, args?: Record<string, unknown>): this {
    this.steps.push({
      type: 'assert-tool',
      data: { toolName, args, shouldBeCalled: true },
    });
    return this;
  }

  /**
   * Assert: tool was not called
   */
  assertToolNotCalled(toolName: string): this {
    this.steps.push({
      type: 'assert-no-tool',
      data: { toolName },
    });
    return this;
  }

  /**
   * Assert: specified number of tools were called
   */
  assertToolCallCount(count: number): this {
    this.steps.push({
      type: 'assert-state',
      data: {
        check: 'toolCallCount',
        expected: count,
      },
    });
    return this;
  }

  /**
   * Assert: output contains specific text
   */
  assertOutputContains(text: string): this {
    this.steps.push({
      type: 'assert-output',
      data: { text, mode: 'contains' },
    });
    return this;
  }

  /**
   * Assert: output does not contain specific text
   */
  assertOutputNotContains(text: string): this {
    this.steps.push({
      type: 'assert-output',
      data: { text, mode: 'not-contains' },
    });
    return this;
  }

  /**
   * Assert: output matches regex pattern
   */
  assertOutputMatches(pattern: RegExp): this {
    this.steps.push({
      type: 'assert-output',
      data: { pattern: pattern.source, flags: pattern.flags, mode: 'regex' },
    });
    return this;
  }

  /**
   * Assert: output is not empty
   */
  assertOutputNotEmpty(): this {
    this.steps.push({
      type: 'assert-output',
      data: { mode: 'not-empty' },
    });
    return this;
  }

  /**
   * Wait for specified time
   */
  wait(ms: number): this {
    this.steps.push({ type: 'wait', data: { ms } });
    return this;
  }

  /**
   * Custom assertion
   */
  assert(fn: (state: ScenarioState) => boolean | Promise<boolean>, description?: string): this {
    this.steps.push({
      type: 'custom',
      data: { fn, description: description ?? 'Custom assertion' },
    });
    return this;
  }

  /**
   * Assert tool call order
   */
  assertToolOrder(...toolNames: string[]): this {
    this.steps.push({
      type: 'custom',
      data: {
        fn: (state: ScenarioState) => {
          const calledTools = state.toolCalls.map((tc) => tc.toolName);
          let lastIndex = -1;
          for (const name of toolNames) {
            const index = calledTools.indexOf(name, lastIndex + 1);
            if (index === -1 || index <= lastIndex) {
              return false;
            }
            lastIndex = index;
          }
          return true;
        },
        description: `Tool order: ${toolNames.join(' -> ')}`,
      },
    });
    return this;
  }

  /**
   * Execute scenario
   */
  async run(config: AgentConfig): Promise<ScenarioResult> {
    const startTime = nowMs();
    const results: StepResult[] = [];
    const state: ScenarioState = {
      output: '',
      toolCalls: [],
      userMessages: [],
    };

    const { timeout = 30000, stopOnFirstFailure = true } = config;

    for (const step of this.steps) {
      const stepStartTime = nowMs();

      try {
        const result = await this.executeStep(step, state, config, timeout);
        result.duration = Math.max(0, Math.ceil(nowMs() - stepStartTime));
        results.push(result);

        if (!result.passed && stopOnFirstFailure) {
          break;
        }
      } catch (error) {
        results.push({
          step,
          passed: false,
          error: error instanceof Error ? error.message : String(error),
          duration: Math.max(0, Math.ceil(nowMs() - stepStartTime)),
        });

        if (stopOnFirstFailure) {
          break;
        }
      }
    }

    const success = results.every((r) => r.passed);
    const failedSteps = results.filter((r) => !r.passed);

    return {
      success,
      steps: results,
      trace: state.trace,
      duration: Math.max(0, Math.ceil(nowMs() - startTime)),
      errorSummary:
        failedSteps.length > 0
          ? failedSteps.map((s) => s.error ?? 'Unknown error').join('; ')
          : undefined,
    };
  }

  /**
   * Execute a single step
   */
  private async executeStep(
    step: ScenarioStep,
    state: ScenarioState,
    config: AgentConfig,
    timeout: number
  ): Promise<StepResult> {
    switch (step.type) {
      case 'user': {
        const { message } = step.data as { message: string };
        this.currentUserMessage = message;
        state.userMessages.push(message);
        return { step, passed: true };
      }

      case 'agent': {
        const response = await Promise.race([
          config.runAgent(this.currentUserMessage),
          this.createTimeoutPromise<AgentResponse>(timeout, 'Agent timeout'),
        ]);

        state.output = response.output;
        state.toolCalls = response.toolCalls;
        state.trace = response.trace;
        return { step, passed: true };
      }

      case 'assert-tool': {
        const { toolName, args, shouldBeCalled } = step.data as {
          toolName: string;
          args?: Record<string, unknown>;
          shouldBeCalled: boolean;
        };

        const found = state.toolCalls.find((tc) => tc.toolName === toolName);

        if (shouldBeCalled && !found) {
          return {
            step,
            passed: false,
            error: `Tool '${toolName}' was not called`,
          };
        }

        if (args && found) {
          const argsMatch = this.matchArgs(found.args, args);
          if (!argsMatch.matched) {
            return {
              step,
              passed: false,
              error: `Tool '${toolName}' called with wrong args: ${argsMatch.reason}`,
            };
          }
        }

        return { step, passed: true };
      }

      case 'assert-no-tool': {
        const { toolName } = step.data as { toolName: string };
        const found = state.toolCalls.find((tc) => tc.toolName === toolName);

        if (found) {
          return {
            step,
            passed: false,
            error: `Tool '${toolName}' should not have been called`,
          };
        }

        return { step, passed: true };
      }

      case 'assert-output': {
        const { text, pattern, flags, mode } = step.data as {
          text?: string;
          pattern?: string;
          flags?: string;
          mode: 'contains' | 'not-contains' | 'regex' | 'not-empty';
        };

        let passed = false;
        let error = '';

        switch (mode) {
          case 'contains':
            passed = text ? state.output.includes(text) : false;
            error = `Output does not contain "${text}"`;
            break;
          case 'not-contains':
            passed = text ? !state.output.includes(text) : true;
            error = `Output should not contain "${text}"`;
            break;
          case 'regex':
            passed = new RegExp(pattern!, flags).test(state.output);
            error = `Output does not match pattern /${pattern}/${flags ?? ''}`;
            break;
          case 'not-empty':
            passed = state.output.trim().length > 0;
            error = 'Output is empty';
            break;
        }

        return { step, passed, error: passed ? undefined : error };
      }

      case 'assert-state': {
        const { check, expected } = step.data as {
          check: string;
          expected: unknown;
        };

        let passed = false;
        let error = '';

        switch (check) {
          case 'toolCallCount':
            passed = state.toolCalls.length === expected;
            error = `Expected ${expected} tool calls, got ${state.toolCalls.length}`;
            break;
          default:
            error = `Unknown state check: ${check}`;
        }

        return { step, passed, error: passed ? undefined : error };
      }

      case 'wait': {
        const { ms } = step.data as { ms: number };
        await new Promise((resolve) => setTimeout(resolve, ms));
        return { step, passed: true };
      }

      case 'custom': {
        const { fn, description } = step.data as {
          fn: (state: ScenarioState) => boolean | Promise<boolean>;
          description: string;
        };

        const result = await fn(state);
        return {
          step,
          passed: result,
          error: result ? undefined : `Assertion failed: ${description}`,
        };
      }

      default:
        return {
          step,
          passed: false,
          error: `Unknown step type: ${step.type}`,
        };
    }
  }

  /**
   * Match arguments (partial match)
   */
  private matchArgs(
    actual: Record<string, unknown>,
    expected: Record<string, unknown>
  ): { matched: boolean; reason?: string } {
    for (const [key, value] of Object.entries(expected)) {
      if (!(key in actual)) {
        return { matched: false, reason: `Missing key '${key}'` };
      }

      const actualValue = actual[key];

      // Deep comparison
      if (typeof value === 'object' && value !== null) {
        if (JSON.stringify(actualValue) !== JSON.stringify(value)) {
          return {
            matched: false,
            reason: `Key '${key}': expected ${JSON.stringify(value)}, got ${JSON.stringify(actualValue)}`,
          };
        }
      } else if (actualValue !== value) {
        return {
          matched: false,
          reason: `Key '${key}': expected ${JSON.stringify(value)}, got ${JSON.stringify(actualValue)}`,
        };
      }
    }

    return { matched: true };
  }

  /**
   * Create timeout Promise
   */
  private createTimeoutPromise<T>(ms: number, message: string): Promise<T> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    });
  }

  /**
   * Get scenario info
   */
  getInfo(): { name: string; description: string; stepCount: number } {
    return {
      name: this.name,
      description: this.description,
      stepCount: this.steps.length,
    };
  }
}

// ============================================
// Convenience Factory Functions
// ============================================

/**
 * Create a new Scenario
 */
export function scenario(name?: string): ScenarioBuilder {
  const builder = new ScenarioBuilder();
  if (name) {
    builder.withName(name);
  }
  return builder;
}

/**
 * Create quick tool call test scenario
 */
export function toolCallScenario(
  input: string,
  expectedTool: string,
  expectedArgs?: Record<string, unknown>
): ScenarioBuilder {
  const builder = scenario(`Tool call: ${expectedTool}`)
    .user(input)
    .agent()
    .assertToolCalled(expectedTool, expectedArgs);

  return builder;
}

/**
 * Create quick text output test scenario
 */
export function outputScenario(input: string, expectedOutput: string | RegExp): ScenarioBuilder {
  const builder = scenario(`Output check`).user(input).agent();

  if (typeof expectedOutput === 'string') {
    builder.assertOutputContains(expectedOutput);
  } else {
    builder.assertOutputMatches(expectedOutput);
  }

  return builder;
}

/**
 * Run multiple scenarios in batch
 */
export async function runScenarios(
  scenarios: ScenarioBuilder[],
  config: AgentConfig,
  options: {
    stopOnFirstFailure?: boolean;
    onProgress?: (completed: number, total: number, result: ScenarioResult) => void;
  } = {}
): Promise<{
  results: Array<{ name: string; result: ScenarioResult }>;
  passRate: number;
  totalDuration: number;
}> {
  const results: Array<{ name: string; result: ScenarioResult }> = [];
  const startTime = Date.now();

  for (let i = 0; i < scenarios.length; i++) {
    const scenarioBuilder = scenarios[i];
    const info = scenarioBuilder.getInfo();
    const result = await scenarioBuilder.run(config);

    results.push({ name: info.name, result });
    options.onProgress?.(i + 1, scenarios.length, result);

    if (options.stopOnFirstFailure && !result.success) {
      break;
    }
  }

  const passedCount = results.filter((r) => r.result.success).length;

  return {
    results,
    passRate: results.length > 0 ? passedCount / results.length : 0,
    totalDuration: Date.now() - startTime,
  };
}
