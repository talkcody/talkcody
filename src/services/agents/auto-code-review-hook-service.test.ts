import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompletionHookContext } from '@/types/completion-hooks';

const { autoCodeReviewRunMock, addUserMessageMock } = vi.hoisted(() => ({
  autoCodeReviewRunMock: vi.fn(),
  addUserMessageMock: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/services/auto-code-review-service', () => ({
  autoCodeReviewService: {
    run: autoCodeReviewRunMock,
  },
  lastReviewedChangeTimestamp: new Map<string, number>(),
}));

vi.mock('@/services/message-service', () => ({
  messageService: {
    addUserMessage: addUserMessageMock,
  },
}));

import { AutoCodeReviewHookService } from './auto-code-review-hook-service';

function createContext(overrides?: Partial<CompletionHookContext>): CompletionHookContext {
  return {
    taskId: 'task-1',
    fullText: 'done',
    toolSummaries: [],
    loopState: {
      messages: [],
      currentIteration: 1,
      isComplete: false,
      lastRequestTokens: 0,
    },
    iteration: 1,
    startTime: Date.now(),
    userMessage: 'Please finish the task',
    ...overrides,
  };
}

describe('AutoCodeReviewHookService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    addUserMessageMock.mockResolvedValue('message-1');
  });

  it('returns stop when no review follow-up is needed', async () => {
    autoCodeReviewRunMock.mockResolvedValue(null);
    const service = new AutoCodeReviewHookService();

    const result = await service.run(createContext());

    expect(result).toEqual({ action: 'stop' });
    expect(addUserMessageMock).not.toHaveBeenCalled();
  });

  it('persists and appends a user message when review finds issues', async () => {
    autoCodeReviewRunMock.mockResolvedValue(`Review found two issues:\n1. Add regression test.\n2. Retry the loop.`);
    const service = new AutoCodeReviewHookService();

    const result = await service.run(createContext());

    expect(addUserMessageMock).toHaveBeenCalledWith(
      'task-1',
      `Review found two issues:\n1. Add regression test.\n2. Retry the loop.`
    );
    expect(result.action).toBe('continue');
    expect(result.continuationMode).toBe('append');
    expect(result.nextMessages).toHaveLength(1);
    expect(result.nextMessages?.[0]).toMatchObject({
      role: 'user',
      content: `Review found two issues:\n1. Add regression test.\n2. Retry the loop.`,
    });
  });

  it('does not run for nested task ids', () => {
    const service = new AutoCodeReviewHookService();

    expect(service.shouldRun(createContext({ taskId: 'nested-task-1' }))).toBe(false);
    expect(service.shouldRun(createContext({ taskId: 'nested' }))).toBe(false);
    expect(service.shouldRun(createContext({ taskId: 'task-1' }))).toBe(true);
  });
});
