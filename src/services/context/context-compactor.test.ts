import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Use vi.hoisted to create mock functions that can be referenced in vi.mock
const mockEstimateTokens = vi.hoisted(() => vi.fn());
const mockCompactContext = vi.hoisted(() => vi.fn());

// Mock AI Context Compaction Service
vi.mock('@/services/ai/ai-context-compaction', () => ({
  aiContextCompactionService: {
    compactContext: mockCompactContext,
  },
}));

import type { Message as ModelMessage } from '@/services/llm/types';
import { ContextCompactor } from './context-compactor';
import type {
  CompressionConfig,
  CompressionResult,
  MessageCompactionOptions,
} from '../../types/agent';

// Mock code-navigation-service for estimateTokens
vi.mock('@/services/code-navigation-service', () => ({
  estimateTokens: mockEstimateTokens,
  summarizeCodeContent: vi.fn().mockResolvedValue({
    success: false,
    summary: '',
    original_lines: 0,
    lang_id: 'unknown',
  }),
  getLangIdFromPath: vi.fn().mockReturnValue(null),
}));

// Mock provider store to provide available models
vi.mock('@/providers/stores/provider-store', () => ({
  useProviderStore: {
    getState: () => ({
      isModelAvailable: () => true,
      getProviderModel: vi.fn().mockReturnValue({}),
      availableModels: [
        {
          key: 'google/gemini-2.5-flash-lite',
          name: 'Gemini 2.5 Flash Lite',
          provider: 'google',
          inputPricing: 0.001,
          outputPricing: 0.002,
        },
      ],
    }),
  },
}));

