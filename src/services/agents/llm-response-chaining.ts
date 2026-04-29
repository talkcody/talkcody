import { generateId } from '@/lib/utils';
import { parseModelIdentifier } from '@/providers/core/provider-utils';
import { useProviderStore } from '@/providers/stores/provider-store';
import type {
  ContinuationContext,
  Message as LlmMessage,
  StreamEvent,
  StreamTextRequest,
} from '@/services/llm/types';
import type { AgentLoopState, ResponsesChainState } from '@/types/agent';

export type RequestPlanningContext = {
  model: string;
  fallbackModels?: string[] | null;
  iteration: number;
  messages: LlmMessage[];
  traceContext?: StreamTextRequest['traceContext'];
  tools?: StreamTextRequest['tools'];
  temperature?: number | null;
  maxTokens?: number | null;
  topP?: number | null;
  topK?: number | null;
  providerOptions?: StreamTextRequest['providerOptions'];
};

export type RequestPlan = {
  request: StreamTextRequest;
  usesIncrementalInput: boolean;
};

export type ChainInvalidationReason =
  | 'history_rewritten'
  | 'transport_fallback'
  | 'provider_rejected'
  | 'missing_response_metadata'
  | 'manual_reset';

export type ResponseMetadataEvent = Extract<StreamEvent, { type: 'response-metadata' }>;
export type TransportFallbackEvent = Extract<StreamEvent, { type: 'transport-fallback' }>;

function isOpenAISubscriptionChainEligible(model: string): boolean {
  const { providerId } = parseModelIdentifier(model);
  if (providerId !== 'openai') {
    return false;
  }

  const { oauthConfig } = useProviderStore.getState();
  return !!oauthConfig?.openaiIsConnected;
}

function createResponsesChainState(): ResponsesChainState {
  return {
    enabled: true,
    provider: 'openai-subscription',
    transportPreference: 'auto',
    transportSessionId: generateId(16),
    baselineMessageCount: 0,
    fallbackCount: 0,
    broken: false,
    needsFreshWebsocketBaseline: false,
  };
}

function ensureTransportSessionId(chainState: ResponsesChainState): void {
  if (!chainState.transportSessionId) {
    chainState.transportSessionId = generateId(16);
  }
}

function buildContinuationContext(
  iteration: number,
  chainState: ResponsesChainState,
  deltaMessageCount: number
): ContinuationContext {
  return {
    iteration,
    baselineMessageCount: chainState.baselineMessageCount,
    deltaMessageCount,
    fallbackCount: chainState.fallbackCount,
  };
}

function buildRequest(
  context: RequestPlanningContext,
  chainState: ResponsesChainState | undefined,
  messages: LlmMessage[],
  overrides: Partial<
    Pick<StreamTextRequest, 'conversationMode' | 'inputMode' | 'previousResponseId'>
  >
): StreamTextRequest {
  const isStateless =
    (overrides.conversationMode ?? (chainState ? 'responses-chained' : 'stateless')) ===
    'stateless';

  return {
    model: context.model,
    fallbackModels: context.fallbackModels ?? null,
    messages,
    tools: context.tools,
    temperature: context.temperature,
    maxTokens: context.maxTokens,
    topP: context.topP,
    topK: context.topK,
    providerOptions: context.providerOptions,
    traceContext: context.traceContext,
    conversationMode:
      overrides.conversationMode ?? (chainState ? 'responses-chained' : 'stateless'),
    inputMode: overrides.inputMode ?? 'full-history',
    previousResponseId: overrides.previousResponseId ?? null,
    transportSessionId: isStateless ? null : (chainState?.transportSessionId ?? null),
    allowTransportFallback: isStateless ? null : chainState ? true : null,
    continuationContext:
      !isStateless && chainState
        ? buildContinuationContext(context.iteration, chainState, messages.length)
        : null,
  };
}

export function ensureResponsesChainState(
  loopState: AgentLoopState,
  model: string
): AgentLoopState['responsesChain'] {
  if (!isOpenAISubscriptionChainEligible(model)) {
    loopState.responsesChain = undefined;
    return undefined;
  }

  loopState.responsesChain ??= createResponsesChainState();
  ensureTransportSessionId(loopState.responsesChain);
  return loopState.responsesChain;
}

