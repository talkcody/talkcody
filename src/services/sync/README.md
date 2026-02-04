# WebDAV 同步引擎使用文档

## 概述

WebDAV 同步引擎是一个基于 WebDAV 协议的数据同步解决方案,采用 JSON-Chunk 存储策略,能够高效地将应用数据同步到 WebDAV 服务器。

## 核心特性

- **WebDAV 协议支持**: 标准的 WebDAV 协议,兼容多种云存储服务
- **JSON-Chunk 存储**: 将数据分块存储,提高同步效率和可靠性
- **双向同步**: 支持双向、仅上传、仅下载三种同步模式
- **冲突解决**: 提供多种冲突解决策略
- **增量同步**: 只同步变更的数据,减少网络传输
- **数据校验**: 使用 SHA-256 校验和确保数据完整性

## 架构设计

```
┌─────────────────┐
│   SyncEngine    │  同步引擎核心
│   (sync-engine) │
└────────┬────────┘
         │
    ┌────┴────┐
    ↓         ↓
┌──────┐  ┌──────────┐
│WebDAV│  │Chunk     │
│Client│  │Storage   │
└──────┘  └──────────┘
    ↓           ↓
┌────────────────────┐
│  WebDAV Server     │
│  (远程存储)         │
└────────────────────┘
```

### 核心组件

1. **WebDAVClient**: WebDAV 客户端,负责与 WebDAV 服务器通信
2. **ChunkStorage**: Chunk 存储策略,负责数据的分块存储和管理
3. **SyncEngine**: 同步引擎,整合客户端和存储策略,提供完整的同步功能

## 快速开始

### 1. 基本配置

```typescript
import { SyncEngine, generateDeviceId } from '@/services/sync';
import type { SyncConfig } from '@/types';

// 创建同步配置
const config: SyncConfig = {
  webdav: {
    url: 'https://dav.example.com',
    username: 'user@example.com',
    password: 'password123',
    syncPath: '/talkcody-sync',
    timeout: 30000,
  },
  direction: 'bidirectional', // 双向同步
  conflictResolution: 'timestamp', // 基于时间戳解决冲突
  autoSync: false, // 关闭自动同步
  maxChunkSize: 1024 * 1024, // 1MB
};

// 生成设备 ID
const deviceId = generateDeviceId();

// 创建同步引擎
const syncEngine = new SyncEngine(config, deviceId);
```

### 2. 初始化同步引擎

```typescript
try {
  await syncEngine.initialize();
  console.log('Sync engine initialized successfully');
} catch (error) {
  console.error('Failed to initialize sync engine:', error);
}
```

### 3. 添加事件监听

```typescript
syncEngine.addEventListener((event) => {
  switch (event.type) {
    case 'status_changed':
      console.log('Status changed:', event.data);
      break;
    case 'progress':
      console.log('Progress:', event.data);
      break;
    case 'completed':
      console.log('Sync completed:', event.data);
      break;
    case 'error':
      console.error('Sync error:', event.data);
      break;
    case 'conflict':
      console.warn('Sync conflict:', event.data);
      break;
  }
});
```

### 4. 执行同步

```typescript
// 准备本地数据管理函数
const localChunks: Record<string, any> = {
  // 本地 Chunk 元数据
};

async function getLocalChunks() {
  // 获取本地所有 Chunk 的元数据
  return localChunks;
}

async function getLocalData(id: string) {
  // 获取指定 Chunk 的数据
  return localChunks[id].data;
}

async function saveLocalData(id: string, data: any) {
  // 保存 Chunk 数据到本地
  localChunks[id] = { data, updatedAt: Date.now() };
}

async function deleteLocalData(id: string) {
  // 从本地删除 Chunk
  delete localChunks[id];
}

// 执行同步
const result = await syncEngine.sync(
  getLocalChunks,
  getLocalData,
  saveLocalData,
  deleteLocalData
);

console.log('Sync result:', result);
```

### 5. 手动管理 Chunk

```typescript
// 保存 Chunk 到远程
await syncEngine.saveChunk('chunk-1', { key: 'value' }, 'settings');

// 从远程加载 Chunk
const data = await syncEngine.loadChunk('chunk-1');

// 删除 Chunk
await syncEngine.deleteChunk('chunk-1');

// 列出所有 Chunk
const chunks = await syncEngine.listChunks();
```

## 配置选项详解

### WebDAVConfig

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| url | string | 是 | WebDAV 服务器 URL |
| username | string | 是 | 用户名 |
| password | string | 是 | 密码 |
| syncPath | string | 是 | 同步路径 (相对于 WebDAV 根目录) |
| rejectUnauthorized | boolean | 否 | HTTPS 证书验证 (默认 true) |
| timeout | number | 否 | 请求超时时间 (毫秒, 默认 30000) |

### SyncDirection

