import { invoke } from '@tauri-apps/api/core';
import { logger } from '@/lib/logger';
import { generateId } from '@/lib/utils';
import {
  createEventQueue,
  isTerminalEvent,
  LlmEventStream,
  logStreamEvent,
  normalizeStreamEvent,
} from './llm-event-stream';
import type {
  AvailableModel,
  CalculateCostRequest,
  CalculateCostResult,
  CompletionContext,
  CompletionResult,
  ContextCompactionRequest,
  ContextCompactionResult,
  GitMessageContext,
  GitMessageResult,
  Message,
  PromptEnhancementRequest,
  PromptEnhancementResult,
  ProviderConfig,
  StreamEvent,
  StreamResponse,
  StreamTextRequest,
  TitleGenerationRequest,
  TitleGenerationResult,
  TranscriptionRequest,
  TranscriptionResponse,
} from './types';

export type StreamTextResult = {
  requestId: string;
  events: AsyncGenerator<StreamEvent, void, unknown>;
};

export class LlmClient {
  async streamText(
    request: StreamTextRequest,
    abortSignal?: AbortSignal
  ): Promise<StreamTextResult> {
    const clientStartMs = Date.now();

    // Generate request ID first and set up listener BEFORE calling Rust
    // This prevents race condition where events are emitted before listener is ready
    const requestId = request.requestId || generateId(16);
    const eventName = `llm-stream-${requestId}`;
    const stream = new LlmEventStream();
    const queue = createEventQueue<StreamEvent>();

    // Named abort handler for proper cleanup
    let onAbort: (() => void) | null = null;

    const stop = () => {
      logger.info(`[LLM Client ${requestId}] Stopping stream`);
      if (abortSignal && onAbort) {
        abortSignal.removeEventListener('abort', onAbort);
      }
      stream.close();
      queue.finish();
    };

    if (abortSignal) {
      if (abortSignal.aborted) {
        logger.info(`[LLM Client ${requestId}] Already aborted, stopping`);
        stop();
        throw new Error('LLM request aborted');
      }
      onAbort = () => {
        logger.info(`[LLM Client ${requestId}] Abort signal received, stopping`);
        stop();
      };
      abortSignal.addEventListener('abort', onAbort, { once: true });
    }

    // Set up event listener BEFORE invoking Rust command
    await stream.listen(eventName, (event) => {
      logger.debug(`[LLM Client ${requestId}] Received event: ${event.type}`);
      const normalized = normalizeStreamEvent(event);
      logStreamEvent(normalized, requestId);
      queue.push(normalized);
      if (isTerminalEvent(normalized)) {
        logger.info(`[LLM Client ${requestId}] Terminal event received: ${event.type}`);
        stop();
      }
    });
    logger.info(
      `[LLM Client ${requestId}] Event listener setup complete, now invoking Rust command`
    );

    // Now invoke Rust command with the requestId and traceContext
    // traceContext must be inside the request object for Rust to receive it
    const traceContext = request.traceContext
      ? {
          ...request.traceContext,
          metadata: {
            ...(request.traceContext.metadata ?? {}),
            client_start_ms: clientStartMs.toString(),
          },
        }
      : undefined;
    const requestPayload = {
      ...request,
      requestId,
      traceContext,
    };

    let response: StreamResponse;
    try {
      response = await invoke<StreamResponse>('llm_stream_text', {
        request: requestPayload,
      });
    } catch (error) {
      // Ensure cleanup on invoke failure to prevent listener leaks
      stop();
      throw error;
    }

    // Validate that the returned request_id matches what we sent
    if (response.request_id !== requestId) {
      stop();
      throw new Error(
        `LLM stream requestId mismatch: expected ${requestId}, got ${response.request_id}`
      );
    }

    return {
      requestId,
      events: queue.iterate(),
    };
  }

  async collectText(
    request: StreamTextRequest,
    abortSignal?: AbortSignal
  ): Promise<{ text: string; finishReason?: string | null }> {
    const { events } = await this.streamText(request, abortSignal);
    let text = '';
    let finishReason: string | null = null;

    for await (const event of events) {
      if (event.type === 'text-delta') {
        text += event.text;
      }
      if (event.type === 'done') {
        finishReason = event.finish_reason ?? null;
      }
      if (event.type === 'error') {
        logger.error(
          `[LLM Client] Error event received: ${(event as { message: string }).message}`
        );
      }
    }

    return { text, finishReason };
  }

