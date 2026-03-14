import { memoryService } from '@/services/memory/memory-service';
import type { PromptContextProvider, ResolveContext } from '@/types/prompt';

export type ProjectMemorySettings = Record<string, never>;

export function ProjectMemoryProvider(settings?: ProjectMemorySettings): PromptContextProvider {
  const resolveProjectMemory = async (token: string, ctx: ResolveContext) => {
    if (token !== 'project_memory') {
      return;
    }

    void settings;

    const document = await memoryService.getInjectedDocument('project', {
      workspaceRoot: ctx.workspaceRoot,
      taskId: ctx.taskId,
    });
    if (!document.content) {
      return;
    }

    return {
      value: document.content,
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
    description: 'Injects the first 200 lines of the project MEMORY.md index',
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
