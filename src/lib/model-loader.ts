import modelsDefault from '@talkcody/shared/data/models-config.json';
import { BaseDirectory, exists, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { logger } from '@/lib/logger';
import { customModelService } from '@/services/custom-model-service';
import type { ModelsConfiguration } from '@/types/models';

const MODELS_CACHE_FILENAME = 'models-cache.json';

/**
 * ModelLoader handles loading and caching of model configurations
 * Priority: Memory → File Cache → Default JSON
 */
class ModelLoader {
  private memoryCache: ModelsConfiguration | null = null;
  private cacheFilePath: string | null = null;

  /**
   * Load models configuration with fallback chain
   * Merges server/cached config with user's custom models
   */
  async load(): Promise<ModelsConfiguration> {
    // Return memory cache if available
    if (this.memoryCache) {
      return this.memoryCache;
    }

    // Load server/cached config
    let serverConfig: ModelsConfiguration;
    try {
      serverConfig = await this.loadFromFile();
    } catch (error) {
      logger.warn('Failed to load models cache file, using default:', error);
      serverConfig = modelsDefault as ModelsConfiguration;
    }

    // Load custom models
    let customConfig: ModelsConfiguration;
    try {
      customConfig = await customModelService.getCustomModels();
    } catch (error) {
      logger.warn('Failed to load custom models:', error);
      customConfig = { version: 'custom', models: {} };
    }

    // Merge configs (custom models take precedence)
    const mergedConfig: ModelsConfiguration = {
      version: serverConfig.version,
      models: {
        ...serverConfig.models,
        ...customConfig.models,
      },
    };

    this.memoryCache = mergedConfig;
    return mergedConfig;
  }

  /**
   * Load models configuration from cache file
   */
  private async loadFromFile(): Promise<ModelsConfiguration> {
    const filePath = await this.getCacheFilePath();

    const fileExists = await exists(filePath, { baseDir: BaseDirectory.AppData });
    if (!fileExists) {
      throw new Error('Cache file does not exist');
    }

    const content = await readTextFile(filePath, { baseDir: BaseDirectory.AppData });
    const config = JSON.parse(content) as ModelsConfiguration;

    // Validate structure
    if (!this.validateConfig(config)) {
      throw new Error('Invalid models configuration structure');
    }

    return config;
  }

  /**
   * Validate models configuration structure
   */
  private validateConfig(config: ModelsConfiguration): boolean {
    if (!config.version || !config.models) {
      return false;
    }

    for (const [key, model] of Object.entries(config.models)) {
      if (!model.name || !Array.isArray(model.providers)) {
        logger.warn(`Invalid model config for key: ${key}`);
        return false;
      }
    }

    return true;
  }

  /**
   * Update models configuration (save to file and memory)
   */
  async update(config: ModelsConfiguration): Promise<void> {
    // Validate before saving
    if (!this.validateConfig(config)) {
      throw new Error('Invalid models configuration structure');
    }

    const filePath = await this.getCacheFilePath();
    const content = JSON.stringify(config, null, 2);

    try {
      await writeTextFile(filePath, content, { baseDir: BaseDirectory.AppData });

      // Clear memory cache to ensure fresh load next time
      // This is important for hot-reload: the caller should use refreshModelConfigs()
      this.memoryCache = null;

      logger.info('Model configuration updated successfully');
    } catch (error) {
      logger.error('Failed to write models cache:', error);
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
      return (modelsDefault as ModelsConfiguration).version;
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
    this.cacheFilePath = MODELS_CACHE_FILENAME;
    return this.cacheFilePath;
  }

  /**
   * Get default configuration (useful for testing)
   */
  getDefaultConfig(): ModelsConfiguration {
    return modelsDefault as ModelsConfiguration;
  }
}

// Export singleton instance
export const modelLoader = new ModelLoader();
export default modelLoader;
