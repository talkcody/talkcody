import { dirname } from '@tauri-apps/api/path';
import { toast } from 'sonner';
import { logger } from '@/lib/logger';
import { getLocale, type SupportedLocale } from '@/locales';
import { modelService } from '@/providers/stores/provider-store';
import { agentRegistry } from '@/services/agents/agent-registry';
import { executionService } from '@/services/execution-service';
import { messageService } from '@/services/message-service';
import { previewSystemPrompt } from '@/services/prompt/preview';
import { taskService } from '@/services/task-service';
import { getEffectiveWorkspaceRoot } from '@/services/workspace-root-service';
import { useSettingsStore } from '@/stores/settings-store';
import { useTaskQueueStore } from '@/stores/task-queue-store';
import type {
  QueueDraftSnapshot,
  QueuedTaskDraft,
  QueuedTaskOrigin,
  TaskSettings,
  UIMessage,
} from '@/types';

function getTranslations() {
  const language = useSettingsStore.getState().language || 'en';
  return getLocale(language as SupportedLocale);
}

export interface QueueTerminalStateInput {
  taskId: string;
  projectId: string;
  status: 'completed' | 'error' | 'stopped';
}

interface EnqueueDraftOptions {
  notify?: boolean;
}

class TaskQueueService {
  private async getRunningTaskIdsForProject(projectId: string): Promise<string[]> {
    const runningTaskIds = executionService.getRunningTaskIds();
    const runningTasks = await Promise.all(
      runningTaskIds.map(async (taskId) => ({
        taskId,
        projectId: (await taskService.getTaskDetails(taskId))?.project_id ?? null,
      }))
    );

    return runningTasks.filter((task) => task.projectId === projectId).map((task) => task.taskId);
  }

  private relinkDependentDrafts(
    projectId: string,
    previousSourceTaskId: string | null,
    nextSourceTaskId: string
  ): void {
    const store = useTaskQueueStore.getState();
    for (const item of store.getQueue(projectId)) {
      if (item.status !== 'queued') {
        continue;
      }
      if (item.sourceTaskId !== previousSourceTaskId) {
        continue;
      }
      store.updateDraft(projectId, item.id, {
        sourceTaskId: nextSourceTaskId,
      });
    }
  }

  private buildTaskSettingsFromDraft(draft: QueuedTaskDraft): TaskSettings {
    const settings: TaskSettings = {};

    if (typeof draft.planModeEnabled === 'boolean') {
      settings.planModeEnabled = draft.planModeEnabled;
    }

    if (typeof draft.ralphLoopEnabled === 'boolean') {
      settings.ralphLoopEnabled = draft.ralphLoopEnabled;
    }

    if (typeof draft.worktreeEnabled === 'boolean') {
      settings.worktreeEnabled = draft.worktreeEnabled;
    }

    return settings;
  }

  async enqueueDraft(
    snapshot: QueueDraftSnapshot,
    options: EnqueueDraftOptions = {}
  ): Promise<QueuedTaskDraft> {
    const draft = useTaskQueueStore.getState().enqueueDraft(snapshot);
    if (options.notify !== false) {
      toast.success(getTranslations().Chat.queue.added);
    }
    return draft;
  }

  async enqueuePrompts(payload: {
    projectId: string;
    sourceTaskId: string | null;
    prompts: string[];
    repositoryPath?: string;
    selectedFile?: string | null;
    selectedFileContent?: string | null;
    origin?: QueuedTaskOrigin;
  }): Promise<QueuedTaskDraft[]> {
    const drafts: QueuedTaskDraft[] = [];

    for (const prompt of payload.prompts) {
      const snapshot = await this.createSnapshot({
        projectId: payload.projectId,
        sourceTaskId: payload.sourceTaskId,
        prompt,
        repositoryPath: payload.repositoryPath,
        selectedFile: payload.selectedFile,
        selectedFileContent: payload.selectedFileContent,
        origin: payload.origin,
      });
      drafts.push(await this.enqueueDraft(snapshot, { notify: false }));
    }

    if (drafts.length > 0) {
      await this.tryStartNextQueuedItem(payload.projectId);
    }

    return drafts;
  }

  getQueue(projectId: string): QueuedTaskDraft[] {
    return useTaskQueueStore.getState().getQueue(projectId);
  }

  getHead(projectId: string): QueuedTaskDraft | null {
    return useTaskQueueStore.getState().getHead(projectId);
  }

  async handleExecutionTerminalState({
    taskId,
    projectId,
    status,
  }: QueueTerminalStateInput): Promise<void> {
    const head = useTaskQueueStore.getState().getHead(projectId);
    if (!head) {
      return;
    }

    if (status === 'completed') {
      await this.tryStartNextQueuedItem(projectId, taskId);
      return;
    }

    if (head.sourceTaskId === taskId || head.sourceTaskId === null) {
      useTaskQueueStore
        .getState()
        .markBlocked(projectId, head.id, getTranslations().Chat.queue.reasonPreviousFailed);
    }
  }

  async tryStartNextQueuedItem(
    projectId: string,
    completedTaskId?: string
  ): Promise<string | null> {
    const head = useTaskQueueStore.getState().getHead(projectId);
    if (!head || head.status !== 'queued') {
      return null;
    }

    const runningTaskIds = await this.getRunningTaskIdsForProject(projectId);
    const blockingTaskIds = runningTaskIds.filter((taskId) => taskId !== completedTaskId);
    if (blockingTaskIds.length > 0) {
      return null;
    }

    return this.materializeDraft(head);
  }

