import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  };
  return {
    logger,
    default: logger,
  };
});

vi.mock('@/services/agents/agent-registry', () => ({
  agentRegistry: {
    getWithResolvedTools: vi.fn(async (agentId: string) => {
      // Mock different agent types for testing
      if (agentId === 'context-gatherer') {
        return {
          id: 'context-gatherer',
          role: 'information-gathering',
          tools: {
            readFile: { execute: vi.fn() },
            codeSearch: { execute: vi.fn() },
            listFiles: { execute: vi.fn() },
          },
        };
      }
      if (agentId === 'coding') {
        return {
          id: 'coding',
          role: 'content-modification',
          tools: {
            readFile: { execute: vi.fn() },
            writeFile: { execute: vi.fn() },
            editFile: { execute: vi.fn() },
          },
        };
      }
      if (agentId === 'general') {
        return {
          id: 'general',
          role: 'content-modification',
          tools: {
            webSearch: { execute: vi.fn() },
          },
        };
      }
      return null;
    }),
  },
}));

vi.mock('@/lib/tools', () => ({
  getAllToolNames: vi.fn(() => [
    'readFile',
    'writeFile',
    'editFile',
    'codeSearch',
    'listFiles',
    'callAgent',
    'callAgentV2',
    'grepSearch',
    'webSearch',
  ]),
  getToolMetadata: vi.fn((toolName: string) => ({
    category: toolName === 'readFile' ? 'read' 
             : toolName === 'codeSearch' ? 'read'
             : toolName === 'listFiles' ? 'read'
             : toolName === 'writeFile' ? 'write'
             : toolName === 'editFile' ? 'edit'
             : 'other',
    canConcurrent: toolName !== 'non-concurrent' && toolName !== 'callAgent',
    fileOperation: false,
    renderDoingUI: true,
    getTargetFile: (input: any) => {
      const targets = input?.targets;
      if (Array.isArray(targets)) return targets;
      if (typeof targets === 'string') return targets;
      return null;
    },
  })),
}));

import { DependencyAnalyzer, isAgentExecutionPlan } from './dependency-analyzer';
import { MAX_PARALLEL_SUBAGENTS } from './agent-dependency-analyzer';
import type { ToolCallInfo } from './tool-executor';

const dependencyAnalyzer = new DependencyAnalyzer();

const concurrentCallAgentTool = {
  callAgentV2: { canConcurrent: true },
} as const;