| 值 | 说明 |
|------|------|
| bidirectional | 双向同步 (默认) |
| upload_only | 仅上传本地数据到远程 |
| download_only | 仅从远程下载数据 |

### ConflictResolution

| 值 | 说明 |
|------|------|
| local | 本地优先 (本地版本覆盖远程) |
| remote | 远程优先 (远程版本覆盖本地) |
| timestamp | 基于时间戳 (最新版本胜出) |
| manual | 手动解决 (抛出错误,需要手动处理) |

### SyncConfig

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| webdav | WebDAVConfig | 是 | WebDAV 配置 |
| direction | SyncDirection | 是 | 同步方向 |
| conflictResolution | ConflictResolution | 是 | 冲突解决策略 |
| autoSync | boolean | 是 | 是否自动同步 |
| autoSyncInterval | number | 否 | 自动同步间隔 (毫秒) |
| maxChunkSize | number | 否 | Chunk 最大大小 (字节, 默认 1MB) |
| enableCompression | boolean | 否 | 是否启用压缩 (暂未实现) |

## 数据结构

### ChunkMetadata

```typescript
interface ChunkMetadata {
  id: string;              // Chunk 唯一标识
  version: number;         // 版本号
  checksum: string;        // SHA-256 校验和
  createdAt: number;       // 创建时间戳
  updatedAt: number;       // 更新时间戳
  size: number;            // 数据大小 (字节)
  dataType: string;        // 数据类型
  deviceId: string;        // 设备标识
}
```

### ChunkData

```typescript
interface ChunkData<T> {
  meta: ChunkMetadata;
  data: T;
}
```

### SyncResult

```typescript
interface SyncResult {
  success: boolean;
  status: SyncStatus;
  uploadedChunks: number;
  downloadedChunks: number;
  deletedChunks: number;
  skippedChunks: number;
  conflicts: string[];
  error?: string;
  startTime: number;
  endTime: number;
}
```

## 同步流程

### 双向同步流程

```
1. 连接到 WebDAV 服务器
2. 获取本地 Chunk 列表
3. 获取远程 Chunk 列表
4. 比较差异:
   - localOnly: 仅在本地存在的 Chunk
   - remoteOnly: 仅在远程存在的 Chunk
   - versionMismatch: 版本不同的 Chunk
5. 处理差异:
   - 上传 localOnly 的 Chunk
   - 下载 remoteOnly 的 Chunk
   - 根据冲突策略解决 versionMismatch
6. 更新索引
7. 完成
```

## 使用场景示例

### 1. 同步用户设置

```typescript
// 保存用户设置到远程
await syncEngine.saveChunk('user-settings', {
  theme: 'dark',
  language: 'zh-CN',
  notifications: true,
}, 'settings');

// 从远程加载用户设置
const settings = await syncEngine.loadChunk('user-settings');
```

### 2. 同步项目数据

```typescript
// 保存项目数据
for (const project of projects) {
  await syncEngine.saveChunk(`project-${project.id}`, project, 'project');
}

// 同步所有项目
await syncEngine.sync(
  getLocalChunks,
  getLocalData,
  saveLocalData,
  deleteLocalData
);
```

### 3. 冲突处理

```typescript
try {
  await syncEngine.sync(...);
} catch (error) {
  if (error.message.includes('manual resolution required')) {
    // 显示冲突解决对话框
    showConflictDialog(error.message);
  }
}
```

## 最佳实践

1. **设备 ID 管理**: 为每个设备生成唯一的设备 ID,并持久化存储
2. **错误处理**: 始终处理同步错误,并向用户显示友好的错误信息
3. **事件监听**: 使用事件监听器跟踪同步状态和进度
4. **冲突解决**: 根据应用场景选择合适的冲突解决策略
5. **数据分片**: 对于大数据,考虑手动分片存储到多个 Chunk
6. **索引管理**: 定期清理无效的 Chunk 文件

## 兼容的 WebDAV 服务

-坚果云
- Nextcloud
- ownCloud
- WebDAV 服务器
- 其他支持 WebDAV 协议的云存储服务

## 注意事项

1. 确保网络连接稳定
2. 定期备份重要数据
3. 测试 WebDAV 服务器连接
4. 处理并发同步冲突
5. 注意 Chunk 大小限制

## 故障排查

### 连接失败

```
- 检查网络连接
- 验证 WebDAV URL、用户名、密码
- 检查防火墙设置
- 确认 WebDAV 服务器可访问
```

### 同步冲突

```
- 查看冲突日志
- 根据需要调整冲突解决策略
- 考虑使用手动解决模式
```

### 数据校验失败

```
- 检查网络传输是否完整
- 验证 Chunk 文件完整性
- 重新同步失败的数据
```

## API 参考

详细的 API 参考请查看源代码中的类型定义和注释。
