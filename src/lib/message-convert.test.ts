import { describe, expect, it } from 'vitest';
import type { Message as ModelMessage } from '@/services/llm/types';
import { mergeConsecutiveAssistantMessages } from '@/lib/message-convert';

describe('mergeConsecutiveAssistantMessages', () => {
  it('merges providerOptions when combining consecutive assistant messages', () => {
    const messages: ModelMessage[] = [
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 'call-1', toolName: 'glob', input: {} }],
        providerOptions: {
          openaiCompatible: {
            reasoning_content: ' ',
          },
        },
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'done' }],
        providerOptions: {
          anthropic: {
            cacheControl: {
              type: 'ephemeral',
            },
          },
        },
      },
    ];

    const merged = mergeConsecutiveAssistantMessages(messages);
    const assistant = merged[0] as Extract<ModelMessage, { role: 'assistant' }>;

    expect(merged).toHaveLength(1);
    expect(assistant.content).toEqual([
      { type: 'tool-call', toolCallId: 'call-1', toolName: 'glob', input: {} },
      { type: 'text', text: 'done' },
    ]);
    expect(assistant.providerOptions).toEqual({
      openaiCompatible: {
        reasoning_content: ' ',
      },
      anthropic: {
        cacheControl: {
          type: 'ephemeral',
        },
      },
    });
  });

  it('preserves nested option fields for the same provider key', () => {
    const messages: ModelMessage[] = [
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 'call-1', toolName: 'readFile', input: {} }],
        providerOptions: {
          openaiCompatible: {
            reasoning_content: ' ',
          },
        },
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'ok' }],
        providerOptions: {
          openaiCompatible: {
            cache_control: {
              type: 'ephemeral',
            },
          },
        },
      },
    ];

    const merged = mergeConsecutiveAssistantMessages(messages);
    const assistant = merged[0] as Extract<ModelMessage, { role: 'assistant' }>;

    expect(assistant.providerOptions).toEqual({
      openaiCompatible: {
        reasoning_content: ' ',
        cache_control: {
          type: 'ephemeral',
        },
      },
    });
  });
});
