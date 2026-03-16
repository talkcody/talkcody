import { memoryService } from '@/services/memory/memory-service';
import type { MemoryContext, MemoryScope } from '@/services/memory/memory-types';
import type { PromptContextProvider, ResolveContext } from '@/types/prompt';

function buildProviderMetadata(scope: MemoryScope) {
  if (scope === 'global') {
    return {
      id: 'global_memory',
      label: 'Global Memory',
      description: 'Injects the first 200 lines of the global MEMORY.md index',
      badges: ['memory'],
      token: 'global_memory',
      sectionTitle: 'Global Memory',
      sectionKind: 'global_memory',
    } as const;
  }

  return {
    id: 'project_memory',
    label: 'Project Memory',
    description: 'Injects the first 200 lines of the project MEMORY.md index',
    badges: ['memory', 'project'],
    token: 'project_memory',
    sectionTitle: 'Project Memory',
    sectionKind: 'project_memory',
  } as const;
}

function buildContext(scope: MemoryScope, ctx: ResolveContext): MemoryContext {
  return scope === 'global'
    ? { scope: 'global' }
    : { scope: 'project', workspaceRoot: ctx.workspaceRoot };
}

export function createMemoryPromptProvider(scope: MemoryScope): PromptContextProvider {
  const metadata = buildProviderMetadata(scope);

  const resolveMemory = async (token: string, ctx: ResolveContext) => {
    if (token !== metadata.token) {
      return;
    }

    const document = await memoryService.getInjectedIndex(buildContext(scope, ctx));
    if (!document.content) {
      return;
    }

    return {
      value: document.content,
      sources: [
        {
          sourcePath: document.path,
          sectionKind: metadata.sectionKind,
        },
      ],
    };
  };

  return {
    id: metadata.id,
    label: metadata.label,
    description: metadata.description,
    badges: [...metadata.badges],
    providedTokens() {
      return [metadata.token];
    },
    canResolve(token: string) {
      return token === metadata.token;
    },
    async resolve(token: string, ctx: ResolveContext) {
      const result = await resolveMemory(token, ctx);
      return result?.value;
    },
    async resolveWithMetadata(token: string, ctx: ResolveContext) {
      return await resolveMemory(token, ctx);
    },
    injection: {
      enabledByDefault: true,
      placement: 'append',
      sectionTitle: metadata.sectionTitle,
      sectionTemplate(values: Record<string, string>) {
        const content = values[metadata.token] || '';
        if (!content) {
          return '';
        }

        return [
          `## ${metadata.sectionTitle}`,
          '',
          `<memory scope="${scope}">\n${content}\n</memory>`,
        ].join('\n');
      },
    },
  };
}
