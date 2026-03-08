// src/services/prompt/preview.ts

import { settingsManager } from '@/stores/settings-store';
import type { AgentDefinition } from '@/types/agent';
import type { PromptBuildResult } from '@/types/prompt';
import { PromptComposer } from './prompt-composer';
import { defaultProviderRegistry } from './provider-registry';

function buildDisabledMemoryVariables(options: {
  globalMemoryEnabled: boolean;
  projectMemoryEnabled: boolean;
}): Record<string, string> {
  const variables: Record<string, string> = {};

  if (!options.globalMemoryEnabled) {
    variables.global_memory = '';
  }

  if (!options.projectMemoryEnabled) {
    variables.project_memory = '';
  }

  return variables;
}

export function filterDynamicPromptProviders(
  providerIds: string[],
  options: {
    globalMemoryEnabled: boolean;
    projectMemoryEnabled: boolean;
  }
): string[] {
  return providerIds.filter((providerId) => {
    if (providerId === 'global_memory') {
      return options.globalMemoryEnabled;
    }

    if (providerId === 'project_memory') {
      return options.projectMemoryEnabled;
    }

    return true;
  });
}

export async function previewSystemPrompt(opts: {
  agent: AgentDefinition;
  workspaceRoot: string;
  extraVariables?: Record<string, string>;
  taskId?: string;
  currentWorkingDirectory?: string;
  recentFilePaths?: string[];
}): Promise<PromptBuildResult> {
  const memoryOptions = {
    globalMemoryEnabled: settingsManager.getMemoryGlobalEnabled(),
    projectMemoryEnabled: settingsManager.getMemoryProjectEnabled(),
  };
  const providerIds = filterDynamicPromptProviders(
    opts.agent.dynamicPrompt?.providers || [],
    memoryOptions
  );
  const disabledMemoryVariables = buildDisabledMemoryVariables(memoryOptions);
  const agent: AgentDefinition = opts.agent.dynamicPrompt
    ? {
        ...opts.agent,
        dynamicPrompt: {
          ...opts.agent.dynamicPrompt,
          providers: providerIds,
          variables: {
            ...(opts.agent.dynamicPrompt.variables ?? {}),
            ...disabledMemoryVariables,
          },
        },
      }
    : opts.agent;

  const providers = defaultProviderRegistry.buildProviders(
    providerIds,
    opts.agent.dynamicPrompt?.providerSettings
  );
  const composer = new PromptComposer(providers);
  return composer.compose({
    agent,
    extraVariables: {
      ...(opts.extraVariables ?? {}),
      ...disabledMemoryVariables,
    },
    workspaceRoot: opts.workspaceRoot,
    taskId: opts.taskId,
    currentWorkingDirectory: opts.currentWorkingDirectory,
    recentFilePaths: opts.recentFilePaths,
  });
}
