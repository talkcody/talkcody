// src/services/check-finish-service.ts
/**
 * Check Finish Service - LLM-based task completion verification
 *
 * This service uses LLM to verify if the current code implementation
 * actually completes the user's task or requirements.
 * If not complete, it returns a todo list for continued work.
 */

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

export const lastCheckFinishTimestamp = new Map<string, number>();

const BASE_CHECK_FINISH_PROMPT = [
  "Please check if the current code implementation actually completes the user's task or requirements.",
  '',
  'Analyze the following aspects:',
  '1. Are all user requirements from the original task fully implemented?',
  '2. Is the code functional and ready for use?',
  '3. Are there any TODO comments or unfinished parts in the code?',
  '',
  'Output format:',
  '## Task Completion Check',
  '- Status: [COMPLETE / INCOMPLETE]',
  '- Confidence: [HIGH / MEDIUM / LOW]',
  '',
  '## Missing Items (if any)',
  'List specific items that are missing or incomplete. Be specific and actionable.',
  '',
  '## Suggested TODO List',
  'If the task is incomplete, provide a numbered todo list of what needs to be done next.',
  'Format each item as: "- [ ] Specific action to complete"',
  '',
  'IMPORTANT: Be thorough but concise. If the task is truly complete, simply state "COMPLETE" with a brief summary.',
  'If incomplete, focus on actionable items that will help complete the task.',
  'Do not ask questions - only provide the check result.',
  '',
  'Context:',
  '- Original user task: {userMessage}',
  '- Files modified: {fileList}',
].join('\n');

function getTaskSettings(taskId: string): TaskSettings | null {
  const task = useTaskStore.getState().getTask(taskId);
  if (!task?.settings) return null;
  try {
    return JSON.parse(task.settings) as TaskSettings;
  } catch (error) {
    logger.warn('[CheckFinish] Failed to parse task settings', { taskId, error });
    return null;
  }
}

function isAutoCheckFinishEnabled(taskId: string): boolean {
  const globalEnabled = useSettingsStore.getState().getAutoCheckFinishGlobal();
  const settings = getTaskSettings(taskId);
  const taskOverride = settings?.autoCheckFinish;

  if (typeof taskOverride === 'boolean') {
    logger.info('[CheckFinish] Auto check finish resolved from task setting', {
      taskId,
      enabled: taskOverride,
      globalEnabled,
    });
    return taskOverride;
  }

  logger.info('[CheckFinish] Auto check finish resolved from global setting', {
    taskId,
    enabled: globalEnabled,
  });
  return globalEnabled;
}

function buildCheckFinishPrompt(taskId: string, userMessage?: string): string {
  const changes = useFileChangesStore.getState().getChanges(taskId);
  const files = Array.from(new Set(changes.map((change) => change.filePath)));
  const fileList =
    files.length > 0 ? files.map((file) => `- ${file}`).join('\n') : 'No files changed';

  const task = useTaskStore.getState().getTask(taskId);
  const originalUserMessage = userMessage || task?.title || 'Unknown task';
  const prompt = BASE_CHECK_FINISH_PROMPT.replace('{userMessage}', originalUserMessage).replace(
    '{fileList}',
    fileList
  );

  logger.info('[CheckFinish] Built prompt context', {
    taskId,
    originalUserMessageLength: originalUserMessage.length,
    fileCount: files.length,
    filePaths: files,
    promptLength: prompt.length,
  });

  return prompt;
}

function extractSectionContent(text: string, heading: string): string {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const headingRegex = new RegExp(`^${escapedHeading}$`, 'im');
  const headingMatch = headingRegex.exec(text);

  if (!headingMatch) {
    return '';
  }

  const contentStart = headingMatch.index + headingMatch[0].length;
  const remainingText = text.slice(contentStart).replace(/^\s*\n/, '');
  const nextHeadingIndex = remainingText.search(/^## /m);
  const sectionContent =
    nextHeadingIndex >= 0 ? remainingText.slice(0, nextHeadingIndex) : remainingText;

  return sectionContent.trim();
}

function hasMeaningfulSectionContent(content: string): boolean {
  if (!content) return false;

  const normalized = content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ')
    .trim();

  if (!normalized) return false;

  return !/^(none|none found\.?|n\/a|no missing items\.?|no todo items\.?|nothing missing\.?)$/i.test(
    normalized
  );
}

export function parseCheckFinishResult(text: string): {
  status: 'COMPLETE' | 'INCOMPLETE' | 'UNKNOWN';
  isComplete: boolean;
  resultText: string;
  hasActionableItems: boolean;
} {
  const trimmedText = text.trim();
  const upperText = trimmedText.toUpperCase();
  const missingItemsContent = extractSectionContent(trimmedText, '## Missing Items');
  const todoContent = extractSectionContent(trimmedText, '## Suggested TODO List');

  const hasExplicitCompleteStatus =
    upperText.includes('STATUS: COMPLETE') ||
    upperText.includes('## TASK COMPLETION CHECK\n- STATUS: COMPLETE') ||
    /^COMPLETE\b/m.test(trimmedText);
  const hasExplicitIncompleteStatus = upperText.includes('STATUS: INCOMPLETE');
  const status = hasExplicitIncompleteStatus
    ? 'INCOMPLETE'
    : hasExplicitCompleteStatus
      ? 'COMPLETE'
      : 'UNKNOWN';

  const hasUncheckedTodoItems = /- \[ \]/.test(trimmedText);
  const hasMeaningfulMissingItems = hasMeaningfulSectionContent(missingItemsContent);
  const hasMeaningfulTodoContent =
    hasUncheckedTodoItems ||
    hasMeaningfulSectionContent(todoContent.replace(/- \[[^\]]*\]/g, '').trim());
  const hasActionableItems = hasMeaningfulMissingItems || hasMeaningfulTodoContent;

  const isComplete = status === 'COMPLETE';

  return {
    status,
    isComplete,
    resultText: trimmedText,
    hasActionableItems,
  };
}

