// src/test/chat-service-tool-ui-rendering.test.ts

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

// Mock logger FIRST before any imports that may use it

import { createLLMService, type LLMService } from '@/services/agents/llm-service';
import type { UIMessage } from '@/types/agent';

// Mock dependencies

vi.mock('@/providers/models/model-service', () => ({
  modelService: { isModelAvailableSync: vi.fn(() => true) },
}));

vi.mock('@/providers/core/provider-factory', () => ({
  aiProviderService: {
    getProviderModel: vi.fn(() => ({ modelId: 'test-model', provider: 'test' })),
  },
}));

// Mock provider store
const mockProviderStore = {
  getProviderModel: vi.fn(() => ({
    languageModel: {
      provider: 'test',
      modelId: 'test-model',
    },
    modelConfig: {
      name: 'Test Model',
      context_length: 128000,
    },
    providerId: 'test-provider',
    modelKey: 'test-model',
  })),
  isModelAvailable: vi.fn(() => true),
  availableModels: [],
  apiKeys: {},
  providers: new Map(),
  customProviders: {},
};

vi.mock('@/providers/stores/provider-store', () => ({
  useProviderStore: {
    getState: vi.fn(() => mockProviderStore),
  },
}));

vi.mock('@/stores/settings-store', () => ({
  settingsManager: {
    getCurrentRootPath: vi.fn(() => '/test/path'),
    getCurrentConversationId: vi.fn(() => 'test-conversation-id'),
    getSync: vi.fn().mockReturnValue(undefined),
    getBatchSync: vi.fn().mockReturnValue({}),
    getAutoApproveEditsGlobal: vi.fn(() => false),
    getAutoCodeReviewGlobal: vi.fn(() => false),
    setAutoApproveEditsGlobal: vi.fn(),
    setAutoCodeReviewGlobal: vi.fn(),
  },
  useSettingsStore: {
    getState: vi.fn(() => ({
      language: 'en',
      getReasoningEffort: vi.fn(() => 'medium'),
      getAutoApproveEditsGlobal: vi.fn(() => false),
      getAutoCodeReviewGlobal: vi.fn(() => false),
      setAutoApproveEditsGlobal: vi.fn(),
      setAutoCodeReviewGlobal: vi.fn(),
    })),
  },
}));

vi.mock('@/services/workspace-root-service', () => ({
  getValidatedWorkspaceRoot: vi.fn().mockResolvedValue('/test/path'),
  getEffectiveWorkspaceRoot: vi.fn().mockResolvedValue('/test/path'),
}));

vi.mock('@/services/ai-pricing-service', () => ({
  aiPricingService: { calculateCost: vi.fn(() => Promise.resolve(0.01)) },
}));

vi.mock('@/services/conversation-manager', () => ({
  ConversationManager: { updateConversationUsage: vi.fn(() => Promise.resolve()) },
}));

vi.mock('@/lib/llm-utils', () => ({
  convertMessages: vi.fn(async (messages) =>
    messages.map((msg: UIMessage) => ({ role: msg.role, content: msg.content }))
  ),
  formatReasoningText: vi.fn((text, isFirst) => (isFirst ? `\n<thinking>\n${text}` : text)),
}));

// Mock tool UI renderers
const mockToolDoingComponent = React.createElement('div', null, 'Tool is running...');
const mockToolResultComponent = React.createElement('div', null, 'Tool completed!');

vi.mock('@/lib/tool-adapter', () => ({
  getToolUIRenderers: vi.fn((toolName) => {
    if (toolName === 'testTool') {
      return {
        renderToolDoing: vi.fn(() => mockToolDoingComponent),
        renderToolResult: vi.fn(() => mockToolResultComponent),
      };
    }
    return null;
  }),
}));

vi.mock('ai', () => ({
  streamText: vi.fn(),
  stepCountIs: vi.fn((count) => ({ type: 'step-count', count })),
  smoothStream: vi.fn(() => undefined),
  NoSuchToolError: { isInstance: vi.fn(() => false) },
  InvalidToolInputError: { isInstance: vi.fn(() => false) },
}));

