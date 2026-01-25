// src/test/mocks/tauri-path.ts
// Centralized mock for @tauri-apps/api/path
// Used by 11+ test files

import { vi } from 'vitest';

const DEFAULT_APP_DATA_DIR = '/test/app-data';
const _DEFAULT_ROOT = '/test/root';
const _DEFAULT_HOME_DIR = '/test/home';

export const createMockTauriPath = (
  overrides: {
    normalize?: (path: string) => string | Promise<string>;
    appDataDir?: string;
    homeDir?: string;
    join?: (...paths: string[]) => string | Promise<string>;
    dirname?: (path: string) => string | Promise<string>;
    basename?: (path: string) => string | Promise<string>;
    isAbsolute?: (path: string) => boolean | Promise<boolean>;
  } = {}
) => ({
  normalize: vi.fn().mockImplementation(overrides.normalize ?? ((path: string) => path)),
  appDataDir: vi.fn().mockResolvedValue(overrides.appDataDir ?? DEFAULT_APP_DATA_DIR),
  homeDir: vi.fn().mockResolvedValue(overrides.homeDir ?? _DEFAULT_HOME_DIR),
  join: vi.fn().mockImplementation(
    overrides.join ??
      ((...paths: string[]) => {
        const filtered = paths.filter((p) => p && p !== '.');
        return filtered.join('/');
      })
  ),
  dirname: vi.fn().mockImplementation(
    overrides.dirname ??
      ((path: string) => {
        const parts = path.split('/');
        parts.pop();
        return parts.join('/') || '/';
      })
  ),
  basename: vi.fn().mockImplementation(
    overrides.basename ??
      ((path: string) => {
        const normalized = path.replace(/\\/g, '/');
        const parts = normalized.split('/');
        return parts.pop() || '';
      })
  ),
  isAbsolute: vi
    .fn()
    .mockImplementation(overrides.isAbsolute ?? ((path: string) => path.startsWith('/'))),
});

// Default instance
export const mockTauriPath = createMockTauriPath();

/**
 * Mock module for vi.mock('@tauri-apps/api/path', ...)
 * Usage:
 * ```typescript
 * vi.mock('@tauri-apps/api/path', () => mockTauriPath);
 * ```
 */
export default mockTauriPath;
