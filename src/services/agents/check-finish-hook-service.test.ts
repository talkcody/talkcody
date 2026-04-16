import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompletionHookContext } from '@/types/completion-hooks';

const { checkFinishRunMock, addUserMessageMock } = vi.hoisted(() => ({
  checkFinishRunMock: vi.fn(),
  addUserMessageMock: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/services/check-finish-service', () => ({
  checkFinishService: {
    run: checkFinishRunMock,
  },
  lastCheckFinishTimestamp: new Map<string, number>(),
  parseCheckFinishResult: vi.fn((text: string) => {
    const upperText = text.toUpperCase();
    const status = upperText.includes('STATUS: INCOMPLETE')
      ? 'INCOMPLETE'
      : upperText.includes('STATUS: COMPLETE')
        ? 'COMPLETE'
        : 'UNKNOWN';

    return {
      status,
      isComplete: status === 'COMPLETE',
      resultText: text.trim(),
      hasActionableItems: status === 'INCOMPLETE',
    };
  }),
}));

vi.mock('@/services/message-service', () => ({
  messageService: {
    addUserMessage: addUserMessageMock,
  },
}));

import { CheckFinishHookService } from './check-finish-hook-service';

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

describe('CheckFinishHookService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    addUserMessageMock.mockResolvedValue('message-1');
  });

  it('skips persisting UI messages when the check service returns null', async () => {
    checkFinishRunMock.mockResolvedValue(null);
    const service = new CheckFinishHookService();

    const result = await service.run(createContext());

    expect(result).toEqual({ action: 'skip' });
    expect(addUserMessageMock).not.toHaveBeenCalled();
  });

  it('skips persisting wrapped COMPLETE payloads even if a string is returned', async () => {
    checkFinishRunMock.mockResolvedValue(`🔍 **Task Completion Check**

## Task Completion Check
- Status: COMPLETE
- Confidence: MEDIUM

## Missing Items (if any)
- None.

## Suggested TODO List
- None.

---
Please continue working on the above items to complete the task.`);
    const service = new CheckFinishHookService();

    const result = await service.run(createContext());

    expect(result).toEqual({ action: 'skip' });
    expect(addUserMessageMock).not.toHaveBeenCalled();
  });

  it('skips persisting UNKNOWN payloads even if a string is returned', async () => {
    checkFinishRunMock.mockResolvedValue('Follow-up work might be needed, but no explicit status was provided.');
    const service = new CheckFinishHookService();

    const result = await service.run(createContext());

    expect(result).toEqual({ action: 'skip' });
    expect(addUserMessageMock).not.toHaveBeenCalled();
  });

  it('persists and appends a user message when the check service returns an explicit INCOMPLETE payload', async () => {
    checkFinishRunMock.mockResolvedValue(`🔍 **Task Completion Check**

## Task Completion Check
- Status: INCOMPLETE
- Confidence: HIGH

## Missing Items (if any)
- Add regression coverage for unknown output.

## Suggested TODO List
- [ ] Add regression coverage for unknown output.

---
Please continue working on the above items to complete the task.`);
    const service = new CheckFinishHookService();

    const result = await service.run(createContext());

    expect(addUserMessageMock).toHaveBeenCalledWith(
      'task-1',
      `🔍 **Task Completion Check**

## Task Completion Check
- Status: INCOMPLETE
- Confidence: HIGH

## Missing Items (if any)
- Add regression coverage for unknown output.

## Suggested TODO List
- [ ] Add regression coverage for unknown output.

---
Please continue working on the above items to complete the task.`
    );
    expect(result.action).toBe('continue');
    expect(result.continuationMode).toBe('append');
    expect(result.nextMessages).toHaveLength(1);
    expect(result.nextMessages?.[0]).toMatchObject({
      role: 'user',
      content: `🔍 **Task Completion Check**

## Task Completion Check
- Status: INCOMPLETE
- Confidence: HIGH

## Missing Items (if any)
- Add regression coverage for unknown output.

## Suggested TODO List
- [ ] Add regression coverage for unknown output.

---
Please continue working on the above items to complete the task.`,
    });
  });

  it('does not run for nested task ids', () => {
    const service = new CheckFinishHookService();

    expect(service.shouldRun(createContext({ taskId: 'nested-task-1' }))).toBe(false);
    expect(service.shouldRun(createContext({ taskId: 'nested' }))).toBe(false);
    expect(service.shouldRun(createContext({ taskId: 'task-1' }))).toBe(true);
  });
});