  async materializeDraft(draft: QueuedTaskDraft): Promise<string | null> {
    let taskId: string | null = null;

    try {
      taskId = await taskService.createTask(draft.prompt, {
        projectId: draft.projectId,
      });

      const taskSettings = this.buildTaskSettingsFromDraft(draft);
      if (Object.keys(taskSettings).length > 0) {
        await taskService.updateTaskSettings(taskId, taskSettings);
      }

      useTaskQueueStore.getState().markStarting(draft.projectId, draft.id, taskId);
      useTaskQueueStore.getState().dequeueStartedDraft(draft.projectId, draft.id);
      this.relinkDependentDrafts(draft.projectId, draft.sourceTaskId, taskId);

      const settingsState = useSettingsStore.getState();
      const agentId = draft.agentId || settingsState.getAgentId();
      let agent = await agentRegistry.getWithResolvedTools(agentId);
      if (!agent) {
        logger.warn(`[TaskQueueService] Agent ${agentId} not found, falling back to planner`);
        agent = await agentRegistry.getWithResolvedTools('planner');
      }

      const resolvedAgentModel = (agent as (typeof agent & { model?: string }) | undefined)?.model;
      const resolvedFallbackModels =
        (agent as (typeof agent & { fallbackModels?: string[] }) | undefined)?.fallbackModels ?? [];
      const model = draft.model || resolvedAgentModel || (await modelService.getCurrentModel());
      const tools = agent?.tools ?? {};

      const executionPromise = (async () => {
        let systemPrompt = agent
          ? typeof agent.systemPrompt === 'function'
            ? await Promise.resolve(agent.systemPrompt())
            : agent.systemPrompt
          : undefined;

        if (agent?.dynamicPrompt?.enabled) {
          try {
            const root = await getEffectiveWorkspaceRoot(taskId);
            const currentWorkingDirectory = draft.selectedFile
              ? await dirname(draft.selectedFile)
              : undefined;
            const { finalSystemPrompt } = await previewSystemPrompt({
              agent,
              workspaceRoot: root,
              taskId,
              currentWorkingDirectory,
              recentFilePaths: draft.selectedFile ? [draft.selectedFile] : undefined,
            });
            systemPrompt = finalSystemPrompt;
          } catch (error) {
            logger.warn(
              '[TaskQueueService] Failed to compose dynamic prompt for queued task',
              error
            );
          }
        }

        await messageService.addUserMessage(taskId, draft.prompt, {
          attachments: draft.attachments,
          agentId,
        });

        const userMessage: UIMessage = {
          id: `queued-${draft.id}`,
          role: 'user',
          content: draft.prompt,
          timestamp: new Date(),
          assistantId: agentId,
          attachments: draft.attachments,
          taskId,
        };

        await executionService.startExecution(
          {
            taskId,
            messages: [userMessage],
            model,
            fallbackModels: draft.model ? undefined : resolvedFallbackModels,
            systemPrompt,
            tools,
            agentId,
            isNewTask: true,
            userMessage: draft.prompt,
          },
          {
            onError: (error) => {
              logger.error('[TaskQueueService] Failed to start queued task execution', error);
              toast.error(error.message);
            },
          }
        );
      })();

      void executionPromise.catch(async (error) => {
        logger.error('[TaskQueueService] Queued task failed before execution could start', error);
        toast.error(getTranslations().Error.generic);
        await this.tryStartNextQueuedItem(draft.projectId);
      });

      toast.success(getTranslations().Chat.queue.started);
      return taskId;
    } catch (error) {
      logger.error('[TaskQueueService] Failed to materialize queued task', error);
      if (useTaskQueueStore.getState().getHead(draft.projectId)?.id === draft.id) {
        useTaskQueueStore
          .getState()
          .markBlocked(draft.projectId, draft.id, getTranslations().Error.generic);
      }
      toast.error(getTranslations().Error.generic);
      return null;
    }
  }

  async createSnapshot(payload: {
    projectId: string;
    sourceTaskId: string | null;
    prompt: string;
    attachments?: QueueDraftSnapshot['attachments'];
    repositoryPath?: string;
    selectedFile?: string | null;
    selectedFileContent?: string | null;
    origin?: QueuedTaskOrigin;
  }): Promise<QueueDraftSnapshot> {
    const settingsState = useSettingsStore.getState();
    const model = await modelService.getCurrentModel();
    const agentId = settingsState.getAgentId();

    return {
      projectId: payload.projectId,
      sourceTaskId: payload.sourceTaskId,
      prompt: payload.prompt,
      attachments: payload.attachments,
      origin: payload.origin ?? 'composer_queue_button',
      agentId,
      model,
      repositoryPath: payload.repositoryPath,
      selectedFile: payload.selectedFile,
      selectedFileContent: payload.selectedFileContent,
      planModeEnabled: settingsState.getPlanModeEnabled(),
      ralphLoopEnabled: settingsState.getRalphLoopEnabled(),
      worktreeEnabled: settingsState.getWorktreeModeEnabled(),
    };
  }
}

export const taskQueueService = new TaskQueueService();
