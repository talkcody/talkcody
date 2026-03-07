import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentDefinition } from '@/types/agent';
import { ModelType } from '@/types/model-types';

const {
  buildProvidersMock,
  getMemoryGlobalEnabledMock,
  getMemoryProjectEnabledMock,
} = vi.hoisted(() => ({
  buildProvidersMock: vi.fn(() => []),
  getMemoryGlobalEnabledMock: vi.fn(() => true),
  getMemoryProjectEnabledMock: vi.fn(() => true),
}));

vi.mock('@/stores/settings-store', () => ({
  settingsManager: {
    getMemoryGlobalEnabled: getMemoryGlobalEnabledMock,
    getMemoryProjectEnabled: getMemoryProjectEnabledMock,
    getSync: vi.fn(() => 'en'),
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: vi.fn(),
  },
}));

vi.mock('@/services/repository-service', () => ({
  repositoryService: {
    readFile: vi.fn(),
  },
}));

vi.mock('./provider-registry', () => ({
  defaultProviderRegistry: {
    buildProviders: buildProvidersMock,
  },
}));

import { filterDynamicPromptProviders, previewSystemPrompt } from './preview';

function createAgent(overrides?: Partial<AgentDefinition>): AgentDefinition {
  return {
    id: 'agent-1',
    name: 'Agent One',
    modelType: ModelType.MAIN,
    systemPrompt: 'Base system prompt',
    dynamicPrompt: {
      enabled: true,
      providers: ['env', 'global_memory', 'project_memory', 'agents_md'],
      variables: {},
      providerSettings: {},
    },
    ...overrides,
  };
}

describe('filterDynamicPromptProviders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMemoryGlobalEnabledMock.mockReturnValue(true);
    getMemoryProjectEnabledMock.mockReturnValue(true);
    buildProvidersMock.mockReturnValue([]);
  });

  it('removes disabled global_memory provider while preserving unrelated providers', () => {
    const providers = filterDynamicPromptProviders(
      ['env', 'global_memory', 'project_memory', 'agents_md', 'skills'],
      {
        globalMemoryEnabled: false,
        projectMemoryEnabled: true,
      }
    );

    expect(providers).toEqual(['env', 'project_memory', 'agents_md', 'skills']);
  });

  it('removes disabled project_memory provider while preserving agents_md instructions', () => {
    const providers = filterDynamicPromptProviders(
      ['env', 'global_memory', 'project_memory', 'agents_md', 'skills'],
      {
        globalMemoryEnabled: true,
        projectMemoryEnabled: false,
      }
    );

    expect(providers).toEqual(['env', 'global_memory', 'agents_md', 'skills']);
  });

  it('passes enabled providers through without rewriting provider settings', async () => {
    await previewSystemPrompt({
      agent: createAgent({
        dynamicPrompt: {
          enabled: true,
          providers: ['project_memory', 'agents_md', 'skills'],
          variables: {},
          providerSettings: {
            agents_md: {
              maxChars: 123,
            },
          },
        },
      }),
      workspaceRoot: '/repo',
    });

    expect(buildProvidersMock).toHaveBeenCalledWith(['project_memory', 'agents_md', 'skills'], {
      agents_md: {
        maxChars: 123,
      },
    });
  });

  it('replaces disabled global_memory placeholders with empty content', async () => {
    getMemoryGlobalEnabledMock.mockReturnValue(false);

    const result = await previewSystemPrompt({
      agent: createAgent({
        systemPrompt: 'Before\n\n{{global_memory}}\n\nAfter',
        dynamicPrompt: {
          enabled: true,
          providers: ['global_memory'],
          variables: {
            global_memory: 'Should be suppressed',
          },
          providerSettings: {},
        },
      }),
      workspaceRoot: '/repo',
    });

    expect(buildProvidersMock).toHaveBeenCalledWith([], {});
    expect(result.finalSystemPrompt).not.toContain('{{global_memory}}');
    expect(result.finalSystemPrompt).not.toContain('Should be suppressed');
    expect(result.finalSystemPrompt).toContain('Before');
    expect(result.finalSystemPrompt).toContain('After');
  });

  it('replaces disabled project_memory placeholders with empty content', async () => {
    getMemoryProjectEnabledMock.mockReturnValue(false);

    const result = await previewSystemPrompt({
      agent: createAgent({
        systemPrompt: 'Before\n\n{{project_memory}}\n\nAfter',
        dynamicPrompt: {
          enabled: true,
          providers: ['project_memory'],
          variables: {
            project_memory: 'Should be suppressed',
          },
          providerSettings: {},
        },
      }),
      workspaceRoot: '/repo',
    });

    expect(buildProvidersMock).toHaveBeenCalledWith([], {});
    expect(result.finalSystemPrompt).not.toContain('{{project_memory}}');
    expect(result.finalSystemPrompt).not.toContain('Should be suppressed');
    expect(result.finalSystemPrompt).toContain('Before');
    expect(result.finalSystemPrompt).toContain('After');
  });
});
