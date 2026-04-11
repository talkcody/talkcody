import { BaseDirectory, exists, readTextFile, remove, writeTextFile } from '@tauri-apps/plugin-fs';
import { logger } from '@/lib/logger';
import { ensureWechatFileDir } from '@/services/remote/wechat/wechat-paths';
import {
  WECHAT_BASE_URL,
  WECHAT_CREDENTIALS_FILE,
  type WechatStoredCredentials,
} from '@/services/remote/wechat/wechat-types';

class WechatCredentialsStore {
  async load(): Promise<WechatStoredCredentials | null> {
    try {
      const present = await exists(WECHAT_CREDENTIALS_FILE, { baseDir: BaseDirectory.AppData });
      if (!present) {
        return null;
      }
      const raw = await readTextFile(WECHAT_CREDENTIALS_FILE, { baseDir: BaseDirectory.AppData });
      const parsed = JSON.parse(raw) as Partial<WechatStoredCredentials>;
      if (!parsed.botToken || !parsed.botId || !parsed.ilinkUserId) {
        return null;
      }
      return {
        botToken: parsed.botToken,
        botId: parsed.botId,
        ilinkUserId: parsed.ilinkUserId,
        baseUrl: parsed.baseUrl || WECHAT_BASE_URL,
        updatedAt: parsed.updatedAt || Date.now(),
      };
    } catch (error) {
      logger.warn('[WechatCredentialsStore] Failed to load credentials', error);
      return null;
    }
  }

  async save(credentials: WechatStoredCredentials): Promise<void> {
    await ensureWechatFileDir(WECHAT_CREDENTIALS_FILE);
    await writeTextFile(WECHAT_CREDENTIALS_FILE, JSON.stringify(credentials, null, 2), {
      baseDir: BaseDirectory.AppData,
    });
  }

  async clear(): Promise<void> {
    const present = await exists(WECHAT_CREDENTIALS_FILE, { baseDir: BaseDirectory.AppData });
    if (present) {
      await remove(WECHAT_CREDENTIALS_FILE, { baseDir: BaseDirectory.AppData });
    }
  }
}

export const wechatCredentialsStore = new WechatCredentialsStore();
