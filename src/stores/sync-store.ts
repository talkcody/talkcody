// src/stores/sync-store.ts
/**
 * 同步引擎状态管理
 * 使用 zustand 管理同步功能
 */

import { create } from 'zustand';
import { logger } from '@/lib/logger';
import { SyncEngine, generateDeviceId } from '@/services/sync';
import type {
  SyncConfig,
  SyncState,
  SyncEvent,
  SyncProgress,
  ChunkMetadata,
} from '@/types';

/**
 * 同步 Store 状态
 */
interface SyncStoreState {
  // 同步引擎实例
  engine: SyncEngine | null;

  // 配置
  config: SyncConfig | null;
  deviceId: string;

  // 状态
  isInitialized: boolean;
  isEnabled: boolean;
  isSyncing: boolean;
  syncState: SyncState;

  // 错误
  lastError: string | null;

  // 初始化
  initialize: (config: SyncConfig) => Promise<void>;

  // 启用/禁用同步
  enableSync: () => Promise<void>;
  disableSync: () => Promise<void>;

  // 执行同步
  performSync: (
    getLocalChunks: () => Promise<Record<string, ChunkMetadata>>,
    getLocalData: (id: string) => Promise<unknown>,
    saveLocalData: (id: string, data: unknown) => Promise<void>,
    deleteLocalData: (id: string) => Promise<void>
  ) => Promise<void>;

  // Chunk 管理
  saveChunk: <T>(id: string, data: T, dataType: string) => Promise<void>;
  loadChunk: <T>(id: string) => Promise<T | null>;
  deleteChunk: (id: string) => Promise<void>;
  listChunks: () => Promise<ChunkMetadata[]>;

  // 配置管理
  updateConfig: (config: Partial<SyncConfig>) => Promise<void>;

  // 清理
  destroy: () => Promise<void>;

  // 事件处理
  addEventListener: (listener: (event: SyncEvent) => void) => void;
  removeEventListener: (listener: (event: SyncEvent) => void) => void;
}

/**
 * 获取持久化的设备 ID
 */
function getPersistentDeviceId(): string {
  const stored = localStorage.getItem('talkcody_device_id');
  if (stored) {
    return stored;
  }

  const newId = generateDeviceId();
  localStorage.setItem('talkcody_device_id', newId);
  return newId;
}

/**
 * 创建同步 Store
 */
