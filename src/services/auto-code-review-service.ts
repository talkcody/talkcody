// src/services/auto-code-review-service.ts

import { logger } from '@/lib/logger';
import { modelService } from '@/providers/stores/provider-store';
import { agentRegistry } from '@/services/agents/agent-registry';
import { createLLMService } from '@/services/agents/llm-service';
import { previewSystemPrompt } from '@/services/prompt/preview';
import { getEffectiveWorkspaceRoot } from '@/services/workspace-root-service';
import { useFileChangesStore } from '@/stores/file-changes-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useTaskStore } from '@/stores/task-store';
import type { UIMessage } from '@/types/agent';
import type { TaskSettings } from '@/types/task';

export const lastReviewedChangeTimestamp = new Map<string, number>();

const BASE_REVIEW_PROMPT = [
  'Review ONLY the files listed below for this task.',
  'Read the specified files to understand the changes.',
  'Focus on code quality, bugs, security issues, and best practices.',
  'Output sections: REVIEW SUMMARY, CRITICAL ISSUES (Blockers), MAJOR ISSUES (Required Changes).',
  'If none, say "None found.".',
  'IMPORTANT: Only review the files listed below. Do not mention, reference, or ask about any other files.',
  'IMPORTANT: Return only the code review results. Do not ask any questions.',
].join('\n');

function getTaskSettings(taskId: string): TaskSettings | null {
  const task = useTaskStore.getState().getTask(taskId);
  if (!task?.settings) return null;
  try {
    return JSON.parse(task.settings) as TaskSettings;
  } catch (error) {
    logger.warn('[AutoCodeReview] Failed to parse task settings', { taskId, error });
    return null;
  }
}

function isAutoCodeReviewEnabled(taskId: string): boolean {
  const globalEnabled = useSettingsStore.getState().getAutoCodeReviewGlobal();
  const settings = getTaskSettings(taskId);
  if (typeof settings?.autoCodeReview === 'boolean') {
    return settings.autoCodeReview;
  }
  return globalEnabled;
}

function getLatestChangeTimestamp(taskId: string): number {
  const changes = useFileChangesStore.getState().getChanges(taskId);
  return changes.reduce((latest, change) => Math.max(latest, change.timestamp), 0);
}

function buildReviewPrompt(taskId: string): string {
  const changes = useFileChangesStore.getState().getChanges(taskId);
  const files = Array.from(new Set(changes.map((change) => change.filePath)));
  if (files.length === 0) {
    return BASE_REVIEW_PROMPT;
  }
  const fileList = files.map((file) => `- ${file}`).join('\n');
  return `${BASE_REVIEW_PROMPT}\n\nChanged files:\n${fileList}`;
}

export class AutoCodeReviewService {
  async run(taskId: string): Promise<string | null> {
    if (!taskId) return null;
    if (!isAutoCodeReviewEnabled(taskId)) return null;

    const changes = useFileChangesStore.getState().getChanges(taskId);
    if (changes.length === 0) return null;

    const latestChange = getLatestChangeTimestamp(taskId);
    const lastReviewed = lastReviewedChangeTimestamp.get(taskId) || 0;
    if (latestChange <= lastReviewed) return null;

    try {
      const agent = await agentRegistry.getWithResolvedTools('code-review');
      if (!agent) {
        logger.warn('[AutoCodeReview] Code review agent not found', { taskId });
        return null;
      }

      const resolvedModel = (agent as typeof agent & { model?: string }).model;
      const resolvedFallbackModels =
        (agent as typeof agent & { fallbackModels?: string[] }).fallbackModels ?? [];
      if (!resolvedModel) {
        logger.warn('[AutoCodeReview] Model not resolved for code review agent', { taskId });
        return null;
      }

      if (!modelService.isModelAvailableSync(resolvedModel)) {
        logger.warn('[AutoCodeReview] Model unavailable for code review agent', {
          taskId,
          model: resolvedModel,
        });
        return null;
      }

      let systemPrompt: string | undefined;
      if (typeof agent.systemPrompt === 'function') {
        systemPrompt = await Promise.resolve(agent.systemPrompt());
      } else {
        systemPrompt = agent.systemPrompt;
      }

      if (agent.dynamicPrompt?.enabled) {
        try {
          const root = await getEffectiveWorkspaceRoot(taskId);
          const { finalSystemPrompt } = await previewSystemPrompt({
            agent,
            workspaceRoot: root,
            taskId,
          });
          systemPrompt = finalSystemPrompt;
        } catch (error) {
          logger.warn('[AutoCodeReview] Dynamic prompt preview failed', { taskId, error });
        }
      }

      const messages: UIMessage[] = [
        {
          id: `auto-review-${taskId}-${Date.now()}`,
          role: 'user',
          content: buildReviewPrompt(taskId),
          timestamp: new Date(),
        },
      ];

      const llmService = createLLMService(taskId);
      let fullText = '';

      await llmService.runAgentLoop(
        {
          messages,
          model: resolvedModel,
          fallbackModels: resolvedFallbackModels,
          systemPrompt,
          tools: agent.tools,
          isSubagent: true,
          suppressReasoning: true,
          agentId: agent.id,
        },
        {
          onChunk: (chunk) => {
            fullText += chunk;
          },
          onComplete: (finalText) => {
            if (finalText) {
              fullText = finalText;
            }
          },
          onError: (error) => {
            logger.error('[AutoCodeReview] Code review failed', { taskId, error });
          },
        }
      );

      const reviewText = fullText.trim();
      if (reviewText) {
        lastReviewedChangeTimestamp.set(taskId, latestChange);
        return reviewText;
      }
      return null;
    } catch (error) {
      logger.error('[AutoCodeReview] Unexpected error', { taskId, error });
      return null;
    }
  }
}

export const autoCodeReviewService = new AutoCodeReviewService();
