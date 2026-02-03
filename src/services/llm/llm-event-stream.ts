import type { UnlistenFn } from '@tauri-apps/api/event';
import { listen } from '@tauri-apps/api/event';
import { logger } from '@/lib/logger';
import type { StreamEvent } from './types';

type EventHandler = (event: StreamEvent) => void;

export class LlmEventStream {
  private unlisten: UnlistenFn | null = null;
  private closed = false;

  async listen(eventName: string, handler: EventHandler): Promise<void> {
    this.unlisten = await listen<StreamEvent>(eventName, (event) => {
      handler(event.payload);
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.unlisten) {
      this.unlisten();
      this.unlisten = null;
    }
  }
}

export function createEventQueue<T>() {
  let resolveNext: ((value: IteratorResult<T>) => void) | null = null;
  const queue: T[] = [];
  let queueIndex = 0;
  let done = false;

  return {
    push(value: T) {
      if (done) return;
      if (resolveNext) {
        resolveNext({ value, done: false });
        resolveNext = null;
      } else {
        queue.push(value);
      }
    },
    finish() {
      done = true;
      if (resolveNext) {
        resolveNext({ value: undefined as T, done: true });
        resolveNext = null;
      }
    },
    async *iterate() {
      while (true) {
        if (queueIndex < queue.length) {
          const value = queue[queueIndex] as T;
          queueIndex += 1;
          if (queueIndex > 1024 && queueIndex === queue.length) {
            queue.length = 0;
            queueIndex = 0;
          }
          yield value;
          continue;
        }
        if (done) {
          return;
        }
        const next = await new Promise<IteratorResult<T>>((resolve) => {
          resolveNext = resolve;
        });
        if (next.done) {
          return;
        }
        yield next.value;
      }
    },
  };
}

export function normalizeStreamEvent(event: StreamEvent): StreamEvent {
  if ('provider_metadata' in event && event.provider_metadata) {
    const { provider_metadata, ...rest } = event as StreamEvent & {
      provider_metadata?: unknown;
    };
    return {
      ...(rest as StreamEvent),
      providerMetadata: provider_metadata as Record<string, unknown>,
    } as StreamEvent;
  }
  return event;
}

export function isTerminalEvent(event: StreamEvent): boolean {
  return event.type === 'done' || event.type === 'error';
}

export function logStreamEvent(event: StreamEvent, requestId: string): void {
  switch (event.type) {
    case 'error':
      logger.error(`[LLM Stream ${requestId}] Error: ${event.message}`);
      break;
    case 'done':
      logger.info(`[LLM Stream ${requestId}] Done: ${event.finish_reason ?? 'unknown'}`);
      break;
    case 'text-start':
      logger.debug(`[LLM Stream ${requestId}] Text start`);
      break;
    case 'text-delta':
      logger.debug(`[LLM Stream ${requestId}] Text delta: ${event.text.length} chars`);
      break;
    case 'tool-call':
      logger.info(
        `[LLM Stream ${requestId}] Tool call: ${event.toolName} (id: ${event.toolCallId})`
      );
      break;
    case 'reasoning-start':
      logger.debug(`[LLM Stream ${requestId}] Reasoning start: ${event.id}`);
      break;
    case 'reasoning-delta':
      logger.debug(`[LLM Stream ${requestId}] Reasoning delta: ${event.text.length} chars`);
      break;
    case 'reasoning-end':
      logger.debug(`[LLM Stream ${requestId}] Reasoning end: ${event.id}`);
      break;
    case 'usage':
      logger.debug(
        `[LLM Stream ${requestId}] Usage: ${event.input_tokens} in, ${event.output_tokens} out`
      );
      break;
    default:
      logger.debug(`[LLM Stream ${requestId}] Event: ${(event as { type: string }).type}`);
  }
}
