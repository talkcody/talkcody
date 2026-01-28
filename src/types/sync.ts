// src/types/sync.ts
/**
 * 同步引擎类型定义
 * 支持 WebDAV 协议的 JSON-Chunk 存储策略
 */

/**
 * 同步状态枚举
 */
export enum SyncStatus {
  IDLE = 'idle',
  SYNCING = 'syncing',
  SUCCESS = 'success',
  ERROR = 'error',
  CONFLICT = 'conflict',
}

/**
 * 同步方向
 */
export enum SyncDirection {
  BIDIRECTIONAL = 'bidirectional', // 双向同步
  UPLOAD_ONLY = 'upload_only', // 仅上传
  DOWNLOAD_ONLY = 'download_only', // 仅下载
}

/**
 * WebDAV 配置
 */
export interface WebDAVConfig {
  /** WebDAV 服务器 URL */
  url: string;
  /** 用户名 */
  username: string;
  /** 密码 */
  password: string;
  /** 同步路径 (相对于 WebDAV 根目录) */
  syncPath: string;
  /** HTTPS 证书验证 (默认 true) */
  rejectUnauthorized?: boolean;
  /** 请求超时时间 (毫秒, 默认 30000) */
  timeout?: number;
}

/**
 * Chunk 元数据
 */
export interface ChunkMetadata {
  /** Chunk 唯一标识 */
  id: string;
  /** Chunk 版本号 */
  version: number;
  /** Chunk 校验和 (用于验证数据完整性) */
  checksum: string;
  /** Chunk 创建时间 */
  createdAt: number;
  /** Chunk 更新时间 */
  updatedAt: number;
  /** Chunk 大小 (字节) */
  size: number;
  /** Chunk 数据类型 */
  dataType: string;
  /** 设备标识 (用于冲突检测) */
  deviceId: string;
}

/**
 * Chunk 数据
 */
export interface ChunkData<T = unknown> {
  /** Chunk 元数据 */
  meta: ChunkMetadata;
  /** Chunk 实际数据 */
  data: T;
}

/**
 * 同步状态信息
 */
export interface SyncState {
  /** 同步状态 */
  status: SyncStatus;
  /** 最后同步时间 */
  lastSyncTime: number | null;
  /** 最后错误信息 */
  lastError: string | null;
  /** 待上传的 Chunk 数量 */
  pendingUploads: number;
  /** 待下载的 Chunk 数量 */
  pendingDownloads: number;
  /** 冲突的 Chunk 数量 */
  conflicts: number;
}

/**
 * 同步结果
 */
export interface SyncResult {
  /** 是否成功 */
  success: boolean;
  /** 同步状态 */
  status: SyncStatus;
  /** 上传的 Chunk 数量 */
  uploadedChunks: number;
  /** 下载的 Chunk 数量 */
  downloadedChunks: number;
  /** 删除的 Chunk 数量 */
  deletedChunks: number;
  /** 跳过的 Chunk 数量 */
  skippedChunks: number;
  /** 冲突的 Chunk 列表 */
  conflicts: string[];
  /** 错误信息 */
  error?: string;
  /** 开始时间 */
  startTime: number;
  /** 结束时间 */
  endTime: number;
}

/**
 * Chunk 差异
 */
export interface ChunkDiff {
  /** 仅在本地存在的 Chunk */
  localOnly: string[];
  /** 仅在远程存在的 Chunk */
  remoteOnly: string[];
  /** 两端都存在但版本不同的 Chunk */
  versionMismatch: Array<{
    id: string;
    localVersion: number;
    remoteVersion: number;
  }>;
}

/**
 * 同步冲突解决策略
 */
export enum ConflictResolution {
  /** 本地优先 */
  LOCAL = 'local',
  /** 远程优先 */
  REMOTE = 'remote',
  /** 手动解决 */
  MANUAL = 'manual',
  /** 基于时间戳 (最新的胜出) */
  TIMESTAMP = 'timestamp',
}

/**
 * 同步配置
 */
export interface SyncConfig {
  /** WebDAV 配置 */
  webdav: WebDAVConfig;
  /** 同步方向 */
  direction: SyncDirection;
  /** 冲突解决策略 */
  conflictResolution: ConflictResolution;
  /** 是否自动同步 */
  autoSync: boolean;
  /** 自动同步间隔 (毫秒) */
  autoSyncInterval?: number;
  /** Chunk 最大大小 (字节, 默认 1MB) */
  maxChunkSize?: number;
  /** 是否启用压缩 */
  enableCompression?: boolean;
}

/**
 * 同步事件类型
 */
export enum SyncEventType {
  STATUS_CHANGED = 'status_changed',
  PROGRESS = 'progress',
  ERROR = 'error',
  CONFLICT = 'conflict',
  COMPLETED = 'completed',
}

/**
 * 同步事件
 */
export interface SyncEvent {
  type: SyncEventType;
  data: unknown;
  timestamp: number;
}

/**
 * 同步进度
 */
export interface SyncProgress {
  /** 当前阶段 */
  phase: 'connecting' | 'listing' | 'downloading' | 'uploading' | 'merging' | 'completed';
  /** 总进度 (0-100) */
  totalProgress: number;
  /** 当前处理的 Chunk */
  currentChunk?: string;
  /** 已处理的 Chunk 数量 */
  processedChunks: number;
  /** 总 Chunk 数量 */
  totalChunks: number;
}
