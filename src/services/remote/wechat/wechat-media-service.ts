import { join } from '@tauri-apps/api/path';
import { BaseDirectory, readFile, writeFile } from '@tauri-apps/plugin-fs';
import { logger } from '@/lib/logger';
import { decryptAes128Ecb } from '@/services/remote/wechat/wechat-crypto';
import { ensureWechatDir, resolveWechatAppDataPath } from '@/services/remote/wechat/wechat-paths';
import {
  type ILinkMedia,
  WECHAT_MEDIA_DIR,
  type WechatMediaDownloadResult,
} from '@/services/remote/wechat/wechat-types';

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'attachment';
}

function inferMimeType(filename: string, fallback: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.silk')) return 'audio/silk';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  return fallback;
}

export class WechatMediaService {
  async saveDecryptedMedia(params: {
    messageId: string;
    filename: string;
    encryptedBytes: Uint8Array;
    media: ILinkMedia;
    fallbackMimeType: string;
  }): Promise<WechatMediaDownloadResult> {
    if (!params.media.aes_key) {
      throw new Error('Missing AES key for WeChat media');
    }

    const decrypted = decryptAes128Ecb(params.encryptedBytes, params.media.aes_key);
    await ensureWechatDir(WECHAT_MEDIA_DIR);

    const safeFilename = sanitizeFilename(params.filename);
    const relativePath = await join(WECHAT_MEDIA_DIR, `${params.messageId}-${safeFilename}`);
    await writeFile(relativePath, decrypted, { baseDir: BaseDirectory.AppData });
    const filePath = await resolveWechatAppDataPath(relativePath);

    return {
      filePath,
      filename: safeFilename,
      mimeType: inferMimeType(safeFilename, params.fallbackMimeType),
      size: decrypted.length,
    };
  }

  async readSavedMedia(relativePath: string): Promise<Uint8Array> {
    return readFile(relativePath, { baseDir: BaseDirectory.AppData });
  }

  logDownloadFailure(messageId: string, error: unknown): void {
    logger.warn('[WechatMediaService] Failed to process media', { messageId, error });
  }
}

export const wechatMediaService = new WechatMediaService();
