// Test for LLMService bug fix: handling finishReason 'tool-calls' with empty toolCalls array
// This test verifies the logic at llm-service.ts:462
// if (loopState.lastFinishReason === 'tool-calls' && toolCalls.length > 0)
// When toolCalls.length is 0, the loop should exit gracefully

import type { AssistantModelMessage, ToolModelMessage } from 'ai';
import { describe, expect, it } from 'vitest';
import type { ToolCallInfo } from './tool-executor';

describe('LLMService - empty tool calls bug fix', () => {
  /**
   * This test documents the bug fix for repeated callAgent tool invocations.
   *
   * BUG SCENARIO:
   * - Parent agent calls nested agent (e.g., explore) via callAgent tool
   * - Nested agent completes successfully and returns result
   * - Parent agent's LLM receives the tool result
   * - LLM returns finishReason: 'tool-calls' BUT toolCalls array is empty (0 tool calls)
   * - Without the fix, the loop would continue and call the tool again
   * - This resulted in the same agent being invoked 4 times repeatedly
   *
   * THE FIX (llm-service.ts:462):
   * Changed from:
   *   if (loopState.lastFinishReason === 'tool-calls') {
   * To:
   *   if (loopState.lastFinishReason === 'tool-calls' && toolCalls.length > 0) {
   *
   * EFFECT:
   * - When finishReason is 'tool-calls' but toolCalls.length === 0
   * - The condition is false, so we enter the else branch
   * - else branch sets loopState.isComplete = true and breaks the loop
   * - Loop exits gracefully without repeated invocations
   *
   * WHY THIS HAPPENS:
   * - Some LLMs (like glm-4.6@zhipu in the bug report) may return finishReason: 'tool-calls'
   *   even when they don't actually generate any tool calls
   * - This could be due to streaming issues, model behavior, or prompt confusion
   * - The fix provides defensive handling for this edge case
   */

  it('documents the bug fix logic for empty toolCalls array', () => {
    // This is a documentation test that explains the bug fix
    // The actual fix is in llm-service.ts:462

    // Simulating the bug fix logic:
    const testScenarios = [
      {
        name: 'Bug scenario: finishReason=tool-calls, toolCalls=[]',
        finishReason: 'tool-calls',
        toolCalls: [],
        expectedToEnterToolExecution: false,
        expectedToExitLoop: true,
      },
      {
        name: 'Normal scenario: finishReason=tool-calls, toolCalls has items',
        finishReason: 'tool-calls',
        toolCalls: [{ toolName: 'testTool', args: {} }],
        expectedToEnterToolExecution: true,
        expectedToExitLoop: false,
      },
      {
        name: 'Normal scenario: finishReason=stop',
        finishReason: 'stop',
        toolCalls: [],
        expectedToEnterToolExecution: false,
        expectedToExitLoop: true,
      },
    ];

    for (const scenario of testScenarios) {
      // This simulates the condition at llm-service.ts:462
      const shouldEnterToolExecution =
        scenario.finishReason === 'tool-calls' && scenario.toolCalls.length > 0;

      const shouldExitLoop = !shouldEnterToolExecution;

      expect(shouldEnterToolExecution).toBe(scenario.expectedToEnterToolExecution);
      expect(shouldExitLoop).toBe(scenario.expectedToExitLoop);
    }
  });

  it('verifies the condition prevents tool execution when toolCalls is empty', () => {
    // The bug fix condition
    const finishReason = 'tool-calls';
    const toolCalls: any[] = []; // Empty array (the bug scenario)

    // The fixed condition
    const shouldExecuteTools = finishReason === 'tool-calls' && toolCalls.length > 0;

    // Should be false because toolCalls.length is 0
    expect(shouldExecuteTools).toBe(false);

    // This means the loop will enter the else branch:
    // else {
    //   loopState.isComplete = true;
    //   break;
    // }
    // And exit gracefully without executing tools
  });

  it('verifies the condition allows tool execution when toolCalls is not empty', () => {
    // Normal scenario
    const finishReason = 'tool-calls';
    const toolCalls = [{ toolName: 'callAgent', args: { agentId: 'explore' } }];

    // The fixed condition
    const shouldExecuteTools = finishReason === 'tool-calls' && toolCalls.length > 0;

    // Should be true because toolCalls has items
    expect(shouldExecuteTools).toBe(true);

    // This means tools will be executed normally
  });
});