describe('DependencyAnalyzer - Context Isolation Validation', () => {
  it('throws error when callAgentV2 is mixed with other tools', async () => {
    const toolCalls: ToolCallInfo[] = [
      { toolCallId: 'read-1', toolName: 'readFile', input: { path: 'src/a.ts' } },
      { toolCallId: 'agent-1', toolName: 'callAgentV2', input: { targets: ['src/b.ts'] } },
    ];

    await expect(async () => {
      await dependencyAnalyzer.analyzeDependencies(toolCalls, concurrentCallAgentTool as any);
    }).rejects.toThrow(/Context isolation violation/);
  });

  it('throws error when a callAgentV2 variant is mixed with other tools', async () => {
    const toolCalls: ToolCallInfo[] = [
      { toolCallId: 'read-1', toolName: 'readFile', input: { path: 'src/a.ts' } },
      { toolCallId: 'agent-1', toolName: 'callAgentV2 Tool', input: { targets: ['src/b.ts'] } },
    ];

    await expect(async () => {
      await dependencyAnalyzer.analyzeDependencies(toolCalls, concurrentCallAgentTool as any);
    }).rejects.toThrow(/Context isolation violation/);
  });

  it('throws error when callAgent is mixed with other tools', async () => {
    const toolCalls: ToolCallInfo[] = [
      { toolCallId: 'search-1', toolName: 'grepSearch', input: { query: 'test' } },
      { toolCallId: 'agent-1', toolName: 'callAgent', input: {} },
    ];

    await expect(async () => {
      await dependencyAnalyzer.analyzeDependencies(toolCalls, concurrentCallAgentTool as any);
    }).rejects.toThrow(/Context isolation violation/);
  });

  it('throws error when a callAgent variant is mixed with other tools', async () => {
    const toolCalls: ToolCallInfo[] = [
      { toolCallId: 'search-1', toolName: 'grepSearch', input: { query: 'test' } },
      { toolCallId: 'agent-1', toolName: 'callagent', input: {} },
    ];

    await expect(async () => {
      await dependencyAnalyzer.analyzeDependencies(toolCalls, concurrentCallAgentTool as any);
    }).rejects.toThrow(/Context isolation violation/);
  });

  it('allows only callAgentV2 calls without other tools', async () => {
    const toolCalls: ToolCallInfo[] = [
      { toolCallId: 'agent-1', toolName: 'callAgentV2', input: { agentId: 'context-gatherer', targets: ['src/a.ts'] } },
      { toolCallId: 'agent-2', toolName: 'callAgentV2', input: { agentId: 'coding', targets: ['src/b.ts'] } },
    ];

    const plan = await dependencyAnalyzer.analyzeDependencies(toolCalls, concurrentCallAgentTool as any);
    expect(isAgentExecutionPlan(plan)).toBe(true);
  });

  it('allows callAgent tool variants without other tools', async () => {
    const toolCalls: ToolCallInfo[] = [
      { toolCallId: 'agent-1', toolName: 'CallAgentV2', input: { agentId: 'context-gatherer', targets: ['src/a.ts'] } },
      { toolCallId: 'agent-2', toolName: 'call agent v2', input: { agentId: 'coding', targets: ['src/b.ts'] } },
    ];

    const plan = await dependencyAnalyzer.analyzeDependencies(toolCalls, concurrentCallAgentTool as any);
    expect(isAgentExecutionPlan(plan)).toBe(true);
  });

  it('allows only non-agent tools without agent calls', async () => {
    const toolCalls: ToolCallInfo[] = [
      { toolCallId: 'read-1', toolName: 'readFile', input: { path: 'src/a.ts' } },
      { toolCallId: 'write-1', toolName: 'writeFile', input: { path: 'src/b.ts' } },
    ];

    const plan = await dependencyAnalyzer.analyzeDependencies(toolCalls, concurrentCallAgentTool as any);
    expect(isAgentExecutionPlan(plan)).toBe(false);
  });
});

