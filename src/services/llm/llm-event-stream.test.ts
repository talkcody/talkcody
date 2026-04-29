import { describe, expect, it } from 'vitest';
import { normalizeStreamEvent } from './llm-event-stream';

describe('normalizeStreamEvent', () => {
  it('maps snake_case response metadata fields', () => {
    const normalized = normalizeStreamEvent({
      type: 'response-metadata',
      response_id: 'resp-1',
      transport: 'websocket',
      provider: 'openai-subscription',
      continuation_accepted: true,
      transport_session_id: 'session-1',
    } as never);

    expect(normalized).toEqual({
      type: 'response-metadata',
      response_id: 'resp-1',
      transport: 'websocket',
      provider: 'openai-subscription',
      continuation_accepted: true,
      transport_session_id: 'session-1',
      responseId: 'resp-1',
      continuationAccepted: true,
      transportSessionId: 'session-1',
    });
  });

  it('maps snake_case transport fallback fields', () => {
    const normalized = normalizeStreamEvent({
      type: 'transport-fallback',
      fallback_reason: 'handshake_failed',
      from: 'websocket',
      to: 'http-sse',
    } as never);

    expect(normalized).toEqual({
      type: 'transport-fallback',
      fallback_reason: 'handshake_failed',
      from: 'websocket',
      to: 'http-sse',
      reason: 'handshake_failed',
    });
  });
});
