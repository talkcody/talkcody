// src/services/sync/index.ts
/**
 * 同步引擎模块
 * 导出所有同步相关的功能
 */

export { WebDAVClient } from './webdav-client';
export { ChunkStorage } from './chunk-storage';
export { SyncEngine, generateDeviceId } from './sync-engine';

// 重新导出类型
export type {
  ChunkData,
  ChunkMetadata,
  ChunkDiff,
  SyncConfig,
  SyncDirection,
  SyncResult,
  SyncState,
  SyncStatus,
  SyncEvent,
  SyncEventType,
  SyncProgress,
  ConflictResolution,
  WebDAVConfig,
} from '@/types';