export function planStreamTextRequest(
  loopState: AgentLoopState,
  context: RequestPlanningContext
): RequestPlan {
  const chainState = ensureResponsesChainState(loopState, context.model);
  const shouldUseStatelessRequest = !chainState || !chainState.enabled || chainState.broken;

  if (shouldUseStatelessRequest) {
    return {
      usesIncrementalInput: false,
      request: buildRequest(context, undefined, context.messages, {
        conversationMode: 'stateless',
        inputMode: 'full-history',
        previousResponseId: null,
      }),
    };
  }

  if (chainState.needsFreshWebsocketBaseline) {
    return {
      usesIncrementalInput: false,
      request: buildRequest(context, chainState, context.messages, {
        conversationMode: 'responses-chained',
        inputMode: 'full-history',
        previousResponseId: null,
      }),
    };
  }

  if (context.iteration <= 1 || !chainState.lastResponseId) {
    return {
      usesIncrementalInput: false,
      request: buildRequest(context, chainState, context.messages, {
        conversationMode: 'responses-chained',
        inputMode: 'full-history',
        previousResponseId: null,
      }),
    };
  }

  const deltaMessages = context.messages.slice(chainState.baselineMessageCount);
  if (deltaMessages.length === 0) {
    return {
      usesIncrementalInput: false,
      request: buildRequest(context, chainState, context.messages, {
        conversationMode: 'responses-chained',
        inputMode: 'full-history',
        previousResponseId: null,
      }),
    };
  }

  return {
    usesIncrementalInput: true,
    request: buildRequest(context, chainState, deltaMessages, {
      inputMode: 'incremental',
      previousResponseId: chainState.lastResponseId,
    }),
  };
}

export function applyResponseMetadataEvent(
  loopState: AgentLoopState,
  event: ResponseMetadataEvent
): boolean {
  const chainState = loopState.responsesChain;
  if (!chainState || chainState.provider !== 'openai-subscription') {
    return false;
  }

  if (event.provider !== 'openai-subscription') {
    return false;
  }

  if (event.continuationAccepted === false) {
    const fallbackCount = chainState.fallbackCount + 1;
    invalidateResponsesChain(loopState, 'provider_rejected');
    if (loopState.responsesChain) {
      loopState.responsesChain.fallbackCount = fallbackCount;
    }
    return true;
  }

  if (event.transport === 'http-sse' && chainState.needsFreshWebsocketBaseline) {
    chainState.lastTransport = 'http-sse';
    chainState.lastContinuationAccepted = event.continuationAccepted;
    chainState.broken = false;
    chainState.brokenReason = undefined;
    ensureTransportSessionId(chainState);
    return true;
  }

  chainState.lastResponseId = event.responseId;
  chainState.lastTransport = event.transport;
  chainState.lastContinuationAccepted = event.continuationAccepted;
  chainState.broken = false;
  chainState.brokenReason = undefined;
  chainState.needsFreshWebsocketBaseline = false;

  if (event.transportSessionId) {
    chainState.transportSessionId = event.transportSessionId;
  } else {
    ensureTransportSessionId(chainState);
  }

  return true;
}

export function applyTransportFallbackEvent(
  loopState: AgentLoopState,
  event: TransportFallbackEvent
): void {
  const chainState = loopState.responsesChain;
  if (!chainState || chainState.provider !== 'openai-subscription') {
    return;
  }

  chainState.fallbackCount += 1;

  if (event.to === 'http-sse') {
    chainState.lastTransport = 'http-sse';
    chainState.lastResponseId = undefined;
    chainState.lastContinuationAccepted = false;
    chainState.needsFreshWebsocketBaseline = true;
    ensureTransportSessionId(chainState);
    return;
  }

  if (event.to === 'fresh-websocket-baseline') {
    chainState.needsFreshWebsocketBaseline = true;
    chainState.lastResponseId = undefined;
    chainState.lastContinuationAccepted = false;
    chainState.broken = false;
    chainState.brokenReason = undefined;
    ensureTransportSessionId(chainState);
    return;
  }

  invalidateResponsesChain(loopState, 'transport_fallback', event.reason);
}

export function commitResponsesChainBaseline(
  loopState: AgentLoopState,
  didReceiveResponseMetadata: boolean,
  baselineMessageCount: number
): void {
  const chainState = loopState.responsesChain;
  if (!chainState || chainState.provider !== 'openai-subscription') {
    return;
  }

  if (chainState.needsFreshWebsocketBaseline && didReceiveResponseMetadata) {
    chainState.broken = false;
    chainState.brokenReason = undefined;
    return;
  }

  if (!didReceiveResponseMetadata || !chainState.lastResponseId) {
    if (!chainState.broken) {
      invalidateResponsesChain(loopState, 'missing_response_metadata');
    }
    return;
  }

  chainState.broken = false;
  chainState.brokenReason = undefined;
  chainState.needsFreshWebsocketBaseline = false;
  chainState.baselineMessageCount = Math.max(0, baselineMessageCount);
}

export function invalidateResponsesChain(
  loopState: AgentLoopState,
  reason: ChainInvalidationReason,
  detail?: string
): void {
  const chainState = loopState.responsesChain;
  if (!chainState) {
    return;
  }

  chainState.broken = true;
  chainState.brokenReason = detail ? `${reason}:${detail}` : reason;
  chainState.lastResponseId = undefined;
  chainState.transportSessionId = undefined;
  chainState.lastContinuationAccepted = false;
  chainState.needsFreshWebsocketBaseline = false;
}

export function resetResponsesChainState(loopState: AgentLoopState): void {
  loopState.responsesChain = undefined;
}
