// src/services/prompt/prompt-composer.ts

import { logger } from '@/lib/logger';
import { buildAutoMemoryGuidance } from '@/services/memory/memory-guidance';
import { repositoryService } from '@/services/repository-service';
import { settingsManager } from '@/stores/settings-store';
import type {
  InjectionPlacement,
  PromptBuildOptions,
  PromptBuildResult,
  PromptContextProvider,
  PromptContextSource,
  ProviderResolveResult,
  ResolveContext,
} from '@/types/prompt';
import { buildSharedOperationalGuidance } from './shared-operational-guidance';

function collectPlaceholders(text: string): string[] {
  const re = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;
  const tokens = new Set<string>();
  let match: RegExpExecArray | null = re.exec(text);
  while (match) {
    const token = match[1];
    if (token) {
      tokens.add(token);
    }
    match = re.exec(text);
  }
  return Array.from(tokens);
}

function replaceAllPlaceholders(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (m, p1) => {
    if (p1) {
      const v = values[p1];
      return v !== undefined ? v : m;
    }
    return m;
  });
}

function joinSections(sections: string[]): string {
  return sections.filter(Boolean).join('\n\n---\n\n');
}

async function resolveProviderToken(
  provider: PromptContextProvider,
  token: string,
  ctx: ResolveContext
): Promise<ProviderResolveResult | undefined> {
  try {
    if (provider.resolveWithMetadata) {
      return await provider.resolveWithMetadata(token, ctx);
    }

    const value = await provider.resolve(token, ctx);
    if (value === undefined) {
      return undefined;
    }

    return { value };
  } catch (error) {
    logger.warn('[PromptComposer] Provider resolve failed', {
      providerId: provider.id,
      token,
      error,
    });
    return undefined;
  }
}

function appendResolvedSources(
  target: PromptContextSource[],
  provider: PromptContextProvider,
  token: string,
  result: ProviderResolveResult | undefined
) {
  if (!result?.value) {
    return;
  }

  const descriptors = result.sources && result.sources.length > 0 ? result.sources : [{}];
  const charsInjected = result.value.length;

  for (const descriptor of descriptors) {
    const key = `${provider.id}|${token}|${descriptor.sourcePath ?? ''}|${descriptor.sectionKind ?? ''}|${charsInjected}`;
    if (
      target.some(
        (source) =>
          `${source.providerId}|${source.token}|${source.sourcePath ?? ''}|${source.sectionKind ?? ''}|${source.charsInjected}` ===
          key
      )
    ) {
      continue;
    }

    target.push({
      providerId: provider.id,
      providerLabel: provider.label,
      token,
      sourcePath: descriptor.sourcePath,
      sectionKind: descriptor.sectionKind,
      charsInjected,
    });
  }
}

function renderInjectedSection(
  provider: PromptContextProvider,
  values: Record<string, string>
): string {
  const injection = provider.injection;
  if (!injection) {
    return '';
  }

  try {
    return injection.sectionTemplate(values);
  } catch (error) {
    logger.warn('[PromptComposer] Provider section render failed', {
      providerId: provider.id,
      error,
    });
    return '';
  }
}

export class PromptComposer {
  private providers: PromptContextProvider[];

  constructor(providers: PromptContextProvider[]) {
    this.providers = providers;
  }