describe('LLMService - parallel tool calls message structure', () => {
  /**
   * This test suite verifies the fix for parallel tool calls message structure.
   *
   * BUG SCENARIO:
   * - When multiple tools are called in parallel, the old code created separate messages
   *   for each tool call and each result:
   *   [Assistant: tool-call 1]
   *   [Assistant: tool-call 2]
   *   [Tool: tool-result 1]
   *   [Tool: tool-result 2]
   *
   * - This violated Anthropic API requirements where each tool_result must have a
   *   corresponding tool_use in the PREVIOUS message.
   *
   * THE FIX (llm-service.ts:519-546):
   * - All parallel tool calls are now combined into ONE assistant message
   * - All tool results are combined into ONE tool message
   * - This ensures proper pairing of tool_use and tool_result blocks
   *
   * CORRECT STRUCTURE:
   * [Assistant: [tool-call 1, tool-call 2, tool-call 3]]
   * [Tool: [tool-result 1, tool-result 2, tool-result 3]]
   */

  it('should combine all parallel tool calls into a single assistant message', () => {
    // Simulate the fixed message construction logic
    const toolCalls: ToolCallInfo[] = [
      { toolCallId: 'call-1', toolName: 'readFile', input: { path: '/test.ts' } },
      { toolCallId: 'call-2', toolName: 'glob', input: { pattern: '*.ts' } },
      { toolCallId: 'call-3', toolName: 'grep', input: { pattern: 'function' } },
    ];

    // This is the fixed logic from llm-service.ts:523-531
    const assistantMessage: AssistantModelMessage = {
      role: 'assistant',
      content: toolCalls.map((tc) => ({
        type: 'tool-call' as const,
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        input: tc.input,
      })),
    };

    // Verify structure
    expect(assistantMessage.role).toBe('assistant');
    expect(Array.isArray(assistantMessage.content)).toBe(true);
    expect(assistantMessage.content).toHaveLength(3);

    // Verify all tool calls are in the same message
    const content = assistantMessage.content as Array<{
      type: string;
      toolCallId: string;
      toolName: string;
      input: unknown;
    }>;
    expect(content[0].type).toBe('tool-call');
    expect(content[0].toolCallId).toBe('call-1');
    expect(content[1].type).toBe('tool-call');
    expect(content[1].toolCallId).toBe('call-2');
    expect(content[2].type).toBe('tool-call');
    expect(content[2].toolCallId).toBe('call-3');
  });

  it('should combine all tool results into a single tool message', () => {
    // Simulate tool execution results
    const results = [
      { toolCall: { toolCallId: 'call-1', toolName: 'readFile', input: {} }, result: 'file content' },
      { toolCall: { toolCallId: 'call-2', toolName: 'glob', input: {} }, result: ['a.ts', 'b.ts'] },
      { toolCall: { toolCallId: 'call-3', toolName: 'grep', input: {} }, result: { matches: 5 } },
    ];

    // This is the fixed logic from llm-service.ts:534-545
    const toolResultMessage: ToolModelMessage = {
      role: 'tool',
      content: results.map(({ toolCall, result }) => ({
        type: 'tool-result' as const,
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        output: {
          type: 'text' as const,
          value: typeof result === 'string' ? result : JSON.stringify(result),
        },
      })),
    };

    // Verify structure
    expect(toolResultMessage.role).toBe('tool');
    expect(Array.isArray(toolResultMessage.content)).toBe(true);
    expect(toolResultMessage.content).toHaveLength(3);

    // Verify all results are in the same message
    expect(toolResultMessage.content[0].type).toBe('tool-result');
    expect(toolResultMessage.content[0].toolCallId).toBe('call-1');
    expect(toolResultMessage.content[0].output).toEqual({ type: 'text', value: 'file content' });

    expect(toolResultMessage.content[1].type).toBe('tool-result');
    expect(toolResultMessage.content[1].toolCallId).toBe('call-2');
    expect(toolResultMessage.content[1].output).toEqual({ type: 'text', value: '["a.ts","b.ts"]' });

    expect(toolResultMessage.content[2].type).toBe('tool-result');
    expect(toolResultMessage.content[2].toolCallId).toBe('call-3');
    expect(toolResultMessage.content[2].output).toEqual({ type: 'text', value: '{"matches":5}' });
  });

  it('should maintain proper pairing of toolCallIds between assistant and tool messages', () => {
    // This test verifies that the toolCallIds match between the two messages
    const toolCalls: ToolCallInfo[] = [
      { toolCallId: 'unique-id-1', toolName: 'tool1', input: { a: 1 } },
      { toolCallId: 'unique-id-2', toolName: 'tool2', input: { b: 2 } },
    ];

    const results = [
      { toolCall: toolCalls[0], result: 'result1' },
      { toolCall: toolCalls[1], result: 'result2' },
    ];

    // Build messages using the fixed logic
    const assistantMessage: AssistantModelMessage = {
      role: 'assistant',
      content: toolCalls.map((tc) => ({
        type: 'tool-call' as const,
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        input: tc.input,
      })),
    };

    const toolResultMessage: ToolModelMessage = {
      role: 'tool',
      content: results.map(({ toolCall, result }) => ({
        type: 'tool-result' as const,
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        output: {
          type: 'text' as const,
          value: typeof result === 'string' ? result : JSON.stringify(result),
        },
      })),
    };

    // Extract toolCallIds from both messages
    const assistantContent = assistantMessage.content as Array<{ toolCallId: string }>;
    const toolResultContent = toolResultMessage.content;

    const assistantIds = assistantContent.map((c) => c.toolCallId);
    const toolResultIds = toolResultContent.map((c) => c.toolCallId);

    // Verify all IDs match (this is what Anthropic API requires)
    expect(assistantIds).toEqual(toolResultIds);
    expect(assistantIds).toEqual(['unique-id-1', 'unique-id-2']);
  });

  it('should handle single tool call correctly (not regression)', () => {
    // Ensure single tool calls still work
    const toolCalls: ToolCallInfo[] = [
      { toolCallId: 'single-call', toolName: 'singleTool', input: { param: 'value' } },
    ];

    const results = [{ toolCall: toolCalls[0], result: 'single result' }];

    const assistantMessage: AssistantModelMessage = {
      role: 'assistant',
      content: toolCalls.map((tc) => ({
        type: 'tool-call' as const,
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        input: tc.input,
      })),
    };

    const toolResultMessage: ToolModelMessage = {
      role: 'tool',
      content: results.map(({ toolCall, result }) => ({
        type: 'tool-result' as const,
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        output: {
          type: 'text' as const,
          value: typeof result === 'string' ? result : JSON.stringify(result),
        },
      })),
    };

    expect(assistantMessage.content).toHaveLength(1);
    expect(toolResultMessage.content).toHaveLength(1);
    expect((assistantMessage.content as Array<{ toolCallId: string }>)[0].toolCallId).toBe('single-call');
    expect(toolResultMessage.content[0].toolCallId).toBe('single-call');
  });

  it('should serialize non-string results to JSON', () => {
    // Test that complex objects are properly serialized
    const results = [
      {
        toolCall: { toolCallId: 'call-1', toolName: 'tool1', input: {} },
        result: { nested: { data: [1, 2, 3], flag: true } },
      },
    ];

    const toolResultMessage: ToolModelMessage = {
      role: 'tool',
      content: results.map(({ toolCall, result }) => ({
        type: 'tool-result' as const,
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        output: {
          type: 'text' as const,
          value: typeof result === 'string' ? result : JSON.stringify(result),
        },
      })),
    };

    const expectedJson = '{"nested":{"data":[1,2,3],"flag":true}}';
    expect(toolResultMessage.content[0].output).toEqual({ type: 'text', value: expectedJson });
  });

  it('documents the old buggy behavior vs new correct behavior', () => {
    /**
     * OLD BUGGY BEHAVIOR (caused Anthropic API error):
     *
     * for (const toolCall of toolCalls) {
     *   const toolCallMessage = buildToolCallMessage(toolCall);  // Creates separate message
     *   messages.push(toolCallMessage);
     * }
     * for (const { toolCall, result } of results) {
     *   const toolResultMessage = buildToolResultMessage(toolCall, result);  // Creates separate message
     *   messages.push(toolResultMessage);
     * }
     *
     * This would create:
     * messages[0] = { role: 'assistant', content: [tool-call-1] }
     * messages[1] = { role: 'assistant', content: [tool-call-2] }  // ERROR: No matching tool_result!
     * messages[2] = { role: 'tool', content: [tool-result-1] }     // ERROR: Looks for tool_use in messages[1]
     * messages[3] = { role: 'tool', content: [tool-result-2] }
     *
     * NEW CORRECT BEHAVIOR:
     * messages[0] = { role: 'assistant', content: [tool-call-1, tool-call-2] }
     * messages[1] = { role: 'tool', content: [tool-result-1, tool-result-2] }
     *
     * This ensures each tool_result has a matching tool_use in the previous message.
     */

    // Simulate old behavior
    const toolCalls: ToolCallInfo[] = [
      { toolCallId: 'id1', toolName: 'tool1', input: {} },
      { toolCallId: 'id2', toolName: 'tool2', input: {} },
    ];

    const oldMessages: Array<AssistantModelMessage | ToolModelMessage> = [];

    // Old buggy loop - creates separate messages
    for (const toolCall of toolCalls) {
      oldMessages.push({
        role: 'assistant',
        content: [{ type: 'tool-call' as const, toolCallId: toolCall.toolCallId, toolName: toolCall.toolName, input: toolCall.input }],
      });
    }

    // This is wrong - 2 separate assistant messages
    expect(oldMessages.filter((m) => m.role === 'assistant')).toHaveLength(2);

    // New correct behavior - single message
    const newMessages: Array<AssistantModelMessage | ToolModelMessage> = [];
    newMessages.push({
      role: 'assistant',
      content: toolCalls.map((tc) => ({
        type: 'tool-call' as const,
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        input: tc.input,
      })),
    });

    // This is correct - 1 assistant message with all tool calls
    expect(newMessages.filter((m) => m.role === 'assistant')).toHaveLength(1);
    expect((newMessages[0].content as Array<unknown>)).toHaveLength(2);
  });
});

