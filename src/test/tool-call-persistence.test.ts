/**
 * Tests for tool-call message persistence bug fix
 *
 * Bug Summary:
 * - tool-executor.ts creates tool-call messages with role='tool'
 * - chat-box.tsx was checking for role='assistant' when saving tool-calls
 * - Result: tool-call messages were never saved to database
 * - When conversation was restored, convertMessages would generate
 *   synthetic tool-calls with empty input: {}
 *
 * Fix: Modified handleToolMessage to save tool-call messages when
 * role='tool' and content[0].type='tool-call'
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock logger FIRST before any imports that may use it

import type { UIMessage, ToolMessageContent } from '@/types/agent';
import type { StoredMessage } from '@/services/database-service';
import type { StoredToolContent } from '@/types';
import { mapStoredToUIMessage } from '@/lib/message-mapper';
import { convertMessages } from '@/lib/llm-utils';

describe('Tool-call message persistence bug fix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Tool-call message format validation', () => {
    it('should recognize tool-call message from tool-executor (role=tool, type=tool-call)', () => {
      // This is the exact format that tool-executor.ts creates
      const toolCallMessage: UIMessage = {
        id: 'toolu_vrtx_01PZAFq5xeWK9jSUKeKAZixH',
        role: 'tool',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'toolu_vrtx_01PZAFq5xeWK9jSUKeKAZixH',
            toolName: 'readFile',
            input: { file_path: '/Users/test/project/src/index.ts' },
          },
        ],
        timestamp: new Date(),
        toolCallId: 'toolu_vrtx_01PZAFq5xeWK9jSUKeKAZixH',
        toolName: 'readFile',
        nestedTools: [],
      };

      // Verify message structure
      expect(toolCallMessage.role).toBe('tool');
      expect(Array.isArray(toolCallMessage.content)).toBe(true);
      const content = toolCallMessage.content as ToolMessageContent[];
      expect(content[0].type).toBe('tool-call');
      expect(content[0].input).toEqual({ file_path: '/Users/test/project/src/index.ts' });
    });

    it('should correctly identify tool-call vs tool-result by content type', () => {
      const toolCallMessage: UIMessage = {
        id: 'call-1',
        role: 'tool',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'readFile',
            input: { file_path: '/test.ts' },
          },
        ],
        timestamp: new Date(),
        toolCallId: 'call-1',
        toolName: 'readFile',
      };

      const toolResultMessage: UIMessage = {
        id: 'result-1',
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'readFile',
            output: 'file content here',
          },
        ],
        timestamp: new Date(),
        toolCallId: 'call-1',
        toolName: 'readFile',
      };

      // Both have role='tool', but different content types
      expect(toolCallMessage.role).toBe('tool');
      expect(toolResultMessage.role).toBe('tool');

      const callContent = toolCallMessage.content as ToolMessageContent[];
      const resultContent = toolResultMessage.content as ToolMessageContent[];

      expect(callContent[0].type).toBe('tool-call');
      expect(resultContent[0].type).toBe('tool-result');
    });
  });

  describe('Tool-call message storage format', () => {
    it('should create correct StoredToolContent for tool-call', () => {
      const toolCallContent: ToolMessageContent = {
        type: 'tool-call',
        toolCallId: 'call-123',
        toolName: 'readFile',
        input: { file_path: '/path/to/file.ts' },
      };

      // This is how chat-box.tsx should serialize the tool-call
      const storedContent: StoredToolContent = {
        type: 'tool-call',
        toolCallId: toolCallContent.toolCallId,
        toolName: toolCallContent.toolName,
        input: toolCallContent.input as Record<string, unknown>,
      };

      expect(storedContent.type).toBe('tool-call');
      expect(storedContent.input).toEqual({ file_path: '/path/to/file.ts' });

      // Verify JSON serialization preserves input
      const serialized = JSON.stringify(storedContent);
      const parsed = JSON.parse(serialized);
      expect(parsed.input).toEqual({ file_path: '/path/to/file.ts' });
    });

    it('should preserve complex input parameters when serialized', () => {
      const complexInput = {
        file_path: '/path/to/file.ts',
        options: {
          encoding: 'utf-8',
          recursive: true,
        },
        patterns: ['*.ts', '*.tsx'],
        limit: 100,
      };

      const storedContent: StoredToolContent = {
        type: 'tool-call',
        toolCallId: 'call-complex',
        toolName: 'searchFiles',
        input: complexInput,
      };

      const serialized = JSON.stringify(storedContent);
      const parsed = JSON.parse(serialized);

      expect(parsed.input).toEqual(complexInput);
      expect(parsed.input.options.encoding).toBe('utf-8');
      expect(parsed.input.patterns).toEqual(['*.ts', '*.tsx']);
    });
  });

  describe('Tool-call message loading and mapping', () => {
    it('should correctly map stored tool-call message to UIMessage', () => {
      const storedContent: StoredToolContent = {
        type: 'tool-call',
        toolCallId: 'call-123',
        toolName: 'readFile',
        input: { file_path: '/test.ts' },
      };

      const storedMessage: StoredMessage = {
        id: 'msg-1',
        conversation_id: 'conv-1',
        role: 'tool',
        content: JSON.stringify(storedContent),
        token_count: 0,
        timestamp: new Date().toISOString(),
        assistant_id: undefined,
        attachments: undefined,
      };

      const uiMessage = mapStoredToUIMessage(storedMessage);

      expect(uiMessage.role).toBe('tool');
      expect(Array.isArray(uiMessage.content)).toBe(true);
      const content = uiMessage.content as ToolMessageContent[];
      expect(content[0].type).toBe('tool-call');
      expect(content[0].toolCallId).toBe('call-123');
      expect(content[0].toolName).toBe('readFile');
      expect(content[0].input).toEqual({ file_path: '/test.ts' });
    });

    it('should correctly map stored tool-result message to UIMessage', () => {
      const storedContent: StoredToolContent = {
        type: 'tool-result',
        toolCallId: 'call-123',
        toolName: 'readFile',
        input: { file_path: '/test.ts' },
        output: 'File content here',
        status: 'success',
      };

      const storedMessage: StoredMessage = {
        id: 'msg-2',
        conversation_id: 'conv-1',
        role: 'tool',
        content: JSON.stringify(storedContent),
        token_count: 0,
        timestamp: new Date().toISOString(),
        assistant_id: undefined,
        attachments: undefined,
      };

      const uiMessage = mapStoredToUIMessage(storedMessage);

      expect(uiMessage.role).toBe('tool');
      const content = uiMessage.content as ToolMessageContent[];
      expect(content[0].type).toBe('tool-result');
      expect(content[0].toolCallId).toBe('call-123');
    });
  });

  describe('convertMessages with properly saved tool-calls', () => {
    const defaultOptions = {
      systemPrompt: 'You are a helpful assistant.',
    };

    it('should NOT generate missing tool-call when tool-call was properly saved', async () => {
      const messages: UIMessage[] = [
        {
          id: '1',
          role: 'user',
          content: 'Read the file',
          timestamp: new Date(),
        },
        // Tool-call (properly saved and loaded)
        {
          id: '2',
          role: 'tool',
          content: [
            {
              type: 'tool-call',
              toolCallId: 'call-123',
              toolName: 'readFile',
              input: { file_path: '/test.ts' },
            },
          ],
          timestamp: new Date(),
          toolCallId: 'call-123',
          toolName: 'readFile',
        },
        // Tool-result (properly saved and loaded)
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

      // Should have: system, user, assistant (tool-call from saved data), tool (tool-result)
      expect(result.length).toBe(4);

      // Verify the tool-call preserves the original input
      const assistantMessage = result[2];
      expect(assistantMessage.role).toBe('assistant');
      expect(assistantMessage.content[0].type).toBe('tool-call');
      expect(assistantMessage.content[0].input).toEqual({ file_path: '/test.ts' });
    });

    it('should preserve input parameters from saved tool-call (not generate empty {})', async () => {
      const complexInput = {
        file_path: '/Users/test/project/src/components/ChatBox.tsx',
        encoding: 'utf-8',
        startLine: 100,
        endLine: 200,
      };

      const messages: UIMessage[] = [
        {
          id: '1',
          role: 'user',
          content: 'Read specific lines from the file',
          timestamp: new Date(),
        },
        {
          id: '2',
          role: 'tool',
          content: [
            {
              type: 'tool-call',
              toolCallId: 'call-complex',
              toolName: 'readFile',
              input: complexInput,
            },
          ],
          timestamp: new Date(),
          toolCallId: 'call-complex',
          toolName: 'readFile',
        },
        {
          id: '3',
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'call-complex',
              toolName: 'readFile',
              output: 'Lines 100-200 content',
            },
          ],
          timestamp: new Date(),
          toolCallId: 'call-complex',
          toolName: 'readFile',
        },
      ];

      const result = await convertMessages(messages, defaultOptions);

      // Verify the input is preserved, not replaced with {}
      const assistantMessage = result[2];
      expect(assistantMessage.content[0].input).toEqual(complexInput);
      expect(assistantMessage.content[0].input).not.toEqual({});
    });

    it('should handle multiple tool-calls with different inputs correctly', async () => {
      const messages: UIMessage[] = [
        {
          id: '1',
          role: 'user',
          content: 'Read multiple files',
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
              input: { file_path: '/file1.ts' },
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
              input: { file_path: '/file2.ts' },
            },
          ],
          timestamp: new Date(),
          toolCallId: 'call-2',
          toolName: 'readFile',
        },
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

      // Verify first tool-call input preserved
      expect(result[2].content[0].input).toEqual({ file_path: '/file1.ts' });

      // Verify second tool-call input preserved
      expect(result[4].content[0].input).toEqual({ file_path: '/file2.ts' });
    });
  });

  describe('End-to-end simulation: save and restore conversation', () => {
    it('should preserve tool-call input through save/load cycle', async () => {
      const originalInput = {
        file_path: '/Users/kks/mygit/talkcody/src/components/chat-box.tsx',
      };

      // Step 1: Simulate tool-executor creating the tool-call message
      const toolCallFromExecutor: UIMessage = {
        id: 'toolu_vrtx_01ABC',
        role: 'tool',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'toolu_vrtx_01ABC',
            toolName: 'readFile',
            input: originalInput,
          },
        ],
        timestamp: new Date(),
        toolCallId: 'toolu_vrtx_01ABC',
        toolName: 'readFile',
      };

      // Step 2: Simulate handleToolMessage creating StoredToolContent
      const toolContent = (toolCallFromExecutor.content as ToolMessageContent[])[0];
      const storedContent: StoredToolContent = {
        type: 'tool-call',
        toolCallId: toolContent.toolCallId,
        toolName: toolContent.toolName,
        input: toolContent.input as Record<string, unknown>,
      };

      // Step 3: Simulate saving to database (JSON.stringify)
      const savedJson = JSON.stringify(storedContent);

      // Step 4: Simulate loading from database
      const storedMessage: StoredMessage = {
        id: 'toolu_vrtx_01ABC',
        conversation_id: 'conv-1',
        role: 'tool',
        content: savedJson,
        token_count: 0,
        timestamp: new Date().toISOString(),
        assistant_id: undefined,
        attachments: undefined,
      };

      // Step 5: Map stored message to UI message
      const restoredMessage = mapStoredToUIMessage(storedMessage);

      // Step 6: Verify restored message has correct input
      const restoredContent = restoredMessage.content as ToolMessageContent[];
      expect(restoredContent[0].type).toBe('tool-call');
      expect(restoredContent[0].input).toEqual(originalInput);

      // Step 7: Pass through convertMessages
      const messages: UIMessage[] = [
        {
          id: '1',
          role: 'user',
          content: 'Read the file',
          timestamp: new Date(),
        },
        restoredMessage,
        {
          id: '2',
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'toolu_vrtx_01ABC',
              toolName: 'readFile',
              output: 'File content',
            },
          ],
          timestamp: new Date(),
          toolCallId: 'toolu_vrtx_01ABC',
          toolName: 'readFile',
        },
      ];

      const convertedMessages = await convertMessages(messages, {
        systemPrompt: 'You are helpful',
      });

      // Verify the tool-call in the converted messages preserves the input
      const assistantWithToolCall = convertedMessages[2];
      expect(assistantWithToolCall.role).toBe('assistant');
      expect(assistantWithToolCall.content[0].input).toEqual(originalInput);
    });
  });

  describe('Regression tests for the original bug', () => {
    it('should NOT produce tool-call with empty {} input when tool-call was saved', async () => {
      // This was the bug: tool-call wasn't saved, so convertMessages
      // would generate a synthetic one with input: {}
      const messages: UIMessage[] = [
        {
          id: '1',
          role: 'user',
          content: 'Read file',
          timestamp: new Date(),
        },
        // With the fix, tool-call IS saved with input
        {
          id: '2',
          role: 'tool',
          content: [
            {
              type: 'tool-call',
              toolCallId: 'call-fix-test',
              toolName: 'readFile',
              input: { file_path: '/important/file.ts' },
            },
          ],
          timestamp: new Date(),
          toolCallId: 'call-fix-test',
          toolName: 'readFile',
        },
        {
          id: '3',
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'call-fix-test',
              toolName: 'readFile',
              output: 'content',
            },
          ],
          timestamp: new Date(),
          toolCallId: 'call-fix-test',
          toolName: 'readFile',
        },
      ];

      const result = await convertMessages(messages, {
        systemPrompt: 'test',
      });

      // Find all assistant messages with tool-call
      const assistantToolCalls = result.filter(
        (m) =>
          m.role === 'assistant' &&
          Array.isArray(m.content) &&
          m.content.some((c: any) => c.type === 'tool-call')
      );

      // Should only have ONE assistant with tool-call (not two - one saved, one generated)
      expect(assistantToolCalls.length).toBe(1);

      // The input should NOT be empty
      const toolCallContent = assistantToolCalls[0].content[0];
      expect(toolCallContent.input).not.toEqual({});
      expect(toolCallContent.input).toEqual({ file_path: '/important/file.ts' });
    });
  });

  describe('handleToolMessage logic simulation', () => {
    /**
     * This simulates the logic in chat-box.tsx handleToolMessage
     * to verify the fix correctly identifies and saves tool-call messages
     */
    it('should correctly identify tool-call message for saving', () => {
      const message: UIMessage = {
        id: 'call-test',
        role: 'tool',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call-test',
            toolName: 'readFile',
            input: { file_path: '/test.ts' },
          },
        ],
        timestamp: new Date(),
        toolCallId: 'call-test',
        toolName: 'readFile',
      };

      // Simulate the fixed logic in handleToolMessage
      const toolContent = Array.isArray(message.content) ? message.content[0] : null;

      // This is the key check that was missing before
      const isToolCall = toolContent && toolContent.type === 'tool-call';

      expect(isToolCall).toBe(true);

      if (isToolCall) {
        const storedContent: StoredToolContent = {
          type: 'tool-call',
          toolCallId: (toolContent as ToolMessageContent).toolCallId,
          toolName: (toolContent as ToolMessageContent).toolName,
          input: (toolContent as ToolMessageContent).input as Record<string, unknown>,
        };

        expect(storedContent.type).toBe('tool-call');
        expect(storedContent.input).toEqual({ file_path: '/test.ts' });
      }
    });

    it('should correctly identify tool-result message for saving', () => {
      const message: UIMessage = {
        id: 'result-test',
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-test',
            toolName: 'readFile',
            output: 'file content',
          },
        ],
        timestamp: new Date(),
        toolCallId: 'call-test',
        toolName: 'readFile',
      };

      const toolContent = Array.isArray(message.content) ? message.content[0] : null;

      // This is NOT a tool-call
      const isToolCall = toolContent && toolContent.type === 'tool-call';
      const isToolResult = toolContent && toolContent.type === 'tool-result';

      expect(isToolCall).toBe(false);
      expect(isToolResult).toBe(true);
    });
  });
});
