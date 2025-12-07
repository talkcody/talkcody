// src/test/setup.ts
import { vi } from 'vitest';
import '@testing-library/jest-dom';

// Mock window object for Tauri APIs
Object.defineProperty(window, '__TAURI_INTERNALS__', {
  value: {
    invoke: vi.fn(),
  },
});

// Mock Tauri APIs
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

// Mock @libsql/client for Turso database
vi.mock('@libsql/client', () => {
  const mockClient = {
    execute: vi.fn().mockResolvedValue({ rows: [], rowsAffected: 0 }),
    batch: vi.fn().mockResolvedValue([]),
  };

  return {
    createClient: vi.fn().mockReturnValue(mockClient),
  };
});

vi.mock('@tauri-apps/plugin-fs', () => ({
  writeTextFile: vi.fn().mockResolvedValue(undefined),
  readTextFile: vi.fn().mockResolvedValue(''),
  exists: vi.fn().mockResolvedValue(false),
  readDir: vi.fn().mockResolvedValue([]),
  mkdir: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue(new Uint8Array()),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tauri-apps/plugin-log', () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
}));

vi.mock('@tauri-apps/api/path', () => ({
  normalize: vi.fn().mockImplementation(async (path: string) => path),
  appDataDir: vi.fn().mockResolvedValue('/test/app-data'),
  join: vi.fn().mockImplementation(async (...paths: string[]) => {
    // Filter out "." and empty strings, then join
    const filtered = paths.filter((p) => p && p !== '.');
    return filtered.join('/');
  }),
  dirname: vi.fn().mockImplementation(async (path: string) => {
    const parts = path.split('/');
    parts.pop();
    return parts.join('/') || '/';
  }),
  isAbsolute: vi.fn().mockImplementation(async (path: string) => path.startsWith('/')),
}));

// Mock logger
vi.mock('../lib/logger', () => {
  const mockLogger = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return {
    logger: mockLogger,
    default: mockLogger,
  };
});

// Mock repository service
vi.mock('../services/repository-service', () => ({
  repositoryService: {
    readFileWithCache: vi.fn().mockResolvedValue(''),
    writeFile: vi.fn().mockResolvedValue(undefined),
    clearCache: vi.fn(),
  },
}));

// Mock repository utils
vi.mock('../services/repository-utils', () => ({
  normalizeFilePath: vi.fn().mockImplementation(async (root, path) => {
    // If path is already absolute (starts with /), return it as-is
    if (path.startsWith('/')) {
      return path;
    }
    // Otherwise, join with root
    return `${root}/${path}`;
  }),
}));

// Mock settings store
vi.mock('../stores/settings-store', () => ({
  settingsManager: {
    getCurrentRootPath: vi.fn().mockReturnValue('/test/root'),
    getCurrentConversationId: vi.fn().mockReturnValue('conv-123'),
    getProject: vi.fn().mockResolvedValue(null),
    getSync: vi.fn().mockReturnValue(undefined),
    getBatchSync: vi.fn().mockReturnValue({}),
    db: {
      select: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockResolvedValue({ rowsAffected: 0 }),
    },
  },
  SettingsManager: vi.fn().mockImplementation(() => ({
    getCurrentRootPath: vi.fn().mockReturnValue('/test/root'),
    getCurrentConversationId: vi.fn().mockReturnValue('conv-123'),
    getProject: vi.fn().mockResolvedValue(null),
  })),
  useSettingsStore: {
    getState: vi.fn(() => ({
      language: 'en',
    })),
    subscribe: vi.fn(),
    setState: vi.fn(),
  },
}));

vi.mock('@/services/workspace-root-service', () => ({
  getValidatedWorkspaceRoot: vi.fn().mockResolvedValue('/test/root'),
}));

// Mock ResizeObserver
(globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver = vi
  .fn()
  .mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  }));

// Mock models config JSON import
vi.mock('@talkcody/shared/data/models-config.json', () => ({
  default: {
    models: [],
    providers: [],
  },
}));

// Mock model loader to avoid JSON import issues in tests
vi.mock('../lib/model-loader', () => ({
  modelLoader: {
    getModels: vi.fn().mockResolvedValue([]),
    loadModels: vi.fn().mockResolvedValue([]),
    refreshModels: vi.fn().mockResolvedValue([]),
  },
}));

// Mock conversation manager
vi.mock('../services/conversation-manager', () => ({
  ConversationManager: {
    getConversationSettings: vi.fn().mockResolvedValue(null),
    updateConversationSettings: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock database service
vi.mock('../services/database-service', () => ({
  databaseService: {
    initialize: vi.fn().mockResolvedValue(undefined),
    db: {
      select: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockResolvedValue({ rowsAffected: 0 }),
    },
  },
}));

// Mock models module
vi.mock('../lib/models', () => ({
  initializeModels: vi.fn().mockResolvedValue(undefined),
  getModelByProviderAndId: vi.fn().mockReturnValue(null),
  getProviderConfig: vi.fn().mockReturnValue(null),
  GEMINI_25_FLASH_LITE: 'gemini-2.5-flash-lite',
  CLAUDE_HAIKU: 'claude-haiku-4.5',
  GPT5: 'gpt-5',
  GPT5_MINI: 'gpt-5-mini',
  GPT51_CODE_MAX: 'gpt-51-codex-max',
  CODE_STARL: 'codestral',
  GROK_CODE_FAST: 'grok-code-fast-1',
  GLM_46: 'glm-4.6',
  NANO_BANANA_PRO: 'gemini-3-pro-image',
  SCRIBE_V2_REALTIME: 'scribe-v2-realtime',
  GPT5_NANO: 'gpt-5-nano',
  MODEL_CONFIGS: {},
  refreshModelConfigs: vi.fn().mockResolvedValue(undefined),
  supportsImageOutput: vi.fn().mockReturnValue(false),
  supportsImageInput: vi.fn().mockReturnValue(false),
  supportsAudioInput: vi.fn().mockReturnValue(false),
  getProvidersForModel: vi.fn().mockReturnValue([]),
}));

// Mock todo store
vi.mock('../stores/todo-store', () => ({
  useTodoStore: {
    getState: vi.fn(() => ({
      todos: [],
      setTodos: vi.fn(),
    })),
  },
}));

// jsdom may not provide a clear() implementation; ensure a working localStorage polyfill exists.
if (!globalThis.localStorage || typeof globalThis.localStorage.clear !== 'function') {
  const store = new Map<string, string>();
  const memoryStorage: Storage = {
    get length() {
      return store.size;
    },
    clear: () => {
      store.clear();
    },
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(String(key), String(value));
    },
  };

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    enumerable: true,
    writable: true,
    value: memoryStorage,
  });
}
