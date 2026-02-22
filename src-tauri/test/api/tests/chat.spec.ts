import { test, expect } from '@playwright/test';
import { apiBaseUrl, enableChatStream, requireLlm } from '../helpers';
import { createSession, fetchSseHeaders } from '../helpers';

test('chat SSE endpoint responds with event-stream', async () => {
  test.skip(!enableChatStream, 'Chat SSE disabled via API_E2E_CHAT_STREAM');

  const sessionId = await createSession();
  const response = await fetchSseHeaders('/v1/chat', {
    method: 'POST',
    timeoutMs: 20000,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4',
      stream: true,
      sessionId,
      messages: [
        {
          role: 'user',
          content: 'ping',
        },
      ],
    }),
  });

  if (requireLlm) {
    expect(response.status).toBe(200);
    expect(response.contentType).toContain('text/event-stream');
  } else {
    expect([200, 400, 500]).toContain(response.status);
  }
});

test('chat SSE stream uses OpenAI-compatible data-only events', async () => {
  test.skip(!enableChatStream, 'Chat SSE disabled via API_E2E_CHAT_STREAM');

  const sessionId = await createSession();
  const url = new URL('/v1/chat', apiBaseUrl).toString();
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4',
      stream: true,
      sessionId,
      messages: [
        {
          role: 'user',
          content: 'ping',
        },
      ],
    }),
  });

  if (!requireLlm) {
    await response.body?.cancel();
    return;
  }

  expect(response.status).toBe(200);
  const reader = response.body?.getReader();
  expect(reader).toBeTruthy();

  let buffer = '';
  const decoder = new TextDecoder();
  let parsedChunk: unknown = null;
  let sawDone = false;

  while (reader && !parsedChunk) {
    const result = await reader.read();
    if (result.done) {
      break;
    }
    buffer += decoder.decode(result.value, { stream: true });

    const parts = buffer.split('\n\n');
    for (let i = 0; i < parts.length; i += 1) {
      const raw = parts[i];
      if (!raw) {
        continue;
      }
      if (raw.includes('event:')) {
        throw new Error('Unexpected SSE event name in stream');
      }
      if (raw.includes('data:')) {
        const dataLines = raw
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.replace(/^data:\s?/, '').trim())
          .filter((line) => line.length > 0);
        const data = dataLines.join('\n');
        if (data === '[DONE]') {
          sawDone = true;
          continue;
        }
        try {
          parsedChunk = JSON.parse(data);
          break;
        } catch {
          continue;
        }
      }
    }
  }

  await reader?.cancel();

  expect(parsedChunk).toBeTruthy();
  if (parsedChunk && typeof parsedChunk === 'object' && 'object' in parsedChunk) {
    expect((parsedChunk as { object?: string }).object).toBe('chat.completion.chunk');
  }
  expect(sawDone).toBeFalsy();
});