describe('ChatService Tool UI Rendering', () => {
  const testMessages: UIMessage[] = [
    {
      id: '1',
      role: 'user',
      content: 'Please run a test tool',
      timestamp: new Date(),
    },
  ];

  let mockStreamText: any;
  let _mockGetToolUIRenderers: any;
  let llmService: LLMService;

  beforeEach(async () => {
    vi.clearAllMocks();

    const aiModule = await import('ai');
    mockStreamText = vi.mocked(aiModule.streamText);

    const toolAdapterModule = await import('@/lib/tool-adapter');
    _mockGetToolUIRenderers = vi.mocked(toolAdapterModule.getToolUIRenderers);

    // Create a new LLMService instance for each test
    llmService = createLLMService('test-task-id');
  });

  it('should send tool-call message when tool call starts', async () => {
    // Setup mock tool
    const mockTool = {
      inputSchema: z.object({}),
      execute: vi.fn(() => Promise.resolve({ success: true, result: 'test result' })),
    };

    // Setup mock stream with tool call (first stream)
    const mockFirstStream = [
      {
        type: 'tool-call',
        toolCallId: 'call_testTool_abc123',
        toolName: 'testTool',
        input: { input: 'test input' },
      },
    ];

    // Second stream after tool execution
    const mockSecondStream = [
      { type: 'text-delta', text: 'Tool completed' },
      {
        type: 'step-finish',
        finishReason: 'stop',
        usage: { inputTokens: 10, outputTokens: 5 },
      },
    ];

    mockStreamText
      .mockReturnValueOnce({
        fullStream: (async function* () {
          for (const delta of mockFirstStream) {
            yield delta;
          }
        })(),
        finishReason: Promise.resolve('tool-calls'),
      })
      .mockReturnValueOnce({
        fullStream: (async function* () {
          for (const delta of mockSecondStream) {
            yield delta;
          }
        })(),
        finishReason: Promise.resolve('stop'),
      });

    const toolMessages: UIMessage[] = [];

    await llmService.runAgentLoop(
      {
        messages: testMessages,
        model: 'test-model',
        tools: { testTool: mockTool },
      },
      {
        onChunk: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
        onStatus: vi.fn(),
        onToolMessage: (message: UIMessage) => {
          // Collect tool messages for testing
          toolMessages.push(message);
        },
      }
    );

    // Verify tool-call message was sent (UI rendering happens in message-item.tsx)
    const toolCallMessage = toolMessages.find(
      (m) =>
        m.role === 'tool' &&
        Array.isArray(m.content) &&
        m.content.some((c) => c.type === 'tool-call')
    );
    expect(toolCallMessage).toBeDefined();
    expect(toolCallMessage?.toolName).toBe('testTool');
    // Tool call ID now has format: call_{toolName}_{6-char-random-id}
    expect(toolCallMessage?.toolCallId).toMatch(/^call_testTool_[A-Za-z0-9]{6}$/);
    expect(toolCallMessage?.nestedTools).toEqual([]);
  });

  it('should send tool-result message when tool execution completes', async () => {
    // Setup mock tool
    const mockToolResult = { success: true, result: 'test result' };
    const mockTool = {
      inputSchema: z.object({}),
      execute: vi.fn(() => Promise.resolve(mockToolResult)),
    };

    // Setup mock stream with tool call (first stream)
    const mockFirstStream = [
      {
        type: 'tool-call',
        toolCallId: 'call_testTool_abc123',
        toolName: 'testTool',
        input: { input: 'test input' },
      },
    ];

    // Second stream after tool execution
    const mockSecondStream = [
      { type: 'text-delta', text: 'Tool completed' },
      {
        type: 'step-finish',
        finishReason: 'stop',
        usage: { inputTokens: 10, outputTokens: 5 },
      },
    ];

    mockStreamText
      .mockReturnValueOnce({
        fullStream: (async function* () {
          for (const delta of mockFirstStream) {
            yield delta;
          }
        })(),
        finishReason: Promise.resolve('tool-calls'),
      })
      .mockReturnValueOnce({
        fullStream: (async function* () {
          for (const delta of mockSecondStream) {
            yield delta;
          }
        })(),
        finishReason: Promise.resolve('stop'),
      });

    const toolMessages: UIMessage[] = [];

    await llmService.runAgentLoop(
      {
        messages: testMessages,
        model: 'test-model',
        tools: { testTool: mockTool },
      },
      {
        onChunk: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
        onStatus: vi.fn(),
        onToolMessage: (message: UIMessage) => {
          // Collect tool messages for testing
          toolMessages.push(message);
        },
      }
    );

    // Verify tool-result message was sent (UI rendering happens in message-item.tsx)
    const toolResultMessage = toolMessages.find(
      (m) =>
        m.role === 'tool' &&
        Array.isArray(m.content) &&
        m.content.some((c) => c.type === 'tool-result')
    );
    expect(toolResultMessage).toBeDefined();
    expect(toolResultMessage?.toolName).toBe('testTool');
    // Tool call ID now has format: call_{toolName}_{6-char-random-id}
    expect(toolResultMessage?.toolCallId).toMatch(/^call_testTool_[A-Za-z0-9]{6}$/);

    // Verify the tool result has the correct output
    const toolResultContent = Array.isArray(toolResultMessage?.content)
      ? toolResultMessage.content.find((c: any) => c.type === 'tool-result')
      : undefined;
    expect(toolResultContent?.output).toEqual(mockToolResult);
  });

  it('should include renderDoingUI flag in tool-call message', async () => {
    // Setup mock tool
    const mockTool = {
      inputSchema: z.object({}),
      execute: vi.fn(() => Promise.resolve({ success: true })),
    };

    // Setup mock stream with tool call
    const mockFirstStream = [
      {
        type: 'tool-call',
        toolCallId: 'call_testTool_render123',
        toolName: 'testTool',
        input: {},
      },
    ];

    const mockSecondStream = [
      { type: 'text-delta', text: 'Done' },
      {
        type: 'step-finish',
        finishReason: 'stop',
        usage: { inputTokens: 10, outputTokens: 5 },
      },
    ];

    mockStreamText
      .mockReturnValueOnce({
        fullStream: (async function* () {
          for (const delta of mockFirstStream) {
            yield delta;
          }
        })(),
        finishReason: Promise.resolve('tool-calls'),
      })
      .mockReturnValueOnce({
        fullStream: (async function* () {
          for (const delta of mockSecondStream) {
            yield delta;
          }
        })(),
        finishReason: Promise.resolve('stop'),
      });

    const toolMessages: UIMessage[] = [];

    await llmService.runAgentLoop(
      {
        messages: testMessages,
        model: 'test-model',
        tools: { testTool: mockTool },
      },
      {
        onChunk: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
        onStatus: vi.fn(),
        onToolMessage: (message: UIMessage) => {
          toolMessages.push(message);
        },
      }
    );

    // Find the tool-call message
    const toolCallMessage = toolMessages.find(
      (m) =>
        m.role === 'tool' &&
        Array.isArray(m.content) &&
        m.content.some((c) => c.type === 'tool-call')
    );

    expect(toolCallMessage).toBeDefined();
    // renderDoingUI should be defined (based on tool metadata)
    // The actual value depends on TOOL_DEFINITIONS in tools/index.ts
    expect(toolCallMessage?.renderDoingUI).toBeDefined();
  });
});
