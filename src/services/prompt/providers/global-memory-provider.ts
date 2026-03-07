import { memoryService } from '@/services/memory/memory-service';
import type { PromptContextProvider, ResolveContext } from '@/types/prompt';

export type GlobalMemorySettings = {
  maxChars?: number;
};

export function truncateMemoryValue(value: string, maxChars = 4000): string {
  if (!value || value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars).trimEnd()}\n\n...[truncated]`;
}

export function GlobalMemoryProvider(settings?: GlobalMemorySettings): PromptContextProvider {
  const resolveGlobalMemory = async (token: string) => {
    if (token !== 'global_memory') {
      return;
    }

    const document = await memoryService.getGlobalDocument();
    if (!document.content) {
      return;
    }

    return {
      value: truncateMemoryValue(document.content, settings?.maxChars ?? 4000),
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
    description: 'Injects user-level persistent memory from the app data directory',
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
