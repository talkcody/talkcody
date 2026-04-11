import { BaseDirectory, exists, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { logger } from '@/lib/logger';
import { ensureWechatFileDir } from '@/services/remote/wechat/wechat-paths';
import {
  WECHAT_STATUS_FILE,
  type WechatStatusSnapshot,
} from '@/services/remote/wechat/wechat-types';

const DEFAULT_STATUS: WechatStatusSnapshot = {
  running: false,
  sessionExpired: false,
  activeContextCount: 0,
};

class WechatStatusStore {
  async load(): Promise<WechatStatusSnapshot> {
    try {
      const present = await exists(WECHAT_STATUS_FILE, { baseDir: BaseDirectory.AppData });
      if (!present) {
        return DEFAULT_STATUS;
      }
      const raw = await readTextFile(WECHAT_STATUS_FILE, { baseDir: BaseDirectory.AppData });
      return {
        ...DEFAULT_STATUS,
        ...(JSON.parse(raw) as Partial<WechatStatusSnapshot>),
      };
    } catch (error) {
      logger.warn('[WechatStatusStore] Failed to load status', error);
      return DEFAULT_STATUS;
    }
  }

  async save(status: WechatStatusSnapshot): Promise<void> {
    await ensureWechatFileDir(WECHAT_STATUS_FILE);
    await writeTextFile(WECHAT_STATUS_FILE, JSON.stringify(status, null, 2), {
      baseDir: BaseDirectory.AppData,
    });
  }
}

export const wechatStatusStore = new WechatStatusStore();