  async checkModelUpdates(): Promise<boolean> {
    return invoke<boolean>('llm_check_model_updates');
  }

  async listAvailableModels(): Promise<AvailableModel[]> {
    return invoke<AvailableModel[]>('llm_list_available_models');
  }

  async getProviderConfigs(): Promise<ProviderConfig[]> {
    return invoke<ProviderConfig[]>('llm_get_provider_configs');
  }

  async isModelAvailable(modelIdentifier: string): Promise<boolean> {
    return invoke<boolean>('llm_is_model_available', { modelIdentifier });
  }

  async transcribeAudio(request: TranscriptionRequest): Promise<TranscriptionResponse> {
    return invoke<TranscriptionResponse>('llm_transcribe_audio', { request });
  }

  // AI Services Commands

  async calculateCost(request: CalculateCostRequest): Promise<CalculateCostResult> {
    return invoke<CalculateCostResult>('llm_calculate_cost', { request });
  }

  async getCompletion(context: CompletionContext): Promise<CompletionResult> {
    return invoke<CompletionResult>('llm_get_completion', { context });
  }

  async generateCommitMessage(context: GitMessageContext): Promise<GitMessageResult> {
    return invoke<GitMessageResult>('llm_generate_commit_message', { context });
  }

  async generateTitle(request: TitleGenerationRequest): Promise<TitleGenerationResult> {
    return invoke<TitleGenerationResult>('llm_generate_title', { request });
  }

  async compactContext(request: ContextCompactionRequest): Promise<ContextCompactionResult> {
    return invoke<ContextCompactionResult>('llm_compact_context', { request });
  }

  async enhancePrompt(request: PromptEnhancementRequest): Promise<PromptEnhancementResult> {
    return invoke<PromptEnhancementResult>('llm_enhance_prompt', { request });
  }

  async registerCustomProvider(config: {
    id: string;
    name: string;
    type: 'openai-compatible' | 'anthropic';
    baseUrl: string;
    apiKey: string;
    enabled: boolean;
    description?: string;
  }): Promise<void> {
    await invoke('llm_register_custom_provider', { config });
  }

  async setSetting(key: string, value: string): Promise<void> {
    await invoke('llm_set_setting', { key, value });
  }

  async startClaudeOAuth(): Promise<{ url: string; verifier: string; state: string }> {
    return invoke('llm_claude_oauth_start');
  }