describe('DependencyAnalyzer - Agent Tool Analysis', () => {
  it('creates read-only stage for agents with only read tools', async () => {
    const toolCalls: ToolCallInfo[] = [
      { toolCallId: 'agent-1', toolName: 'callAgentV2', input: { agentId: 'context-gatherer', targets: ['src/a.ts'] } },
      { toolCallId: 'agent-2', toolName: 'callAgentV2', input: { agentId: 'context-gatherer', targets: ['src/b.ts'] } },
    ];

    const plan = await dependencyAnalyzer.analyzeDependencies(toolCalls, concurrentCallAgentTool as any);
    
    if (isAgentExecutionPlan(plan)) {
      expect(plan.stages).toHaveLength(1);
      expect(plan.stages[0].phase).toBe('read-stage');
      expect(plan.stages[0].groups[0].concurrent).toBe(true);
      expect(plan.summary.informationGatheringAgents).toBe(2);
      expect(plan.summary.contentModificationAgents).toBe(0);
    } else {
      throw new Error('Expected AgentExecutionPlan');
    }
  });

  it('creates write-operations stage for agents with write tools', async () => {
    const toolCalls: ToolCallInfo[] = [
      { toolCallId: 'agent-1', toolName: 'callAgentV2', input: { agentId: 'coding', targets: ['src/a.ts'] } },
      { toolCallId: 'agent-2', toolName: 'callAgentV2', input: { agentId: 'coding', targets: ['src/b.ts'] } },
    ];

    const plan = await dependencyAnalyzer.analyzeDependencies(toolCalls, concurrentCallAgentTool as any);
    
    if (isAgentExecutionPlan(plan)) {
      expect(plan.stages).toHaveLength(1);
      expect(plan.stages[0].phase).toBe('write-edit-stage');
      expect(plan.summary.informationGatheringAgents).toBe(0);
      expect(plan.summary.contentModificationAgents).toBe(2);
    } else {
      throw new Error('Expected AgentExecutionPlan');
    }
  });

  it('creates both stages for mixed agent types', async () => {
    const toolCalls: ToolCallInfo[] = [
      { toolCallId: 'agent-1', toolName: 'callAgentV2', input: { agentId: 'context-gatherer', targets: ['src/a.ts'] } },
      { toolCallId: 'agent-2', toolName: 'callAgentV2', input: { agentId: 'coding', targets: ['src/b.ts'] } },
    ];

    const plan = await dependencyAnalyzer.analyzeDependencies(toolCalls, concurrentCallAgentTool as any);
    
    if (isAgentExecutionPlan(plan)) {
      expect(plan.stages).toHaveLength(2);
      expect(plan.stages[0].phase).toBe('read-stage');
      expect(plan.stages[1].phase).toBe('write-edit-stage');
      expect(plan.summary.informationGatheringAgents).toBe(1);
      expect(plan.summary.contentModificationAgents).toBe(1);
    } else {
      throw new Error('Expected AgentExecutionPlan');
    }
  });

  it('handles target conflicts in write-capable agents', async () => {
    const toolCalls: ToolCallInfo[] = [
      { toolCallId: 'agent-1', toolName: 'callAgentV2', input: { agentId: 'coding', targets: ['src/shared.ts'] } },
      { toolCallId: 'agent-2', toolName: 'callAgentV2', input: { agentId: 'coding', targets: ['src/shared.ts'] } },
    ];

    const plan = await dependencyAnalyzer.analyzeDependencies(toolCalls, concurrentCallAgentTool as any);
    
    if (isAgentExecutionPlan(plan)) {
      expect(plan.stages).toHaveLength(1);
      expect(plan.stages[0].phase).toBe('write-edit-stage');
      // Should create separate groups due to target conflict
      expect(plan.stages[0].groups.length).toBeGreaterThan(1);
    } else {
      throw new Error('Expected AgentExecutionPlan');
    }
  });

  it('classifies agents with only "other" tools as write-capable to avoid dropping them', async () => {
    const toolCalls: ToolCallInfo[] = [
      { toolCallId: 'agent-1', toolName: 'callAgentV2', input: { agentId: 'general' } },
    ];

    const plan = await dependencyAnalyzer.analyzeDependencies(toolCalls, concurrentCallAgentTool as any);

    if (isAgentExecutionPlan(plan)) {
      expect(plan.summary.totalAgents).toBe(1);
      expect(plan.summary.informationGatheringAgents).toBe(0);
      expect(plan.summary.contentModificationAgents).toBe(1);
      expect(plan.summary.totalStages).toBe(1);
      expect(plan.stages[0].phase).toBe('write-edit-stage');
      expect(plan.stages[0].groups[0].agentCalls).toHaveLength(1);
    } else {
      throw new Error('Expected AgentExecutionPlan');
    }
  });
});

describe('DependencyAnalyzer - Tool-only Analysis', () => {
  it('uses ToolDependencyAnalyzer for non-agent tools', async () => {
    const toolCalls: ToolCallInfo[] = [
      { toolCallId: 'read-1', toolName: 'readFile', input: { path: 'src/a.ts' } },
      { toolCallId: 'write-1', toolName: 'writeFile', input: { path: 'src/b.ts' } },
    ];

    const plan = await dependencyAnalyzer.analyzeDependencies(toolCalls, {} as any);
    
    expect(isAgentExecutionPlan(plan)).toBe(false);
    if (!isAgentExecutionPlan(plan)) {
      expect(plan.stages).toHaveLength(2); // read stage + write stage
      expect(plan.stages[0].name).toBe('read-stage');
      expect(plan.stages[1].name).toBe('write-edit-stage');
    }
  });
});
