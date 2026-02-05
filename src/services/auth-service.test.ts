import { describe, expect, it, vi } from 'vitest';
import { authService } from '@/services/auth-service';
import { llmClient } from '@/services/llm/llm-client';
import { secureStorage } from '@/services/secure-storage';
import { simpleFetch } from '@/lib/tauri-fetch';

vi.mock('@/services/llm/llm-client', () => ({
  llmClient: {
    setSetting: vi.fn(),
  },
}));

vi.mock('@/services/secure-storage', () => ({
  secureStorage: {
    setAuthToken: vi.fn(),
    getAuthToken: vi.fn(),
    removeAuthToken: vi.fn(),
  },
}));
vi.mock('@/lib/config', () => ({
  getApiUrl: (path: string) => `https://api.test${path}`,
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/lib/tauri-fetch', () => ({
  simpleFetch: vi.fn(),
}));

const mockSetSetting = llmClient.setSetting as unknown as ReturnType<typeof vi.fn>;
const mockSetAuthToken = secureStorage.setAuthToken as unknown as ReturnType<typeof vi.fn>;
const mockGetAuthToken = secureStorage.getAuthToken as unknown as ReturnType<typeof vi.fn>;
const mockRemoveAuthToken = secureStorage.removeAuthToken as unknown as ReturnType<typeof vi.fn>;
const mockSimpleFetch = simpleFetch as unknown as ReturnType<typeof vi.fn>;

describe('AuthService token sync', () => {
  it('syncs token to backend when storing auth token', async () => {
    mockSetAuthToken.mockResolvedValueOnce(undefined);
    mockSetSetting.mockResolvedValueOnce(undefined);

    await authService.storeAuthToken('token-123');

    expect(mockSetAuthToken).toHaveBeenCalledWith('token-123');
    expect(mockSetSetting).toHaveBeenCalledWith('talkcody_auth_token', 'token-123');
  });

  it('clears backend token on sign out', async () => {
    mockRemoveAuthToken.mockResolvedValueOnce(undefined);
    mockSetSetting.mockResolvedValueOnce(undefined);

    await authService.signOut();

    expect(mockRemoveAuthToken).toHaveBeenCalled();
    expect(mockSetSetting).toHaveBeenCalledWith('talkcody_auth_token', '');
  });

  it('syncs backend token when checking authentication', async () => {
    mockGetAuthToken.mockResolvedValueOnce('token-xyz');
    mockSetSetting.mockResolvedValueOnce(undefined);

    const isAuthenticated = await authService.isAuthenticated();

    expect(isAuthenticated).toBe(true);
    expect(mockSetSetting).toHaveBeenCalledWith('talkcody_auth_token', 'token-xyz');
  });

  it('clears backend token when profile fetch returns 401', async () => {
    mockGetAuthToken.mockResolvedValueOnce('token-401');
    mockSimpleFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    });
    mockRemoveAuthToken.mockResolvedValueOnce(undefined);
    mockSetSetting.mockResolvedValueOnce(undefined);

    const result = await authService.fetchUserProfile();

    expect(result).toBeNull();
    expect(mockRemoveAuthToken).toHaveBeenCalled();
    expect(mockSetSetting).toHaveBeenCalledWith('talkcody_auth_token', '');
  });
});
