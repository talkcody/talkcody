// src/services/agents/ralph-loop-service.ts
/**
 * Ralph Loop Service - Completion Hook Implementation
 *
 * Ralph Loop is now implemented as a completion hook that integrates into
 * LLMService's completion hook pipeline. Instead of running its own loop,
 * it evaluates completion criteria and decides whether to continue or stop.
 *
 * Hook Priority: 20 (after stop hook: 10, before auto review: 30)
 */

import { logger } from '@/lib/logger';
import { generateId } from '@/lib/utils';
import { taskFileService } from '@/services/task-file-service';
import { useFileChangesStore } from '@/stores/file-changes-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useTaskStore } from '@/stores/task-store';
import type { MessageAttachment, UIMessage } from '@/types/agent';
import type {
  CompletionHook,
  CompletionHookContext,
  CompletionHookResult,
  ToolSummary,
} from '@/types/completion-hooks';
import type { RalphLoopConfig, RalphLoopStateFile, RalphLoopStopReason } from '@/types/ralph-loop';
import type { TaskSettings } from '@/types/task';

// Completion promise instructions added to system prompt
export const COMPLETION_PROMISE = [
  'Ralph Loop completion promise:',
  '- When the task is fully done, output exactly: <ralph>COMPLETE</ralph>',
  '- If blocked, output exactly: <ralph>BLOCKED: reason</ralph>',
].join('\n');

/**
 * Tool result type guard for bash tool
 */
export type BashToolResult = {
  success?: boolean;
  command?: string;
  message?: string;
  output?: string;
  error?: string;
};

export function isBashResult(value: unknown): value is BashToolResult {
  if (!value || typeof value !== 'object') return false;
  return 'success' in value || 'command' in value || 'error' in value;
}

/**
 * Default Ralph Loop configuration
 */
export const DEFAULT_CONFIG: RalphLoopConfig = {
  enabled: true,
  maxIterations: 6,
  maxWallTimeMs: 60 * 60 * 1000,
  stopCriteria: {
    requirePassingTests: false,
    requireLint: false,
    requireTsc: false,
    requireNoErrors: true,
    successRegex: '<ralph>COMPLETE</ralph>',
    blockedRegex: '<ralph>BLOCKED:(.*?)</ralph>',
  },
  memory: {
    summaryFileName: 'ralph-summary.md',
    feedbackFileName: 'ralph-feedback.md',
    stateFileName: 'ralph-iteration.json',
  },
  context: {
    includeLastNMessages: 0,
  },
};

// Command patterns for test/lint/tsc detection
const TEST_COMMAND_PATTERNS = [
  /^bun\s+run\s+test(\b|:)/,
  /^npm\s+(run\s+)?test(\b|:)/,
  /^yarn\s+test(\b|:)/,
  /^pnpm\s+test(\b|:)/,
  /^vitest(\b|\s)/,
  /^jest(\b|\s)/,
  /^pytest(\b|\s)/,
  /^cargo\s+test(\b|\s)/,
  /^go\s+test(\b|\s)/,
];

const LINT_COMMAND_PATTERNS = [
  /^bun\s+run\s+lint(\b|:)/,
  /^npm\s+(run\s+)?lint(\b|:)/,
  /^yarn\s+lint(\b|:)/,
  /^pnpm\s+lint(\b|:)/,
  /^eslint(\b|\s)/,
  /^biome(\b|\s)/,
  /^ruff(\b|\s)/,
];

const TSC_COMMAND_PATTERNS = [/^bun\s+run\s+tsc(\b|:)/, /^tsc(\b|\s)/];

/**
 * Parse task settings to check Ralph Loop override
 */
function parseTaskSettings(taskId: string): TaskSettings | null {
  const task = useTaskStore.getState().getTask(taskId);
  if (!task?.settings) return null;
  try {
    return JSON.parse(task.settings) as TaskSettings;
  } catch (error) {
    logger.warn('[RalphLoop] Failed to parse task settings', { taskId, error });
    return null;
  }
}

