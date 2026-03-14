import { memoryService } from '@/services/memory/memory-service';
import type { PromptContextProvider, ResolveContext } from '@/types/prompt';

export type GlobalMemorySettings = Record<string, never>;

export function GlobalMemoryProvider(settings?: GlobalMemorySettings): PromptContextProvider {
  const resolveGlobalMemory = async (token: string) => {
    if (token !== 'global_memory') {
      return;
    }

    void settings;

    const document = await memoryService.getInjectedDocument('global');
    if (!document.content) {
      return;
    }

    return {
      value: document.content,
      sources: [
        {
          sourcePath: document.path,
          sectionKind: 'global_memory',
        },
      ],
    };
  };

  return {
    id: 'global_memory',
    label: 'Global Memory',
    description: 'Injects the first 200 lines of the global MEMORY.md index',
    badges: ['memory'],
    providedTokens() {
      return ['global_memory'];
    },
    canResolve(token: string) {
      return token === 'global_memory';
    },
    async resolve(token: string, _ctx: ResolveContext) {
      const result = await resolveGlobalMemory(token);
      return result?.value;
    },
    async resolveWithMetadata(token: string, _ctx: ResolveContext) {
      return await resolveGlobalMemory(token);
    },
    injection: {
      enabledByDefault: true,
      placement: 'append',
      sectionTitle: 'Global Memory',
      sectionTemplate(values: Record<string, string>) {
        const content = values.global_memory || '';
        if (!content) return '';
        return ['## Global Memory', '', `<memory scope="global">\n${content}\n</memory>`].join(
          '\n'
        );
      },
    },
  };
}
