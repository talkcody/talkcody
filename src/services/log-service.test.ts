import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LogService } from './log-service';

// Mock modules at the top level
vi.mock('@tauri-apps/plugin-os', () => ({
  platform: vi.fn(() => 'macos'),
}));

vi.mock('@tauri-apps/api/path', () => ({
  homeDir: vi.fn(() => Promise.resolve('/Users/test')),
  appDataDir: vi.fn(() => Promise.resolve('/Users/test/Library/Application Support')),
  join: vi.fn((...paths: string[]) => paths.join('/')),
  sep: vi.fn(() => '/'),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn(() => Promise.resolve(false)),
  readTextFile: vi.fn(() => Promise.resolve('')),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('LogService', () => {
  let logService: LogService;

  beforeEach(async () => {
    vi.clearAllMocks();
    logService = new LogService();
  });

  describe('getLogDirectoryPath', () => {
    it('should return correct path for macOS', async () => {
      const os = await import('@tauri-apps/plugin-os');
      vi.mocked(os.platform).mockReturnValue('macos');

      const result = await logService.getLogDirectoryPath();
      expect(result).toBe('/Users/test/Library/Logs/com.talkcody');
    });

    it('should return correct path for Windows', async () => {
      const os = await import('@tauri-apps/plugin-os');
      const path = await import('@tauri-apps/api/path');

      vi.mocked(os.platform).mockReturnValue('windows');
      vi.mocked(path.appDataDir).mockResolvedValue('C:\\Users\\test\\AppData\\Local');
      vi.mocked(path.join).mockImplementation((...paths: string[]) => paths.join('\\'));

      const result = await logService.getLogDirectoryPath();
      expect(result).toBe('C:\\Users\\test\\AppData\\Local\\logs');
    });

    it('should return correct path for Linux', async () => {
      const os = await import('@tauri-apps/plugin-os');
      const path = await import('@tauri-apps/api/path');

      vi.mocked(os.platform).mockReturnValue('linux');
      vi.mocked(path.homeDir).mockResolvedValue('/home/test');
      vi.mocked(path.join).mockImplementation((...paths: string[]) => paths.join('/'));

      const result = await logService.getLogDirectoryPath();
      expect(result).toBe('/home/test/.local/share/com.talkcody/logs');
    });
  });

  describe('getLogFilePath', () => {
    it('should return correct file path', async () => {
      const os = await import('@tauri-apps/plugin-os');
      const path = await import('@tauri-apps/api/path');

      vi.mocked(os.platform).mockReturnValue('macos');
      vi.mocked(path.join).mockImplementation((...paths: string[]) => paths.join('/'));

      const result = await logService.getLogFilePath();
      expect(result).toContain('TalkCody.log');
    });
  });

  describe('getLatestLogs', () => {
    it('should return empty array when file does not exist', async () => {
      const fs = await import('@tauri-apps/plugin-fs');
      vi.mocked(fs.exists).mockResolvedValue(false);

      const result = await logService.getLatestLogs(10);
      expect(result).toEqual([]);
    });

    it('should return last N lines when file exists', async () => {
      const fs = await import('@tauri-apps/plugin-fs');
      const mockContent = 'line 1\nline 2\nline 3\nline 4\nline 5';

      vi.mocked(fs.exists).mockResolvedValue(true);
      vi.mocked(fs.readTextFile).mockResolvedValue(mockContent);

      const result = await logService.getLatestLogs(3);
      expect(result).toEqual(['line 3', 'line 4', 'line 5']);
    });
  });

  describe('getDisplayLogFilePath', () => {
    it('should format path with ~ for home directory', async () => {
      const os = await import('@tauri-apps/plugin-os');
      const path = await import('@tauri-apps/api/path');

      vi.mocked(os.platform).mockReturnValue('macos');
      vi.mocked(path.homeDir).mockResolvedValue('/Users/test');
      vi.mocked(path.join).mockImplementation((...paths: string[]) => paths.join('/'));

      const result = await logService.getDisplayLogFilePath();
      expect(result).toContain('~/Library/Logs/com.talkcody/TalkCody.log');
    });
  });
});