/**
 * Check if Ralph Loop is enabled for a task
 */
export function isRalphLoopEnabled(taskId: string): boolean {
  const globalEnabled = useSettingsStore.getState().getRalphLoopEnabled();
  const settings = parseTaskSettings(taskId);
  if (typeof settings?.ralphLoopEnabled === 'boolean') {
    return settings.ralphLoopEnabled;
  }
  return globalEnabled;
}

/**
 * Build regex for stop patterns
 */
function buildStopRegex(pattern?: string): RegExp | null {
  if (!pattern) return null;
  try {
    return new RegExp(pattern, 'i');
  } catch (error) {
    logger.warn('[RalphLoop] Invalid stop regex, ignoring', { pattern, error });
    return null;
  }
}

/**
 * Check if command matches any pattern
 */
function matchCommand(command: string | undefined, patterns: RegExp[]): boolean {
  if (!command) return false;
  return patterns.some((pattern) => pattern.test(command.trim()));
}

/**
 * Get base user message from messages array
 */
function getBaseUserMessage(messages: UIMessage[]): string {
  const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');
  if (!lastUserMessage) return '';

  const content = lastUserMessage.content;
  if (typeof content === 'string') return content;
  try {
    return JSON.stringify(content);
  } catch {
    return '';
  }
}

/**
 * Ralph Loop Service - Completion Hook Implementation
 *
 * Implements the CompletionHook interface to integrate with LLMService's
 * completion hook pipeline.
 */
export class RalphLoopService implements CompletionHook {
  /** Hook name for identification */
  readonly name = 'ralph-loop';

  /** Hook priority (20 = after stop hook, before auto review) */
  readonly priority = 20;

  /**
   * Check if this hook should run
   */
  shouldRun(context: CompletionHookContext): boolean {
    return isRalphLoopEnabled(context.taskId);
  }

  /**
   * Execute Ralph Loop evaluation
   *
   * This method is called by LLMService after a successful agent loop finish.
   * It evaluates stop criteria and decides whether to continue or stop.
   */
  async run(context: CompletionHookContext): Promise<CompletionHookResult> {
    const { taskId, fullText, toolSummaries, iteration, startTime } = context;

    logger.info('[RalphLoop] Running completion hook', {
      taskId,
      iteration,
      toolSummaryCount: toolSummaries.length,
    });

    const config = { ...DEFAULT_CONFIG };
    const successRegex = buildStopRegex(config.stopCriteria.successRegex);
    const blockedRegex = buildStopRegex(config.stopCriteria.blockedRegex);

    // Check wall time
    const elapsed = Date.now() - startTime;
    if (elapsed > config.maxWallTimeMs) {
      logger.info('[RalphLoop] Max wall time reached', { elapsed, max: config.maxWallTimeMs });

      await this.persistFinalState({
        taskId,
        iteration,
        startTime,
        stopReason: 'max-wall-time',
        stopMessage: 'Reached max wall time',
      });

      return {
        action: 'stop',
        stopReason: 'max-wall-time',
        stopMessage: 'Reached max wall time',
      };
    }

    // Check max iterations
    if (iteration >= config.maxIterations) {
      logger.info('[RalphLoop] Max iterations reached', { iteration, max: config.maxIterations });

      await this.persistFinalState({
        taskId,
        iteration,
        startTime,
        stopReason: 'max-iterations',
        stopMessage: 'Reached max iterations',
      });

      return {
        action: 'stop',
        stopReason: 'max-iterations',
        stopMessage: 'Reached max iterations',
      };
    }

    // Evaluate stop criteria
    const evaluation = this.evaluateStopCriteria({
      fullText,
      toolSummaries,
      successRegex,
      blockedRegex,
      stopCriteria: config.stopCriteria,
    });

    // Persist iteration artifacts
    await this.persistIterationArtifacts({
      taskId,
      iteration,
      startTime,
      fullText,
      toolSummaries,
      evaluation,
    });

    // If should stop, return stop action
    if (evaluation.shouldStop) {
      logger.info('[RalphLoop] Stop criteria met', {
        stopReason: evaluation.stopReason,
        stopMessage: evaluation.stopMessage,
      });

      return {
        action: 'stop',
        stopReason: evaluation.stopReason,
        stopMessage: evaluation.stopMessage,
      };
    }

    // Continue with fresh context
    logger.info('[RalphLoop] Continuing to next iteration', { iteration: iteration + 1 });

    const nextMessages = await this.buildIterationMessages({
      taskId,
      includeLastN: config.context.includeLastNMessages,
    });

    return {
      action: 'continue',
      continuationMode: 'replace',
      nextMessages,
    };
  }

