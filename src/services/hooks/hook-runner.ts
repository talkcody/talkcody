import { appDataDir, join } from '@tauri-apps/api/path';
import { exists, mkdir, remove, writeTextFile } from '@tauri-apps/plugin-fs';
import { platform } from '@tauri-apps/plugin-os';
import { logger } from '@/lib/logger';
import { bashExecutor } from '@/services/bash-executor';
import { hookConfigService } from '@/services/hooks/hook-config-service';
import type {
  HookCommand,
  HookEventName,
  HookInputBase,
  HookOutputCommon,
  HookRule,
  HookRunSummary,
  HooksConfigFile,
} from '@/types/hooks';

interface HookCommandResult {
  output?: HookOutputCommon;
  rawStdout?: string;
  rawStderr?: string;
  exitCode: number;
}

const DEFAULT_TIMEOUT_SEC = 60;
const HOOK_BLOCK_EXIT_CODE = 2;
const HOOKS_DIR = 'hooks';

function normalizeMatcher(matcher?: string): string {
  if (!matcher) return '';
  return matcher.trim();
}

function matcherMatches(matcher: string, value: string): boolean {
  if (!matcher || matcher === '*' || matcher === '') {
    return true;
  }
  if (matcher === value) {
    return true;
  }
  try {
    const regex = new RegExp(matcher);
    return regex.test(value);
  } catch {
    return false;
  }
}

function parseJsonOutput(stdout: string): HookOutputCommon | null {
  const trimmed = stdout.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return null;
  }
  try {
    return JSON.parse(trimmed) as HookOutputCommon;
  } catch {
    return null;
  }
}

function initializeSummary(): HookRunSummary {
  return {
    blocked: false,
    additionalContext: [],
    continue: true,
  };
}

function applyHookOutput(summary: HookRunSummary, output: HookOutputCommon | undefined): void {
  if (!output) return;

  if (typeof output.continue === 'boolean') {
    summary.continue = output.continue;
  }
  if (typeof output.stopReason === 'string') {
    summary.stopReason = output.stopReason;
  }
  if (typeof output.systemMessage === 'string') {
    summary.systemMessage = output.systemMessage;
  }

  if (output.additionalContext) {
    summary.additionalContext.push(output.additionalContext);
  }
  if (output.updatedInput) {
    summary.updatedInput = output.updatedInput;
  }
  const hookSpecific = output.hookSpecificOutput;
  if (hookSpecific?.additionalContext) {
    summary.additionalContext.push(hookSpecific.additionalContext);
  }
  if (hookSpecific?.updatedInput) {
    summary.updatedInput = hookSpecific.updatedInput;
  }
  if (hookSpecific?.permissionDecision) {
    summary.permissionDecision = hookSpecific.permissionDecision;
    summary.permissionDecisionReason = hookSpecific.permissionDecisionReason;
  }

  if (output.decision === 'block' || output.decision === 'deny') {
    summary.blocked = true;
    if (output.reason) {
      summary.blockReason = output.reason;
    }
  }
}

function shouldSkipRule(rule: HookRule): boolean {
  if (rule.enabled === false) return true;
  if (!rule.hooks || rule.hooks.length === 0) return true;
  return false;
}

function shouldSkipHook(hook: HookCommand): boolean {
  if (hook.enabled === false) return true;
  if (!hook.command.trim()) return true;
  return false;
}

async function ensureHooksDir(): Promise<string> {
  const appData = await appDataDir();
  const hooksDir = await join(appData, HOOKS_DIR);
  const dirExists = await exists(hooksDir);
  if (!dirExists) {
    await mkdir(hooksDir, { recursive: true });
  }
  return hooksDir;
}

function buildHookCommand(hookCommand: string, inputFilePath: string, projectDir: string): string {
  const isWindows = platform() === 'windows';
  const quotedFile = `"${inputFilePath}"`;
  const quotedProjectDir = `"${projectDir}"`;

  if (isWindows) {
    return `set "TALKCODY_PROJECT_DIR=${projectDir}" && ${hookCommand} < ${quotedFile}`;
  }

  return `TALKCODY_PROJECT_DIR=${quotedProjectDir} ${hookCommand} < ${quotedFile}`;
}

async function executeHookCommand(
  hook: HookCommand,
  input: HookInputBase,
  taskId: string
): Promise<HookCommandResult> {
  const payload = JSON.stringify(input, null, 0);
  const timeoutMs = (hook.timeout ?? DEFAULT_TIMEOUT_SEC) * 1000;
  const hooksDir = await ensureHooksDir();
  const fileName = `hook-input-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
  const inputPath = await join(hooksDir, fileName);

  try {
    await writeTextFile(inputPath, payload);
    const command = buildHookCommand(hook.command, inputPath, input.cwd);
    const result = await bashExecutor.executeWithTimeout(
      command,
      taskId,
      `hook_${Date.now()}`,
      timeoutMs,
      timeoutMs
    );

    return {
      rawStdout: result.output,
      rawStderr: result.error,
      exitCode: result.exit_code ?? 0,
      output: result.output ? (parseJsonOutput(result.output) ?? undefined) : undefined,
    };
  } finally {
    try {
      await remove(inputPath);
    } catch (error) {
      logger.warn('[HookRunner] Failed to remove hook input file', { inputPath, error });
    }
  }
}

function extractMatchingRules(
  config: HooksConfigFile,
  event: HookEventName,
  matcherValue: string
): HookCommand[] {
  const rules = config.hooks?.[event] ?? [];
  const matches: HookCommand[] = [];

  for (const rule of rules) {
    if (shouldSkipRule(rule)) continue;
    const matcher = normalizeMatcher(rule.matcher);
    if (!matcherMatches(matcher, matcherValue)) {
      continue;
    }
    for (const hook of rule.hooks) {
      if (hook.type !== 'command') continue;
      if (shouldSkipHook(hook)) continue;
      matches.push(hook);
    }
  }

  return matches;
}

export class HookRunner {
  async runHooks(
    event: HookEventName,
    matcherValue: string,
    input: HookInputBase,
    taskId: string
  ): Promise<HookRunSummary> {
    const summary = initializeSummary();

    const mergedConfig = await hookConfigService.loadConfigs();
    const hooks = extractMatchingRules({ hooks: mergedConfig.hooks }, event, matcherValue);

    if (hooks.length === 0) {
      return summary;
    }

    const results = await Promise.all(
      hooks.map(async (hook) => {
        try {
          return await executeHookCommand(hook, input, taskId);
        } catch (error) {
          logger.error('[HookRunner] Hook execution failed', { event, error });
          return { exitCode: 1, rawStderr: String(error) } as HookCommandResult;
        }
      })
    );

    for (const result of results) {
      if (result.exitCode === HOOK_BLOCK_EXIT_CODE) {
        summary.blocked = true;
        // Many CLI tools (e.g. linters) write errors to stdout, not stderr.
        // Combine both so the AI receives the full error output.
        const combinedOutput = [result.rawStdout, result.rawStderr]
          .filter((s) => s && s.trim())
          .join('\n')
          .trim();
        summary.blockReason = combinedOutput || 'Hook blocked execution.';
        summary.continue = false;
      } else if (result.exitCode === 0) {
        applyHookOutput(summary, result.output ?? undefined);
      }
    }

    logger.info('[HookRunner] Hook run summary', { event, summary });

    return summary;
  }
}

export const hookRunner = new HookRunner();
