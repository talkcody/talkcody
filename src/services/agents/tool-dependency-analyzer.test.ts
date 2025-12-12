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

vi.mock('@/lib/tools', () => ({
  getToolMetadata: vi.fn((toolName: string) => ({
    category: toolName === 'readFile' ? 'read' 
             : toolName === 'grepSearch' ? 'read'
             : toolName === 'codeSearch' ? 'read'
             : toolName === 'listFiles' ? 'read'
             : toolName === 'bash' ? 'other'
             : toolName === 'writeFile' ? 'write'
             : toolName === 'editFile' ? 'edit'
             : 'other',
    canConcurrent: toolName !== 'non-concurrent',
    fileOperation: false,
    renderDoingUI: true,
  })),
}));

import { ToolDependencyAnalyzer } from './tool-dependency-analyzer';
import type { ToolCallInfo } from './tool-executor';

const toolAnalyzer = new ToolDependencyAnalyzer();

describe('ToolDependencyAnalyzer - Pure Tool Analysis', () => {
  it('handles only non-agent tools', () => {
    const toolCalls: ToolCallInfo[] = [
      { toolCallId: 'read-1', toolName: 'readFile', input: { path: 'src/a.ts' } },
      { toolCallId: 'write-1', toolName: 'writeFile', input: { path: 'src/b.ts' } },
    ];

    const plan = toolAnalyzer.analyzeDependencies(toolCalls, {} as any);
    expect(plan.stages).toHaveLength(2); // read stage + write stage
    expect(plan.stages[0].name).toBe('read-stage');
    expect(plan.stages[1].name).toBe('write-edit-stage');
  });

  it('groups read operations in parallel', () => {
    const toolCalls: ToolCallInfo[] = [
      { toolCallId: 'read-1', toolName: 'readFile', input: { path: 'src/a.ts' } },
      { toolCallId: 'read-2', toolName: 'readFile', input: { path: 'src/b.ts' } },
      { toolCallId: 'search-1', toolName: 'grepSearch', input: { query: 'test' } },
    ];

    const plan = toolAnalyzer.analyzeDependencies(toolCalls, {} as any);
    expect(plan.stages).toHaveLength(1); // only read stage
    expect(plan.stages[0].name).toBe('read-stage');
    expect(plan.stages[0].groups[0].concurrent).toBe(true);
    expect(plan.stages[0].groups[0].tools).toHaveLength(3);
  });

  it('runs write/edit operations sequentially', () => {
    const toolCalls: ToolCallInfo[] = [
      { toolCallId: 'write-1', toolName: 'writeFile', input: { path: 'src/a.ts' } },
      { toolCallId: 'edit-1', toolName: 'editFile', input: { path: 'src/b.ts' } },
    ];

    const plan = toolAnalyzer.analyzeDependencies(toolCalls, {} as any);
    expect(plan.stages).toHaveLength(1); // only write-edit stage
    expect(plan.stages[0].name).toBe('write-edit-stage');
    expect(plan.stages[0].groups[0].concurrent).toBe(false);
  });

  it('handles other tools based on canConcurrent flag', () => {
    const toolCalls: ToolCallInfo[] = [
      { toolCallId: 'bash-1', toolName: 'bash', input: { command: 'ls' } },
      { toolCallId: 'bash-2', toolName: 'bash', input: { command: 'pwd' } },
    ];

    const plan = toolAnalyzer.analyzeDependencies(toolCalls, {
      bash: { canConcurrent: true }
    } as any);
    
    expect(plan.stages).toHaveLength(1); // only other stage
    expect(plan.stages[0].name).toBe('other-stage');
    expect(plan.stages[0].groups[0].concurrent).toBe(true);
  });

  it('creates proper execution order: read -> write/edit -> other', () => {
    const toolCalls: ToolCallInfo[] = [
      { toolCallId: 'bash-1', toolName: 'bash', input: { command: 'ls' } },
      { toolCallId: 'read-1', toolName: 'readFile', input: { path: 'src/a.ts' } },
      { toolCallId: 'write-1', toolName: 'writeFile', input: { path: 'src/b.ts' } },
    ];

    const plan = toolAnalyzer.analyzeDependencies(toolCalls, {} as any);
    expect(plan.stages).toHaveLength(3);
    expect(plan.stages[0].name).toBe('read-stage');
    expect(plan.stages[1].name).toBe('write-edit-stage');
    expect(plan.stages[2].name).toBe('other-stage');
  });

  it('handles empty tool calls', () => {
    const toolCalls: ToolCallInfo[] = [];

    const plan = toolAnalyzer.analyzeDependencies(toolCalls, {} as any);
    expect(plan.stages).toHaveLength(0);
    expect(plan.summary.totalTools).toBe(0);
  });
});