  /**
   * Evaluate stop criteria based on full text and tool results
   */
  evaluateStopCriteria(params: {
    fullText: string;
    toolSummaries: ToolSummary[];
    successRegex: RegExp | null;
    blockedRegex: RegExp | null;
    stopCriteria: RalphLoopConfig['stopCriteria'];
  }): {
    shouldStop: boolean;
    stopReason: RalphLoopStopReason;
    stopMessage?: string;
    completionPromiseMatched: boolean;
  } {
    const { fullText, toolSummaries, successRegex, blockedRegex, stopCriteria } = params;

    // Check for blocked marker
    const blockedMatch = blockedRegex?.exec(fullText || '');
    if (blockedMatch) {
      return {
        shouldStop: true,
        stopReason: 'blocked',
        stopMessage: blockedMatch[1]?.trim() || 'Blocked',
        completionPromiseMatched: false,
      };
    }

    // Check for completion marker
    const completionPromiseMatched = successRegex ? successRegex.test(fullText || '') : false;

    if (!completionPromiseMatched) {
      return {
        shouldStop: false,
        stopReason: 'unknown',
        completionPromiseMatched: false,
      };
    }

    // Completion marker found - check additional criteria
    const commandMatches = (patterns: RegExp[]) =>
      toolSummaries.filter((summary) => summary.command && matchCommand(summary.command, patterns));

    const testResults = commandMatches(TEST_COMMAND_PATTERNS);
    const lintResults = commandMatches(LINT_COMMAND_PATTERNS);
    const tscResults = commandMatches(TSC_COMMAND_PATTERNS);

    const testsPassed = testResults.some((result) => result.success === true);
    const lintPassed = lintResults.some((result) => result.success === true);
    const tscPassed = tscResults.some((result) => result.success === true);

    // Check for errors in tool results
    const hasToolErrors = toolSummaries.some(
      (summary) => summary.error || summary.success === false
    );

    // Evaluate all criteria
    // If requireNoErrors is true and there are errors, block completion
    if (stopCriteria.requireNoErrors && hasToolErrors) {
      return {
        shouldStop: false,
        stopReason: 'unknown',
        completionPromiseMatched: true,
      };
    }

    // If requirePassingTests is true, we need:
    // - At least one test command to have been executed (testResults.length > 0)
    // - All test commands to have passed (testsPassed)
    const testsSatisfied =
      !stopCriteria.requirePassingTests || (testResults.length > 0 && testsPassed);
    if (!testsSatisfied) {
      return {
        shouldStop: false,
        stopReason: 'unknown',
        completionPromiseMatched: true,
      };
    }

    // If requireLint is true, we need:
    // - At least one lint command to have been executed (lintResults.length > 0)
    // - All lint commands to have passed (lintPassed)
    const lintSatisfied = !stopCriteria.requireLint || (lintResults.length > 0 && lintPassed);
    if (!lintSatisfied) {
      return {
        shouldStop: false,
        stopReason: 'unknown',
        completionPromiseMatched: true,
      };
    }

    // If requireTsc is true, we need:
    // - At least one tsc command to have been executed (tscResults.length > 0)
    // - All tsc commands to have passed (tscPassed)
    const tscSatisfied = !stopCriteria.requireTsc || (tscResults.length > 0 && tscPassed);
    if (!tscSatisfied) {
      return {
        shouldStop: false,
        stopReason: 'unknown',
        completionPromiseMatched: true,
      };
    }

    // All criteria met - can stop
    return {
      shouldStop: true,
      stopReason: 'complete',
      completionPromiseMatched: true,
    };
  }

