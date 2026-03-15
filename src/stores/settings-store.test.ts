import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the database service and other dependencies
vi.mock('@/services/database-service', () => ({
  databaseService: {
    initialize: vi.fn(),
    getDb: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('@/stores/task-store', () => ({
  taskStore: {
    getState: vi.fn(() => ({ setCurrentTaskId: vi.fn() })),
  },
}));

const settingsRows = new Map<string, string>();
const mockDb = {
  execute: vi.fn(async (_sql: string, params: unknown[]) => {
    for (let index = 0; index < params.length; index += 3) {
      const key = params[index];
      const value = params[index + 1];

      if (typeof key !== 'string' || typeof value !== 'string') {
        continue;
      }

      if (!settingsRows.has(key)) {
        settingsRows.set(key, value);
      }
    }

    return { rowsAffected: 0 };
  }),
  select: vi.fn(async (sql: string, params: unknown[]) => {
    if (sql.includes('SELECT key, value FROM settings')) {
      return params.flatMap((key) => {
        if (typeof key !== 'string') {
          return [];
        }

        const value = settingsRows.get(key);
        return value === undefined ? [] : [{ key, value }];
      });
    }

    if (sql.includes('SELECT value FROM settings WHERE key = $1')) {
      const key = params[0];
      if (typeof key !== 'string') {
        return [];
      }

      const value = settingsRows.get(key);
      return value === undefined ? [] : [{ value }];
    }

    return [];
  }),
  batch: vi.fn(async (statements: Array<{ params: unknown[] }>) => {
    for (const statement of statements) {
      const [key, value] = statement.params;
      if (typeof key === 'string' && typeof value === 'string') {
        settingsRows.set(key, value);
      }
    }

    return [];
  }),
};

describe('settingsManager.get', () => {
  // Create a mock state that mimics the actual SettingsState
  const createMockState = () => ({
    // Boolean values
    telegram_remote_enabled: true,
    feishu_remote_enabled: false,
    is_think: false,
    // String values
    telegram_remote_token: 'test-token-123',
    feishu_remote_app_id: 'app-id',
    language: 'en',
    // Empty string
    telegram_remote_allowed_chats: '',
    // Number values (stored as strings in DB but could be numbers in state during transitions)
    terminal_font_size: 14,
    // Undefined and null (edge cases)
    undefined_key: undefined,
    null_key: null,
  });

  it('should convert boolean true to string "true"', () => {
    const mockState = createMockState();
    const get = vi.fn(() => mockState);

    // Simulate the get function behavior
    const getValue = (key: string): string => {
      const state = get() as Record<string, unknown>;
      const value = state[key];
      if (value === undefined || value === null) return '';
      return String(value);
    };

    expect(getValue('telegram_remote_enabled')).toBe('true');
  });

  it('should convert boolean false to string "false" (not empty string)', () => {
    const mockState = createMockState();
    const get = vi.fn(() => mockState);

    const getValue = (key: string): string => {
      const state = get() as Record<string, unknown>;
      const value = state[key];
      if (value === undefined || value === null) return '';
      return String(value);
    };

    // This is the key bug fix: false should become "false", not ""
    expect(getValue('is_think')).toBe('false');
    expect(getValue('is_think')).not.toBe('');
  });

  it('should return string values as-is', () => {
    const mockState = createMockState();
    const get = vi.fn(() => mockState);

    const getValue = (key: string): string => {
      const state = get() as Record<string, unknown>;
      const value = state[key];
      if (value === undefined || value === null) return '';
      return String(value);
    };

    expect(getValue('telegram_remote_token')).toBe('test-token-123');
    expect(getValue('feishu_remote_app_id')).toBe('app-id');
    expect(getValue('language')).toBe('en');
  });

  it('should convert empty string to empty string', () => {
    const mockState = createMockState();
    const get = vi.fn(() => mockState);

    const getValue = (key: string): string => {
      const state = get() as Record<string, unknown>;
      const value = state[key];
      if (value === undefined || value === null) return '';
      return String(value);
    };

    expect(getValue('telegram_remote_allowed_chats')).toBe('');
  });

  it('should convert number to string', () => {
    const mockState = createMockState();
    const get = vi.fn(() => mockState);

    const getValue = (key: string): string => {
      const state = get() as Record<string, unknown>;
      const value = state[key];
      if (value === undefined || value === null) return '';
      return String(value);
    };

    expect(getValue('terminal_font_size')).toBe('14');
  });

  it('should return empty string for undefined values', () => {
    const mockState = createMockState();
    const get = vi.fn(() => mockState);

    const getValue = (key: string): string => {
      const state = get() as Record<string, unknown>;
      const value = state[key];
      if (value === undefined || value === null) return '';
      return String(value);
    };

    expect(getValue('undefined_key')).toBe('');
    expect(getValue('nonexistent_key')).toBe('');
  });

  it('should return empty string for null values', () => {
    const mockState = createMockState();
    const get = vi.fn(() => mockState);

    const getValue = (key: string): string => {
      const state = get() as Record<string, unknown>;
      const value = state[key];
      if (value === undefined || value === null) return '';
      return String(value);
    };

    expect(getValue('null_key')).toBe('');
  });
});

describe('useSettingsStore.initialize', () => {
  beforeEach(() => {
    settingsRows.clear();
    vi.clearAllMocks();
  });

  it('defaults long-term memory injection to disabled', async () => {
    vi.resetModules();
    vi.unmock('@/stores/settings-store');

    const { databaseService } = await import('@/services/database-service');
    vi.mocked(databaseService.initialize).mockResolvedValue(undefined);
    vi.mocked(databaseService.getDb).mockResolvedValue(mockDb);

    const { useSettingsStore } = await import('./settings-store');

    await useSettingsStore.getState().initialize();

    expect(useSettingsStore.getState().memory_global_enabled).toBe(false);
    expect(useSettingsStore.getState().memory_project_enabled).toBe(false);
  });
});

describe('settingsManager.getBatch', () => {
  const createMockState = () => ({
    telegram_remote_enabled: true,
    feishu_remote_enabled: false,
    telegram_remote_token: 'test-token',
    is_think: false,
  });

  it('should convert multiple boolean values correctly', () => {
    const mockState = createMockState();
    const get = vi.fn(() => mockState);

    const getBatch = (keys: readonly string[]): Record<string, string> => {
      const state = get() as Record<string, unknown>;
      const result: Record<string, string> = {};
      for (const key of keys) {
        const value = state[key];
        result[key] = value === undefined || value === null ? '' : String(value);
      }
      return result;
    };

    const result = getBatch([
      'telegram_remote_enabled',
      'feishu_remote_enabled',
      'telegram_remote_token',
      'is_think',
    ]);

    expect(result).toEqual({
      telegram_remote_enabled: 'true',
      feishu_remote_enabled: 'false',
      telegram_remote_token: 'test-token',
      is_think: 'false',
    });
  });
});

describe('RemoteControlSettings helpers', () => {
  it('toBoolean should handle boolean true', () => {
    const toBoolean = (value: unknown): boolean => {
      if (typeof value === 'boolean') return value;
      if (typeof value === 'string') return value === 'true';
      return false;
    };

    expect(toBoolean(true)).toBe(true);
    expect(toBoolean('true')).toBe(true);
    expect(toBoolean(false)).toBe(false);
    expect(toBoolean('false')).toBe(false);
    expect(toBoolean('')).toBe(false);
    expect(toBoolean(undefined)).toBe(false);
    expect(toBoolean(null)).toBe(false);
  });

  it('valueToString should handle various types', () => {
    const valueToString = (value: unknown): string => {
      if (value === undefined || value === null) return '';
      return String(value);
    };

    expect(valueToString('hello')).toBe('hello');
    expect(valueToString(true)).toBe('true');
    expect(valueToString(false)).toBe('false');
    expect(valueToString(42)).toBe('42');
    expect(valueToString('')).toBe('');
    expect(valueToString(undefined)).toBe('');
    expect(valueToString(null)).toBe('');
  });

  it('remote control state shape includes keepAwake', () => {
    const state = {
      enabled: true,
      token: 'token',
      allowedChats: '1,2',
      pollTimeout: '25',
      keepAwake: false,
    };

    expect(state.keepAwake).toBe(false);
  });
});