  async completeClaudeOAuth(params: { code: string; verifier: string; state: string }): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
  }> {
    return invoke('llm_claude_oauth_complete', { request: params });
  }

  async refreshClaudeOAuth(params: { refreshToken: string }): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
  }> {
    return invoke('llm_claude_oauth_refresh', { request: params });
  }

  async startOpenAIOAuth(params?: { redirectUri?: string }): Promise<{
    url: string;
    verifier: string;
    state: string;
  }> {
    return invoke('llm_openai_oauth_start', { request: params ?? {} });
  }

  async completeOpenAIOAuth(params: {
    code: string;
    verifier: string;
    expectedState: string;
    redirectUri?: string;
  }): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    accountId?: string;
  }> {
    if (!params.expectedState) {
      throw new Error('Missing expectedState for OpenAI OAuth');
    }
    return invoke('llm_openai_oauth_complete', { payload: { request: params } });
  }

  async refreshOpenAIOAuth(params: { refreshToken: string }): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    accountId?: string;
  }> {
    return invoke('llm_openai_oauth_refresh', { request: params });
  }

  async refreshOpenAIOAuthFromStore(): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    accountId?: string;
  }> {
    return invoke('llm_openai_oauth_refresh_from_store');
  }

  async disconnectClaudeOAuth(): Promise<void> {
    await invoke('llm_claude_oauth_disconnect');
  }

  async disconnectOpenAIOAuth(): Promise<void> {
    await invoke('llm_openai_oauth_disconnect');
  }

  async startGitHubCopilotOAuthDeviceCode(params: { enterpriseUrl?: string }): Promise<{
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    expiresIn: number;
    interval: number;
  }> {
    return invoke('llm_github_copilot_oauth_start_device_code', { request: params ?? {} });
  }

  async pollGitHubCopilotOAuthDeviceCode(params: {
    deviceCode: string;
    enterpriseUrl?: string;
  }): Promise<{
    type: 'success' | 'failed' | 'pending';
    tokens?: {
      accessToken: string;
      copilotToken: string;
      expiresAt: number;
      enterpriseUrl?: string;
    };
    error?: string;
  }> {
    return invoke('llm_github_copilot_oauth_poll_device_code', { request: params });
  }

  async refreshGitHubCopilotOAuthToken(): Promise<{
    accessToken: string;
    copilotToken: string;
    expiresAt: number;
    enterpriseUrl?: string;
  }> {
    return invoke('llm_github_copilot_oauth_refresh');
  }

  async disconnectGitHubCopilotOAuth(): Promise<void> {
    await invoke('llm_github_copilot_oauth_disconnect');
  }

  async getGitHubCopilotOAuthTokens(): Promise<{
    accessToken?: string | null;
    copilotToken?: string | null;
    expiresAt?: number | null;
    enterpriseUrl?: string | null;
  }> {
    return invoke('llm_github_copilot_oauth_tokens');
  }

  async getOAuthStatus(): Promise<{
    anthropic?: {
      expiresAt?: number | null;
      isConnected?: boolean | null;
    } | null;
    openai?: {
      expiresAt?: number | null;
      accountId?: string | null;
      isConnected?: boolean | null;
      hasRefreshToken?: boolean | null;
    } | null;
    githubCopilot?: {
      isConnected?: boolean | null;
    } | null;
  } | null> {
    return invoke('llm_oauth_status');
  }

  async listMcpTools(): Promise<
    Array<{
      id: string;
      name: string;
      description?: string | null;
      serverId: string;
      serverName?: string | null;
      inputSchema?: unknown;
    }>
  > {
    logger.warn('[LLM Client] listMcpTools is deprecated and returns empty results');
    return [];
  }

  async getMcpTool(_prefixedName: string): Promise<{
    name: string;
    description?: string | null;
    inputSchema?: unknown;
    serverId: string;
    serverName?: string | null;
    prefixedName: string;
  }> {
    throw new Error('getMcpTool is no longer supported from llm-client');
  }

  async getMcpServerStatuses(): Promise<
    Record<string, { isConnected: boolean; error?: string | null; toolCount: number }>
  > {
    logger.warn('[LLM Client] getMcpServerStatuses is deprecated and returns empty status');
    return {};
  }

  async refreshMcpConnections(): Promise<void> {
    logger.warn('[LLM Client] refreshMcpConnections is deprecated and ignored');
  }

  async refreshMcpServer(_serverId: string): Promise<void> {
    logger.warn('[LLM Client] refreshMcpServer is deprecated and ignored');
  }

  async testMcpConnection(_serverId: string): Promise<{
    success: boolean;
    error?: string | null;
    toolCount?: number | null;
  }> {
    logger.warn('[LLM Client] testMcpConnection is deprecated and returns failure');
    return { success: false, error: 'deprecated', toolCount: null };
  }

  async mcpHealthCheck(): Promise<boolean> {
    logger.warn('[LLM Client] mcpHealthCheck is deprecated and returns false');
    return false;
  }
}

export const llmClient = new LlmClient();

export function buildPromptRequest(
  model: string,
  prompt: string,
  providerOptions?: Record<string, unknown>,
  temperature?: number,
  maxTokens?: number,
  topP?: number,
  topK?: number
): StreamTextRequest {
  const message: Message = {
    role: 'user',
    content: prompt,
  };

  return {
    model,
    messages: [message],
    stream: true,
    providerOptions: providerOptions ?? undefined,
    temperature,
    maxTokens,
    topP,
    topK,
  };
}

export function buildMessagesRequest(
  model: string,
  messages: Message[],
  providerOptions?: Record<string, unknown>,
  temperature?: number,
  maxTokens?: number,
  topP?: number,
  topK?: number
): StreamTextRequest {
  return {
    model,
    messages,
    stream: true,
    providerOptions: providerOptions ?? undefined,
    temperature,
    maxTokens,
    topP,
    topK,
  };
}