  /**
   * Build system prompt with Ralph instructions
   */
  buildSystemPrompt(baseSystemPrompt: string | undefined, config: RalphLoopConfig): string {
    const stopRules: string[] = [];

    if (config.stopCriteria.requirePassingTests) {
      stopRules.push('- Run tests and ensure they pass before completion.');
    }
    if (config.stopCriteria.requireLint) {
      stopRules.push('- Run lint and fix all lint errors before completion.');
    }
    if (config.stopCriteria.requireTsc) {
      stopRules.push('- Run typecheck (tsc) and fix all errors before completion.');
    }
    if (config.stopCriteria.requireNoErrors) {
      stopRules.push('- Do not declare completion if any tool or execution errors occurred.');
    }

    const stopRulesText = stopRules.length
      ? ['Stop criteria:', ...stopRules].join('\n')
      : 'Stop criteria: No additional automated checks required.';

    return [baseSystemPrompt, 'Ralph Loop mode is enabled.', COMPLETION_PROMISE, stopRulesText]
      .filter(Boolean)
      .join('\n\n');
  }

  /**
   * Build iteration messages for next Ralph iteration
   */
  async buildIterationMessages(params: {
    taskId: string;
    includeLastN?: number;
  }): Promise<UIMessage[]> {
    const { taskId, includeLastN } = params;

    const summary = await taskFileService.readFile(
      'context',
      taskId,
      DEFAULT_CONFIG.memory.summaryFileName
    );
    const feedback = await taskFileService.readFile(
      'context',
      taskId,
      DEFAULT_CONFIG.memory.feedbackFileName
    );

    // Get original user message from task
    const task = useTaskStore.getState().getTask(taskId);
    const messages = useTaskStore.getState().getMessages(taskId);
    const userMessage = task?.title || getBaseUserMessage(messages);

    // Get recent messages if configured
    const recentMessages = includeLastN && includeLastN > 0 ? messages.slice(-includeLastN) : [];

    const promptSections = ['## Task', userMessage];

    if (summary) {
      promptSections.push('## Ralph Summary', summary);
    }

    if (feedback) {
      promptSections.push('## Ralph Feedback', feedback);
    }

    // Get attachments from original message
    const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');
    const attachments: MessageAttachment[] = lastUserMessage?.attachments || [];

    return [
      ...recentMessages,
      {
        id: generateId(),
        role: 'user',
        content: promptSections.join('\n\n'),
        timestamp: new Date(),
        attachments,
      },
    ];
  }