export const useSyncStore = create<SyncStoreState>((set, get) => ({
  // 初始状态
  engine: null,
  config: null,
  deviceId: getPersistentDeviceId(),
  isInitialized: false,
  isEnabled: false,
  isSyncing: false,
  syncState: {
    status: 'idle',
    lastSyncTime: null,
    lastError: null,
    pendingUploads: 0,
    pendingDownloads: 0,
    conflicts: 0,
  },
  lastError: null,

  /**
   * 初始化同步引擎
   */
  initialize: async (config: SyncConfig) => {
    try {
      logger.info('Initializing sync engine...');

      const deviceId = get().deviceId;
      const engine = new SyncEngine(config, deviceId);

      // 添加事件监听器
      engine.addEventListener((event) => {
        const state = get();

        switch (event.type) {
          case 'status_changed':
            set({
              syncState: {
                ...state.syncState,
                status: (event.data as any).status,
              },
            });
            break;

          case 'progress':
            const progress = event.data as SyncProgress;
            set({
              isSyncing: progress.phase !== 'completed',
              syncState: {
                ...state.syncState,
                status: progress.phase === 'completed' ? 'success' : 'syncing',
              },
            });
            break;

          case 'error':
            set({
              lastError: (event.data as any).error,
              syncState: {
                ...state.syncState,
                status: 'error',
                lastError: (event.data as any).error,
              },
            });
            break;

          case 'completed':
            const result = event.data as any;
            set({
              isSyncing: false,
              syncState: {
                ...state.syncState,
                status: result.conflicts > 0 ? 'conflict' : 'success',
                lastSyncTime: Date.now(),
                conflicts: result.conflicts,
                pendingUploads: 0,
                pendingDownloads: 0,
              },
            });
            break;
        }
      });

      // 初始化引擎
      await engine.initialize();

      set({
        engine,
        config,
        isInitialized: true,
        isEnabled: true,
        lastError: null,
      });

      logger.info('Sync engine initialized successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to initialize sync engine:', error);

      set({
        lastError: errorMessage,
        syncState: {
          ...get().syncState,
          status: 'error',
          lastError: errorMessage,
        },
      });

      throw error;
    }
  },

  /**
   * 启用同步
   */
  enableSync: async () => {
    const { config, isInitialized, engine } = get();

    if (!config) {
      throw new Error('Sync config not set');
    }

    if (!isInitialized || !engine) {
      await get().initialize(config);
    }

    set({ isEnabled: true });
    logger.info('Sync enabled');
  },

  /**
   * 禁用同步
   */
  disableSync: async () => {
    const { engine } = get();

    if (engine) {
      engine.stopAutoSync();
    }

    set({ isEnabled: false });
    logger.info('Sync disabled');
  },

  /**
   * 执行同步
   */
  performSync: async (
    getLocalChunks,
    getLocalData,
    saveLocalData,
    deleteLocalData
  ) => {
    const { engine, isEnabled } = get();

    if (!engine) {
      throw new Error('Sync engine not initialized');
    }

    if (!isEnabled) {
      logger.warn('Sync is disabled, skipping');
      return;
    }

    set({ isSyncing: true, lastError: null });

    try {
      const result = await engine.sync(
        getLocalChunks,
        getLocalData,
        saveLocalData,
        deleteLocalData
      );

      if (!result.success) {
        set({ lastError: result.error });
      }

      logger.info('Sync completed:', result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      set({ lastError: errorMessage, isSyncing: false });
      throw error;
    } finally {
      set({ isSyncing: false });
    }
  },

  /**
   * 保存 Chunk
   */
  saveChunk: async (id, data, dataType) => {
    const { engine } = get();

    if (!engine) {
      throw new Error('Sync engine not initialized');
    }

    await engine.saveChunk(id, data, dataType);
  },

  /**
   * 加载 Chunk
   */
  loadChunk: async (id) => {
    const { engine } = get();

    if (!engine) {
      throw new Error('Sync engine not initialized');
    }

    return engine.loadChunk(id);
  },

  /**
   * 删除 Chunk
   */
  deleteChunk: async (id) => {
    const { engine } = get();

    if (!engine) {
      throw new Error('Sync engine not initialized');
    }

    await engine.deleteChunk(id);
  },

  /**
   * 列出所有 Chunk
   */
  listChunks: async () => {
    const { engine } = get();

    if (!engine) {
      throw new Error('Sync engine not initialized');
    }

    return engine.listChunks();
  },

  /**
   * 更新配置
   */
  updateConfig: async (partialConfig) => {
    const { engine, config } = get();

    if (!engine) {
      throw new Error('Sync engine not initialized');
    }

    const newConfig = { ...config, ...partialConfig } as SyncConfig;
    await engine.updateConfig(newConfig);

    set({ config: newConfig });
  },

  /**
   * 销毁引擎
   */
  destroy: async () => {
    const { engine } = get();

    if (engine) {
      await engine.destroy();
    }

    set({
      engine: null,
      isInitialized: false,
      isEnabled: false,
      isSyncing: false,
      syncState: {
        status: 'idle',
        lastSyncTime: null,
        lastError: null,
        pendingUploads: 0,
        pendingDownloads: 0,
        conflicts: 0,
      },
    });
  },

  /**
   * 添加事件监听器
   */
  addEventListener: (listener) => {
    const { engine } = get();
    if (engine) {
      engine.addEventListener(listener);
    }
  },

  /**
   * 移除事件监听器
   */
  removeEventListener: (listener) => {
    const { engine } = get();
    if (engine) {
      engine.removeEventListener(listener);
    }
  },
}));
