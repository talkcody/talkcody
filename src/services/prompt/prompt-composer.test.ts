import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { AgentDefinition } from '@/types/agent';
import { ModelType } from '@/types/model-types';
import type { PromptContextProvider } from '@/types/prompt';
import type { ToolWithUI } from '@/types/tool';

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    warn: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: mockLogger,
}));

vi.mock('@/services/repository-service', () => ({
  repositoryService: {
    readFile: vi.fn(),
  },
}));

vi.mock('@/stores/settings-store', () => ({
  settingsManager: {
    getSync: vi.fn(() => 'en'),
  },
}));

import { PromptComposer } from './prompt-composer';

function createAgent(): AgentDefinition {
  return {
    id: 'agent-1',
    name: 'Agent One',
    modelType: ModelType.MAIN,
    systemPrompt: 'Base system prompt',
    dynamicPrompt: {
      enabled: true,
      providers: ['task_summary', 'skills'],
      variables: {},
    },
  };
}

function createToolStub(name: string, description: string): ToolWithUI {
  return {
    name,
    description,
    inputSchema: z.object({}),
    execute: async () => ({}),
    renderToolDoing: () => null,
    renderToolResult: () => null,
    canConcurrent: true,
  };
}

describe('PromptComposer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps composing when one auto-injected provider throws', async () => {
    const failingProvider: PromptContextProvider = {
      id: 'task_summary',
      label: 'Task Summary',
      description: 'Loads task summary context',
      providedTokens() {
        return ['task_summary'];
      },
      canResolve(token: string) {
        return token === 'task_summary';
      },
      async resolve() {
        throw new Error('Workspace root is unavailable');
      },
      injection: {
        enabledByDefault: true,
        placement: 'append',
        sectionTitle: 'Task Summary',
        sectionTemplate(values: Record<string, string>) {
          const content = values.task_summary || '';
          return content ? `## Task Summary\n\n${content}` : '';
        },
      },
    };

    const workingProvider: PromptContextProvider = {
      id: 'skills',
      label: 'Skills',
      description: 'Loads skill instructions',
      providedTokens() {
        return ['skills'];
      },
      canResolve(token: string) {
        return token === 'skills';
      },
      async resolve() {
        return '- Use bun run test';
      },
      injection: {
        enabledByDefault: true,
        placement: 'append',
        sectionTitle: 'Skills',
        sectionTemplate(values: Record<string, string>) {
          const content = values.skills || '';
          return content ? `## Skills\n\n${content}` : '';
        },
      },
    };

    const composer = new PromptComposer([failingProvider, workingProvider]);

    const result = await composer.compose({
      agent: createAgent(),
      workspaceRoot: '/repo',
      taskId: 'stale-task',
    });

    expect(result.finalSystemPrompt).toContain('Base system prompt');
    expect(result.finalSystemPrompt).toContain('## Skills');
    expect(result.finalSystemPrompt).toContain('- Use bun run test');
    expect(result.finalSystemPrompt).not.toContain('## Task Summary');
    expect(result.resolvedContextSources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerId: 'skills',
          token: 'skills',
          charsInjected: expect.any(Number),
        }),
      ])
    );
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it('injects shared memory tool activation guidance when memory tools are available', async () => {
    const composer = new PromptComposer([]);

    const result = await composer.compose({
      agent: {
        ...createAgent(),
        tools: {
          memoryRead: createToolStub('memoryRead', 'Read memory'),
          memoryWrite: createToolStub('memoryWrite', 'Write memory'),
        },
      },
      workspaceRoot: '/repo',
    });

    expect(result.finalSystemPrompt).toContain('## Tool Activation Guidance');
    expect(result.finalSystemPrompt).toContain('proactively consider using `memoryRead`');
    expect(result.finalSystemPrompt).toContain('proactively consider using `memoryWrite`');
    expect(result.finalSystemPrompt).toContain('first 200 lines of MEMORY.md');
    expect(result.finalSystemPrompt).toContain('Treat that content as an index');
    expect(result.finalSystemPrompt).toContain('read the referenced topic file before answering');
    expect(result.finalSystemPrompt).toContain('Avoid duplicate memory');
    expect(result.finalSystemPrompt).toContain('organize topics by stable subject');
    expect(result.finalSystemPrompt).toContain(
      'Follow the memory tools\' own rules for scope selection, durability, and error handling.'
    );
  });

  it('injects auto-memory guidance that forbids inferring topic contents from MEMORY.md alone', async () => {
    const composer = new PromptComposer([]);

    const result = await composer.compose({
      agent: {
        ...createAgent(),
        dynamicPrompt: {
          enabled: true,
          providers: ['global_memory'],
          variables: {},
        },
      },
      workspaceRoot: '/repo',
    });

    expect(result.finalSystemPrompt).toContain('Auto memory guidance:');
    expect(result.finalSystemPrompt).toContain('Start with the injected MEMORY.md lines.');
    expect(result.finalSystemPrompt).toContain('read the full MEMORY.md before concluding the memory is missing');
    expect(result.finalSystemPrompt).toContain(
      'Treat MEMORY.md as a routing index, not the detailed memory payload.'
    );
    expect(result.finalSystemPrompt).toContain(
      'Never claim that you know a topic file\'s contents unless you have actually read that topic file.'
    );
    expect(result.finalSystemPrompt).toContain('keep each topic focused on one stable subject');
    expect(result.finalSystemPrompt).toContain('avoid writing duplicate topic routes or duplicate memory facts');
  });

  it('does not inject shared memory guidance when memory tools are unavailable', async () => {
    const composer = new PromptComposer([]);

    const result = await composer.compose({
      agent: createAgent(),
      workspaceRoot: '/repo',
    });

    expect(result.finalSystemPrompt).not.toContain('## Tool Activation Guidance');
    expect(result.finalSystemPrompt).not.toContain('proactively consider using `memoryRead`');
    expect(result.finalSystemPrompt).not.toContain('proactively consider using `memoryWrite`');
  });
});