  /**
   * Persist iteration artifacts
   */
  private async persistIterationArtifacts(params: {
    taskId: string;
    iteration: number;
    startTime: number;
    fullText: string;
    toolSummaries: ToolSummary[];
    evaluation: {
      shouldStop: boolean;
      stopReason: RalphLoopStopReason;
      stopMessage?: string;
      completionPromiseMatched: boolean;
    };
  }): Promise<void> {
    const { taskId, iteration, startTime, fullText, toolSummaries, evaluation } = params;

    const summaryFile = DEFAULT_CONFIG.memory.summaryFileName;
    const _feedbackFile = DEFAULT_CONFIG.memory.feedbackFileName;
    const stateFile = DEFAULT_CONFIG.memory.stateFileName;

    // Read existing summary
    const existingSummary = await taskFileService.readFile('context', taskId, summaryFile);

    // Get file changes
    const changes = useFileChangesStore.getState().getChanges(taskId);
    const filesChanged = Array.from(new Set(changes.map((change) => change.filePath)));

    // Get task info for objective
    const messages = useTaskStore.getState().getMessages(taskId);
    const userMessage = getBaseUserMessage(messages);

    // Build new iteration content
    const newIterationContent = [
      '',
      `## Iteration ${iteration}`,
      `Stop candidate: ${evaluation.stopReason}`,
      `Completion marker: ${evaluation.completionPromiseMatched ? 'matched' : 'not found'}`,
      evaluation.stopMessage ? `Stop message: ${evaluation.stopMessage}` : null,
      '',
      '## Files Changed',
      filesChanged.length ? filesChanged.map((file) => `- ${file}`).join('\n') : 'None',
      '',
      '## Tool Results',
      toolSummaries.length
        ? toolSummaries
            .map((tool) => {
              const status =
                tool.success === false ? 'failed' : tool.success === true ? 'passed' : 'unknown';
              return `- ${tool.toolName}${tool.command ? ` (${tool.command})` : ''}: ${status}`;
            })
            .join('\n')
        : 'None',
      '',
      '## Last Output (truncated)',
      this.truncateText(fullText, 1200),
    ].filter(Boolean) as string[];

    // Build summary content
    let summaryContent: string;
    if (!existingSummary || existingSummary.trim().length === 0) {
      // Create new summary with objective
      summaryContent = [
        '# Ralph Loop Summary',
        '',
        '## Objective',
        userMessage,
        ...newIterationContent,
      ].join('\n');
    } else {
      // Append to existing summary
      summaryContent = existingSummary.trim() + '\n' + newIterationContent.join('\n');
    }

    await taskFileService.writeFile('context', taskId, summaryFile, summaryContent);

    // Update state file
    const state: RalphLoopStateFile = {
      taskId,
      startedAt: startTime,
      updatedAt: Date.now(),
      iteration,
      stopReason: evaluation.stopReason,
      stopMessage: evaluation.stopMessage,
      completionPromiseMatched: evaluation.completionPromiseMatched,
      errors: [],
    };

    await taskFileService.writeFile('context', taskId, stateFile, JSON.stringify(state, null, 2));

    logger.info('[RalphLoop] Persisted iteration artifacts', {
      taskId,
      iteration,
      stopReason: evaluation.stopReason,
    });
  }

  /**
   * Persist final state when loop stops
   */
  private async persistFinalState(params: {
    taskId: string;
    iteration: number;
    startTime: number;
    stopReason: RalphLoopStopReason;
    stopMessage?: string;
  }): Promise<void> {
    const { taskId, iteration, startTime, stopReason, stopMessage } = params;

    const summaryFile = DEFAULT_CONFIG.memory.summaryFileName;
    const stateFile = DEFAULT_CONFIG.memory.stateFileName;

    // Update state file
    const state: RalphLoopStateFile = {
      taskId,
      startedAt: startTime,
      updatedAt: Date.now(),
      iteration,
      stopReason,
      stopMessage,
      completionPromiseMatched: stopReason === 'complete',
      errors: [],
    };

    await taskFileService.writeFile('context', taskId, stateFile, JSON.stringify(state, null, 2));

    // Ensure summary exists
    const summary = await taskFileService.readFile('context', taskId, summaryFile);
    if (!summary) {
      await taskFileService.writeFile(
        'context',
        taskId,
        summaryFile,
        `# Ralph Loop Summary\n\nStop reason: ${stopReason}`
      );
    }

    logger.info('[RalphLoop] Persisted final state', {
      taskId,
      iteration,
      stopReason,
    });
  }

  /**
   * Truncate text to max length
   */
  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength)}...`;
  }
}

// Singleton instance
export const ralphLoopService = new RalphLoopService();
