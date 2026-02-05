import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BaseDirectory, exists, readTextFile, remove, writeTextFile } from '@tauri-apps/plugin-fs';
import { secureStorage } from '@/services/secure-storage';

vi.mock('@tauri-apps/plugin-fs', () => ({
  BaseDirectory: { AppData: 'AppData' },
  exists: vi.fn(),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  remove: vi.fn(),
}));

const mockExists = vi.mocked(exists);
const mockReadTextFile = vi.mocked(readTextFile);
const mockWriteTextFile = vi.mocked(writeTextFile);
const mockRemove = vi.mocked(remove);

describe('SecureStorageService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads auth token from talkcody-auth.dat when present', async () => {
    mockExists.mockImplementation(async (fileName: string) => fileName === 'talkcody-auth.dat');
    mockReadTextFile.mockResolvedValueOnce(JSON.stringify({ auth_token: 'token-123' }));

    const token = await secureStorage.getAuthToken();

    expect(token).toBe('token-123');
    expect(mockReadTextFile).toHaveBeenCalledWith('talkcody-auth.dat', {
      baseDir: BaseDirectory.AppData,
    });
    expect(mockReadTextFile).toHaveBeenCalledTimes(1);
  });

  it('migrates legacy talkcody-auth.json to talkcody-auth.dat', async () => {
    mockExists.mockImplementation(async (fileName: string) => fileName === 'talkcody-auth.json');
    mockReadTextFile.mockResolvedValueOnce(JSON.stringify({ auth_token: 'legacy-token' }));

    const token = await secureStorage.getAuthToken();

    expect(token).toBe('legacy-token');
    expect(mockWriteTextFile).toHaveBeenCalledWith(
      'talkcody-auth.dat',
      JSON.stringify({ auth_token: 'legacy-token' }, null, 2),
      { baseDir: BaseDirectory.AppData }
    );
    expect(mockRemove).toHaveBeenCalledWith('talkcody-auth.json', {
      baseDir: BaseDirectory.AppData,
    });
  });

  it('removes legacy auth file when storing a new token', async () => {
    mockExists.mockResolvedValue(false);
    mockExists
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await secureStorage.setAuthToken('fresh-token');

    expect(mockWriteTextFile).toHaveBeenCalledWith(
      'talkcody-auth.dat',
      JSON.stringify({ auth_token: 'fresh-token' }, null, 2),
      { baseDir: BaseDirectory.AppData }
    );
    expect(mockRemove).toHaveBeenCalledWith('talkcody-auth.json', {
      baseDir: BaseDirectory.AppData,
    });
  });

  it('removes both current and legacy auth files on sign out', async () => {
    mockExists.mockResolvedValue(true);

    await secureStorage.removeAuthToken();

    expect(mockRemove).toHaveBeenCalledWith('talkcody-auth.dat', {
      baseDir: BaseDirectory.AppData,
    });
    expect(mockRemove).toHaveBeenCalledWith('talkcody-auth.json', {
      baseDir: BaseDirectory.AppData,
    });
  });
});
