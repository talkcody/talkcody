import { logger } from '@/lib/logger';
import { acquireSleepPrevention, releaseSleepPrevention } from '@/services/keep-awake-service';
import { remoteChatService } from '@/services/remote/remote-chat-service';
import { settingsManager, useSettingsStore } from '@/stores/settings-store';
import type { RemoteChannelId } from '@/types/remote-control';

type ManagedRemoteChannelId = Extract<RemoteChannelId, 'telegram' | 'feishu' | 'wechat'>;
const MANAGED_REMOTE_CHANNELS = ['telegram', 'feishu', 'wechat'] as const;

class RemoteControlLifecycleService {
  private static instance: RemoteControlLifecycleService | null = null;
  private isEnabled = false;
  private keepAwakeActive = false;
  private lastEnabledChannels: Record<ManagedRemoteChannelId, boolean> = {
    telegram: false,
    feishu: false,
    wechat: false,
  };

  private constructor() {}

  static getInstance(): RemoteControlLifecycleService {
    if (!RemoteControlLifecycleService.instance) {
      RemoteControlLifecycleService.instance = new RemoteControlLifecycleService();
    }
    return RemoteControlLifecycleService.instance;
  }

  async initialize(): Promise<void> {
    try {
      await settingsManager.initialize();
      const state = useSettingsStore.getState();
      const enabledChannels = this.getEnabledChannels(state);
      this.isEnabled = enabledChannels.any;
      this.lastEnabledChannels = enabledChannels.state;
      await this.applyKeepAwake(this.isEnabled && state.remote_control_keep_awake);

      if (this.isEnabled) {
        await remoteChatService.start();
      }
    } catch (error) {
      logger.warn('[RemoteControlLifecycle] Failed to initialize', error);
    }
  }

  async refresh(): Promise<void> {
    const state = useSettingsStore.getState();
    const enabledChannels = this.getEnabledChannels(state);
    const shouldRun = enabledChannels.any;
    const wasRunning = this.isEnabled;

    await this.applyKeepAwake(shouldRun && state.remote_control_keep_awake);

    if (shouldRun && !wasRunning) {
      await remoteChatService.start();
    } else if (!shouldRun && wasRunning) {
      await remoteChatService.stop();
    } else if (shouldRun) {
      await this.syncChannelState(enabledChannels.state);
    }

    this.isEnabled = shouldRun;
    this.lastEnabledChannels = enabledChannels.state;
  }

  async shutdown(): Promise<void> {
    await remoteChatService.stop();
    if (this.keepAwakeActive) {
      await releaseSleepPrevention();
      this.keepAwakeActive = false;
    }
  }

  private getEnabledChannels(state: ReturnType<typeof useSettingsStore.getState>): {
    any: boolean;
    state: Record<ManagedRemoteChannelId, boolean>;
  } {
    const enabled = {
      telegram: state.telegram_remote_enabled,
      feishu: state.feishu_remote_enabled,
      wechat: state.wechat_remote_enabled,
    };
    return { any: enabled.telegram || enabled.feishu || enabled.wechat, state: enabled };
  }

  private async syncChannelState(next: Record<ManagedRemoteChannelId, boolean>): Promise<void> {
    const changedChannels = MANAGED_REMOTE_CHANNELS.filter(
      (channelId) => this.lastEnabledChannels[channelId] !== next[channelId]
    );

    for (const channelId of changedChannels) {
      if (next[channelId]) {
        await remoteChatService.startChannel(channelId);
        continue;
      }

      await remoteChatService.stopChannel(channelId);
    }
  }

  private async applyKeepAwake(enabled: boolean): Promise<void> {
    if (enabled && !this.keepAwakeActive) {
      await acquireSleepPrevention();
      this.keepAwakeActive = true;
      return;
    }

    if (!enabled && this.keepAwakeActive) {
      await releaseSleepPrevention();
      this.keepAwakeActive = false;
    }
  }
}

export const remoteControlLifecycleService = RemoteControlLifecycleService.getInstance();
