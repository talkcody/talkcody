import { logger } from '@/lib/logger';
import {
  buildNotificationInput,
  buildPostToolUseInput,
  buildPreToolUseInput,
  buildSessionStartInput,
  buildStopInput,
  buildUserPromptSubmitInput,
  type HookEventContext,
} from '@/services/hooks/hook-events';
import { hookRunner } from '@/services/hooks/hook-runner';
import { emptyHookSummary } from '@/services/hooks/hook-service-utils';
import { hookStateService } from '@/services/hooks/hook-state-service';
import { getEffectiveWorkspaceRoot } from '@/services/workspace-root-service';
import type { HookRunSummary } from '@/types/hooks';
import type { ToolInput, ToolOutput } from '@/types/tool';

export class HookService {
  private async getContext(taskId: string): Promise<HookEventContext> {
    const cwd = await getEffectiveWorkspaceRoot(taskId);
    return {
      sessionId: hookStateService.getSessionId(),
      cwd,
      permissionMode: 'default',
    };
  }

  async runUserPromptSubmit(taskId: string, prompt: string): Promise<HookRunSummary> {
    if (!hookStateService.shouldRunHooks('UserPromptSubmit')) {
      return emptyHookSummary();
    }
    const context = await this.getContext(taskId);
    const input = buildUserPromptSubmitInput(context, prompt);
    return hookRunner.runHooks('UserPromptSubmit', '', input, taskId);
  }

  async runPreToolUse(
    taskId: string,
    toolName: string,
    toolInput: ToolInput,
    toolUseId: string
  ): Promise<HookRunSummary> {
    if (!hookStateService.shouldRunHooks('PreToolUse')) {
      return emptyHookSummary();
    }
    const context = await this.getContext(taskId);
    const input = buildPreToolUseInput(context, toolName, toolInput, toolUseId);
    return hookRunner.runHooks('PreToolUse', toolName, input, taskId);
  }

  async runPostToolUse(
    taskId: string,
    toolName: string,
    toolInput: ToolInput,
    toolOutput: ToolOutput,
    toolUseId: string
  ): Promise<HookRunSummary> {
    if (!hookStateService.shouldRunHooks('PostToolUse')) {
      return emptyHookSummary();
    }
    const context = await this.getContext(taskId);
    const input = buildPostToolUseInput(context, toolName, toolInput, toolOutput, toolUseId);
    return hookRunner.runHooks('PostToolUse', toolName, input, taskId);
  }

  async runNotification(taskId: string, message: string, notificationType: string): Promise<void> {
    if (!hookStateService.shouldRunHooks('Notification')) {
      return;
    }
    const context = await this.getContext(taskId);
    const input = buildNotificationInput(context, message, notificationType);
    await hookRunner.runHooks('Notification', notificationType, input, taskId);
  }

  async runStop(taskId: string): Promise<HookRunSummary> {
    logger.info(`[HookService] Running Stop hooks for task ${taskId}`);
    if (!hookStateService.shouldRunHooks('Stop')) {
      return emptyHookSummary();
    }
    const context = await this.getContext(taskId);
    const input = buildStopInput(context, hookStateService.isStopHookActive());
    return hookRunner.runHooks('Stop', '', input, taskId);
  }

  async runSessionStart(taskId: string, source: 'startup' | 'resume' | 'clear' | 'compact') {
    if (!hookStateService.shouldRunHooks('SessionStart')) {
      return emptyHookSummary();
    }
    const context = await this.getContext(taskId);
    const input = buildSessionStartInput(context, source);
    return hookRunner.runHooks('SessionStart', '', input, taskId);
  }

  applyHookSummary(summary: HookRunSummary): void {
    hookStateService.applyHookSummary(summary);
  }
}

export const hookService = new HookService();
