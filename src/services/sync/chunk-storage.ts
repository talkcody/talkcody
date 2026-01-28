// src/services/sync/chunk-storage.ts
/**
 * JSON-Chunk 存储策略
 * 将数据分块存储到 WebDAV 服务器
 */

import { logger } from '@/lib/logger';
import { WebDAVClient } from './webdav-client';
import type {
  ChunkData,
  ChunkMetadata,
  ChunkDiff,
  SyncDirection,
  ConflictResolution,
} from '@/types';

/**
 * Chunk 存储索引
 */
interface ChunkIndex {
  chunks: Record<string, ChunkMetadata>;
  lastUpdated: number;
}

/**
 * Chunk 存储类
 */
export class ChunkStorage {
  private client: WebDAVClient;
  private deviceId: string;
  private maxChunkSize: number;
  private indexCache: ChunkIndex | null = null;

  constructor(
    client: WebDAVClient,
    deviceId: string,
    maxChunkSize: number = 1024 * 1024 // 默认 1MB
  ) {
    this.client = client;
    this.deviceId = deviceId;
    this.maxChunkSize = maxChunkSize;
  }

  /**
   * 初始化存储
   */
  async initialize(): Promise<void> {
    // 确保同步目录存在
    try {
      await this.client.createDirectory('');
    } catch (error) {
      logger.error('Failed to create sync directory:', error);
      throw error;
    }

    // 加载索引
    await this.loadIndex();
  }

  /**
   * 获取索引文件路径
   */
  private getIndexPath(): string {
    return '.chunk-index.json';
  }

  /**
   * 获取 Chunk 文件路径
   */
  private getChunkPath(chunkId: string): string {
    return `chunks/${chunkId}.json`;
  }

