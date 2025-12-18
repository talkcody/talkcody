// src/services/prompt/preview.ts

import type { AgentDefinition } from '@/types/agent';
import type { PromptBuildResult } from '@/types/prompt';
import { PromptComposer } from './prompt-composer';
import { defaultProviderRegistry } from './provider-registry';

export async function previewSystemPrompt(opts: {
  agent: AgentDefinition;
  workspaceRoot: string;
  extraVariables?: Record<string, string>;
  taskId?: string;
}): Promise<PromptBuildResult> {
  const providers = defaultProviderRegistry.buildProviders(
    opts.agent.dynamicPrompt?.providers || [],
    opts.agent.dynamicPrompt?.providerSettings
  );
  const composer = new PromptComposer(providers);
  return composer.compose({
    agent: opts.agent,
    extraVariables: opts.extraVariables,
    workspaceRoot: opts.workspaceRoot,
    taskId: opts.taskId,
  });
}
