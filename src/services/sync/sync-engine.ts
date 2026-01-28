// src/services/sync/sync-engine.ts
/**
 * 同步引擎
 * 整合 WebDAV 客户端和 Chunk 存储策略,提供完整的同步功能
 */

import { logger } from '@/lib/logger';
import { WebDAVClient } from './webdav-client';
import { ChunkStorage } from './chunk-storage';
import type {
  ChunkMetadata,
  SyncConfig,
  SyncDirection,
  SyncResult,
  SyncState,
  SyncStatus,
  SyncEvent,
  SyncProgress,
  ConflictResolution,
} from '@/types';
import { SyncEventType } from '@/types';

/**
 * 事件监听器类型
 */
type EventListener = (event: SyncEvent) => void;

/**
 * 同步引擎类
 */
export class SyncEngine {
  private config: SyncConfig;
  private client: WebDAVClient | null = null;
  private storage: ChunkStorage | null = null;
  private state: SyncState;
  private eventListeners: Set<EventListener> = new Set();
  private autoSyncTimer: ReturnType<typeof setInterval> | null = null;
  private deviceId: string;

  constructor(config: SyncConfig, deviceId: string) {
    this.config = config;
    this.deviceId = deviceId;
    this.state = {
      status: 'idle' as SyncStatus,
      lastSyncTime: null,
      lastError: null,
      pendingUploads: 0,
      pendingDownloads: 0,
      conflicts: 0,
    };
  }

  /**
   * 初始化同步引擎
   */
  async initialize(): Promise<void> {
    try {
      // 创建 WebDAV 客户端
      this.client = new WebDAVClient(this.config.webdav);

      // 测试连接
      const connectionResult = await this.client.testConnection();
      if (!connectionResult.success) {
        throw new Error(connectionResult.error || 'Failed to connect to WebDAV server');
      }

      // 创建 Chunk 存储
      this.storage = new ChunkStorage(
        this.client,
        this.deviceId,
        this.config.maxChunkSize || 1024 * 1024
      );

      // 初始化存储
      await this.storage.initialize();

      // 清理无效文件
      await this.storage.cleanup();

      // 设置自动同步
      if (this.config.autoSync && this.config.autoSyncInterval) {
        this.startAutoSync();
      }

      this.emitEvent({
        type: SyncEventType.STATUS_CHANGED,
        data: { status: 'idle' },
        timestamp: Date.now(),
      });

      logger.info('Sync engine initialized successfully');
    } catch (error) {
      this.state.lastError = error instanceof Error ? error.message : String(error);
      this.state.status = 'error';
      logger.error('Failed to initialize sync engine:', error);
      throw error;
    }
  }

  /**
   * 添加事件监听器
   */
  addEventListener(listener: EventListener): void {
    this.eventListeners.add(listener);
  }

  /**
   * 移除事件监听器
   */
  removeEventListener(listener: EventListener): void {
    this.eventListeners.delete(listener);
  }

  /**
   * 触发事件
   */
  private emitEvent(event: SyncEvent): void {
    this.eventListeners.forEach((listener) => {
      try {
        listener(event);
      } catch (error) {
        logger.error('Error in event listener:', error);
      }
    });
  }

  /**
   * 更新同步状态
   */
  private updateStatus(status: SyncStatus): void {
    this.state.status = status;
    this.emitEvent({
      type: SyncEventType.STATUS_CHANGED,
      data: { status },
      timestamp: Date.now(),
    });
  }

  /**
   * 发送进度更新
   */
  private emitProgress(progress: SyncProgress): void {
    this.emitEvent({
      type: SyncEventType.PROGRESS,
      data: progress,
      timestamp: Date.now(),
    });
  }

