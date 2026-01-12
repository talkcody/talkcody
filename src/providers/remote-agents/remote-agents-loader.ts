import remoteAgentsDefault from '@talkcody/shared/data/remote-agents-config.json';
import type { RemoteAgentsConfiguration } from '@talkcody/shared/types/remote-agents';
import { BaseDirectory, exists, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { logger } from '@/lib/logger';

const REMOTE_AGENTS_CACHE_FILENAME = 'remote-agents-cache.json';

/**
 * RemoteAgentsLoader handles loading and caching of remote agents configurations
 * Priority: Memory → File Cache → Default JSON
 */
class RemoteAgentsLoader {
  private memoryCache: RemoteAgentsConfiguration | null = null;
  private cacheFilePath: string | null = null;

  /**
   * Load remote agents configuration with fallback chain
   */
  async load(): Promise<RemoteAgentsConfiguration> {
    // Return memory cache if available
    if (this.memoryCache) {
      return this.memoryCache;
    }

    // Try to load from file cache
    try {
      const config = await this.loadFromFile();
      this.memoryCache = config;
      return config;
    } catch (error) {
      logger.warn('Failed to load remote agents cache file, using default:', error);
      const defaultConfig = remoteAgentsDefault as RemoteAgentsConfiguration;
      this.memoryCache = defaultConfig;
      return defaultConfig;
    }
  }

  /**
   * Load remote agents configuration from cache file
   */
  private async loadFromFile(): Promise<RemoteAgentsConfiguration> {
    const filePath = await this.getCacheFilePath();

    const fileExists = await exists(filePath, { baseDir: BaseDirectory.AppData });
    if (!fileExists) {
      throw new Error('Cache file does not exist');
    }

    const content = await readTextFile(filePath, { baseDir: BaseDirectory.AppData });
    const config = JSON.parse(content) as RemoteAgentsConfiguration;

    // Validate structure
    if (!this.validateConfig(config)) {
      throw new Error('Invalid remote agents configuration structure');
    }

    return config;
  }

  /**
   * Validate remote agents configuration structure
   */
  private validateConfig(config: RemoteAgentsConfiguration): boolean {
    if (!config.version || !Array.isArray(config.remoteAgents)) {
      return false;
    }

    for (const agent of config.remoteAgents) {
      if (!agent.id || !agent.name || !agent.category || !agent.repository || !agent.githubPath) {
        logger.warn(`Invalid remote agent config: ${agent.id || 'unknown'}`);
        return false;
      }
    }

    return true;
  }

  /**
   * Update remote agents configuration (save to file and memory)
   */
  async update(config: RemoteAgentsConfiguration): Promise<void> {
    // Validate before saving
    if (!this.validateConfig(config)) {
      throw new Error('Invalid remote agents configuration structure');
    }

    const filePath = await this.getCacheFilePath();
    const content = JSON.stringify(config, null, 2);

    try {
      await writeTextFile(filePath, content, { baseDir: BaseDirectory.AppData });

      // Clear memory cache to ensure fresh load next time
      this.memoryCache = null;

      logger.info('Remote agents configuration updated successfully');
    } catch (error) {
      logger.error('Failed to write remote agents cache:', error);
      throw error;
    }
  }

  /**
   * Get current version from loaded configuration
   * Falls back to file cache or default config if memory cache is empty
   */
  async getVersion(): Promise<string | null> {
    // Return from memory cache if available
    if (this.memoryCache?.version) {
      return this.memoryCache.version;
    }

    // Try to load from file cache
    try {
      const config = await this.loadFromFile();
      return config.version;
    } catch {
      // Fall back to bundled default version
      return (remoteAgentsDefault as RemoteAgentsConfiguration).version;
    }
  }

  /**
   * Clear memory cache (for testing or manual refresh)
   */
  clearCache(): void {
    this.memoryCache = null;
  }

  /**
   * Get the cache file path
   */
  private async getCacheFilePath(): Promise<string> {
    if (this.cacheFilePath) {
      return this.cacheFilePath;
    }

    // Cache file is stored in app data directory
    this.cacheFilePath = REMOTE_AGENTS_CACHE_FILENAME;
    return this.cacheFilePath;
  }

  /**
   * Get default configuration (useful for testing)
   */
  getDefaultConfig(): RemoteAgentsConfiguration {
    return remoteAgentsDefault as RemoteAgentsConfiguration;
  }
}

// Export singleton instance
export const remoteAgentsLoader = new RemoteAgentsLoader();
export default remoteAgentsLoader;
