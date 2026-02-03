import type { StreamTextResult } from '@/services/llm/llm-client';
import type { StreamEvent } from '@/services/llm/types';

export function createStreamTextMock(options: {
  textChunks: string[];
  finishReason: string;
  inputTokens: number;
  outputTokens: number;
  extraEvents?: StreamEvent[];
}): StreamTextResult {
  const { textChunks, finishReason, inputTokens, outputTokens, extraEvents } = options;

  const events: StreamEvent[] = [];
  if (textChunks.length > 0) {
    events.push({ type: 'text-start' });
    for (const chunk of textChunks) {
      events.push({ type: 'text-delta', text: chunk });
    }
  }

  if (extraEvents && extraEvents.length > 0) {
    events.push(...extraEvents);
  }

  events.push({
    type: 'usage',
    input_tokens: inputTokens,
    output_tokens: outputTokens,
  });
  events.push({ type: 'done', finish_reason: finishReason });

  async function* iterate(): AsyncGenerator<StreamEvent, void, unknown> {
    for (const event of events) {
      yield event;
    }
  }

  return {
    requestId: 'mock-request-id',
    events: iterate(),
  };
}
