import { describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { llmClient } from './llm-client';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (_event, handler) => {
    handler({
      payload: { type: 'text-delta', text: 'Hello ' },
    });
    handler({
      payload: { type: 'text-delta', text: 'world' },
    });
    handler({
      payload: { type: 'done', finish_reason: 'stop' },
    });
    return () => {};
  }),
}));

describe('llmClient', () => {
  it('collects text from streamed events', async () => {
    (invoke as any).mockResolvedValue({ request_id: 'test-request-id' });

    const result = await llmClient.collectText({
      model: 'test',
      messages: [{ role: 'user', content: 'Hello' }],
      stream: true,
      requestId: 'test-request-id',
      traceContext: {
        traceId: 'trace-1',
        spanName: 'Step1-llm',
        parentSpanId: null,
      },
    });

    expect(result.text).toBe('Hello world');
    expect(result.finishReason).toBe('stop');
  });

  it('wraps OpenAI OAuth complete payload for Rust command', async () => {
    const params = {
      code: 'code-123',
      verifier: 'verifier-123',
      expectedState: 'state-123',
      redirectUri: 'http://localhost:1455/auth/callback',
    };

    (invoke as any).mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: 123,
    });

    await llmClient.completeOpenAIOAuth(params);

    expect(invoke).toHaveBeenCalledWith('llm_openai_oauth_complete', {
      payload: { request: params },
    });
  });

  it('wraps GitHub Copilot OAuth device code payload for Rust command', async () => {
    const params = {
      enterpriseUrl: 'https://github.acme.test',
    };

    (invoke as any).mockResolvedValue({
      deviceCode: 'device-123',
      userCode: 'user-123',
      verificationUri: 'https://github.com/login/device',
      expiresIn: 900,
      interval: 5,
    });

    await llmClient.startGitHubCopilotOAuthDeviceCode(params);

    expect(invoke).toHaveBeenCalledWith('llm_github_copilot_oauth_start_device_code', {
      request: {
        enterpriseUrl: 'https://github.acme.test',
      },
    });
  });

  it('wraps GitHub Copilot OAuth polling payload for Rust command', async () => {
    const params = {
      deviceCode: 'device-123',
      enterpriseUrl: 'https://github.acme.test',
    };

    (invoke as any).mockResolvedValue({
      type: 'pending',
    });

    await llmClient.pollGitHubCopilotOAuthDeviceCode(params);

    expect(invoke).toHaveBeenCalledWith('llm_github_copilot_oauth_poll_device_code', {
      request: {
        deviceCode: 'device-123',
        enterpriseUrl: 'https://github.acme.test',
      },
    });
  });

  it('calls llm_enhance_prompt with correct payload', async () => {
    const mockResult = {
      enhancedPrompt: 'Enhanced version of the prompt',
      extractedKeywords: ['React', 'TypeScript'],
      generatedQueries: ['React component patterns'],
      contextSnippetCount: 3,
    };
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult);

    const request = {
      originalPrompt: 'Help me refactor this component',
      projectPath: '/path/to/project',
      conversationHistory: 'User: previous message\nAssistant: response',
      enableContextExtraction: true,
      model: 'gpt-4@openai',
    };

    const result = await llmClient.enhancePrompt(request);

    expect(invoke).toHaveBeenCalledWith('llm_enhance_prompt', { request });
    expect(result).toEqual(mockResult);
  });
});
