import type {
  RemoteAgentConfig,
  RemoteAgentsConfiguration,
} from '@talkcody/shared/types/remote-agents';
import { getApiUrl } from '@/lib/config';
import { logger } from '@/lib/logger';
import { simpleFetch } from '@/lib/tauri-fetch';
import { remoteAgentsLoader } from '@/providers/remote-agents/remote-agents-loader';

const VERSION_ENDPOINT = '/api/remote-agents/version';
const CONFIGS_ENDPOINT = '/api/remote-agents/configs';

// Check interval: 1 hour
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

/**
 * RemoteAgentsSyncService handles version checking and automatic updates
 * of remote agents configurations from the remote API
 */
class RemoteAgentsSyncService {
  private checkInterval: number | null = null;
  private isCheckingUpdate = false;

  /**
   * Initialize the sync service
   * Call this on app startup (non-blocking)
   */
  async initialize(): Promise<void> {
    // Check for updates on startup (async, non-blocking)
    this.checkForUpdates().catch((err) => {
      logger.warn('Initial remote agents update check failed:', err);
    });

    // Start background sync
    this.startBackgroundSync();
  }

  /**
   * Check if remote has newer version and update if needed
   * @returns true if update was performed, false otherwise
   */
  async checkForUpdates(): Promise<boolean> {
    // Prevent concurrent checks
    if (this.isCheckingUpdate) {
      logger.info('Remote agents update check already in progress');
      return false;
    }

    this.isCheckingUpdate = true;

    try {
      const localVersion = await remoteAgentsLoader.getVersion();
      const remoteVersion = await this.fetchRemoteVersion();

      // Compare versions (ISO 8601 string comparison works correctly)
      if (!localVersion || remoteVersion.version > localVersion) {
        logger.info(`Updating remote agents: ${localVersion || 'none'} → ${remoteVersion.version}`);
        await this.downloadAndUpdate();
        return true;
      } else {
        logger.info(`Remote agents are up to date (${localVersion})`);
        return false;
      }
    } catch (error) {
      logger.error('Failed to check for remote agents updates:', error);
      // Don't throw - graceful degradation
      return false;
    } finally {
      this.isCheckingUpdate = false;
    }
  }

  /**
   * Fetch remote version info
   */
  private async fetchRemoteVersion(): Promise<{ version: string }> {
    const url = getApiUrl(VERSION_ENDPOINT);
    const response = await simpleFetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch version: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Download and update remote agents configuration
   */
  private async downloadAndUpdate(): Promise<void> {
    const url = getApiUrl(CONFIGS_ENDPOINT);
    const response = await simpleFetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch configs: ${response.status} ${response.statusText}`);
    }

    const config: RemoteAgentsConfiguration = await response.json();

    // Validate and save to file cache
    await remoteAgentsLoader.update(config);
    logger.info(`Remote agents updated successfully to version ${config.version}`);

    // Notify UI components that remote agents have been updated
    window.dispatchEvent(new CustomEvent('remoteAgentsUpdated'));
    logger.info('Remote agents updated and UI notified');
  }

  /**
   * Start background sync (checks every hour)
   */
  startBackgroundSync(): void {
    if (this.checkInterval !== null) {
      logger.warn('Background sync already started');
      return;
    }

    this.checkInterval = window.setInterval(() => {
      this.checkForUpdates().catch((err) => {
        logger.warn('Background remote agents update check failed:', err);
      });
    }, CHECK_INTERVAL_MS);

    logger.info('Started background remote agents sync (1 hour interval)');
  }

  /**
   * Stop background sync
   */
  stopBackgroundSync(): void {
    if (this.checkInterval !== null) {
      window.clearInterval(this.checkInterval);
      this.checkInterval = null;
      logger.info('Stopped background remote agents sync');
    }
  }

  /**
   * Manually trigger update check (for UI button)
   */
  async manualRefresh(): Promise<boolean> {
    logger.info('Manual remote agents refresh triggered');
    return await this.checkForUpdates();
  }

  /**
   * Get current sync status
   */
  getStatus(): { isChecking: boolean; hasBackgroundSync: boolean } {
    return {
      isChecking: this.isCheckingUpdate,
      hasBackgroundSync: this.checkInterval !== null,
    };
  }
}

// Export singleton instance
export const remoteAgentsSyncService = new RemoteAgentsSyncService();
export default remoteAgentsSyncService;
