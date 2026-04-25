import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UIMessage } from '@/types/agent';
import { convertMessages } from './llm-utils';

describe('convertMessages', () => {
  const defaultOptions = {
    systemPrompt: 'You are a helpful assistant.',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('basic message conversion', () => {
    it('should add system message at the beginning', async () => {
      const messages: UIMessage[] = [
        {
          id: '1',
          role: 'user',
          content: 'Hello',
          timestamp: new Date(),
        },
      ];

      const result = await convertMessages(messages, defaultOptions);

      expect(result[0]).toEqual({
        role: 'system',
        content: 'You are a helpful assistant.',
        providerOptions: {
          anthropic: { cacheControl: { type: 'ephemeral' } },
        },
      });
    });

    it('should convert user messages correctly', async () => {
      const messages: UIMessage[] = [
        {
          id: '1',
          role: 'user',
          content: 'Hello, how are you?',
          timestamp: new Date(),
        },
      ];

      const result = await convertMessages(messages, defaultOptions);

      expect(result[1]).toEqual({
        role: 'user',
        content: 'Hello, how are you?',
      });
    });

    it('should convert assistant messages with string content', async () => {
      const messages: UIMessage[] = [
        {
          id: '1',
          role: 'user',
          content: 'Hello',
          timestamp: new Date(),
        },
        {
          id: '2',
          role: 'assistant',
          content: 'Hi there! How can I help you?',
          timestamp: new Date(),
        },
      ];

      const result = await convertMessages(messages, defaultOptions);

      expect(result[2]).toEqual({
        role: 'assistant',
        content: 'Hi there! How can I help you?',
      });
    });

    it('should preserve reasoning_content on assistant messages', async () => {
      const messages: UIMessage[] = [
        {
          id: '1',
          role: 'user',
          content: 'Hello',
          timestamp: new Date(),
        },
        {
          id: '2',
          role: 'assistant',
          content: 'Answer',
          reasoningContent: 'thinking',
          timestamp: new Date(),
        },
      ];

      const result = await convertMessages(messages, defaultOptions);

      expect(result[2]).toEqual({
        role: 'assistant',
        content: 'Answer',
        providerOptions: {
          openaiCompatible: {
            reasoning_content: 'thinking',
          },
        },
      });
    });

    it('should skip system messages from input', async () => {
      const messages: UIMessage[] = [
        {
          id: '0',
          role: 'system',
          content: 'This should be skipped',
          timestamp: new Date(),
        },
        {
          id: '1',
          role: 'user',
          content: 'Hello',
          timestamp: new Date(),
        },
      ];

      const result = await convertMessages(messages, defaultOptions);

      expect(result.length).toBe(2); // system (from options) + user
      expect(result[0].role).toBe('system');
      expect(result[0].content).toBe('You are a helpful assistant.');
    });
  });

  describe('tool-call and tool-result pairing', () => {
    it('should convert tool-call message to assistant message format', async () => {
      const messages: UIMessage[] = [
        {
          id: '1',
          role: 'user',
          content: 'Read the file',
          timestamp: new Date(),
        },
        {
          id: '2',
          role: 'tool',
          content: [
            {
              type: 'tool-call',
              toolCallId: 'call-123',
              toolName: 'readFile',
              input: { file_path: '/test.txt' },
            },
          ],
          timestamp: new Date(),
          toolCallId: 'call-123',
          toolName: 'readFile',
        },
        // Tool-result is required for tool-call to not be skipped as orphaned
        {
          id: '3',
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'call-123',
              toolName: 'readFile',
              output: 'File content here',
            },
          ],
          timestamp: new Date(),
          toolCallId: 'call-123',
          toolName: 'readFile',
        },
      ];

      const result = await convertMessages(messages, defaultOptions);

      expect(result[2]).toEqual({
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call-123',
            toolName: 'readFile',
            input: { file_path: '/test.txt' },
          },
        ],
      });
    });

    it('should preserve reasoning_content on tool-call messages', async () => {
      const messages: UIMessage[] = [
        {
          id: '1',
          role: 'user',
          content: 'Read the file',
          timestamp: new Date(),
        },
        {
          id: '2',
          role: 'tool',
          content: [
            {
              type: 'tool-call',
              toolCallId: 'call-123',
              toolName: 'readFile',
              input: { file_path: '/test.txt' },
            },
          ],
          reasoningContent: 'tool thinking',
          timestamp: new Date(),
          toolCallId: 'call-123',
          toolName: 'readFile',
        },
        {
          id: '3',
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'call-123',
              toolName: 'readFile',
              output: 'File content here',
            },
          ],
          timestamp: new Date(),
          toolCallId: 'call-123',
          toolName: 'readFile',
        },
      ];

      const result = await convertMessages(messages, defaultOptions);

      expect(result[2]).toEqual({
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call-123',
            toolName: 'readFile',
            input: { file_path: '/test.txt' },
          },
        ],
        providerOptions: {
          openaiCompatible: {
            reasoning_content: 'tool thinking',
          },
        },
      });
    });

    it('should NOT generate duplicate tool-call when both exist', async () => {
      // This simulates new data where both tool-call and tool-result are saved
      const messages: UIMessage[] = [
        {
          id: '1',
          role: 'user',
          content: 'Read the file',
          timestamp: new Date(),
        },
        {
          id: '2',
          role: 'tool',
          content: [
            {
              type: 'tool-call',
              toolCallId: 'call-123',
              toolName: 'readFile',
              input: { file_path: '/test.txt' },
            },
          ],
          timestamp: new Date(),
          toolCallId: 'call-123',
          toolName: 'readFile',
        },
        {
          id: '3',
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'call-123',
              toolName: 'readFile',
              output: 'File content here',
            },
          ],
          timestamp: new Date(),
          toolCallId: 'call-123',
          toolName: 'readFile',
        },
      ];

      const result = await convertMessages(messages, defaultOptions);

      // Should have: system, user, assistant (tool-call), tool (tool-result)
      // NOT: system, user, assistant (tool-call), assistant (duplicate), tool (tool-result)
      expect(result.length).toBe(4);

      // Only one assistant message with tool-call
      const assistantMessages = result.filter(
        (m) => m.role === 'assistant' && Array.isArray(m.content)
      );
      expect(assistantMessages.length).toBe(1);
    });
  });

  describe('multiple tool calls', () => {
    it('should handle multiple sequential tool calls', async () => {
      const messages: UIMessage[] = [
        {
          id: '1',
          role: 'user',
          content: 'Read both files',
          timestamp: new Date(),
        },
        // First tool-call
        {
          id: '2',
          role: 'tool',
          content: [
            {
              type: 'tool-call',
              toolCallId: 'call-1',
              toolName: 'readFile',
              input: { file_path: '/file1.txt' },
            },
          ],
          timestamp: new Date(),
          toolCallId: 'call-1',
          toolName: 'readFile',
        },
        // First tool-result
        {
          id: '3',
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'call-1',
              toolName: 'readFile',
              output: 'Content of file 1',
            },
          ],
          timestamp: new Date(),
          toolCallId: 'call-1',
          toolName: 'readFile',
        },
        // Second tool-call
        {
          id: '4',
          role: 'tool',
          content: [
            {
              type: 'tool-call',
              toolCallId: 'call-2',
              toolName: 'readFile',
              input: { file_path: '/file2.txt' },
            },
          ],
          timestamp: new Date(),
          toolCallId: 'call-2',
          toolName: 'readFile',
        },
        // Second tool-result
        {
          id: '5',
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'call-2',
              toolName: 'readFile',
              output: 'Content of file 2',
            },
          ],
          timestamp: new Date(),
          toolCallId: 'call-2',
          toolName: 'readFile',
        },
      ];

      const result = await convertMessages(messages, defaultOptions);

      // Should have: system, user, assistant (call-1), tool (result-1), assistant (call-2), tool (result-2)
      expect(result.length).toBe(6);

      // Verify proper pairing
      expect(result[2].role).toBe('assistant');
      expect(result[2].content[0].toolCallId).toBe('call-1');

      expect(result[3].role).toBe('tool');
      expect(result[3].content[0].toolCallId).toBe('call-1');

      expect(result[4].role).toBe('assistant');
      expect(result[4].content[0].toolCallId).toBe('call-2');

      expect(result[5].role).toBe('tool');
      expect(result[5].content[0].toolCallId).toBe('call-2');
    });
  });

  describe('multi-turn conversation scenarios', () => {
    it('should handle complete multi-turn conversation with tools', async () => {
      const messages: UIMessage[] = [
        // Turn 1: User asks to read a file
        {
          id: '1',
          role: 'user',
          content: 'Read the config file',
          timestamp: new Date(),
        },
        // Turn 1: AI reads file (tool-call saved separately)
        {
          id: '2',
          role: 'tool',
          content: [
            {
              type: 'tool-call',
              toolCallId: 'call-1',
              toolName: 'readFile',
              input: { file_path: '/config.json' },
            },
          ],
          timestamp: new Date(),
          toolCallId: 'call-1',
          toolName: 'readFile',
        },
        {
          id: '3',
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'call-1',
              toolName: 'readFile',
              output: '{"key": "value"}',
            },
          ],
          timestamp: new Date(),
          toolCallId: 'call-1',
          toolName: 'readFile',
        },
        // Turn 1: AI responds
        {
          id: '4',
          role: 'assistant',
          content: 'The config file contains {"key": "value"}.',
          timestamp: new Date(),
        },
        // Turn 2: User asks follow-up
        {
          id: '5',
          role: 'user',
          content: 'Now update the key to "newValue"',
          timestamp: new Date(),
        },
      ];

      const result = await convertMessages(messages, defaultOptions);

      // Verify message order and structure
      expect(result[0].role).toBe('system');
      expect(result[1].role).toBe('user');
      expect(result[1].content).toBe('Read the config file');

      expect(result[2].role).toBe('assistant');
      expect(result[2].content[0].type).toBe('tool-call');

      expect(result[3].role).toBe('tool');
      expect(result[3].content[0].type).toBe('tool-result');

      expect(result[4].role).toBe('assistant');
      expect(result[4].content).toBe('The config file contains {"key": "value"}.');

      expect(result[5].role).toBe('user');
      expect(result[5].content).toBe('Now update the key to "newValue"');
    });
  });

  describe('edge cases', () => {
    it('should handle empty messages array', async () => {
      const result = await convertMessages([], defaultOptions);

      expect(result.length).toBe(1);
      expect(result[0].role).toBe('system');
    });

    it('should handle tool message with empty content array', async () => {
      const messages: UIMessage[] = [
        {
          id: '1',
          role: 'user',
          content: 'Hello',
          timestamp: new Date(),
        },
        {
          id: '2',
          role: 'tool',
          content: [],
          timestamp: new Date(),
        },
      ];

      const result = await convertMessages(messages, defaultOptions);

      // Empty tool message should be skipped
      expect(result.length).toBe(2); // system + user
    });

    it('should handle tool-result with object output', async () => {
      const messages: UIMessage[] = [
        {
          id: '1',
          role: 'user',
          content: 'Search',
          timestamp: new Date(),
        },
        {
          id: '2',
          role: 'tool',
          content: [
            {
              type: 'tool-call',
              toolCallId: 'call-123',
              toolName: 'readFile',
              input: { file_path: '/test.json' },
            },
          ],
          timestamp: new Date(),
          toolCallId: 'call-123',
          toolName: 'readFile',
        },
        {
          id: '3',
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'call-123',
              toolName: 'readFile',
              output: { key: 'value', nested: { data: 123 } },
            },
          ],
          timestamp: new Date(),
          toolCallId: 'call-123',
          toolName: 'readFile',
        },
      ];

      const result = await convertMessages(messages, defaultOptions);

      // Should have: system, user, assistant (tool-call), tool (tool-result)
      expect(result.length).toBe(4);
      // Output should be JSON stringified
      expect(result[3].content[0].output.value).toBe('{"key":"value","nested":{"data":123}}');
    });

    it('should handle messages with attachments', async () => {
      const messages: UIMessage[] = [
        {
          id: '1',
          role: 'user',
          content: 'Check this file',
          timestamp: new Date(),
          attachments: [
            {
              id: 'att-1',
              type: 'file',
              filename: 'test.ts',
              filePath: '/path/to/test.ts',
              content: 'const x = 1;',
              mimeType: 'text/typescript',
              size: 12,
            },
          ],
        },
      ];

      const result = await convertMessages(messages, defaultOptions);

      expect(result[1].role).toBe('user');
      expect(result[1].content).toHaveLength(2);
      expect(result[1].content[0].type).toBe('text');
      expect(result[1].content[0].text).toBe('Check this file');
      expect(result[1].content[1].type).toBe('text');
      expect(result[1].content[1].text).toContain('test.ts');
    });

    it('should merge consecutive assistant messages', async () => {
      const messages: UIMessage[] = [
        {
          id: '1',
          role: 'user',
          content: 'Hello',
          timestamp: new Date(),
        },
        {
          id: '2',
          role: 'assistant',
          content: 'First response part',
          timestamp: new Date(),
        },
        {
          id: '3',
          role: 'assistant',
          content: 'Second response part',
          timestamp: new Date(),
        },
      ];

      const result = await convertMessages(messages, defaultOptions);

      // Consecutive assistant messages should be merged
      expect(result.length).toBe(3); // system + user + merged assistant
      expect(result[2].role).toBe('assistant');
      // Content should be merged into array
      expect(Array.isArray(result[2].content)).toBe(true);
      expect(result[2].content).toHaveLength(2);
      expect(result[2].content[0].text).toBe('First response part');
      expect(result[2].content[1].text).toBe('Second response part');
    });

    it('should merge providerOptions when assistant text and tool-call rows share reasoning_content', async () => {
      const messages: UIMessage[] = [
        {
          id: '1',
          role: 'user',
          content: 'Hello',
          timestamp: new Date(),
        },
        {
          id: '2',
          role: 'assistant',
          content: 'First response part',
          reasoningContent: 'thinking',
          timestamp: new Date(),
        },
        {
          id: '3',
          role: 'tool',
          content: [
            {
              type: 'tool-call',
              toolCallId: 'call-123',
              toolName: 'readFile',
              input: { file_path: '/test.txt' },
            },
          ],
          reasoningContent: 'thinking',
          timestamp: new Date(),
          toolCallId: 'call-123',
          toolName: 'readFile',
        },
        {
          id: '4',
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'call-123',
              toolName: 'readFile',
              output: 'File content here',
            },
          ],
          timestamp: new Date(),
          toolCallId: 'call-123',
          toolName: 'readFile',
        },
      ];

      const result = await convertMessages(messages, defaultOptions);

      expect(result[2].role).toBe('assistant');
      expect(result[2].providerOptions).toEqual({
        openaiCompatible: {
          reasoning_content: 'thinking',
        },
      });
    });

    it('should merge three consecutive assistant messages', async () => {
      const messages: UIMessage[] = [
        {
          id: '1',
          role: 'user',
          content: 'Hello',
          timestamp: new Date(),
        },
        {
          id: '2',
          role: 'assistant',
          content: '> Reasoning: thinking...',
          timestamp: new Date(),
        },
        {
          id: '3',
          role: 'assistant',
          content: 'Response text',
          timestamp: new Date(),
        },
        {
          id: '4',
          role: 'assistant',
          content: 'More text',
          timestamp: new Date(),
        },
      ];

      const result = await convertMessages(messages, defaultOptions);

      // All consecutive assistant messages should be merged into one
      expect(result.length).toBe(3); // system + user + merged assistant
      expect(result[2].role).toBe('assistant');
      expect(Array.isArray(result[2].content)).toBe(true);
      expect(result[2].content).toHaveLength(3);
    });

    it('should filter out empty text parts when merging assistant messages', async () => {
      const messages: UIMessage[] = [
        {
          id: '1',
          role: 'user',
          content: 'Hello',
          timestamp: new Date(),
        },
        {
          id: '2',
          role: 'assistant',
          content: 'First part',
          timestamp: new Date(),
        },
        {
          id: '3',
          role: 'assistant',
          content: '',
          timestamp: new Date(),
        },
        {
          id: '4',
          role: 'assistant',
          content: 'Third part',
          timestamp: new Date(),
        },
      ];

      const result = await convertMessages(messages, defaultOptions);

      // Empty text parts should be filtered out
      expect(result.length).toBe(3); // system + user + merged assistant
      expect(result[2].role).toBe('assistant');
      expect(Array.isArray(result[2].content)).toBe(true);
      // Empty content should be filtered
      expect(result[2].content).toHaveLength(2);
      expect(result[2].content[0].text).toBe('First part');
      expect(result[2].content[1].text).toBe('Third part');
    });
  });
});
