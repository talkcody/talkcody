import { vi } from 'vitest';
import '@testing-library/jest-dom';

// Import centralized mocks
import {
  mockDatabaseService,
  mockLogger,
  mockRepositoryService,
  mockSettingsStore,
  mockTauriPath,
  mockWorkspaceRootService,
} from './mocks';

// Note: monaco-editor is mocked via alias in vitest.config.ts
// See src/test/mocks/monaco-editor.ts

// ============================================
// Tauri API Mocks
// ============================================

// Mock window object for Tauri APIs (only in browser environment)
// NOTE: configurable and writable must be true to allow @tauri-apps/api/mocks to override
if (typeof window !== 'undefined') {
  Object.defineProperty(window, '__TAURI_INTERNALS__', {
    value: {
      invoke: vi.fn(),
    },
    configurable: true,
    writable: true,
  });
}

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

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

// Apply centralized mocks globally to setup.ts
vi.mock('@tauri-apps/api/path', () => mockTauriPath);
vi.mock('@/lib/logger', () => ({
  logger: mockLogger.logger,
  default: mockLogger.default,
}));
vi.mock('@/stores/settings-store', () => mockSettingsStore);
vi.mock('@/services/workspace-root-service', () => mockWorkspaceRootService);
vi.mock('@/services/database-service', () => ({ databaseService: mockDatabaseService }));
vi.mock('@/services/task-service', () => ({
  taskService: {
    getTaskSettings: vi.fn().mockResolvedValue(null),
    updateTaskSettings: vi.fn().mockResolvedValue(undefined),
    createTask: vi.fn().mockResolvedValue('test-task-id'),
    loadTasks: vi.fn().mockResolvedValue([]),
    loadMessages: vi.fn().mockResolvedValue([]),
    selectTask: vi.fn().mockResolvedValue(undefined),
    deleteTask: vi.fn().mockResolvedValue(undefined),
    renameTask: vi.fn().mockResolvedValue(undefined),
    updateTaskUsage: vi.fn().mockResolvedValue(undefined),
    getTaskDetails: vi.fn().mockResolvedValue(null),
    loadTasksWithPagination: vi.fn().mockResolvedValue([]),
    loadTasksWithSearchPagination: vi.fn().mockResolvedValue([]),
    startNewTask: vi.fn().mockReturnValue(undefined),
    generateAndUpdateTitle: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('@/services/repository-service', () => ({ repositoryService: mockRepositoryService }));

// Mock repository utils
vi.mock('@/services/repository-utils', () => ({
  normalizeFilePath: vi.fn().mockImplementation(async (root, path) => {
    if (path.startsWith('/')) return path;
    return `${root}/${path}`;
  }),
}));

// Mock models config JSON import
vi.mock('@talkcody/shared/data/models-config.json', () => ({
  default: {
    models: [],
    providers: [],
  },
}));

// Mock model loader
vi.mock('@/lib/model-loader', () => ({
  modelLoader: {
    getModels: vi.fn().mockResolvedValue([]),
    loadModels: vi.fn().mockResolvedValue([]),
    refreshModels: vi.fn().mockResolvedValue([]),
  },
}));

// Mock models module
vi.mock('@/lib/models', () => ({
  initializeModels: vi.fn().mockResolvedValue(undefined),
  getModelByProviderAndId: vi.fn().mockReturnValue(null),
  getProviderConfig: vi.fn().mockReturnValue(null),
  GEMINI_25_FLASH_LITE: 'gemini-2.5-flash-lite',
  CLAUDE_HAIKU: 'claude-haiku-4.5',
  GPT5: 'gpt-5',
  GPT5_MINI: 'gpt-5-mini',
  MODEL_CONFIGS: {},
  refreshModelConfigs: vi.fn().mockResolvedValue(undefined),
  supportsImageOutput: vi.fn().mockReturnValue(false),
  supportsImageInput: vi.fn().mockReturnValue(false),
  supportsAudioInput: vi.fn().mockReturnValue(false),
  getProvidersForModel: vi.fn().mockReturnValue([]),
}));

// Mock todo store
vi.mock('@/stores/todo-store', () => ({
  useTodoStore: {
    getState: vi.fn(() => ({
      todos: [],
      setTodos: vi.fn(),
    })),
  },
}));

// ============================================
// Polyfills
// ============================================

// Mock ResizeObserver
class ResizeObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

(globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverMock;

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
    getItem: (key: string) => (store.has(key) ? (store.get(key) ?? null) : null),
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