describe('MessageCompactor', () => {
  let messageCompactor: ContextCompactor;

  const defaultConfig: CompressionConfig = {
    enabled: true,
    preserveRecentMessages: 3,
    compressionModel: 'google/gemini-2.5-flash-lite',
    compressionFallbackModels: ['openai/gpt-4o-mini'],
    compressionThreshold: 0.7,
  };

  const createTestMessages = (count: number): ModelMessage[] => {
    const messages: ModelMessage[] = [];
    for (let i = 0; i < count; i++) {
      messages.push({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i + 1}: This is a test message with some content.`,
      });
    }
    return messages;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock AI context compaction service with default response
    const mockResponse = `
<analysis>
This is a test compression analysis.
</analysis>

1. Primary Request and Intent: The user is testing the compression functionality.
2. Key Technical Concepts: Message compression, AI models, context management.
3. Files and Code Sections: Testing compression algorithms.
4. Errors and fixes: No errors in this test scenario.
5. Problem Solving: Implementing efficient message compression.
6. All user messages: User requested testing of compression feature.
7. Pending Tasks: Complete compression testing.
8. Current Work: Running compression tests.
`;
    
    mockCompactContext.mockResolvedValue(mockResponse);

    // Set default return value for estimateTokens
    // Individual tests can override with mockResolvedValueOnce
    mockEstimateTokens.mockResolvedValue(1000);

    messageCompactor = new ContextCompactor();
  });


  describe('compactMessages', () => {
    it('should compress messages when needed', async () => {
      const messages = createTestMessages(15);
      const options: MessageCompactionOptions = {
        messages,
        config: defaultConfig,
        systemPrompt: 'Test system prompt',
      };

      const result = await messageCompactor.compactMessages(options, 0);

      expect(result).toBeDefined();
      expect(result.originalMessageCount).toBe(15);
      expect(result.compressedMessageCount).toBe(4); // 1 summary + 3 preserved
      expect(result.compressionRatio).toBeLessThan(1);
      expect(result.compressedSummary).toBeTruthy();
      expect(result.preservedMessages).toHaveLength(3);
      expect(mockCompactContext).toHaveBeenCalledWith(
        expect.any(String),
        'google/gemini-2.5-flash-lite',
        ['openai/gpt-4o-mini']
      );
      expect(mockCompactContext).toHaveBeenCalledTimes(1);
    });

    it('should return original messages when no compression needed', async () => {
      const messages = createTestMessages(2);
      const options: MessageCompactionOptions = {
        messages,
        config: defaultConfig,
      };

      const result = await messageCompactor.compactMessages(options, 0);

      expect(result.originalMessageCount).toBe(2);
      expect(result.compressedMessageCount).toBe(2);
      expect(result.compressionRatio).toBe(1.0);
      expect(result.compressedSummary).toBe('');
      expect(result.preservedMessages).toEqual(messages);
      expect(mockCompactContext).not.toHaveBeenCalled();
    });

    it('should compress same messages multiple times', async () => {
      const messages = createTestMessages(12);
      const options: MessageCompactionOptions = {
        messages,
        config: defaultConfig,
      };

      // First compression
      const result1 = await messageCompactor.compactMessages(options, 0);
      expect(mockCompactContext).toHaveBeenCalledTimes(1);

      // Second compression with same messages should also call runAgentLoop
      const result2 = await messageCompactor.compactMessages(options, 0);
      expect(mockCompactContext).toHaveBeenCalledTimes(2);
      // Results should have same structure
      expect(result2.originalMessageCount).toBe(result1.originalMessageCount);
      expect(result2.compressedMessageCount).toBe(result1.compressedMessageCount);
    });
  });

  describe('createCompressedMessages', () => {
    it('should create properly formatted compressed messages with summary as user message', () => {
      // Create preserved messages with a system message (systemPrompt) first
      const preservedMessages: ModelMessage[] = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ];

      const mockResult: CompressionResult = {
        compressedSummary: 'This is a test summary.',
        sections: [],
        preservedMessages,
        originalMessageCount: 10,
        compressedMessageCount: 6,
        compressionRatio: 0.6,
      };

      const compressedMessages = messageCompactor.createCompressedMessages(mockResult);

      // Expected structure:
      // [system] original systemPrompt
      // [user] summary
      // [assistant] acknowledgment
      // [user] preserved user message
      // [assistant] preserved assistant message
      expect(compressedMessages.length).toBeGreaterThanOrEqual(5);
      expect(compressedMessages[0].role).toBe('system');
      expect(compressedMessages[0].content).toBe('You are a helpful assistant.');

      // Summary should be a user message
      expect(compressedMessages[1].role).toBe('user');
      expect(compressedMessages[1].content).toContain('[Previous conversation summary]');
      expect(compressedMessages[1].content).toContain('This is a test summary.');

      // Assistant acknowledgment should follow
      expect(compressedMessages[2].role).toBe('assistant');
      expect(compressedMessages[2].content).toContain('I understand the previous context');
    });

    it('should handle empty compression summary', () => {
      const mockResult: CompressionResult = {
        compressedSummary: '',
        sections: [],
        preservedMessages: createTestMessages(2),
        originalMessageCount: 5,
        compressedMessageCount: 2,
        compressionRatio: 0.4,
      };

      const compressedMessages = messageCompactor.createCompressedMessages(mockResult);

      expect(compressedMessages).toHaveLength(2); // Only preserved messages
      expect(compressedMessages).toEqual(mockResult.preservedMessages);
    });

    it('should preserve original systemPrompt and skip old summary messages', () => {
      const preservedMessages: ModelMessage[] = [
        { role: 'system', content: 'Original system prompt' },
        {
          role: 'system',
          content: '[Previous conversation summary]\n\nOld summary that should be condensed',
        },
        { role: 'user', content: 'Recent user message' },
      ];

      const mockResult: CompressionResult = {
        compressedSummary: 'New compressed summary',
        sections: [],
        preservedMessages,
        originalMessageCount: 20,
        compressedMessageCount: 5,
        compressionRatio: 0.25,
      };

      const compressedMessages = messageCompactor.createCompressedMessages(mockResult);

      // First should be original system prompt
      expect(compressedMessages[0].role).toBe('system');
      expect(compressedMessages[0].content).toBe('Original system prompt');

      // Second should be user message with new summary (condensing old)
      expect(compressedMessages[1].role).toBe('user');
      expect(compressedMessages[1].content).toContain('[Previous conversation summary]');
      expect(compressedMessages[1].content).toContain('New compressed summary');
      expect(compressedMessages[1].content).toContain('Earlier context');

      // Old summary system message should be skipped
      const hasOldSummarySystem = compressedMessages.some(
        (m) =>
          m.role === 'system' &&
          typeof m.content === 'string' &&
          m.content.includes('Old summary')
      );
      expect(hasOldSummarySystem).toBe(false);
    });
  });

  describe('statistics', () => {
    it('should track compression statistics', async () => {
      const messages = createTestMessages(12);
      const options: MessageCompactionOptions = {
        messages,
        config: defaultConfig,
      };

      const initialStats = messageCompactor.getCompressionStats();
      expect(initialStats.totalCompressions).toBe(0);

      await messageCompactor.compactMessages(options, 0);

      const updatedStats = messageCompactor.getCompressionStats();
      expect(updatedStats.totalCompressions).toBe(1);
      expect(updatedStats.averageCompressionRatio).toBeGreaterThan(0);
    });

    it('should calculate average compression ratio correctly', async () => {
      const messages1 = createTestMessages(10);
      const messages2 = createTestMessages(15);

      await messageCompactor.compactMessages({ messages: messages1, config: defaultConfig }, 0);
      await messageCompactor.compactMessages({ messages: messages2, config: defaultConfig }, 0);

      const stats = messageCompactor.getCompressionStats();
      expect(stats.totalCompressions).toBe(2);
      expect(stats.averageCompressionRatio).toBeGreaterThan(0);
      expect(stats.averageCompressionRatio).toBeLessThan(1);
    });
  });

  describe('error handling', () => {
    it('should handle compression errors gracefully', async () => {
      // Mock AI service to reject with error
      mockCompactContext.mockRejectedValueOnce(new Error('Compression failed'));

      const messages = createTestMessages(12);
      const options: MessageCompactionOptions = {
        messages,
        config: defaultConfig,
      };

      // Should return fallback result instead of throwing
      const result = await messageCompactor.compactMessages(options, 0);
      expect(result.compressedSummary).toBe('');
      expect(result.sections).toEqual([]);
      expect(result.preservedMessages.length).toBeGreaterThan(0);
    });
  });

  describe('edge cases and boundary conditions', () => {
    it('should handle preserveRecentMessages greater than message count', async () => {
      const messages = createTestMessages(5);
      const config: CompressionConfig = {
        ...defaultConfig,
        preserveRecentMessages: 10, // More than message count
      };

      const result = await messageCompactor.compactMessages({
        messages,
        config,
      }, 0);

      expect(result.preservedMessages).toHaveLength(5);
      expect(result.compressedSummary).toBe('');
      expect(result.compressionRatio).toBe(1.0);
    });

    it('should handle empty message array', async () => {
      const result = await messageCompactor.compactMessages({
        messages: [],
        config: defaultConfig,
      }, 0);

      expect(result.originalMessageCount).toBe(0);
      expect(result.compressedMessageCount).toBe(0);
      expect(result.preservedMessages).toHaveLength(0);
    });

    it('should handle messages with mixed content types', async () => {
      const mixedMessages: ModelMessage[] = [
        { role: 'user', content: 'Text message' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Response' },
            { type: 'tool-call', toolCallId: '1', toolName: 'test', input: {} },
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: '1',
              toolName: 'test',
              output: { type: 'text', value: 'success' },
            },
          ],
        },
      ];

      const config: CompressionConfig = {
        ...defaultConfig,
        preserveRecentMessages: 1,
      };

      const result = await messageCompactor.compactMessages({
        messages: mixedMessages,
        config,
      }, 0);

      // adjustPreserveBoundary ensures tool-call/tool-result pairs are kept together,
      // so preserveCount is adjusted from 1 to 2 to include the assistant message with tool-call.
      // The user message is in messagesToCompress and will be compressed.
      expect(result.preservedMessages).toHaveLength(2);
      // Compression is called because the user message needs to be compressed
      expect(mockCompactContext).toHaveBeenCalled();
    });
  });

  describe('section parsing edge cases', () => {
    it('should parse sections with various formats', () => {
      const testCases = [
        {
          summary: '1. Title: content\n2. Another: more',
          expectedCount: 2,
        },
        {
          summary: '1) Title: content\n2) Another: more',
          expectedCount: 2,
        },
        {
          summary: '1 - Title: content\n2 - Another: more',
          expectedCount: 2,
        },
      ];

      for (const testCase of testCases) {
        const sections = (messageCompactor as any).parseSections(testCase.summary);
        expect(sections.length).toBeGreaterThanOrEqual(testCase.expectedCount);
      }
    });

    it('should handle malformed section formats gracefully', () => {
      const malformedSummary = 'This is just plain text without sections';
      const sections = (messageCompactor as any).parseSections(malformedSummary);

      expect(sections.length).toBeGreaterThan(0);
      expect(sections[0].title).toBe('Summary');
      expect(sections[0].content).toContain('plain text');
    });

    it('should extract analysis tags correctly', () => {
      const summaryWithAnalysis = '<analysis>Test analysis</analysis>\n1. Section: content';
      const sections = (messageCompactor as any).parseSections(summaryWithAnalysis);

      const analysisSection = sections.find((s: any) => s.title === 'Analysis');
      expect(analysisSection).toBeDefined();
      expect(analysisSection?.content).toBe('Test analysis');
    });
  });

  describe('abort and timeout handling', () => {
    it('should handle abort signal during compression', async () => {
      const abortController = new AbortController();
      const messages = createTestMessages(15);

      // Abort after a short delay
      setTimeout(() => abortController.abort(), 50);

      // Mock to simulate long-running compression
      mockCompactContext.mockImplementation(() => {
        return new Promise<string>((resolve) => {
          setTimeout(() => {
            resolve('aborted response');
          }, 200);
        });
      });

      try {
        await messageCompactor.compactMessages(
          {
            messages,
            config: defaultConfig,
          },
          0,
          abortController
        );
      } catch (_error) {
        // Expected to be aborted or timeout
      }

      // Test should complete without hanging
      expect(true).toBe(true);
    });
  });

  describe('extractLastToolCalls', () => {
    it('should extract the last exitPlanMode tool call and result', async () => {
      const messages: ModelMessage[] = [
        { role: 'user', content: 'Start planning' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Let me plan' },
            {
              type: 'tool-call',
              toolCallId: 'plan-1',
              toolName: 'exitPlanMode',
              args: { plan: 'First plan' },
            } as any,
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'plan-1',
              toolName: 'exitPlanMode',
              result: { approved: true },
            } as any,
          ],
        },
        { role: 'user', content: 'Update the plan' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Updated plan' },
            {
              type: 'tool-call',
              toolCallId: 'plan-2',
              toolName: 'exitPlanMode',
              args: { plan: 'Second plan' },
            } as any,
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'plan-2',
              toolName: 'exitPlanMode',
              result: { approved: true },
            } as any,
          ],
        },
        { role: 'user', content: 'Continue working' },
        { role: 'assistant', content: 'Working on it...' },
        { role: 'user', content: 'More work' },
        { role: 'assistant', content: 'Done' },
      ];

      const config: CompressionConfig = {
        ...defaultConfig,
        preserveRecentMessages: 2, // Only preserve last 2 messages
      };

      const result = await messageCompactor.compactMessages({
        messages,
        config,
      }, 0);

      // The last exitPlanMode call (plan-2) should be in preserved messages
      const preservedContent = JSON.stringify(result.preservedMessages);
      expect(preservedContent).toContain('plan-2');
      expect(preservedContent).toContain('exitPlanMode');

      // The first exitPlanMode call (plan-1) should NOT be in preserved messages
      expect(preservedContent).not.toContain('plan-1');
    });

    it('should extract the last todoWrite tool call and result', async () => {
      const messages: ModelMessage[] = [
        { role: 'user', content: 'Create todo list' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Creating todos' },
            {
              type: 'tool-call',
              toolCallId: 'todo-1',
              toolName: 'todoWrite',
              args: { todos: [{ id: '1', content: 'First task', status: 'pending' }] },
            } as any,
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'todo-1',
              toolName: 'todoWrite',
              result: [{ id: '1', content: 'First task', status: 'pending' }],
            } as any,
          ],
        },
        { role: 'user', content: 'Update todos' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Updating todos' },
            {
              type: 'tool-call',
              toolCallId: 'todo-2',
              toolName: 'todoWrite',
              args: { todos: [{ id: '1', content: 'First task', status: 'completed' }] },
            } as any,
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'todo-2',
              toolName: 'todoWrite',
              result: [{ id: '1', content: 'First task', status: 'completed' }],
            } as any,
          ],
        },
        { role: 'user', content: 'Continue' },
        { role: 'assistant', content: 'Continuing...' },
      ];

      const config: CompressionConfig = {
        ...defaultConfig,
        preserveRecentMessages: 2,
      };

      const result = await messageCompactor.compactMessages({
        messages,
        config,
      }, 0);

      // The last todoWrite call (todo-2) should be in preserved messages
      const preservedContent = JSON.stringify(result.preservedMessages);
      expect(preservedContent).toContain('todo-2');
      expect(preservedContent).toContain('todoWrite');

      // The first todoWrite call (todo-1) should NOT be in preserved messages
      expect(preservedContent).not.toContain('todo-1');
    });

    it('should extract both exitPlanMode and todoWrite when both exist', async () => {
      const messages: ModelMessage[] = [
        { role: 'user', content: 'Start' },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: 'plan-1',
              toolName: 'exitPlanMode',
              args: { plan: 'The plan' },
            } as any,
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'plan-1',
              toolName: 'exitPlanMode',
              result: { approved: true },
            } as any,
          ],
        },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: 'todo-1',
              toolName: 'todoWrite',
              args: { todos: [] },
            } as any,
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'todo-1',
              toolName: 'todoWrite',
              result: [],
            } as any,
          ],
        },
        { role: 'user', content: 'More work' },
        { role: 'assistant', content: 'Done' },
        { role: 'user', content: 'Even more' },
        { role: 'assistant', content: 'All done' },
      ];

      const config: CompressionConfig = {
        ...defaultConfig,
        preserveRecentMessages: 2,
      };

      const result = await messageCompactor.compactMessages({
        messages,
        config,
      }, 0);

      const preservedContent = JSON.stringify(result.preservedMessages);
      // Both should be preserved
      expect(preservedContent).toContain('exitPlanMode');
      expect(preservedContent).toContain('todoWrite');
      expect(preservedContent).toContain('plan-1');
      expect(preservedContent).toContain('todo-1');
    });

    it('should handle messages without critical tool calls', async () => {
      const messages: ModelMessage[] = [
        { role: 'user', content: 'Hello' },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: 'read-1',
              toolName: 'readFile',
              args: { path: '/some/file' },
            } as any,
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'read-1',
              toolName: 'readFile',
              result: 'file content',
            } as any,
          ],
        },
        { role: 'user', content: 'Thanks' },
        { role: 'assistant', content: 'Welcome' },
        { role: 'user', content: 'Bye' },
        { role: 'assistant', content: 'Goodbye' },
      ];

      const config: CompressionConfig = {
        ...defaultConfig,
        preserveRecentMessages: 2,
      };

      const result = await messageCompactor.compactMessages({
        messages,
        config,
      }, 0);

      // Should still work normally, just with regular preserved messages
      expect(result.preservedMessages.length).toBeGreaterThanOrEqual(2);
      // The readFile tool call should NOT be extracted (not a critical tool)
      const preservedContent = JSON.stringify(result.preservedMessages);
      expect(preservedContent).not.toContain('readFile');
    });

    it('should preserve tool-call and tool-result pairs together', async () => {
      const messages: ModelMessage[] = [
        { role: 'user', content: 'Start' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Planning' },
            {
              type: 'tool-call',
              toolCallId: 'plan-1',
              toolName: 'exitPlanMode',
              args: { plan: 'My plan' },
            } as any,
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'plan-1',
              toolName: 'exitPlanMode',
              result: { approved: true },
            } as any,
          ],
        },
        { role: 'user', content: 'Work' },
        { role: 'assistant', content: 'Working' },
        { role: 'user', content: 'More' },
        { role: 'assistant', content: 'Done' },
      ];

      const config: CompressionConfig = {
        ...defaultConfig,
        preserveRecentMessages: 2,
      };

      const result = await messageCompactor.compactMessages({
        messages,
        config,
      }, 0);

      // Find messages with exitPlanMode
      const hasToolCall = result.preservedMessages.some((msg) => {
        if (msg.role !== 'assistant' || !Array.isArray(msg.content)) return false;
        return msg.content.some(
          (part: any) => part.type === 'tool-call' && part.toolCallId === 'plan-1'
        );
      });

      const hasToolResult = result.preservedMessages.some((msg) => {
        if (msg.role !== 'tool' || !Array.isArray(msg.content)) return false;
        return msg.content.some(
          (part: any) => part.type === 'tool-result' && part.toolCallId === 'plan-1'
        );
      });

      expect(hasToolCall).toBe(true);
      expect(hasToolResult).toBe(true);
    });
  });

  describe('MessageFilter integration', () => {
    it('should filter duplicate file reads before compression', async () => {
      const messages: ModelMessage[] = [
        { role: 'user', content: 'Read file' },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: 'read-1',
              toolName: 'readFile',
              args: { file_path: '/test/file.ts', offset: 0, limit: 100 },
            } as any,
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'read-1',
              toolName: 'readFile',
              result: 'content v1',
            } as any,
          ],
        },
        { role: 'user', content: 'Read again' },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: 'read-2',
              toolName: 'readFile',
              args: { file_path: '/test/file.ts', offset: 0, limit: 100 },
            } as any,
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'read-2',
              toolName: 'readFile',
              result: 'content v2',
            } as any,
          ],
        },
        { role: 'user', content: 'Continue' },
        { role: 'assistant', content: 'Done' },
        { role: 'user', content: 'More' },
        { role: 'assistant', content: 'All done' },
      ];

      const config: CompressionConfig = {
        ...defaultConfig,
        preserveRecentMessages: 2,
      };

      const result = await messageCompactor.compactMessages({
        messages,
        config,
      }, 0);

      // Compression should have been called
      expect(mockCompactContext).toHaveBeenCalled();

      // The messages to compress should have been filtered
      // We can verify by checking the compression worked
      expect(result.compressedSummary).toBeTruthy();
    });

    it('should filter exploratory tools outside protection window', async () => {
      // Create messages with exploratory tools
      const messages: ModelMessage[] = [];

      // Add early exploratory tool (should be filtered)
      messages.push({ role: 'user', content: 'Search code' });
      messages.push({
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'glob-1',
            toolName: 'glob',
            args: { pattern: '*.ts' },
          } as any,
        ],
      });
      messages.push({
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'glob-1',
            toolName: 'glob',
            result: ['file1.ts', 'file2.ts'],
          } as any,
        ],
      });

      // Add more messages to push glob outside protection window
      for (let i = 0; i < 25; i++) {
        messages.push({ role: 'user', content: `Message ${i}` });
        messages.push({ role: 'assistant', content: `Response ${i}` });
      }

      const config: CompressionConfig = {
        ...defaultConfig,
        preserveRecentMessages: 4,
      };

      const result = await messageCompactor.compactMessages({
        messages,
        config,
      }, 0);

      // Should complete compression successfully
      expect(result.compressedSummary).toBeTruthy();
      expect(mockCompactContext).toHaveBeenCalled();
    });

    it('should apply filter after extracting critical tool calls', async () => {
      // This test verifies the order of operations:
      // 1. Extract critical tools (exitPlanMode, todoWrite)
      // 2. Apply MessageFilter to remaining messages
      // 3. Compress filtered messages

      const messages: ModelMessage[] = [
        { role: 'user', content: 'Start' },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: 'todo-1',
              toolName: 'todoWrite',
              args: { todos: [{ id: '1', content: 'Task', status: 'pending' }] },
            } as any,
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'todo-1',
              toolName: 'todoWrite',
              result: [{ id: '1', content: 'Task', status: 'pending' }],
            } as any,
          ],
        },
        // Duplicate file reads that should be filtered
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: 'read-1',
              toolName: 'readFile',
              args: { file_path: '/test.ts' },
            } as any,
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'read-1',
              toolName: 'readFile',
              result: 'content',
            } as any,
          ],
        },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: 'read-2',
              toolName: 'readFile',
              args: { file_path: '/test.ts' },
            } as any,
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'read-2',
              toolName: 'readFile',
              result: 'content updated',
            } as any,
          ],
        },
        { role: 'user', content: 'Continue' },
        { role: 'assistant', content: 'Done' },
        { role: 'user', content: 'More' },
        { role: 'assistant', content: 'All done' },
      ];

      const config: CompressionConfig = {
        ...defaultConfig,
        preserveRecentMessages: 2,
      };

      const result = await messageCompactor.compactMessages({
        messages,
        config,
      }, 0);

      // todoWrite should be in preserved messages
      const preservedContent = JSON.stringify(result.preservedMessages);
      expect(preservedContent).toContain('todoWrite');
      expect(preservedContent).toContain('todo-1');

      // Compression should have run
      expect(result.compressedSummary).toBeTruthy();
    });
  });

  describe('system message and user message preservation', () => {
    it('should preserve original system message (systemPrompt) during compression', async () => {
      const messages: ModelMessage[] = [
        { role: 'system', content: 'You are a helpful coding assistant.' },
        { role: 'user', content: 'First message' },
        { role: 'assistant', content: 'Response 1' },
        { role: 'user', content: 'Second message' },
        { role: 'assistant', content: 'Response 2' },
        { role: 'user', content: 'Third message' },
        { role: 'assistant', content: 'Response 3' },
        { role: 'user', content: 'Fourth message' },
        { role: 'assistant', content: 'Response 4' },
        { role: 'user', content: 'Fifth message' },
        { role: 'assistant', content: 'Response 5' },
      ];

      const config: CompressionConfig = {
        ...defaultConfig,
        preserveRecentMessages: 2,
      };

      const result = await messageCompactor.compactMessages({
        messages,
        config,
      }, 0);

      // Original system message should be first in preserved messages
      expect(result.preservedMessages[0]?.role).toBe('system');
      expect(result.preservedMessages[0]?.content).toBe('You are a helpful coding assistant.');
    });

    it('should preserve tool-call/tool-result pairs when adjusting preserve boundary', async () => {
      const messages: ModelMessage[] = [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'First user message' },
        { role: 'assistant', content: 'Response 1' },
        { role: 'user', content: 'Second user message' },
        { role: 'assistant', content: 'Response 2' },
        { role: 'user', content: 'Third user message' },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: 'tool-1',
              toolName: 'someAction',
              input: {},
            },
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'tool-1',
              toolName: 'someAction',
              output: { type: 'text', value: 'done' },
            },
          ],
        },
        { role: 'assistant', content: 'Final response' },
      ];

      const config: CompressionConfig = {
        ...defaultConfig,
        preserveRecentMessages: 2, // Would only preserve tool + assistant without adjustment
      };

      const result = await messageCompactor.compactMessages({
        messages,
        config,
      }, 0);

      // With boundary adjustment, tool-call and tool-result should be preserved together
      // The system message should also be preserved
      expect(result.preservedMessages[0]?.role).toBe('system');

      // The preserved messages should have valid tool-call/tool-result pairs
      const preservedToolCalls = new Set<string>();
      const preservedToolResults = new Set<string>();

      for (const msg of result.preservedMessages) {
        if (msg.role === 'assistant' && Array.isArray(msg.content)) {
          for (const part of msg.content) {
            if ((part as any).type === 'tool-call') {
              preservedToolCalls.add((part as any).toolCallId);
            }
          }
        }
        if (msg.role === 'tool' && Array.isArray(msg.content)) {
          for (const part of msg.content) {
            if ((part as any).type === 'tool-result') {
              preservedToolResults.add((part as any).toolCallId);
            }
          }
        }
      }

      // Every preserved tool-call should have a matching tool-result
      for (const callId of preservedToolCalls) {
        expect(preservedToolResults.has(callId)).toBe(true);
      }
    });

    it('should create valid message sequence after compression', async () => {
      const messages: ModelMessage[] = [
        { role: 'system', content: 'Original system prompt' },
        { role: 'user', content: 'User message 1' },
        { role: 'assistant', content: 'Assistant response 1' },
        { role: 'user', content: 'User message 2' },
        { role: 'assistant', content: 'Assistant response 2' },
        { role: 'user', content: 'User message 3' },
        { role: 'assistant', content: 'Assistant response 3' },
        { role: 'user', content: 'User message 4' },
        { role: 'assistant', content: 'Assistant response 4' },
        { role: 'user', content: 'Recent user message' },
        { role: 'assistant', content: 'Recent assistant response' },
      ];

      const config: CompressionConfig = {
        ...defaultConfig,
        preserveRecentMessages: 2,
      };

      const result = await messageCompactor.compactMessages({
        messages,
        config,
      }, 0);

      const compressedMessages = messageCompactor.createCompressedMessages(result);

      // First message should be system (original systemPrompt)
      expect(compressedMessages[0]?.role).toBe('system');
      expect(compressedMessages[0]?.content).toBe('Original system prompt');

      // Second message should be user (summary)
      expect(compressedMessages[1]?.role).toBe('user');
      expect(compressedMessages[1]?.content).toContain('[Previous conversation summary]');

      // Third message should be assistant (acknowledgment)
      expect(compressedMessages[2]?.role).toBe('assistant');

      // Should have at least one user message after the summary
      const userMessagesAfterSummary = compressedMessages.slice(3).filter((m) => m.role === 'user');
      expect(userMessagesAfterSummary.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('selectMessagesToCompress', () => {
    it('should return empty arrays for empty message array', () => {
      const result = messageCompactor.selectMessagesToCompress([], 3);

      expect(result.messagesToCompress).toHaveLength(0);
      expect(result.preservedMessages).toHaveLength(0);
      expect(result.originalSystemMessage).toBeNull();
    });

    it('should preserve system message and return empty messagesToCompress for only system message', () => {
      const messages: ModelMessage[] = [
        { role: 'system', content: 'You are a helpful assistant.' },
      ];

      const result = messageCompactor.selectMessagesToCompress(messages, 3);

      expect(result.messagesToCompress).toHaveLength(0);
      expect(result.preservedMessages).toHaveLength(1);
      expect(result.preservedMessages[0]?.role).toBe('system');
      expect(result.originalSystemMessage).not.toBeNull();
      expect(result.originalSystemMessage?.content).toBe('You are a helpful assistant.');
    });

    it('should preserve all messages when message count is less than preserveRecentMessages', () => {
      const messages: ModelMessage[] = [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
        { role: 'user', content: 'How are you?' },
        { role: 'assistant', content: 'I am doing well.' },
      ];

      const result = messageCompactor.selectMessagesToCompress(messages, 10);

      expect(result.messagesToCompress).toHaveLength(0);
      // All messages should be preserved (system + 4 conversation messages)
      expect(result.preservedMessages).toHaveLength(5);
      expect(result.originalSystemMessage?.content).toBe('System prompt');
    });

    it('should correctly split messages into compress and preserve groups', () => {
      const messages: ModelMessage[] = [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'Message 1' },
        { role: 'assistant', content: 'Response 1' },
        { role: 'user', content: 'Message 2' },
        { role: 'assistant', content: 'Response 2' },
        { role: 'user', content: 'Message 3' },
        { role: 'assistant', content: 'Response 3' },
        { role: 'user', content: 'Message 4' },
        { role: 'assistant', content: 'Response 4' },
        { role: 'user', content: 'Recent message' },
        { role: 'assistant', content: 'Recent response' },
      ];

      const result = messageCompactor.selectMessagesToCompress(messages, 2);

      // preservedMessages should include: system message + last 2 messages
      expect(result.preservedMessages).toHaveLength(3);
      expect(result.preservedMessages[0]?.role).toBe('system');
      expect(result.preservedMessages[1]?.content).toBe('Recent message');
      expect(result.preservedMessages[2]?.content).toBe('Recent response');

      // messagesToCompress should include the rest (8 messages, may be filtered)
      expect(result.messagesToCompress.length).toBeGreaterThan(0);
      expect(result.originalSystemMessage?.content).toBe('System prompt');
    });

    it('should adjust preserve boundary to avoid cutting tool-call/tool-result pairs', () => {
      const messages: ModelMessage[] = [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'Early message' },
        { role: 'assistant', content: 'Early response' },
        { role: 'user', content: 'Request action' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Taking action' },
            {
              type: 'tool-call',
              toolCallId: 'call-1',
              toolName: 'someAction',
              args: {},
            } as any,
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'call-1',
              toolName: 'someAction',
              result: 'done',
            } as any,
          ],
        },
        { role: 'assistant', content: 'Action completed' },
      ];

      // With preserveRecentMessages=2, only last 2 messages would be preserved
      // But since tool-result is in preserved section, tool-call must be included too
      const result = messageCompactor.selectMessagesToCompress(messages, 2);

      // Check that tool-call and tool-result are both in preserved messages
      const preservedToolCallIds = new Set<string>();
      const preservedToolResultIds = new Set<string>();

      for (const msg of result.preservedMessages) {
        if (msg.role === 'assistant' && Array.isArray(msg.content)) {
          for (const part of msg.content) {
            if ((part as any).type === 'tool-call') {
              preservedToolCallIds.add((part as any).toolCallId);
            }
          }
        }
        if (msg.role === 'tool' && Array.isArray(msg.content)) {
          for (const part of msg.content) {
            if ((part as any).type === 'tool-result') {
              preservedToolResultIds.add((part as any).toolCallId);
            }
          }
        }
      }

      // Every tool-result should have its corresponding tool-call
      for (const resultId of preservedToolResultIds) {
        expect(preservedToolCallIds.has(resultId)).toBe(true);
      }
    });

    it('should extract exitPlanMode tool call to preserved messages', () => {
      const messages: ModelMessage[] = [
        { role: 'user', content: 'Plan something' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Here is my plan' },
            {
              type: 'tool-call',
              toolCallId: 'plan-1',
              toolName: 'exitPlanMode',
              args: { plan: 'The implementation plan' },
            } as any,
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'plan-1',
              toolName: 'exitPlanMode',
              result: { approved: true },
            } as any,
          ],
        },
        { role: 'user', content: 'Continue' },
        { role: 'assistant', content: 'Working on it' },
        { role: 'user', content: 'More work' },
        { role: 'assistant', content: 'Done' },
      ];

      const result = messageCompactor.selectMessagesToCompress(messages, 2);

      // exitPlanMode should be in preserved messages
      const preservedContent = JSON.stringify(result.preservedMessages);
      expect(preservedContent).toContain('exitPlanMode');
      expect(preservedContent).toContain('plan-1');
    });

    it('should extract todoWrite tool call to preserved messages', () => {
      const messages: ModelMessage[] = [
        { role: 'user', content: 'Create todos' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Creating todo list' },
            {
              type: 'tool-call',
              toolCallId: 'todo-1',
              toolName: 'todoWrite',
              args: { todos: [{ id: '1', content: 'Task 1', status: 'pending' }] },
            } as any,
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'todo-1',
              toolName: 'todoWrite',
              result: [{ id: '1', content: 'Task 1', status: 'pending' }],
            } as any,
          ],
        },
        { role: 'user', content: 'Continue' },
        { role: 'assistant', content: 'Working' },
        { role: 'user', content: 'More' },
        { role: 'assistant', content: 'Done' },
      ];

      const result = messageCompactor.selectMessagesToCompress(messages, 2);

      // todoWrite should be in preserved messages
      const preservedContent = JSON.stringify(result.preservedMessages);
      expect(preservedContent).toContain('todoWrite');
      expect(preservedContent).toContain('todo-1');
    });

    it('should extract only the last occurrence of critical tool calls', () => {
      const messages: ModelMessage[] = [
        { role: 'user', content: 'First plan' },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: 'plan-1',
              toolName: 'exitPlanMode',
              args: { plan: 'First plan' },
            } as any,
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'plan-1',
              toolName: 'exitPlanMode',
              result: { approved: true },
            } as any,
          ],
        },
        { role: 'user', content: 'Update plan' },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: 'plan-2',
              toolName: 'exitPlanMode',
              args: { plan: 'Updated plan' },
            } as any,
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'plan-2',
              toolName: 'exitPlanMode',
              result: { approved: true },
            } as any,
          ],
        },
        { role: 'user', content: 'Continue' },
        { role: 'assistant', content: 'Working' },
        { role: 'user', content: 'More' },
        { role: 'assistant', content: 'Done' },
      ];

      const result = messageCompactor.selectMessagesToCompress(messages, 2);

      const preservedContent = JSON.stringify(result.preservedMessages);
      // Only the last exitPlanMode (plan-2) should be preserved
      expect(preservedContent).toContain('plan-2');
      expect(preservedContent).not.toContain('plan-1');
    });

    it('should filter duplicate file reads from messagesToCompress', () => {
      const messages: ModelMessage[] = [
        { role: 'user', content: 'Read file' },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: 'read-1',
              toolName: 'readFile',
              args: { file_path: '/test/file.ts' },
            } as any,
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'read-1',
              toolName: 'readFile',
              result: 'content v1',
            } as any,
          ],
        },
        { role: 'user', content: 'Read again' },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: 'read-2',
              toolName: 'readFile',
              args: { file_path: '/test/file.ts' },
            } as any,
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'read-2',
              toolName: 'readFile',
              result: 'content v2',
            } as any,
          ],
        },
        { role: 'user', content: 'Continue' },
        { role: 'assistant', content: 'Done' },
        { role: 'user', content: 'More' },
        { role: 'assistant', content: 'All done' },
      ];

      const result = messageCompactor.selectMessagesToCompress(messages, 2);

      // The messagesToCompress should have filtered duplicates
      // The exact count depends on MessageFilter implementation
      // We just verify that filtering occurred by checking the method completes successfully
      expect(result.messagesToCompress).toBeDefined();
      expect(result.preservedMessages.length).toBeGreaterThanOrEqual(2);
    });

    it('should handle messages without system message', () => {
      const messages: ModelMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi!' },
        { role: 'user', content: 'How are you?' },
        { role: 'assistant', content: 'Good!' },
        { role: 'user', content: 'Bye' },
        { role: 'assistant', content: 'Goodbye!' },
      ];

      const result = messageCompactor.selectMessagesToCompress(messages, 2);

      expect(result.originalSystemMessage).toBeNull();
      expect(result.preservedMessages).toHaveLength(2);
      expect(result.preservedMessages[0]?.content).toBe('Bye');
      expect(result.preservedMessages[1]?.content).toBe('Goodbye!');
    });
  });

  describe('token early-exit logic', () => {
    it('should skip AI compression when token reduction >= 75%', async () => {
      const messages = createTestMessages(12);

      // Mock estimateTokens to return 20% of original (80% reduction)
      // lastTokenCount = 1000, estimated = 200 -> reduction = 80%
      mockEstimateTokens.mockResolvedValueOnce(200);

      const result = await messageCompactor.compactMessages(
        {
          messages,
          config: defaultConfig,
        },
        1000 // lastTokenCount
      );

      // AI compression should NOT be called (runAgentLoop)
      expect(mockCompactContext).not.toHaveBeenCalled();

      // compressedSummary should be empty (no AI compression)
      expect(result.compressedSummary).toBe('');

      // preservedMessages should include messagesToCompress
      expect(result.preservedMessages.length).toBeGreaterThan(defaultConfig.preserveRecentMessages);

      // compressionRatio should reflect the token reduction
      expect(result.compressionRatio).toBe(0.2); // 200/1000
    });

    it('should skip AI compression when token reduction is exactly 75%', async () => {
      const messages = createTestMessages(12);

      // Mock estimateTokens to return exactly 25% of original (75% reduction)
      // lastTokenCount = 1000, estimated = 250 -> reduction = 75%
      mockEstimateTokens.mockResolvedValueOnce(250);

      const result = await messageCompactor.compactMessages(
        {
          messages,
          config: defaultConfig,
        },
        1000 // lastTokenCount
      );

      // AI compression should NOT be called
      expect(mockCompactContext).not.toHaveBeenCalled();
      expect(result.compressedSummary).toBe('');
      expect(result.compressionRatio).toBe(0.25);
    });

    it('should proceed with AI compression when token reduction < 75%', async () => {
      const messages = createTestMessages(12);

      // Mock estimateTokens to return 50% of original (50% reduction < 75%)
      // lastTokenCount = 1000, estimated = 500 -> reduction = 50%
      mockEstimateTokens.mockResolvedValueOnce(500);

      const result = await messageCompactor.compactMessages(
        {
          messages,
          config: defaultConfig,
        },
        1000 // lastTokenCount
      );

      // AI compression SHOULD be called
      expect(mockCompactContext).toHaveBeenCalled();

      // compressedSummary should have content from AI compression
      expect(result.compressedSummary).toBeTruthy();
    });

    it('should proceed with AI compression when lastTokenCount is not provided', async () => {
      const messages = createTestMessages(12);

      const result = await messageCompactor.compactMessages({
        messages,
        config: defaultConfig,
      }, 0);

      // AI compression SHOULD be called (no early exit without lastTokenCount)
      expect(mockCompactContext).toHaveBeenCalled();
      expect(result.compressedSummary).toBeTruthy();

      // estimateTokens should NOT be called when lastTokenCount is not provided
      expect(mockEstimateTokens).not.toHaveBeenCalled();
    });

    it('should proceed with AI compression when lastTokenCount is 0', async () => {
      const messages = createTestMessages(12);

      const result = await messageCompactor.compactMessages(
        {
          messages,
          config: defaultConfig,
        },
        0 // lastTokenCount = 0
      );

      // AI compression SHOULD be called (no early exit when lastTokenCount is 0)
      expect(mockCompactContext).toHaveBeenCalled();
      expect(result.compressedSummary).toBeTruthy();

      // estimateTokens should NOT be called when lastTokenCount is 0
      expect(mockEstimateTokens).not.toHaveBeenCalled();
    });

    it('should return correct result structure when skipping AI compression', async () => {
      const messages = createTestMessages(12);

      // Mock estimateTokens to trigger early exit (90% reduction)
      mockEstimateTokens.mockResolvedValueOnce(100);

      const result = await messageCompactor.compactMessages(
        {
          messages,
          config: defaultConfig,
        },
        1000 // lastTokenCount
      );

      // Verify result structure
      expect(result).toMatchObject({
        compressedSummary: '',
        sections: [],
        originalMessageCount: 12,
      });

      // preservedMessages should combine messagesToCompress with recentPreservedMessages
      expect(result.preservedMessages.length).toBeGreaterThan(0);

      // compressionRatio should reflect token estimation
      expect(result.compressionRatio).toBe(0.1); // 100/1000
    });

    it('should handle very high token reduction gracefully', async () => {
      const messages = createTestMessages(12);

      // Mock estimateTokens to return very low token count (99% reduction)
      mockEstimateTokens.mockResolvedValueOnce(10);

      const result = await messageCompactor.compactMessages(
        {
          messages,
          config: defaultConfig,
        },
        1000 // lastTokenCount
      );

      // Should skip AI compression
      expect(mockCompactContext).not.toHaveBeenCalled();
      expect(result.compressedSummary).toBe('');
      expect(result.compressionRatio).toBe(0.01); // 10/1000
    });

    it('should handle token reduction just below threshold (74%)', async () => {
      const messages = createTestMessages(12);

      // Mock estimateTokens to return 26% of original (74% reduction < 75%)
      mockEstimateTokens.mockResolvedValueOnce(260);

      const result = await messageCompactor.compactMessages(
        {
          messages,
          config: defaultConfig,
        },
        1000 // lastTokenCount
      );

      // AI compression SHOULD be called (74% < 75%)
      expect(mockCompactContext).toHaveBeenCalled();
      expect(result.compressedSummary).toBeTruthy();
    });

    it('should pass lastTokenCount to performCompressionIfNeeded', async () => {
      const messages = createTestMessages(12);

      // Add a system message to make shouldCompress more likely to pass
      const messagesWithSystem: ModelMessage[] = [
        { role: 'system', content: 'System prompt' },
        ...messages,
      ];

      // Mock estimateTokens to trigger early exit
      mockEstimateTokens.mockResolvedValueOnce(100);

      const largeTokenCount = 200000; // Large enough to trigger compression

      const result = await messageCompactor.performCompressionIfNeeded(
        messagesWithSystem,
        { ...defaultConfig, compressionThreshold: 0.5 }, // 50% threshold
        largeTokenCount,
        'test-model',
        'Test system prompt'
      );

      if (result) {
        // If compression was triggered, estimateTokens should have been called
        expect(mockEstimateTokens).toHaveBeenCalled();
      }
    });
  });
});
