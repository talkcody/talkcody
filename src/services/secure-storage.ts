import { BaseDirectory, exists, readTextFile, remove, writeTextFile } from '@tauri-apps/plugin-fs';
import { logger } from '@/lib/logger';

const AUTH_FILE_NAME = 'talkcody-auth.dat';
const LEGACY_AUTH_FILE_NAME = 'talkcody-auth.json';

interface AuthData {
  auth_token?: string;
}

class SecureStorageService {
  private async readAuthDataFile(fileName: string): Promise<AuthData | null> {
    try {
      const fileExists = await exists(fileName, { baseDir: BaseDirectory.AppData });
      if (!fileExists) {
        return null;
      }
      const content = await readTextFile(fileName, { baseDir: BaseDirectory.AppData });
      return JSON.parse(content) as AuthData;
    } catch (error) {
      logger.error('[Secure Storage] Failed to read auth data from', fileName, error);
      return null;
    }
  }

  private async removeAuthFile(fileName: string): Promise<void> {
    const fileExists = await exists(fileName, { baseDir: BaseDirectory.AppData });
    if (fileExists) {
      await remove(fileName, { baseDir: BaseDirectory.AppData });
    }
  }

  private async removeLegacyAuthFile(): Promise<void> {
    await this.removeAuthFile(LEGACY_AUTH_FILE_NAME);
  }

  private async readAuthData(): Promise<AuthData> {
    try {
      const currentData = await this.readAuthDataFile(AUTH_FILE_NAME);
      if (currentData) {
        return currentData;
      }

      const legacyData = await this.readAuthDataFile(LEGACY_AUTH_FILE_NAME);
      if (legacyData) {
        await this.writeAuthData(legacyData);
        await this.removeLegacyAuthFile();
        return legacyData;
      }

      return {};
    } catch (error) {
      logger.error('Failed to read auth data:', error);
      return {};
    }
  }

  private async writeAuthData(data: AuthData): Promise<void> {
    await writeTextFile(AUTH_FILE_NAME, JSON.stringify(data, null, 2), {
      baseDir: BaseDirectory.AppData,
    });
  }

  async setAuthToken(token: string): Promise<void> {
    const data = await this.readAuthData();
    data.auth_token = token;
    await this.writeAuthData(data);
    await this.removeLegacyAuthFile();
  }

  async getAuthToken(): Promise<string | null> {
    try {
      const data = await this.readAuthData();
      return data.auth_token || null;
    } catch (error) {
      logger.error('Failed to get auth token:', error);
      return null;
    }
  }

  async removeAuthToken(): Promise<void> {
    try {
      await this.removeAuthFile(AUTH_FILE_NAME);
      await this.removeLegacyAuthFile();
    } catch (error) {
      logger.error('Failed to remove auth token:', error);
    }
  }

  async hasAuthToken(): Promise<boolean> {
    const token = await this.getAuthToken();
    return token !== null && token.length > 0;
  }
}

export const secureStorage = new SecureStorageService();
