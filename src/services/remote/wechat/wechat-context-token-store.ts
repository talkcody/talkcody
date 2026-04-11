import { BaseDirectory, exists, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { logger } from '@/lib/logger';
import { ensureWechatFileDir } from '@/services/remote/wechat/wechat-paths';
import {
  WECHAT_CONTEXT_TOKENS_FILE,
  type WechatContextTokenEntry,
} from '@/services/remote/wechat/wechat-types';

export type WechatContextTokenMap = Record<string, WechatContextTokenEntry>;

class WechatContextTokenStore {
  private cache: WechatContextTokenMap | null = null;

  private async ensureLoaded(): Promise<WechatContextTokenMap> {
    if (this.cache) {
      return this.cache;
    }

    try {
      const present = await exists(WECHAT_CONTEXT_TOKENS_FILE, { baseDir: BaseDirectory.AppData });
      if (!present) {
        this.cache = {};
        return this.cache;
      }
      const raw = await readTextFile(WECHAT_CONTEXT_TOKENS_FILE, {
        baseDir: BaseDirectory.AppData,
      });
      this.cache = JSON.parse(raw) as WechatContextTokenMap;
      return this.cache;
    } catch (error) {
      logger.warn('[WechatContextTokenStore] Failed to load context tokens', error);
      this.cache = {};
      return this.cache;
    }
  }

  private async persist(): Promise<void> {
    await ensureWechatFileDir(WECHAT_CONTEXT_TOKENS_FILE);
    await writeTextFile(WECHAT_CONTEXT_TOKENS_FILE, JSON.stringify(this.cache ?? {}, null, 2), {
      baseDir: BaseDirectory.AppData,
    });
  }

  async get(chatId: string): Promise<WechatContextTokenEntry | null> {
    const store = await this.ensureLoaded();
    const entry = store[chatId];
    if (!entry) {
      return null;
    }
    if (entry.expiresAt <= Date.now()) {
      delete store[chatId];
      await this.persist();
      return null;
    }
    return entry;
  }

  async set(chatId: string, entry: WechatContextTokenEntry): Promise<void> {
    const store = await this.ensureLoaded();
    store[chatId] = entry;
    await this.persist();
  }

  async remove(chatId: string): Promise<void> {
    const store = await this.ensureLoaded();
    delete store[chatId];
    await this.persist();
  }

  async pruneExpired(now: number = Date.now()): Promise<void> {
    const store = await this.ensureLoaded();
    let changed = false;
    for (const [chatId, entry] of Object.entries(store)) {
      if (entry.expiresAt <= now) {
        delete store[chatId];
        changed = true;
      }
    }
    if (changed) {
      await this.persist();
    }
  }

  async countActive(now: number = Date.now()): Promise<number> {
    await this.pruneExpired(now);
    const store = await this.ensureLoaded();
    return Object.keys(store).length;
  }

  resetForTests(): void {
    this.cache = null;
  }
}

export const wechatContextTokenStore = new WechatContextTokenStore();
