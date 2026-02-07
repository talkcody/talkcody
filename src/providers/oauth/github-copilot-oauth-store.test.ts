import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  isCopilotTokenExpired,
  pollForAccessToken,
  startDeviceCodeFlow,
} from './github-copilot-oauth-service';
import { useGitHubCopilotOAuthStore } from './github-copilot-oauth-store';
import { llmClient } from '@/services/llm/llm-client';

vi.mock('./github-copilot-oauth-service', () => ({
  startDeviceCodeFlow: vi.fn(),
  pollForAccessToken: vi.fn(),
  isCopilotTokenExpired: vi.fn(),
}));

vi.mock('@/services/llm/llm-client', () => ({
  llmClient: {
    getOAuthStatus: vi.fn(),
    getGitHubCopilotOAuthTokens: vi.fn(),
    refreshGitHubCopilotOAuthToken: vi.fn(),
    disconnectGitHubCopilotOAuth: vi.fn(),
  },
}));

const mockStartDeviceCodeFlow = startDeviceCodeFlow as Mock;
const mockPollForAccessToken = pollForAccessToken as Mock;
const mockIsCopilotTokenExpired = isCopilotTokenExpired as Mock;

function resetStore() {
  useGitHubCopilotOAuthStore.setState({
    isConnected: false,
    isLoading: false,
    isPolling: false,
    error: null,
    expiresAt: null,
    enterpriseUrl: null,
    deviceCode: null,
    userCode: null,
    verificationUri: null,
    expiresAtMs: null,
    intervalMs: null,
    isInitialized: true,
  });
}

describe('GitHubCopilotOAuthStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('polls until success and stores token metadata', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-06T00:00:00Z'));

    mockStartDeviceCodeFlow.mockResolvedValue({
      deviceCode: 'device-123',
      userCode: 'user-123',
      verificationUri: 'https://github.com/login/device',
      expiresIn: 600,
      interval: 1,
    });

    mockPollForAccessToken
      .mockResolvedValueOnce({ type: 'pending' })
      .mockResolvedValueOnce({
        type: 'success',
        tokens: {
          accessToken: 'access-token',
          copilotToken: 'copilot-token',
          expiresAt: 123456,
          enterpriseUrl: null,
        },
      });

    await useGitHubCopilotOAuthStore.getState().startOAuth();

    const pollPromise = useGitHubCopilotOAuthStore.getState().pollForToken();
    await vi.advanceTimersByTimeAsync(1000);
    await pollPromise;

    expect(mockPollForAccessToken).toHaveBeenCalledTimes(2);
    expect(mockPollForAccessToken).toHaveBeenNthCalledWith(1, 'device-123', undefined);
    expect(mockPollForAccessToken).toHaveBeenNthCalledWith(2, 'device-123', undefined);

    const state = useGitHubCopilotOAuthStore.getState();
    expect(state.isConnected).toBe(true);
    expect(state.expiresAt).toBe(123456);
    expect(state.deviceCode).toBeNull();
    expect(state.intervalMs).toBeNull();
  });

  it('stops polling when device code expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-06T00:00:00Z'));

    mockStartDeviceCodeFlow.mockResolvedValue({
      deviceCode: 'device-123',
      userCode: 'user-123',
      verificationUri: 'https://github.com/login/device',
      expiresIn: 0,
      interval: 1,
    });

    mockPollForAccessToken.mockResolvedValue({ type: 'pending' });

    await useGitHubCopilotOAuthStore.getState().startOAuth();

    await expect(useGitHubCopilotOAuthStore.getState().pollForToken()).rejects.toThrow(
      'Device code expired. Please start OAuth flow again.'
    );

    expect(mockPollForAccessToken).not.toHaveBeenCalled();
    expect(useGitHubCopilotOAuthStore.getState().isPolling).toBe(false);
  });

  it('returns cached token when not expired', async () => {
    useGitHubCopilotOAuthStore.setState({
      isConnected: true,
      expiresAt: Date.now() + 60_000,
    });

    mockIsCopilotTokenExpired.mockReturnValue(false);
    (llmClient.getGitHubCopilotOAuthTokens as Mock).mockResolvedValue({
      copilotToken: 'copilot-token',
    });

    const token = await useGitHubCopilotOAuthStore.getState().getValidCopilotToken();

    expect(token).toBe('copilot-token');
  });
});
