import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import { logger } from '@/lib/logger';
import { hookService } from '@/services/hooks/hook-service';
import { remoteControlLifecycleService } from '@/services/remote/remote-control-lifecycle-service';
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

  private async isWindowFocused(): Promise<boolean> {
    try {
      return await getCurrentWindow().isFocused();
    } catch (error) {
      logger.error('Failed to check window focus:', error);
      return true;
    }
  }

  async sendIfNotFocused(title: string, body: string): Promise<void> {
    try {
      if (await this.isWindowFocused()) {
        return;
      }
      const hasPermission = await this.ensurePermission();
      if (!hasPermission) {
        logger.warn('Notification permission not granted');
        return;
      }
      await sendNotification({ title, body, sound: 'Glass' });
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
      await remoteControlLifecycleService.refresh();
    } catch (error) {
      logger.warn('[NotificationService] Remote refresh failed', error);
    }
  }

  async notifyScheduledTaskResult(params: {
    taskName: string;
    success: boolean;
    body?: string;
  }): Promise<void> {
    const title = params.success ? 'Scheduled Task Complete' : 'Scheduled Task Failed';
    const body =
      params.body ?? `${params.taskName} ${params.success ? 'completed successfully' : 'failed'}`;
    await this.sendIfNotFocused(title, body);
  }

  async notifyHooked(taskId: string, title: string, body: string, type: string): Promise<void> {
    if (settingsManager.getHooksEnabled()) {
      await hookService.runNotification(taskId, body, type);
    }
    await this.sendIfNotFocused(title, body);
  }
}

export const notificationService = new NotificationService();