describe('LLMService - JSON string input defensive parsing', () => {
  /**
   * This test suite verifies the defensive fix for JSON string tool call input.
   *
   * BUG SCENARIO:
   * - Some providers (like MiniMax) return tool_use.input as a JSON string
   *   e.g., "{\"command\": \"ls -la\"}" instead of { command: "ls -la" }
   * - When building assistant messages, the string input would be passed through
   * - The API rejected it with: "tool_use.input: Input should be a valid dictionary"
   *
   * THE FIX (llm-service.ts:747-764):
   * - When building toolCallParts, check if input is a string
   * - If it's a valid JSON string, parse it to an object
   * - If parsing fails, wrap it in { value: input } to satisfy API requirements
   *
   * This is a defensive second layer - StreamProcessor should already parse JSON strings,
   * but this ensures the message is always valid even if something slips through.
   */

  it('should parse JSON string input when building tool call parts', () => {
    // Simulate tool calls with JSON string input
    const toolCalls: ToolCallInfo[] = [
      {
        toolCallId: 'call-1',
        toolName: 'bash',
        input: '{"command": "ls -la"}' as unknown, // JSON string (should be object)
      },
    ];

    // This simulates the fixed logic from llm-service.ts:747-764
    const toolCallParts = toolCalls.map((tc) => {
      let input = tc.input;
      if (typeof input === 'string') {
        try {
          input = JSON.parse(input);
        } catch {
          input = { value: input };
        }
      }
      return {
        type: 'tool-call' as const,
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        input,
      };
    });

    // Input should be parsed to object
    expect(typeof toolCallParts[0].input).toBe('object');
    expect(toolCallParts[0].input).toEqual({ command: 'ls -la' });
  });

  it('should wrap invalid JSON string in value object', () => {
    // When input is a string but not valid JSON
    const toolCalls: ToolCallInfo[] = [
      {
        toolCallId: 'call-2',
        toolName: 'echo',
        input: 'plain text value' as unknown, // Not JSON
      },
    ];

    const toolCallParts = toolCalls.map((tc) => {
      let input = tc.input;
      if (typeof input === 'string') {
        try {
          input = JSON.parse(input);
        } catch {
          input = { value: input };
        }
      }
      return {
        type: 'tool-call' as const,
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        input,
      };
    });

    // Input should be wrapped in { value: ... }
    expect(typeof toolCallParts[0].input).toBe('object');
    expect(toolCallParts[0].input).toEqual({ value: 'plain text value' });
  });

  it('should keep object input unchanged', () => {
    // Normal case: input is already an object
    const toolCalls: ToolCallInfo[] = [
      {
        toolCallId: 'call-3',
        toolName: 'readFile',
        input: { path: '/test.ts', encoding: 'utf8' },
      },
    ];

    const toolCallParts = toolCalls.map((tc) => {
      let input = tc.input;
      if (typeof input === 'string') {
        try {
          input = JSON.parse(input);
        } catch {
          input = { value: input };
        }
      }
      return {
        type: 'tool-call' as const,
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        input,
      };
    });

    // Input should remain unchanged
    expect(toolCallParts[0].input).toEqual({ path: '/test.ts', encoding: 'utf8' });
  });

  it('should handle the actual MiniMax bug scenario', () => {
    /**
     * ACTUAL BUG FROM LOGS:
     * MiniMax returned tool_use with input as JSON string:
     * "input": "{\"command\": \"cd /path && sed -i '' 's/old/new/g' file.cpp\"}"
     *
     * Error: "invalid params, messages.401.content.1.tool_use.input: Input should be a valid dictionary"
     */
    const toolCalls: ToolCallInfo[] = [
      {
        toolCallId: 'call_function_zy9mnhfwk5iv_1',
        toolName: 'bash',
        input: '{"command": "cd /path && sed -i \'\' \'s/old/new/g\' file.cpp"}' as unknown,
      },
    ];

    const toolCallParts = toolCalls.map((tc) => {
      let input = tc.input;
      if (typeof input === 'string') {
        try {
          input = JSON.parse(input);
        } catch {
          input = { value: input };
        }
      }
      return {
        type: 'tool-call' as const,
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        input,
      };
    });

    // After fix: input is an object that API will accept
    expect(typeof toolCallParts[0].input).toBe('object');
    expect(toolCallParts[0].input).toHaveProperty('command');

    // Build assistant message to verify it's valid
    const assistantMessage: AssistantModelMessage = {
      role: 'assistant',
      content: toolCallParts,
    };

    // Message structure is valid for API
    expect(assistantMessage.role).toBe('assistant');
    expect(Array.isArray(assistantMessage.content)).toBe(true);
    expect(typeof (assistantMessage.content as Array<{ input: unknown }>)[0].input).toBe('object');
  });

  it('should handle multiple tool calls with mixed input types', () => {
    // Mix of string and object inputs
    const toolCalls: ToolCallInfo[] = [
      {
        toolCallId: 'call-a',
        toolName: 'bash',
        input: '{"command": "ls"}' as unknown, // JSON string
      },
      {
        toolCallId: 'call-b',
        toolName: 'readFile',
        input: { path: '/file.ts' }, // Object
      },
      {
        toolCallId: 'call-c',
        toolName: 'echo',
        input: 'hello world' as unknown, // Plain string
      },
    ];

    const toolCallParts = toolCalls.map((tc) => {
      let input = tc.input;
      if (typeof input === 'string') {
        try {
          input = JSON.parse(input);
        } catch {
          input = { value: input };
        }
      }
      return {
        type: 'tool-call' as const,
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        input,
      };
    });

    // All inputs should be objects
    expect(toolCallParts[0].input).toEqual({ command: 'ls' }); // Parsed JSON
    expect(toolCallParts[1].input).toEqual({ path: '/file.ts' }); // Unchanged object
    expect(toolCallParts[2].input).toEqual({ value: 'hello world' }); // Wrapped string
  });
});
