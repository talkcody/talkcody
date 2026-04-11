import { BaseDirectory, exists, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { logger } from '@/lib/logger';
import { ensureWechatFileDir } from '@/services/remote/wechat/wechat-paths';
import {
  WECHAT_SYNC_STATE_FILE,
  type WechatSyncState,
} from '@/services/remote/wechat/wechat-types';

const EMPTY_STATE: WechatSyncState = {
  syncBuf: '',
  updatedAt: 0,
};

class WechatSyncStateStore {
  async load(): Promise<WechatSyncState> {
    try {
      const present = await exists(WECHAT_SYNC_STATE_FILE, { baseDir: BaseDirectory.AppData });
      if (!present) {
        return EMPTY_STATE;
      }
      const raw = await readTextFile(WECHAT_SYNC_STATE_FILE, { baseDir: BaseDirectory.AppData });
      const parsed = JSON.parse(raw) as Partial<WechatSyncState>;
      return {
        syncBuf: parsed.syncBuf || '',
        updatedAt: parsed.updatedAt || 0,
        lastMessageId: parsed.lastMessageId,
      };
    } catch (error) {
      logger.warn('[WechatSyncStateStore] Failed to load state', error);
      return EMPTY_STATE;
    }
  }

  async save(state: WechatSyncState): Promise<void> {
    await ensureWechatFileDir(WECHAT_SYNC_STATE_FILE);
    await writeTextFile(WECHAT_SYNC_STATE_FILE, JSON.stringify(state, null, 2), {
      baseDir: BaseDirectory.AppData,
    });
  }
}

export const wechatSyncStateStore = new WechatSyncStateStore();