  /**
   * 执行同步
   */
  async sync(
    getLocalChunks: () => Promise<Record<string, ChunkMetadata>>,
    getLocalData: (id: string) => Promise<unknown>,
    saveLocalData: (id: string, data: unknown) => Promise<void>,
    deleteLocalData: (id: string) => Promise<void>
  ): Promise<SyncResult> {
    const startTime = Date.now();
    let uploadedChunks = 0;
    let downloadedChunks = 0;
    let deletedChunks = 0;
    let skippedChunks = 0;
    const conflicts: string[] = [];

    try {
      if (!this.storage) {
        throw new Error('Sync engine not initialized');
      }

      this.updateStatus('syncing');

      // 阶段 1: 连接
      this.emitProgress({
        phase: 'connecting',
        totalProgress: 0,
        processedChunks: 0,
        totalChunks: 0,
      });

      // 获取本地 Chunk
      const localChunks = await getLocalChunks();
      const localChunkIds = new Set(Object.keys(localChunks));

      // 阶段 2: 列出远程 Chunk
      this.emitProgress({
        phase: 'listing',
        totalProgress: 10,
        processedChunks: 0,
        totalChunks: 0,
      });

      const remoteChunks = await this.storage.listChunks();
      const remoteChunkIds = new Set(remoteChunks.map((c) => c.id));

      // 比较差异
      const diff = await this.storage.compareChunks(localChunks);

      this.state.pendingUploads = diff.localOnly.length + diff.versionMismatch.length;
      this.state.pendingDownloads = diff.remoteOnly.length + diff.versionMismatch.length;
      this.state.conflicts = diff.versionMismatch.length;

      logger.info('Chunk diff:', {
        localOnly: diff.localOnly.length,
        remoteOnly: diff.remoteOnly.length,
        versionMismatch: diff.versionMismatch.length,
      });

      const totalChunks =
        diff.localOnly.length + diff.remoteOnly.length + diff.versionMismatch.length;
      let processedChunks = 0;

      // 阶段 3: 上传本地独有的 Chunk
      if (diff.localOnly.length > 0) {
        this.emitProgress({
          phase: 'uploading',
          totalProgress: 20,
          processedChunks: 0,
          totalChunks,
        });

        for (const id of diff.localOnly) {
          this.emitProgress({
            phase: 'uploading',
            totalProgress: 20 + (processedChunks / totalChunks) * 60,
            currentChunk: id,
            processedChunks,
            totalChunks,
          });

          const data = await getLocalData(id);
          const metadata = localChunks[id];
          await this.storage!.uploadChunk(id, data, metadata.dataType || 'unknown');
          uploadedChunks++;
          processedChunks++;
        }
      }

      // 阶段 4: 下载远程独有的 Chunk
      if (diff.remoteOnly.length > 0) {
        this.emitProgress({
          phase: 'downloading',
          totalProgress: 20,
          processedChunks,
          totalChunks,
        });

        for (const id of diff.remoteOnly) {
          this.emitProgress({
            phase: 'downloading',
            totalProgress: 20 + (processedChunks / totalChunks) * 60,
            currentChunk: id,
            processedChunks,
            totalChunks,
          });

          const chunkData = await this.storage!.downloadChunk(id);
          if (chunkData) {
            await saveLocalData(id, chunkData.data);
            downloadedChunks++;
          }
          processedChunks++;
        }
      }

      // 阶段 5: 处理版本冲突
      if (diff.versionMismatch.length > 0) {
        this.emitProgress({
          phase: 'merging',
          totalProgress: 20,
          processedChunks,
          totalChunks,
        });

        for (const conflict of diff.versionMismatch) {
          this.emitProgress({
            phase: 'merging',
            totalProgress: 20 + (processedChunks / totalChunks) * 60,
            currentChunk: conflict.id,
            processedChunks,
            totalChunks,
          });

          try {
            await this.resolveConflict(
              conflict.id,
              conflict.localVersion,
              conflict.remoteVersion,
              getLocalData,
              saveLocalData
            );
            processedChunks++;
          } catch (error) {
            conflicts.push(conflict.id);
            logger.error(`Failed to resolve conflict for chunk ${conflict.id}:`, error);
          }
        }
      }

      // 阶段 6: 清理已删除的 Chunk
      this.emitProgress({
        phase: 'merging',
        totalProgress: 80,
        processedChunks,
        totalChunks,
      });

      // 删除远程已删除的本地 Chunk
      for (const id of localChunkIds) {
        if (!remoteChunkIds.has(id)) {
          // 这个 Chunk 在本地存在但远程不存在
          // 根据同步方向决定是否删除
          if (this.config.direction === SyncDirection.DOWNLOAD_ONLY) {
            await deleteLocalData(id);
            deletedChunks++;
          } else {
            skippedChunks++;
          }
        }
      }

      // 完成
      this.state.lastSyncTime = Date.now();
      this.state.lastError = null;
      this.state.pendingUploads = 0;
      this.state.pendingDownloads = 0;
      this.state.conflicts = conflicts.length;

      this.updateStatus(conflicts.length > 0 ? 'conflict' : 'success');

      this.emitProgress({
        phase: 'completed',
        totalProgress: 100,
        processedChunks: totalChunks,
        totalChunks,
      });

      this.emitEvent({
        type: SyncEventType.COMPLETED,
        data: {
          uploadedChunks,
          downloadedChunks,
          deletedChunks,
          skippedChunks,
          conflicts: conflicts.length,
        },
        timestamp: Date.now(),
      });

      logger.info('Sync completed', {
        uploadedChunks,
        downloadedChunks,
        deletedChunks,
        skippedChunks,
        conflicts: conflicts.length,
      });

      return {
        success: conflicts.length === 0,
        status: this.state.status,
        uploadedChunks,
        downloadedChunks,
        deletedChunks,
        skippedChunks,
        conflicts,
        startTime,
        endTime: Date.now(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.state.lastError = errorMessage;
      this.updateStatus('error');

      this.emitEvent({
        type: SyncEventType.ERROR,
        data: { error: errorMessage },
        timestamp: Date.now(),
      });

      logger.error('Sync failed:', error);

      return {
        success: false,
        status: 'error',
        uploadedChunks,
        downloadedChunks,
        deletedChunks,
        skippedChunks,
        conflicts,
        error: errorMessage,
        startTime,
        endTime: Date.now(),
      };
    }
  }

  /**
   * 解决冲突
   */
  private async resolveConflict(
    id: string,
    localVersion: number,
    remoteVersion: number,
    getLocalData: (id: string) => Promise<unknown>,
    saveLocalData: (id: string) => Promise<unknown>
  ): Promise<void> {
    if (!this.storage) {
      throw new Error('Sync engine not initialized');
    }

    const resolution = this.config.conflictResolution;

    switch (resolution) {
      case 'local': {
        // 本地优先:上传本地版本
        const data = await getLocalData(id);
        await this.storage.uploadChunk(id, data, 'unknown');
        logger.info(`Resolved conflict (local wins): ${id}`);
        break;
      }
      case 'remote': {
        // 远程优先:下载远程版本
        const chunkData = await this.storage.downloadChunk(id);
        if (chunkData) {
          await saveLocalData(id, chunkData.data);
        }
        logger.info(`Resolved conflict (remote wins): ${id}`);
        break;
      }
      case 'timestamp': {
        // 基于时间戳
        const localMeta = await this.storage.getChunkMetadata(id);
        const chunkData = await this.storage.downloadChunk(id);

        if (localMeta && chunkData) {
          if (localMeta.updatedAt > chunkData.meta.updatedAt) {
            const data = await getLocalData(id);
            await this.storage.uploadChunk(id, data, 'unknown');
            logger.info(`Resolved conflict (timestamp - local wins): ${id}`);
          } else {
            await saveLocalData(id, chunkData.data);
            logger.info(`Resolved conflict (timestamp - remote wins): ${id}`);
          }
        }
        break;
      }
      case 'manual': {
        // 手动解决:抛出错误
        throw new Error(`Conflict for chunk ${id}, manual resolution required`);
      }
    }
  }

  /**
   * 开始自动同步
   */
  private startAutoSync(): void {
    if (this.autoSyncTimer) {
      clearInterval(this.autoSyncTimer);
    }

    if (this.config.autoSyncInterval) {
      this.autoSyncTimer = setInterval(() => {
        logger.info('Auto-sync triggered');
        // 注意:这里需要调用者提供 getLocalChunks 等回调
        // 实际使用时应该通过其他机制触发同步
      }, this.config.autoSyncInterval);

      logger.info(`Auto-sync started with interval ${this.config.autoSyncInterval}ms`);
    }
  }

  /**
   * 停止自动同步
   */
  stopAutoSync(): void {
    if (this.autoSyncTimer) {
      clearInterval(this.autoSyncTimer);
      this.autoSyncTimer = null;
      logger.info('Auto-sync stopped');
    }
  }

  /**
   * 获取当前状态
   */
  getState(): SyncState {
    return { ...this.state };
  }

  /**
   * 获取配置
   */
  getConfig(): SyncConfig {
    return { ...this.config };
  }

  /**
   * 更新配置
   */
  async updateConfig(config: Partial<SyncConfig>): Promise<void> {
    // 更新配置
    this.config = { ...this.config, ...config };

    // 重新初始化
    await this.initialize();
  }

  /**
   * 保存 Chunk 到远程
   */
  async saveChunk<T>(id: string, data: T, dataType: string): Promise<void> {
    if (!this.storage) {
      throw new Error('Sync engine not initialized');
    }

    await this.storage.saveChunk(id, data, dataType);
  }

  /**
   * 从远程加载 Chunk
   */
  async loadChunk<T>(id: string): Promise<T | null> {
    if (!this.storage) {
      throw new Error('Sync engine not initialized');
    }

    const chunkData = await this.storage.loadChunk<T>(id);
    return chunkData?.data || null;
  }

  /**
   * 删除 Chunk
   */
  async deleteChunk(id: string): Promise<void> {
    if (!this.storage) {
      throw new Error('Sync engine not initialized');
    }

    await this.storage.deleteChunk(id);
  }

  /**
   * 列出所有 Chunk
   */
  async listChunks(): Promise<ChunkMetadata[]> {
    if (!this.storage) {
      throw new Error('Sync engine not initialized');
    }

    return this.storage.listChunks();
  }

  /**
   * 销毁同步引擎
   */
  async destroy(): Promise<void> {
    this.stopAutoSync();
    this.eventListeners.clear();
    this.storage = null;
    this.client = null;
    logger.info('Sync engine destroyed');
  }
}

/**
 * 生成设备 ID
 */
export function generateDeviceId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
}