export class CheckFinishService {
  async run(taskId: string, userMessage?: string): Promise<string | null> {
    if (!taskId) {
      logger.info('[CheckFinish] Skipping because taskId is missing');
      return null;
    }
    if (!isAutoCheckFinishEnabled(taskId)) {
      logger.info('[CheckFinish] Auto check finish disabled, skipping', { taskId });
      return null;
    }

    const changes = useFileChangesStore.getState().getChanges(taskId);
    const changedFiles = Array.from(new Set(changes.map((change) => change.filePath)));

    logger.info('[CheckFinish] Evaluating whether task should be checked', {
      taskId,
      changeCount: changes.length,
      changedFiles,
      lastRecordedCheckTimestamp: lastCheckFinishTimestamp.get(taskId) || 0,
    });

    // Only run if there are file changes or it's a follow-up check
    if (changes.length === 0) {
      logger.info('[CheckFinish] No file changes, skipping', {
        taskId,
        changeCount: 0,
      });
      return null;
    }

    try {
      // Use a simple agent or direct LLM call for the check
      const agent = await agentRegistry.getWithResolvedTools('explore');
      if (!agent) {
        logger.warn('[CheckFinish] Explore agent not found', { taskId });
        return null;
      }

      const resolvedModel = (agent as typeof agent & { model?: string }).model;
      if (!resolvedModel) {
        logger.warn('[CheckFinish] Model not resolved for agent', { taskId });
        return null;
      }

      logger.info('[CheckFinish] Resolved coding agent for completion check', {
        taskId,
        agentId: agent.id,
        model: resolvedModel,
        dynamicPromptEnabled: !!agent.dynamicPrompt?.enabled,
      });

      if (!modelService.isModelAvailableSync(resolvedModel)) {
        logger.warn('[CheckFinish] Model unavailable', { taskId, model: resolvedModel });
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
          logger.info('[CheckFinish] Applied dynamic system prompt preview', {
            taskId,
            workspaceRoot: root,
            systemPromptLength: systemPrompt?.length ?? 0,
          });
        } catch (error) {
          logger.warn('[CheckFinish] Dynamic prompt preview failed', { taskId, error });
        }
      }

      const messages: UIMessage[] = [
        {
          id: `check-finish-${taskId}-${Date.now()}`,
          role: 'user',
          content: buildCheckFinishPrompt(taskId, userMessage),
          timestamp: new Date(),
        },
      ];

      logger.info('[CheckFinish] Prepared nested LLM request', {
        taskId,
        messageCount: messages.length,
        promptLength: typeof messages[0]?.content === 'string' ? messages[0].content.length : 0,
      });

      const llmService = createLLMService(taskId);
      let fullText = '';

      await llmService.runAgentLoop(
        {
          messages,
          model: resolvedModel,
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
            logger.error('[CheckFinish] Check failed', { taskId, error });
          },
        }
      );

      logger.info('[CheckFinish] Nested LLM check completed', {
        taskId,
        outputLength: fullText.length,
      });

      const result = parseCheckFinishResult(fullText);

      logger.info('[CheckFinish] Parsed completion check result', {
        taskId,
        status: result.status,
        isComplete: result.isComplete,
        hasActionableItems: result.hasActionableItems,
        resultLength: result.resultText.length,
      });

      if (result.status === 'COMPLETE') {
        logger.info('[CheckFinish] Task marked complete, skipping continuation message', {
          taskId,
        });
        return null;
      }

      if (result.status !== 'INCOMPLETE') {
        logger.info('[CheckFinish] Completion status not explicit, skipping continuation message', {
          taskId,
          status: result.status,
          hasActionableItems: result.hasActionableItems,
        });
        return null;
      }

      if (!result.resultText) {
        logger.info('[CheckFinish] Incomplete result was empty, skipping continuation message', {
          taskId,
        });
        return null;
      }

      // Only explicit INCOMPLETE results should be surfaced back to the user.
      const formattedResult = [
        '🔍 **Task Completion Check**',
        '',
        result.resultText,
        '',
        '---',
        'Please continue working on the above items to complete the task.',
      ].join('\n');

      logger.info('[CheckFinish] Task incomplete, requesting continuation', {
        taskId,
        hasActionableItems: result.hasActionableItems,
        formattedResultLength: formattedResult.length,
      });

      return formattedResult;
    } catch (error) {
      logger.error('[CheckFinish] Unexpected error', { taskId, error });
      return null;
    }
  }
}

export const checkFinishService = new CheckFinishService();
