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
    category: 'other',
    canConcurrent: toolName !== 'non-concurrent',
    fileOperation: false,
    renderDoingUI: true,
  })),
}));

import { MAX_PARALLEL_SUBAGENTS } from './agent-dependency-analyzer';
import { ToolExecutor, type ToolCallInfo } from './tool-executor';
import type { UIMessage } from '@/types/agent';

describe('ToolExecutor callAgentV2 nested tool routing', () => {
  it('forwards nested tool messages with parentToolCallId', async () => {
    const executor = new ToolExecutor();
    const onToolMessage = vi.fn();

    const nestedMessage: UIMessage = {
      id: 'nested-1',
      role: 'assistant',
      content: 'nested-message',
      timestamp: new Date(),
      toolCallId: 'nested-call',
      toolName: 'readFile',
    };

    const callAgentExecute = vi.fn(async (args: any) => {
      args._onNestedToolMessage?.(nestedMessage);
      return { success: true };
    });

    const toolCalls: ToolCallInfo[] = [
      {
        toolCallId: 'call-123',
        toolName: 'callAgentV2',
        input: {},
      },
    ];

    await executor.executeToolCall(toolCalls[0], {
      tools: {
        callAgentV2: { execute: callAgentExecute, canConcurrent: true },
      },
      loopState: {
        messages: [],
        currentIteration: 0,
        isComplete: false,
        lastRequestTokens: 0,
      },
      model: 'test-model',
      abortController: new AbortController(),
      onToolMessage,
    });

    expect(callAgentExecute).toHaveBeenCalled();

    const forwardedNested = onToolMessage.mock.calls
      .map((call) => call[0] as UIMessage)
      .find((message) => message.id === nestedMessage.id);

    expect(forwardedNested?.parentToolCallId).toBe('call-123');
  });

  it('caps concurrent callAgentV2 executions to the configured max', async () => {
    const executor = new ToolExecutor();
    const onToolMessage = vi.fn();
    const abortController = new AbortController();

    const toolCalls: ToolCallInfo[] = Array.from({
      length: MAX_PARALLEL_SUBAGENTS + 2,
    }).map((_, index) => ({
      toolCallId: `call-${index}`,
      toolName: 'callAgentV2',
      input: {},
    }));

    let running = 0;
    let peak = 0;
    const callAgentExecute = vi.fn(async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return { success: true };
    });

    await (executor as any).executeToolGroup(
      {
        concurrent: true,
        maxConcurrency: MAX_PARALLEL_SUBAGENTS,
        tools: toolCalls,
        id: 'test-group',
        reason: 'test',
      },
      {
        tools: {
          callAgentV2: { execute: callAgentExecute, canConcurrent: true },
        },
        loopState: {
          messages: [],
          currentIteration: 0,
          isComplete: false,
          lastRequestTokens: 0,
        },
        model: 'test-model',
        abortController,
        onToolMessage,
      }
    );

    expect(callAgentExecute).toHaveBeenCalledTimes(toolCalls.length);
    expect(peak).toBeLessThanOrEqual(MAX_PARALLEL_SUBAGENTS);
  });
});
