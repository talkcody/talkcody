import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import { logger } from '@/lib/logger';
import { hookService } from '@/services/hooks/hook-service';
import { telegramRemoteService } from '@/services/remote/telegram-remote-service';
import { settingsManager } from '@/stores/settings-store';

class NotificationService {
  private permissionGranted: boolean | null = null;

  private async ensurePermission(): Promise<boolean> {
    if (this.permissionGranted !== null) {
      return this.permissionGranted;
    }

    try {
      let granted = await isPermissionGranted();

      if (!granted) {
        const permission = await requestPermission();
        granted = permission === 'granted';
      }

      this.permissionGranted = granted;
      return granted;
    } catch (error) {
      logger.error('Failed to check notification permission:', error);
      return false;
    }
  }

  /**
   * Check if the current window is focused
   */
  private async isWindowFocused(): Promise<boolean> {
    try {
      const window = getCurrentWindow();
      const focused = await window.isFocused();
      return focused;
    } catch (error) {
      logger.error('Failed to check window focus:', error);
      // If we can't check, assume focused to avoid spamming notifications
      return true;
    }
  }

  /**
   * Send a notification if the window is not focused
   * @param title Notification title
   * @param body Notification body
   */
  async sendIfNotFocused(title: string, body: string): Promise<void> {
    try {
      // Check if window is focused
      const focused = await this.isWindowFocused();

      if (focused) {
        return;
      }

      // Check permission
      const hasPermission = await this.ensurePermission();

      if (!hasPermission) {
        logger.warn('Notification permission not granted');
        return;
      }

      // Send notification
      await sendNotification({
        title,
        body,
        sound: 'Glass',
      });
    } catch (error) {
      logger.error('Failed to send notification:', error);
    }
  }

  async notifyAgentComplete(): Promise<void> {
    await this.sendIfNotFocused('Task Complete', 'TalkCody agent has finished processing');
  }

  async notifyReviewRequired(): Promise<void> {
    await this.sendIfNotFocused('Review Required', 'File edit needs your approval');
    try {
      await telegramRemoteService.refresh();
    } catch (error) {
      logger.warn('[NotificationService] Remote refresh failed', error);
    }
  }

  async notifyHooked(taskId: string, title: string, body: string, type: string): Promise<void> {
    if (settingsManager.getHooksEnabled()) {
      await hookService.runNotification(taskId, body, type);
    }
    await this.sendIfNotFocused(title, body);
  }
}

export const notificationService = new NotificationService();