  async compose(options: PromptBuildOptions): Promise<PromptBuildResult> {
    const {
      agent,
      extraVariables,
      workspaceRoot,
      currentWorkingDirectory,
      recentFilePaths,
      taskId,
    } = options;

    // Extract systemPrompt from agent (handle function case)
    let baseSystem = '';
    if (typeof agent.systemPrompt === 'string') {
      baseSystem = agent.systemPrompt;
    } else if (typeof agent.systemPrompt === 'function') {
      baseSystem = await Promise.resolve(agent.systemPrompt());
    }

    const sections: string[] = [];
    sections.push(baseSystem);

    // Add rules if present
    if (agent.rules) {
      const rules = agent.rules
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      if (rules.length) {
        sections.push(`You must follow the following rules:\n\n${rules.join('\n')}`);
      }
    }

    // Add output format if present
    if (agent.outputFormat) {
      sections.push(agent.outputFormat);
    }

    const sharedOperationalGuidance = buildSharedOperationalGuidance(agent);
    if (sharedOperationalGuidance) {
      sections.push(sharedOperationalGuidance);
    }

    const enabledProviderIds = new Set(agent.dynamicPrompt?.providers || []);
    const autoMemoryGuidance = buildAutoMemoryGuidance(enabledProviderIds);
    if (autoMemoryGuidance) {
      sections.push(autoMemoryGuidance);
    }

    let raw = joinSections(sections);

    const ctx: ResolveContext = {
      workspaceRoot,
      currentWorkingDirectory,
      recentFilePaths,
      taskId,
      agentId: agent.id,
      cache: new Map(),
      readFile: (root, file) => repositoryService.readFile(root, file),
    };

    const enabledProviders = this.providers.filter((p) => enabledProviderIds.has(p.id));

    const explicitTokens = collectPlaceholders(raw);
    const resolvedContextSources: PromptContextSource[] = [];

    // Resolve values: explicit placeholders first
    const resolvedValues: Record<string, string> = {};
    const unresolved = new Set<string>(explicitTokens);

    const variablesSources: Array<Record<string, string> | undefined> = [
      extraVariables,
      agent.dynamicPrompt?.variables,
    ];

    // 1) variables override
    for (const source of variablesSources) {
      if (!source) continue;
      for (const [k, v] of Object.entries(source)) {
        if (explicitTokens.includes(k)) {
          resolvedValues[k] = v;
          unresolved.delete(k);
        }
      }
    }

    // 2) providers for remaining explicit tokens
    for (const token of Array.from(unresolved)) {
      for (const provider of enabledProviders) {
        if (!provider.canResolve(token)) continue;
        const result = await resolveProviderToken(provider, token, ctx);
        if (result?.value !== undefined) {
          resolvedValues[token] = result.value;
          unresolved.delete(token);
          appendResolvedSources(resolvedContextSources, provider, token, result);
          break;
        }
      }
    }

    // Replace explicit placeholders
    raw = replaceAllPlaceholders(raw, resolvedValues);

    // Auto-injection: providers may inject standard section if token not explicitly used
    if (agent.dynamicPrompt?.enabled) {
      const autoSections: Array<{
        placement: InjectionPlacement;
        text: string;
      }> = [];

      for (const provider of enabledProviders) {
        const inj = provider.injection;
        if (!inj?.enabledByDefault) continue;

        // If any of provider tokens already present explicitly in template, skip auto inject
        const tokens = provider.providedTokens();
        const isExplicit = tokens.some((t) => explicitTokens.includes(t));
        if (isExplicit) continue;

        // Try to resolve all tokens provider can provide and render its section
        const tokenValues: Record<string, string> = { ...resolvedValues };
        for (const t of tokens) {
          if (tokenValues[t] !== undefined) continue;
          // variable overrides for auto as well
          if (extraVariables && extraVariables[t] !== undefined) {
            tokenValues[t] = extraVariables[t];
            continue;
          }
          if (agent.dynamicPrompt?.variables && agent.dynamicPrompt.variables[t] !== undefined) {
            tokenValues[t] = agent.dynamicPrompt.variables[t];
            continue;
          }
          const result = await resolveProviderToken(provider, t, ctx);
          if (result?.value !== undefined) {
            tokenValues[t] = result.value;
            appendResolvedSources(resolvedContextSources, provider, t, result);
          }
        }

        const sectionText = renderInjectedSection(provider, tokenValues);
        if (sectionText?.trim().length) {
          autoSections.push({ placement: inj.placement, text: sectionText });
        }
      }

      // Apply auto sections by placement
      for (const s of autoSections) {
        if (s.placement === 'prepend') {
          raw = joinSections([s.text, raw]);
        } else if (s.placement === 'append') {
          raw = joinSections([raw, s.text]);
        } else if (typeof s.placement === 'object' && 'anchorToken' in s.placement) {
          const anchor = s.placement.anchorToken;
          const anchorPattern = new RegExp(
            `\\{\\{\\s*${anchor.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\s*\\}\\}`,
            'g'
          );
          if (anchorPattern.test(raw)) {
            raw = raw.replace(anchorPattern, s.text);
          } else {
            raw = joinSections([raw, s.text]);
          }
        }
      }
    }

    // Append output language instruction based on user's language setting
    const language = settingsManager.getSync('language');
    if (language === 'zh') {
      raw = `${raw}\n\nIMPORTANT: You MUST respond in Chinese.`;
    } else {
      raw = `${raw}\n\nIMPORTANT: You MUST respond in English.`;
    }

    return {
      finalSystemPrompt: raw,
      unresolvedPlaceholders: Array.from(unresolved),
      resolvedContextSources,
    };
  }
}
