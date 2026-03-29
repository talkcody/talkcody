// src/services/agents/llm-completion-hooks.test.ts
import { describe, expect, it, vi } from 'vitest';
import { CompletionHookPipeline } from '@/services/agents/llm-completion-hooks';
import type { CompletionHook, CompletionHookContext, CompletionHookResult } from '@/types/completion-hooks';

describe('CompletionHookPipeline', () => {
  const createMockHook = (
    name: string,
    priority: number,
    shouldRun: boolean,
    result: CompletionHookResult
  ): CompletionHook => ({
    name,
    priority,
    shouldRun: () => shouldRun,
    run: vi.fn().mockResolvedValue(result),
  });

  describe('register', () => {
    it('registers hooks and sorts by priority', () => {
      const pipeline = new CompletionHookPipeline();

      const hook1 = createMockHook('hook-1', 30, true, { action: 'skip' });
      const hook2 = createMockHook('hook-2', 10, true, { action: 'skip' });
      const hook3 = createMockHook('hook-3', 20, true, { action: 'skip' });

      pipeline.register(hook1);
      pipeline.register(hook2);
      pipeline.register(hook3);

      const registered = pipeline.getRegisteredHooks();
      expect(registered.map((h) => h.priority)).toEqual([10, 20, 30]);
    });
  });

  describe('run', () => {
    it('runs hooks in priority order', async () => {
      const pipeline = new CompletionHookPipeline();
      const order: string[] = [];

      const hook1: CompletionHook = {
        name: 'hook-1',
        priority: 10,
        shouldRun: () => true,
        run: vi.fn().mockImplementation(async () => {
          order.push('hook-1');
          return { action: 'skip' };
        }),
      };

      const hook2: CompletionHook = {
        name: 'hook-2',
        priority: 20,
        shouldRun: () => true,
        run: vi.fn().mockImplementation(async () => {
          order.push('hook-2');
          return { action: 'stop' };
        }),
      };

      pipeline.register(hook2);
      pipeline.register(hook1);

      const context = {
        taskId: 'task-1',
        fullText: '',
        toolSummaries: [],
        loopState: {
          messages: [],
          currentIteration: 1,
          isComplete: false,
          lastRequestTokens: 0,
        },
        iteration: 1,
        startTime: Date.now(),
      } as CompletionHookContext;

      await pipeline.run(context);

      expect(order).toEqual(['hook-1', 'hook-2']);
    });

    it('stops on first continue action', async () => {
      const pipeline = new CompletionHookPipeline();

      const hook1 = createMockHook('hook-1', 10, true, { action: 'skip' });
      const hook2 = createMockHook('hook-2', 20, true, {
        action: 'continue',
        continuationMode: 'append',
        nextMessages: [{ id: 'test', role: 'user', content: 'Continue', timestamp: new Date() }],
      });
      const hook3 = createMockHook('hook-3', 30, true, { action: 'stop' });

      pipeline.register(hook1);
      pipeline.register(hook2);
      pipeline.register(hook3);

      const context = {
        taskId: 'task-1',
        fullText: '',
        toolSummaries: [],
        loopState: {
          messages: [],
          currentIteration: 1,
          isComplete: false,
          lastRequestTokens: 0,
        },
        iteration: 1,
        startTime: Date.now(),
      } as CompletionHookContext;

      const result = await pipeline.run(context);

      expect(result.action).toBe('continue');
      expect(result.continuationMode).toBe('append');
      expect(hook3.run).not.toHaveBeenCalled();
    });

    it('stops on first stop action', async () => {
      const pipeline = new CompletionHookPipeline();

      const hook1 = createMockHook('hook-1', 10, true, { action: 'skip' });
      const hook2 = createMockHook('hook-2', 20, true, { action: 'stop', stopReason: 'complete' });
      const hook3 = createMockHook('hook-3', 30, true, { action: 'skip' });

      pipeline.register(hook1);
      pipeline.register(hook2);
      pipeline.register(hook3);

      const context = {
        taskId: 'task-1',
        fullText: '',
        toolSummaries: [],
        loopState: {
          messages: [],
          currentIteration: 1,
          isComplete: false,
          lastRequestTokens: 0,
        },
        iteration: 1,
        startTime: Date.now(),
      } as CompletionHookContext;

      const result = await pipeline.run(context);

      expect(result.action).toBe('stop');
      expect(result.stopReason).toBe('complete');
      expect(hook3.run).not.toHaveBeenCalled();
    });

    it('skips hooks that should not run', async () => {
      const pipeline = new CompletionHookPipeline();

      const hook1 = createMockHook('hook-1', 10, false, { action: 'stop' });
      const hook2 = createMockHook('hook-2', 20, true, { action: 'stop' });

      pipeline.register(hook1);
      pipeline.register(hook2);

      const context = {
        taskId: 'task-1',
        fullText: '',
        toolSummaries: [],
        loopState: {
          messages: [],
          currentIteration: 1,
          isComplete: false,
          lastRequestTokens: 0,
        },
        iteration: 1,
        startTime: Date.now(),
      } as CompletionHookContext;

      await pipeline.run(context);

      expect(hook1.run).not.toHaveBeenCalled();
      expect(hook2.run).toHaveBeenCalled();
    });

    it('returns default stop when all hooks skip', async () => {
      const pipeline = new CompletionHookPipeline();

      const hook = createMockHook('hook', 10, true, { action: 'skip' });
      pipeline.register(hook);

      const context = {
        taskId: 'task-1',
        fullText: '',
        toolSummaries: [],
        loopState: {
          messages: [],
          currentIteration: 1,
          isComplete: false,
          lastRequestTokens: 0,
        },
        iteration: 1,
        startTime: Date.now(),
      } as CompletionHookContext;

      const result = await pipeline.run(context);

      expect(result.action).toBe('stop');
    });

    it('handles hook errors gracefully', async () => {
      const pipeline = new CompletionHookPipeline();

      const hook1: CompletionHook = {
        name: 'failing-hook',
        priority: 10,
        shouldRun: () => true,
        run: vi.fn().mockRejectedValue(new Error('Hook failed')),
      };

      const hook2 = createMockHook('hook-2', 20, true, { action: 'stop' });

      pipeline.register(hook1);
      pipeline.register(hook2);

      const context = {
        taskId: 'task-1',
        fullText: '',
        toolSummaries: [],
        loopState: {
          messages: [],
          currentIteration: 1,
          isComplete: false,
          lastRequestTokens: 0,
        },
        iteration: 1,
        startTime: Date.now(),
      } as CompletionHookContext;

      const result = await pipeline.run(context);

      expect(result.action).toBe('stop');
      expect(hook2.run).toHaveBeenCalled();
    });
  });

  describe('unregister', () => {
    it('unregisters hook by name', () => {
      const pipeline = new CompletionHookPipeline();
      const hook = createMockHook('hook-1', 10, true, { action: 'skip' });

      pipeline.register(hook);
      expect(pipeline.getRegisteredHooks()).toHaveLength(1);

      pipeline.unregister('hook-1');
      expect(pipeline.getRegisteredHooks()).toHaveLength(0);
    });

    it('does nothing when unregistering non-existent hook', () => {
      const pipeline = new CompletionHookPipeline();
      pipeline.unregister('non-existent');
      expect(pipeline.getRegisteredHooks()).toHaveLength(0);
    });
  });

  describe('clear', () => {
    it('removes all registered hooks', () => {
      const pipeline = new CompletionHookPipeline();

      pipeline.register(createMockHook('hook-1', 10, true, { action: 'skip' }));
      pipeline.register(createMockHook('hook-2', 20, true, { action: 'skip' }));

      expect(pipeline.getRegisteredHooks()).toHaveLength(2);

      pipeline.clear();
      expect(pipeline.getRegisteredHooks()).toHaveLength(0);
    });
  });
});
