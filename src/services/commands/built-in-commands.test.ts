import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandType, type CommandContext } from '@/types/command';

vi.mock('@/services/context/manual-context-compaction', () => ({
  compactTaskContext: vi.fn(),
}));

import { getBuiltInCommands } from './built-in-commands';

describe('getBuiltInCommands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not expose the memory command anymore', async () => {
    const commands = await getBuiltInCommands();

    expect(commands.find((command) => command.id === 'memory')).toBeUndefined();
    expect(commands.find((command) => command.name === 'memory')).toBeUndefined();
  });

  it('includes create-tool command with preferred agent and install guidance', async () => {
    const commands = await getBuiltInCommands();
    const createTool = commands.find((command) => command.id === 'create-tool');

    expect(createTool).toBeDefined();
    expect(createTool?.name).toBe('create-tool');
    expect(createTool?.type).toBe(CommandType.AI_PROMPT);
    expect(createTool?.preferredAgentId).toBe('create-tool');

    const result = await createTool?.executor({}, {} as CommandContext);
    expect(result?.success).toBe(true);
    expect(result?.continueProcessing).toBe(true);
    expect(result?.aiMessage).toContain('custom TalkCody tool');
    expect(result?.aiMessage).toContain('Custom Tools');
    expect(result?.aiMessage).toContain('Tool Playground');
  });

  it('includes create-agent command with preferred agent and registration guidance', async () => {
    const commands = await getBuiltInCommands();
    const createAgent = commands.find((command) => command.id === 'create-agent');

    expect(createAgent).toBeDefined();
    expect(createAgent?.name).toBe('create-agent');
    expect(createAgent?.type).toBe(CommandType.AI_PROMPT);
    expect(createAgent?.preferredAgentId).toBe('create-agent');

    const result = await createAgent?.executor({}, {} as CommandContext);
    expect(result?.success).toBe(true);
    expect(result?.continueProcessing).toBe(true);
    expect(result?.aiMessage).toContain('custom TalkCody agent');
    expect(result?.aiMessage).toContain('.talkcody/agents');
    expect(result?.aiMessage).toContain('writeFile tool');
  });

  it('includes create-skill command with preferred agent and skill guidance', async () => {
    const commands = await getBuiltInCommands();
    const createSkill = commands.find((command) => command.id === 'create-skill');

    expect(createSkill).toBeDefined();
    expect(createSkill?.name).toBe('create-skill');
    expect(createSkill?.type).toBe(CommandType.AI_PROMPT);
    expect(createSkill?.preferredAgentId).toBe('create-skill');

    const result = await createSkill?.executor({}, {} as CommandContext);
    expect(result?.success).toBe(true);
    expect(result?.continueProcessing).toBe(true);
    expect(result?.aiMessage).toContain('custom local TalkCody skill');
    expect(result?.aiMessage).toContain('SKILL.md');
    expect(result?.aiMessage).toContain('AgentSkillService.getSkillsDirPath');
  });
});
