import { describe, expect, it } from 'vitest';
import type { Message as ModelMessage } from '@/services/llm/types';
import { MessageTransform } from '@/lib/message-transform';

describe('MessageTransform.transform', () => {
  it('adds reasoning_content for DeepSeek and strips reasoning from current assistant content', () => {
    const { transformedContent } = MessageTransform.transform(
      [],
      'deepseek-v3.2',
      'deepseek',
      [
        { type: 'reasoning', text: 'think' },
        { type: 'text', text: 'answer' },
      ]
    );

    expect(transformedContent?.content).toEqual([{ type: 'text', text: 'answer' }]);
    expect(transformedContent?.providerOptions).toEqual({
      openaiCompatible: {
        reasoning_content: 'think',
      },
    });
  });

  it('adds placeholder reasoning_content for DeepSeek tool-call assistant content without reasoning', () => {
    const { transformedContent } = MessageTransform.transform([], 'deepseek-v4-pro', 'deepseek', [
      {
        type: 'tool-call',
        toolCallId: 'call_1',
        toolName: 'readFile',
        input: { file_path: '/tmp/a.txt' },
      },
    ]);

    expect(transformedContent?.providerOptions).toEqual({
      openaiCompatible: {
        reasoning_content: ' ',
      },
    });
  });

  it('adds placeholder reasoning_content for Kimi tool-call assistant content', () => {
    const { transformedContent } = MessageTransform.transform(
      [],
      'kimi-k2.6@kimi_coding',
      'kimi_coding',
      [
        {
          type: 'tool-call',
          toolCallId: 'call_1',
          toolName: 'readFile',
          input: { file_path: '/tmp/a.txt' },
        },
      ]
    );

    expect(transformedContent?.providerOptions).toEqual({
      openaiCompatible: {
        reasoning_content: ' ',
      },
    });
  });

  it('does not add reasoning_content for non-reasoning providers without tool-call constraints', () => {
    const { transformedContent } = MessageTransform.transform([], 'gpt-4o', 'openai', [
      { type: 'text', text: 'hello' },
    ]);

    expect(transformedContent?.content).toEqual([{ type: 'text', text: 'hello' }]);
    expect(transformedContent?.providerOptions).toBeUndefined();
  });

  it('normalizes historical DeepSeek assistant tool-call messages without reasoning_content', () => {
    const msgs: ModelMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'read file' }] },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call_1',
            toolName: 'readFile',
            input: { file_path: '/tmp/a.txt' },
          },
        ],
      },
    ];

    const { messages } = MessageTransform.transform(msgs, 'deepseek-v4-pro', 'deepseek');
    const assistant = messages[1] as Extract<ModelMessage, { role: 'assistant' }>;

    expect(assistant.providerOptions).toEqual({
      openaiCompatible: {
        reasoning_content: ' ',
      },
    });
  });

  it('normalizes historical Kimi assistant tool-call messages without reasoning_content', () => {
    const msgs: ModelMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'read file' }] },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call_1',
            toolName: 'readFile',
            input: { file_path: '/tmp/a.txt' },
          },
        ],
      },
    ];

    const { messages } = MessageTransform.transform(msgs, 'kimi-k2.6@kimi_coding', 'kimi_coding');
    const assistant = messages[1] as Extract<ModelMessage, { role: 'assistant' }>;

    expect(assistant.providerOptions).toEqual({
      openaiCompatible: {
        reasoning_content: ' ',
      },
    });
  });

  it('preserves existing historical reasoning_content', () => {
    const msgs: ModelMessage[] = [
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call_1',
            toolName: 'glob',
            input: { pattern: '**/*.ts' },
          },
        ],
        providerOptions: {
          openaiCompatible: {
            reasoning_content: 'already-there',
          },
        },
      },
    ];

    const { messages } = MessageTransform.transform(msgs, 'kimi-k2.6@kimi_coding', 'kimi_coding');
    const assistant = messages[0] as Extract<ModelMessage, { role: 'assistant' }>;
    const openaiCompatible = (assistant.providerOptions as { openaiCompatible?: { reasoning_content?: string } })
      .openaiCompatible;

    expect(openaiCompatible?.reasoning_content).toBe('already-there');
  });

  it('normalizes historical reasoning blocks into reasoning_content for Kimi', () => {
    const msgs: ModelMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'first' },
          { type: 'reasoning', text: ' second' },
          {
            type: 'tool-call',
            toolCallId: 'call_1',
            toolName: 'readFile',
            input: { file_path: '/tmp/a.txt' },
          },
        ],
      },
    ];

    const { messages } = MessageTransform.transform(msgs, 'kimi-k2.6@kimi_coding', 'kimi_coding');
    const assistant = messages[0] as Extract<ModelMessage, { role: 'assistant' }>;

    expect(assistant.content).toEqual([
      {
        type: 'tool-call',
        toolCallId: 'call_1',
        toolName: 'readFile',
        input: { file_path: '/tmp/a.txt' },
      },
    ]);
    expect(assistant.providerOptions).toEqual({
      openaiCompatible: {
        reasoning_content: 'first second',
      },
    });
  });

  it('keeps non-reasoning providers unchanged when no assistantContent is provided', () => {
    const msgs: ModelMessage[] = [
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call_1',
            toolName: 'readFile',
            input: { file_path: '/tmp/a.txt' },
          },
        ],
      },
    ];

    const { messages } = MessageTransform.transform(msgs, 'gpt-4o', 'openai');

    expect(messages).toBe(msgs);
  });
});
