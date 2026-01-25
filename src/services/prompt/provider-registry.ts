// src/services/prompt/provider-registry.ts
import type { PromptContextProvider } from '@/types/prompt';
import { AgentsMdProvider, type AgentsMdSettings } from './providers/agents-md-provider';
import { EnvProvider } from './providers/env-provider';
import { OutputFormatProvider } from './providers/output-format-provider';
import { SkillsProvider } from './providers/skills-provider';
import { SubagentsProvider } from './providers/subagents-provider';

type ProviderSettings = Record<string, unknown> & {
  agents_md?: AgentsMdSettings;
};

export class ProviderRegistry {
  private providers: Map<string, PromptContextProvider> = new Map();

  constructor() {
    this.register(EnvProvider);
    this.register(AgentsMdProvider());
    this.register(OutputFormatProvider);
    this.register(SkillsProvider);
    this.register(SubagentsProvider);
  }

  register(provider: PromptContextProvider) {
    this.providers.set(provider.id, provider);
  }

  getAll(): PromptContextProvider[] {
    return Array.from(this.providers.values());
  }

  getByIds(ids: string[]): PromptContextProvider[] {
    const idSet = new Set(ids);
    return this.getAll().filter((p) => idSet.has(p.id));
  }

  // Build providers using optional per-provider settings
  buildProviders(ids: string[], providerSettings?: ProviderSettings): PromptContextProvider[] {
    const result: PromptContextProvider[] = [];
    const idSet = new Set(ids);
    if (idSet.has('env')) result.push(EnvProvider);
    if (idSet.has('agents_md')) result.push(AgentsMdProvider(providerSettings?.agents_md));
    if (idSet.has('output_format')) result.push(OutputFormatProvider);
    if (idSet.has('skills')) result.push(SkillsProvider);
    if (idSet.has('subagents')) result.push(SubagentsProvider);
    return result;
  }
}

export const defaultProviderRegistry = new ProviderRegistry();
