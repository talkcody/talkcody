import { appDataDir, dirname, join } from '@tauri-apps/api/path';
import { BaseDirectory, exists, mkdir } from '@tauri-apps/plugin-fs';

export async function ensureWechatDir(relativeDir: string): Promise<void> {
  const present = await exists(relativeDir, { baseDir: BaseDirectory.AppData });
  if (!present) {
    await mkdir(relativeDir, { baseDir: BaseDirectory.AppData, recursive: true });
  }
}

export async function ensureWechatFileDir(relativeFilePath: string): Promise<void> {
  const parent = await dirname(relativeFilePath);
  await ensureWechatDir(parent);
}

export async function resolveWechatAppDataPath(relativePath: string): Promise<string> {
  const appDir = await appDataDir();
  return join(appDir, relativePath);
}