  /**
   * 生成校验和
   */
  private async generateChecksum(data: string): Promise<string> {
    // 使用 Subtle API 生成 SHA-256 哈希
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * 加载索引
   */
  private async loadIndex(): Promise<void> {
    try {
      const indexData = await this.client.getFile(this.getIndexPath());
      this.indexCache = JSON.parse(indexData) as ChunkIndex;
      logger.debug(`Loaded chunk index with ${Object.keys(this.indexCache.chunks).length} chunks`);
    } catch (error) {
      // 索引不存在,创建新索引
      logger.info('Chunk index not found, creating new index');
      this.indexCache = {
        chunks: {},
        lastUpdated: Date.now(),
      };
      await this.saveIndex();
    }
  }

  /**
   * 保存索引
   */
  private async saveIndex(): Promise<void> {
    if (!this.indexCache) {
      throw new Error('Index not loaded');
    }

    this.indexCache.lastUpdated = Date.now();
    const indexData = JSON.stringify(this.indexCache, null, 2);
    await this.client.putFile(this.getIndexPath(), indexData);
    logger.debug('Saved chunk index');
  }

  /**
   * 创建 Chunk 元数据
   */
  private async createMetadata(
    id: string,
    data: unknown,
    dataType: string
  ): Promise<ChunkMetadata> {
    const dataJson = JSON.stringify(data);
    const checksum = await this.generateChecksum(dataJson);
    const now = Date.now();

    return {
      id,
      version: 1,
      checksum,
      createdAt: now,
      updatedAt: now,
      size: dataJson.length,
      dataType,
      deviceId: this.deviceId,
    };
  }

  /**
   * 保存 Chunk
   */
  async saveChunk<T>(id: string, data: T, dataType: string): Promise<ChunkMetadata> {
    // 检查数据大小
    const dataJson = JSON.stringify(data);
    if (dataJson.length > this.maxChunkSize) {
      throw new Error(`Chunk data exceeds maximum size of ${this.maxChunkSize} bytes`);
    }

    // 创建元数据
    const metadata = await this.createMetadata(id, data, dataType);

    // 创建 Chunk 数据
    const chunkData: ChunkData<T> = {
      meta: metadata,
      data,
    };

    // 确保 chunks 目录存在
    try {
      await this.client.createDirectory('chunks');
    } catch {
      // 目录可能已存在,忽略错误
    }

    // 保存 Chunk 文件
    const chunkJson = JSON.stringify(chunkData);
    await this.client.putFile(this.getChunkPath(id), chunkJson);

    // 更新索引
    if (!this.indexCache) {
      await this.loadIndex();
    }
    this.indexCache!.chunks[id] = metadata;
    await this.saveIndex();

    logger.info(`Saved chunk: ${id} (${metadata.size} bytes)`);
    return metadata;
  }

  /**
   * 加载 Chunk
   */
  async loadChunk<T>(id: string): Promise<ChunkData<T> | null> {
    try {
      const chunkJson = await this.client.getFile(this.getChunkPath(id));
      const chunkData = JSON.parse(chunkJson) as ChunkData<T>;

      // 验证校验和
      const dataJson = JSON.stringify(chunkData.data);
      const checksum = await this.generateChecksum(dataJson);

      if (checksum !== chunkData.meta.checksum) {
        logger.warn(`Chunk checksum mismatch: ${id}`);
        return null;
      }

      return chunkData;
    } catch (error) {
      logger.error(`Failed to load chunk: ${id}`, error);
      return null;
    }
  }

  /**
   * 删除 Chunk
   */
  async deleteChunk(id: string): Promise<void> {
    // 删除 Chunk 文件
    try {
      await this.client.deleteFile(this.getChunkPath(id));
    } catch (error) {
      logger.warn(`Failed to delete chunk file: ${id}`, error);
    }

    // 更新索引
    if (!this.indexCache) {
      await this.loadIndex();
    }

    if (this.indexCache!.chunks[id]) {
      delete this.indexCache!.chunks[id];
      await this.saveIndex();
    }

    logger.info(`Deleted chunk: ${id}`);
  }

  /**
   * 更新 Chunk
   */
  async updateChunk<T>(id: string, data: T): Promise<ChunkMetadata> {
    // 加载现有元数据
    if (!this.indexCache) {
      await this.loadIndex();
    }

    const existingMetadata = this.indexCache!.chunks[id];
    if (!existingMetadata) {
      throw new Error(`Chunk not found: ${id}`);
    }

    // 检查数据大小
    const dataJson = JSON.stringify(data);
    if (dataJson.length > this.maxChunkSize) {
      throw new Error(`Chunk data exceeds maximum size of ${this.maxChunkSize} bytes`);
    }

    // 创建新元数据 (版本号递增)
    const checksum = await this.generateChecksum(dataJson);
    const metadata: ChunkMetadata = {
      ...existingMetadata,
      version: existingMetadata.version + 1,
      checksum,
      updatedAt: Date.now(),
      size: dataJson.length,
    };

    // 创建 Chunk 数据
    const chunkData: ChunkData<T> = {
      meta: metadata,
      data,
    };

    // 保存 Chunk 文件
    const chunkJson = JSON.stringify(chunkData);
    await this.client.putFile(this.getChunkPath(id), chunkJson);

    // 更新索引
    this.indexCache!.chunks[id] = metadata;
    await this.saveIndex();

    logger.info(`Updated chunk: ${id} (version ${metadata.version})`);
    return metadata;
  }

  /**
   * 获取 Chunk 元数据
   */
  async getChunkMetadata(id: string): Promise<ChunkMetadata | null> {
    if (!this.indexCache) {
      await this.loadIndex();
    }

    return this.indexCache!.chunks[id] || null;
  }

  /**
   * 列出所有 Chunk
   */
  async listChunks(): Promise<ChunkMetadata[]> {
    if (!this.indexCache) {
      await this.loadIndex();
    }

    return Object.values(this.indexCache!.chunks);
  }

  /**
   * 比较本地和远程 Chunk 差异
   */
  async compareChunks(localChunks: Record<string, ChunkMetadata>): Promise<ChunkDiff> {
    if (!this.indexCache) {
      await this.loadIndex();
    }

    const remoteChunks = this.indexCache!.chunks;
    const localOnly: string[] = [];
    const remoteOnly: string[] = [];
    const versionMismatch: Array<{
      id: string;
      localVersion: number;
      remoteVersion: number;
    }> = [];

    // 检查本地独有的 Chunk
    for (const id of Object.keys(localChunks)) {
      if (!remoteChunks[id]) {
        localOnly.push(id);
      } else if (localChunks[id].version !== remoteChunks[id].version) {
        versionMismatch.push({
          id,
          localVersion: localChunks[id].version,
          remoteVersion: remoteChunks[id].version,
        });
      }
    }

    // 检查远程独有的 Chunk
    for (const id of Object.keys(remoteChunks)) {
      if (!localChunks[id]) {
        remoteOnly.push(id);
      }
    }

    return {
      localOnly,
      remoteOnly,
      versionMismatch,
    };
  }

  /**
   * 上传本地 Chunk
   */
  async uploadChunk<T>(id: string, data: T, dataType: string): Promise<void> {
    // 检查远程是否已存在
    const remoteMetadata = await this.getChunkMetadata(id);

    if (remoteMetadata) {
      // 如果已存在,更新
      const dataJson = JSON.stringify(data);
      const checksum = await this.generateChecksum(dataJson);

      const metadata: ChunkMetadata = {
        ...remoteMetadata,
        version: remoteMetadata.version + 1,
        checksum,
        updatedAt: Date.now(),
        size: dataJson.length,
      };

      const chunkData: ChunkData<T> = {
        meta: metadata,
        data,
      };

      const chunkJson = JSON.stringify(chunkData);
      await this.client.putFile(this.getChunkPath(id), chunkJson);

      this.indexCache!.chunks[id] = metadata;
      await this.saveIndex();

      logger.info(`Uploaded chunk update: ${id} (version ${metadata.version})`);
    } else {
      // 如果不存在,创建新的
      await this.saveChunk(id, data, dataType);
    }
  }

  /**
   * 下载远程 Chunk
   */
  async downloadChunk<T>(id: string): Promise<ChunkData<T> | null> {
    return this.loadChunk<T>(id);
  }

  /**
   * 合并差异 (根据同步方向和冲突解决策略)
   */
  async mergeDiff(
    diff: ChunkDiff,
    direction: SyncDirection,
    conflictResolution: ConflictResolution,
    getLocalData: (id: string) => Promise<unknown>,
    saveLocalData: (id: string, data: unknown) => Promise<void>
  ): Promise<void> {
    // 处理本地独有的 Chunk
    if (direction !== SyncDirection.DOWNLOAD_ONLY) {
      for (const id of diff.localOnly) {
        const data = await getLocalData(id);
        const metadata = await this.getChunkMetadata(id);
        await this.uploadChunk(id, data, metadata?.dataType || 'unknown');
        logger.info(`Uploaded local-only chunk: ${id}`);
      }
    }

    // 处理远程独有的 Chunk
    if (direction !== SyncDirection.UPLOAD_ONLY) {
      for (const id of diff.remoteOnly) {
        const chunkData = await this.downloadChunk(id);
        if (chunkData) {
          await saveLocalData(id, chunkData.data);
          logger.info(`Downloaded remote-only chunk: ${id}`);
        }
      }
    }

    // 处理版本冲突
    for (const conflict of diff.versionMismatch) {
      if (direction === SyncDirection.UPLOAD_ONLY) {
        // 仅上传模式:上传本地版本
        const data = await getLocalData(conflict.id);
        await this.uploadChunk(conflict.id, data, 'unknown');
        logger.info(`Resolved conflict (upload): ${conflict.id}`);
      } else if (direction === SyncDirection.DOWNLOAD_ONLY) {
        // 仅下载模式:下载远程版本
        const chunkData = await this.downloadChunk(conflict.id);
        if (chunkData) {
          await saveLocalData(conflict.id, chunkData.data);
          logger.info(`Resolved conflict (download): ${conflict.id}`);
        }
      } else {
        // 双向同步模式:根据冲突解决策略处理
        await this.resolveConflict(
          conflict.id,
          conflict.localVersion,
          conflict.remoteVersion,
          conflictResolution,
          getLocalData,
          saveLocalData
        );
      }
    }
  }

  /**
   * 解决冲突
   */
  private async resolveConflict(
    id: string,
    localVersion: number,
    remoteVersion: number,
    resolution: ConflictResolution,
    getLocalData: (id: string) => Promise<unknown>,
    saveLocalData: (id: string, data: unknown) => Promise<void>
  ): Promise<void> {
    switch (resolution) {
      case 'local': {
        // 本地优先:上传本地版本
        const data = await getLocalData(id);
        await this.uploadChunk(id, data, 'unknown');
        logger.info(`Resolved conflict (local wins): ${id}`);
        break;
      }
      case 'remote': {
        // 远程优先:下载远程版本
        const chunkData = await this.downloadChunk(id);
        if (chunkData) {
          await saveLocalData(id, chunkData.data);
          logger.info(`Resolved conflict (remote wins): ${id}`);
        }
        break;
      }
      case 'timestamp': {
        // 基于时间戳:比较更新时间
        const localMeta = await this.getChunkMetadata(id);
        const chunkData = await this.downloadChunk(id);

        if (localMeta && chunkData) {
          if (localMeta.updatedAt > chunkData.meta.updatedAt) {
            // 本地更新时间更新,上传本地版本
            const data = await getLocalData(id);
            await this.uploadChunk(id, data, 'unknown');
            logger.info(`Resolved conflict (timestamp - local wins): ${id}`);
          } else {
            // 远程更新时间更新,下载远程版本
            await saveLocalData(id, chunkData.data);
            logger.info(`Resolved conflict (timestamp - remote wins): ${id}`);
          }
        }
        break;
      }
      case 'manual': {
        // 手动解决:记录冲突,不自动处理
        logger.warn(`Conflict detected (manual resolution required): ${id}`);
        throw new Error(`Conflict detected for chunk ${id}, manual resolution required`);
      }
    }
  }

  /**
   * 清理无效的 Chunk 文件
   */
  async cleanup(): Promise<void> {
    if (!this.indexCache) {
      await this.loadIndex();
    }

    try {
      const files = await this.client.listDirectory('chunks');
      const indexedIds = new Set(Object.keys(this.indexCache!.chunks));

      for (const file of files) {
        if (file.endsWith('/')) {
          continue; // 跳过目录
        }

        const match = file.match(/^chunks\/(.+)\.json$/);
        if (match) {
          const chunkId = match[1];
          if (!indexedIds.has(chunkId)) {
            // 这个文件不在索引中,删除
            await this.client.deleteFile(file);
            logger.info(`Cleaned up orphaned chunk file: ${chunkId}`);
          }
        }
      }
    } catch (error) {
      logger.error('Failed to cleanup chunk files:', error);
    }
  }
}
