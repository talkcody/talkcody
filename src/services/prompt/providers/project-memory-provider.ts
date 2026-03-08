import { memoryService } from '@/services/memory/memory-service';
import type { PromptContextProvider, ResolveContext } from '@/types/prompt';
import { truncateMemoryValue } from './global-memory-provider';

export type ProjectMemorySettings = {
  maxChars?: number;
};

export function ProjectMemoryProvider(settings?: ProjectMemorySettings): PromptContextProvider {
  const resolveProjectMemory = async (token: string, ctx: ResolveContext) => {
    if (token !== 'project_memory') {
      return;
    }

    const document = await memoryService.getProjectMemoryDocument(ctx.workspaceRoot);
    if (!document.content) {
      return;
    }

    return {
      value: truncateMemoryValue(document.content, settings?.maxChars ?? 4000),
      sources: [
        {
          sourcePath: document.path,
          sectionKind: 'project_memory',
        },
      ],
    };
  };

  return {
    id: 'project_memory',
    label: 'Project Memory',
    description:
      'Injects the root Long-Term Memory section from the current workspace instruction file',
    badges: ['memory', 'project'],
    providedTokens() {
      return ['project_memory'];
    },
    canResolve(token: string) {
      return token === 'project_memory';
    },
    async resolve(token: string, ctx: ResolveContext) {
      const result = await resolveProjectMemory(token, ctx);
      return result?.value;
    },
    async resolveWithMetadata(token: string, ctx: ResolveContext) {
      return await resolveProjectMemory(token, ctx);
    },
    injection: {
      enabledByDefault: true,
      placement: 'append',
      sectionTitle: 'Project Memory',
      sectionTemplate(values: Record<string, string>) {
        const content = values.project_memory || '';
        if (!content) return '';
        return ['## Project Memory', '', `<memory scope="project">\n${content}\n</memory>`].join(
          '\n'
        );
      },
    },
  };
}
