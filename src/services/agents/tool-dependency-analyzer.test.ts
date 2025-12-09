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

vi.mock('@/services/ai-provider-service', () => ({
  aiProviderService: {
    getProviderByModel: vi.fn(),
    getProviderModel: vi.fn(),
    getProviderForProviderModel: vi.fn(),
  },
}));

vi.mock('@/lib/error-utils', () => ({
  createErrorContext: vi.fn(() => ({})),
  extractAndFormatError: vi.fn((error: unknown) =>
    error instanceof Error ? error.message : String(error)
  ),
}));

vi.mock('@/lib/tools', () => ({
  getToolMetadata: vi.fn((toolName: string) => ({
    category: toolName === 'readFile' ? 'read' : 'other',
    canConcurrent: toolName !== 'non-concurrent',
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

import { MAX_PARALLEL_SUBAGENTS, ToolDependencyAnalyzer } from './tool-dependency-analyzer';
import type { ToolCallInfo } from './tool-executor';

const analyzer = new ToolDependencyAnalyzer();

const concurrentCallAgentTool = {
  callAgent: { canConcurrent: true },
} as const;

describe('ToolDependencyAnalyzer - callAgent targets and concurrency', () => {
  it('keeps callAgent tool calls with disjoint targets in a single concurrent group', () => {
    const toolCalls: ToolCallInfo[] = [
      { toolCallId: 'call-1', toolName: 'callAgent', input: { targets: ['src/a.ts'] } },
      { toolCallId: 'call-2', toolName: 'callAgent', input: { targets: ['src/b.ts'] } },
    ];

    const plan = analyzer.analyzeDependencies(toolCalls, concurrentCallAgentTool as any);
    const otherStage = plan.stages.find((stage) => stage.name === 'other-stage');

    expect(otherStage?.groups).toHaveLength(1);
    expect(otherStage?.groups[0].concurrent).toBe(true);
    expect(otherStage?.groups[0].maxConcurrency).toBe(MAX_PARALLEL_SUBAGENTS);
    expect(otherStage?.groups[0].tools.map((t) => t.toolCallId)).toEqual(['call-1', 'call-2']);
    expect(otherStage?.groups[0].targetFiles).toEqual(
      expect.arrayContaining(['src/a.ts', 'src/b.ts'])
    );
  });

  it('splits callAgent tool calls with overlapping targets into separate groups', () => {
    const toolCalls: ToolCallInfo[] = [
      { toolCallId: 'call-3', toolName: 'callAgent', input: { targets: ['src/shared.ts'] } },
      { toolCallId: 'call-4', toolName: 'callAgent', input: { targets: ['src/shared.ts'] } },
    ];

    const plan = analyzer.analyzeDependencies(toolCalls, concurrentCallAgentTool as any);
    const otherStage = plan.stages.find((stage) => stage.name === 'other-stage');

    expect(otherStage?.groups).toHaveLength(2);
    expect(otherStage?.groups[0].tools).toHaveLength(1);
    expect(otherStage?.groups[1].tools).toHaveLength(1);
    expect(otherStage?.groups[1].reason).toContain('conflicting declared targets');
  });

  it('runs callAgent tool calls without targets sequentially for safety', () => {
    const toolCalls: ToolCallInfo[] = [
      { toolCallId: 'call-5', toolName: 'callAgent', input: {} },
      { toolCallId: 'call-6', toolName: 'callAgent', input: {} },
    ];

    const plan = analyzer.analyzeDependencies(toolCalls, concurrentCallAgentTool as any);
    const otherStage = plan.stages.find((stage) => stage.name === 'other-stage');

    expect(otherStage?.groups).toHaveLength(2);
    expect(otherStage?.groups.every((group) => group.concurrent === false)).toBe(true);
    expect(otherStage?.groups[0].reason).toContain('without declared targets');
  });

  it('uses metadata canConcurrent when tool definition lacks the flag', () => {
    const toolCalls: ToolCallInfo[] = [
      { toolCallId: 'call-7', toolName: 'callAgent', input: { targets: ['src/a.ts'] } },
      { toolCallId: 'call-8', toolName: 'callAgent', input: { targets: ['src/b.ts'] } },
    ];

    const plan = analyzer.analyzeDependencies(
      toolCalls,
      { callAgent: { execute: async () => ({}) } } as any
    );
    const otherStage = plan.stages.find((stage) => stage.name === 'other-stage');

    expect(otherStage?.groups).toHaveLength(1);
    expect(otherStage?.groups[0].concurrent).toBe(true);
    expect(otherStage?.groups[0].reason).toContain('metadata');
  });
});
