// Test for StreamProcessor bug fix: handling JSON string input from providers like MiniMax
// This test verifies the logic at stream-processor.ts:240-250
// When input is a JSON string, it should be parsed to an object

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { StreamProcessor, type StreamProcessorCallbacks } from './stream-processor';

// Mock the settings store
vi.mock('@/stores/settings-store', () => ({
  useSettingsStore: {
    getState: () => ({ language: 'en' }),
  },
}));

// Mock the logger
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('StreamProcessor - JSON string input bug fix', () => {
  /**
   * This test suite verifies the fix for JSON string tool call input.
   *
   * BUG SCENARIO:
   * - Some providers (like MiniMax) return tool_use.input as a JSON string
   *   e.g., "{\"command\": \"ls -la\"}" instead of { command: "ls -la" }
   * - When this string was passed through to build assistant messages,
   *   the API rejected it with: "tool_use.input: Input should be a valid dictionary"
   *
   * THE FIX (stream-processor.ts:240-250):
   * - After decoding HTML entities, check if input is a string
   * - If it's a valid JSON string, parse it to an object
   * - If parsing fails, keep as string (might be intentional)
   *
   * EFFECT:
   * - Tool call input is always an object when sent back to the API
   * - Prevents "Input should be a valid dictionary" errors
   */

  let processor: StreamProcessor;
  let mockCallbacks: StreamProcessorCallbacks;

  beforeEach(() => {
    processor = new StreamProcessor();
    mockCallbacks = {
      onChunk: vi.fn(),
      onStatus: vi.fn(),
    };
  });

  it('should parse JSON string input to object', () => {
    // Simulate a tool call with JSON string input (as MiniMax returns)
    const jsonStringInput = '{"command": "ls -la", "cwd": "/home"}';

    processor.processToolCall(
      {
        toolCallId: 'call-1',
        toolName: 'bash',
        input: jsonStringInput,
      },
      mockCallbacks
    );

    const toolCalls = processor.getToolCalls();
    expect(toolCalls).toHaveLength(1);

    // The input should now be an object, not a string
    expect(typeof toolCalls[0].input).toBe('object');
    expect(toolCalls[0].input).toEqual({
      command: 'ls -la',
      cwd: '/home',
    });
  });

  it('should handle nested JSON string input', () => {
    // More complex JSON string with nested objects
    const jsonStringInput = '{"file_path": "/test.ts", "options": {"recursive": true}}';

    processor.processToolCall(
      {
        toolCallId: 'call-2',
        toolName: 'readFile',
        input: jsonStringInput,
      },
      mockCallbacks
    );

    const toolCalls = processor.getToolCalls();
    expect(toolCalls[0].input).toEqual({
      file_path: '/test.ts',
      options: { recursive: true },
    });
  });

  it('should keep object input as-is', () => {
    // When input is already an object (normal behavior)
    const objectInput = { pattern: '*.ts', path: '/src' };

    processor.processToolCall(
      {
        toolCallId: 'call-3',
        toolName: 'glob',
        input: objectInput,
      },
      mockCallbacks
    );

    const toolCalls = processor.getToolCalls();
    expect(toolCalls[0].input).toEqual({
      pattern: '*.ts',
      path: '/src',
    });
  });

  it('should keep invalid JSON string as string', () => {
    // When input is a string but not valid JSON, keep as string
    const invalidJsonString = 'this is not json';

    processor.processToolCall(
      {
        toolCallId: 'call-4',
        toolName: 'echo',
        input: invalidJsonString,
      },
      mockCallbacks
    );

    const toolCalls = processor.getToolCalls();
    // Should remain as string since it's not valid JSON
    expect(typeof toolCalls[0].input).toBe('string');
    expect(toolCalls[0].input).toBe('this is not json');
  });

  it('should handle escaped quotes in JSON string', () => {
    // JSON string with escaped quotes (common in shell commands)
    const jsonStringInput = '{"command": "echo \\"hello world\\""}';

    processor.processToolCall(
      {
        toolCallId: 'call-5',
        toolName: 'bash',
        input: jsonStringInput,
      },
      mockCallbacks
    );

    const toolCalls = processor.getToolCalls();
    expect(toolCalls[0].input).toEqual({
      command: 'echo "hello world"',
    });
  });

  it('should handle JSON array string input', () => {
    // Some tools might receive array input as JSON string
    const jsonArrayString = '["file1.ts", "file2.ts", "file3.ts"]';

    processor.processToolCall(
      {
        toolCallId: 'call-6',
        toolName: 'multiRead',
        input: jsonArrayString,
      },
      mockCallbacks
    );

    const toolCalls = processor.getToolCalls();
    // Array should be parsed correctly
    expect(Array.isArray(toolCalls[0].input)).toBe(true);
    expect(toolCalls[0].input).toEqual(['file1.ts', 'file2.ts', 'file3.ts']);
  });

  it('documents the bug scenario from MiniMax API', () => {
    /**
     * ACTUAL BUG FROM LOGS:
     * The MiniMax API returned:
     * {
     *   "type": "tool_use",
     *   "id": "call_function_zy9mnhfwk5iv_1",
     *   "name": "bash",
     *   "input": "{\"command\": \"cd /path && sed -i '' 's/old/new/g' file.cpp\"}"
     * }
     *
     * Note: input is a STRING, not an object!
     *
     * When this was sent back to the API without parsing:
     * Error: "invalid params, messages.401.content.1.tool_use.input: Input should be a valid dictionary"
     *
     * The fix parses the JSON string to an object before storing.
     */

    // Simulate the actual bug scenario
    const minimaxStyleInput = '{"command": "cd /path && sed -i \'\' \'s/old/new/g\' file.cpp"}';

    processor.processToolCall(
      {
        toolCallId: 'call_function_zy9mnhfwk5iv_1',
        toolName: 'bash',
        input: minimaxStyleInput,
      },
      mockCallbacks
    );

    const toolCalls = processor.getToolCalls();

    // After fix: input should be an object
    expect(typeof toolCalls[0].input).toBe('object');
    expect(toolCalls[0].input).toHaveProperty('command');

    // This object can now be safely sent back to the API
    // without triggering "Input should be a valid dictionary" error
  });
});
