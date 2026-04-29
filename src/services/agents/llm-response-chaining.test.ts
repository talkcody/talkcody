import { describe, expect, it, vi } from 'vitest';
import type { Message } from '@/services/llm/types';
import type { AgentLoopState } from '@/types/agent';
import {
  applyResponseMetadataEvent,
  applyTransportFallbackEvent,
  commitResponsesChainBaseline,
  ensureResponsesChainState,
  invalidateResponsesChain,
  planStreamTextRequest,
  resetResponsesChainState,
} from './llm-response-chaining';

const oauthState = {
  openaiIsConnected: true,
};

vi.mock('@/providers/stores/provider-store', () => ({
  useProviderStore: {
    getState: () => ({
      oauthConfig: oauthState,
    }),
  },
}));

vi.mock('@/lib/utils', () => ({
  generateId: vi.fn(() => 'transport-session-1'),
}));

function createLoopState(messages: Message[] = []): AgentLoopState {
  return {
    messages,
    currentIteration: 0,
    isComplete: false,
    lastRequestTokens: 0,
  };
}

describe('llm-response-chaining', () => {
  it('uses full history on the first OpenAI OAuth iteration', () => {
    const messages: Message[] = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'working on it' },
    ];
    const loopState = createLoopState(messages);

    const plan = planStreamTextRequest(loopState, {
      model: 'gpt-5.4@openai',
      iteration: 1,
      messages,
    });

    expect(plan.usesIncrementalInput).toBe(false);
    expect(plan.request.conversationMode).toBe('responses-chained');
    expect(plan.request.inputMode).toBe('full-history');
    expect(plan.request.messages).toEqual(messages);
    expect(plan.request.previousResponseId).toBeNull();
    expect(plan.request.transportSessionId).toBe('transport-session-1');
    expect(loopState.responsesChain?.transportSessionId).toBe('transport-session-1');
  });

  it('sends only the post-baseline delta after a committed chained turn', () => {
    const initialMessages: Message[] = [
      { role: 'user', content: 'read file' },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'readFile',
            input: { file_path: 'src/index.ts' },
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'readFile',
            output: { type: 'text', value: 'first result' },
          },
        ],
      },
    ];
    const loopState = createLoopState([...initialMessages]);

    ensureResponsesChainState(loopState, 'gpt-5.4@openai');
    applyResponseMetadataEvent(loopState, {
      type: 'response-metadata',
      responseId: 'resp-1',
      provider: 'openai-subscription',
      transport: 'websocket',
      continuationAccepted: true,
      transportSessionId: 'session-42',
    });
    commitResponsesChainBaseline(loopState, true, loopState.messages.length);

    loopState.messages.push({ role: 'user', content: 'tool guidance' });

    const plan = planStreamTextRequest(loopState, {
      model: 'gpt-5.4@openai',
      iteration: 2,
      messages: loopState.messages,
    });

    expect(plan.usesIncrementalInput).toBe(true);
    expect(plan.request.inputMode).toBe('incremental');
    expect(plan.request.previousResponseId).toBe('resp-1');
    expect(plan.request.transportSessionId).toBe('session-42');
    expect(plan.request.messages).toEqual([{ role: 'user', content: 'tool guidance' }]);
    expect(plan.request.continuationContext).toEqual({
      iteration: 2,
      baselineMessageCount: 3,
      deltaMessageCount: 1,
      fallbackCount: 0,
    });
  });

  it('keeps synthetic follow-up user guidance incremental when chain is healthy', () => {
    const loopState = createLoopState([{ role: 'user', content: 'start' }]);

    ensureResponsesChainState(loopState, 'gpt-5.4@openai');
    applyResponseMetadataEvent(loopState, {
      type: 'response-metadata',
      responseId: 'resp-healthy',
      provider: 'openai-subscription',
      transport: 'http-sse',
      continuationAccepted: true,
    });
    commitResponsesChainBaseline(loopState, true, loopState.messages.length);

    loopState.messages.push({
      role: 'user',
      content: 'Tool validation error: use available tools only.',
    });

    const plan = planStreamTextRequest(loopState, {
      model: 'gpt-5.4@openai',
      iteration: 2,
      messages: loopState.messages,
    });

    expect(plan.usesIncrementalInput).toBe(true);
    expect(plan.request.messages).toEqual([
      {
        role: 'user',
        content: 'Tool validation error: use available tools only.',
      },
    ]);
  });

  it('invalidates the chain when history is rewritten and falls back to full history', () => {
    const loopState = createLoopState([{ role: 'user', content: 'start' }]);

    ensureResponsesChainState(loopState, 'gpt-5.4@openai');
    applyResponseMetadataEvent(loopState, {
      type: 'response-metadata',
      responseId: 'resp-compact',
      provider: 'openai-subscription',
      transport: 'http-sse',
      continuationAccepted: true,
    });
    commitResponsesChainBaseline(loopState, true, loopState.messages.length);

    invalidateResponsesChain(loopState, 'history_rewritten');
    loopState.messages = [
      { role: 'system', content: 'compressed summary' },
      { role: 'user', content: 'continue' },
    ];

    const plan = planStreamTextRequest(loopState, {
      model: 'gpt-5.4@openai',
      iteration: 3,
      messages: loopState.messages,
    });

    expect(loopState.responsesChain?.broken).toBe(true);
    expect(loopState.responsesChain?.brokenReason).toBe('history_rewritten');
    expect(plan.usesIncrementalInput).toBe(false);
    expect(plan.request.conversationMode).toBe('stateless');
    expect(plan.request.inputMode).toBe('full-history');
    expect(plan.request.messages).toEqual(loopState.messages);
    expect(plan.request.previousResponseId).toBeNull();
    expect(plan.request.transportSessionId).toBeNull();
  });

  it('keeps non-OpenAI providers on stateless mode', () => {
    const messages: Message[] = [{ role: 'user', content: 'hello' }];
    const loopState = createLoopState(messages);

    const plan = planStreamTextRequest(loopState, {
      model: 'claude-sonnet@anthropic',
      iteration: 2,
      messages,
    });

    expect(loopState.responsesChain).toBeUndefined();
    expect(plan.usesIncrementalInput).toBe(false);
    expect(plan.request.conversationMode).toBe('stateless');
    expect(plan.request.inputMode).toBe('full-history');
  });

  it('marks the chain broken on stateless transport fallback', () => {
    const loopState = createLoopState([{ role: 'user', content: 'start' }]);

    ensureResponsesChainState(loopState, 'gpt-5.4@openai');
    applyResponseMetadataEvent(loopState, {
      type: 'response-metadata',
      responseId: 'resp-2',
      provider: 'openai-subscription',
      transport: 'websocket',
      continuationAccepted: true,
    });

    applyTransportFallbackEvent(loopState, {
      type: 'transport-fallback',
      reason: 'previous_response_not_found',
      from: 'responses-chained',
      to: 'stateless',
    });

    expect(loopState.responsesChain?.broken).toBe(true);
    expect(loopState.responsesChain?.brokenReason).toBe(
      'transport_fallback:previous_response_not_found'
    );
    expect(loopState.responsesChain?.fallbackCount).toBe(1);
  });

  it('marks the chain for a fresh websocket baseline after websocket timeout fallback', () => {
    const loopState = createLoopState([{ role: 'user', content: 'start' }]);

    ensureResponsesChainState(loopState, 'gpt-5.4@openai');
    applyResponseMetadataEvent(loopState, {
      type: 'response-metadata',
      responseId: 'resp-2',
      provider: 'openai-subscription',
      transport: 'websocket',
      continuationAccepted: true,
    });

    applyTransportFallbackEvent(loopState, {
      type: 'transport-fallback',
      reason: 'keepalive ping timeout',
      from: 'responses-chained',
      to: 'fresh-websocket-baseline',
    });

    expect(loopState.responsesChain?.broken).toBe(false);
    expect(loopState.responsesChain?.needsFreshWebsocketBaseline).toBe(true);
    expect(loopState.responsesChain?.lastResponseId).toBeUndefined();
    expect(loopState.responsesChain?.fallbackCount).toBe(1);
  });

  it('converts http fallback into a fresh websocket baseline retry', () => {
    const loopState = createLoopState([{ role: 'user', content: 'start' }]);

    ensureResponsesChainState(loopState, 'gpt-5.4@openai');
    applyResponseMetadataEvent(loopState, {
      type: 'response-metadata',
      responseId: 'resp-2',
      provider: 'openai-subscription',
      transport: 'websocket',
      continuationAccepted: true,
    });

    applyTransportFallbackEvent(loopState, {
      type: 'transport-fallback',
      reason: 'socket expired',
      from: 'websocket',
      to: 'http-sse',
    });

    expect(loopState.responsesChain?.broken).toBe(false);
    expect(loopState.responsesChain?.needsFreshWebsocketBaseline).toBe(true);
    expect(loopState.responsesChain?.lastTransport).toBe('http-sse');
    expect(loopState.responsesChain?.lastResponseId).toBeUndefined();
  });

  it('resets chain state after provider isolation changes', () => {
    const loopState = createLoopState([{ role: 'user', content: 'start' }]);
    ensureResponsesChainState(loopState, 'gpt-5.4@openai');

    resetResponsesChainState(loopState);

    expect(loopState.responsesChain).toBeUndefined();
  });
});
