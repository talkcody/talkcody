import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const acquireSleepPrevention = vi.fn().mockResolvedValue(undefined);
  const releaseSleepPrevention = vi.fn().mockResolvedValue(undefined);
  const remoteChatServiceStart = vi.fn().mockResolvedValue(undefined);
  const remoteChatServiceStop = vi.fn().mockResolvedValue(undefined);
  const remoteChatServiceStartChannel = vi.fn().mockResolvedValue(undefined);
  const remoteChatServiceStopChannel = vi.fn().mockResolvedValue(undefined);
  const settingsManagerInitialize = vi.fn().mockResolvedValue(undefined);
  const useSettingsStore = Object.assign(vi.fn(), {
    getState: vi.fn(),
  });

  return {
    acquireSleepPrevention,
    releaseSleepPrevention,
    remoteChatServiceStart,
    remoteChatServiceStop,
    remoteChatServiceStartChannel,
    remoteChatServiceStopChannel,
    settingsManagerInitialize,
    useSettingsStore,
  };
});

vi.mock('@/services/keep-awake-service', () => ({
  acquireSleepPrevention: mocks.acquireSleepPrevention,
  releaseSleepPrevention: mocks.releaseSleepPrevention,
}));

vi.mock('@/services/remote/remote-chat-service', () => ({
  remoteChatService: {
    start: mocks.remoteChatServiceStart,
    stop: mocks.remoteChatServiceStop,
    startChannel: mocks.remoteChatServiceStartChannel,
    stopChannel: mocks.remoteChatServiceStopChannel,
  },
}));

vi.mock('@/stores/settings-store', () => ({
  settingsManager: {
    initialize: mocks.settingsManagerInitialize,
  },
  useSettingsStore: mocks.useSettingsStore,
}));

import { remoteControlLifecycleService } from '@/services/remote/remote-control-lifecycle-service';

describe('remote-control-lifecycle-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const service = remoteControlLifecycleService as {
      isEnabled: boolean;
      keepAwakeActive: boolean;
      lastEnabledChannels: {
        telegram: boolean;
        feishu: boolean;
        wechat: boolean;
      };
    };
    service.isEnabled = false;
    service.keepAwakeActive = false;
    service.lastEnabledChannels = {
      telegram: false,
      feishu: false,
      wechat: false,
    };
  });

  it('acquires keep-awake only when remote control is enabled', async () => {
    mocks.useSettingsStore.getState.mockReturnValue({
      telegram_remote_enabled: true,
      feishu_remote_enabled: false,
      wechat_remote_enabled: false,
      remote_control_keep_awake: true,
    });

    await remoteControlLifecycleService.initialize();

    expect(mocks.acquireSleepPrevention).toHaveBeenCalledTimes(1);
    expect(mocks.releaseSleepPrevention).not.toHaveBeenCalled();
    expect(mocks.remoteChatServiceStart).toHaveBeenCalledTimes(1);
  });

  it('releases keep-awake when remote control is disabled', async () => {
    const service = remoteControlLifecycleService as {
      keepAwakeActive: boolean;
      isEnabled: boolean;
      lastEnabledChannels: {
        telegram: boolean;
        feishu: boolean;
        wechat: boolean;
      };
    };
    service.keepAwakeActive = true;
    service.isEnabled = true;
    service.lastEnabledChannels = {
      telegram: true,
      feishu: false,
      wechat: false,
    };

    mocks.useSettingsStore.getState.mockReturnValue({
      telegram_remote_enabled: false,
      feishu_remote_enabled: false,
      wechat_remote_enabled: false,
      remote_control_keep_awake: true,
    });

    await remoteControlLifecycleService.refresh();

    expect(mocks.acquireSleepPrevention).not.toHaveBeenCalled();
    expect(mocks.releaseSleepPrevention).toHaveBeenCalledTimes(1);
    expect(mocks.remoteChatServiceStop).toHaveBeenCalledTimes(1);
  });

  it('stops only Telegram when disabled while another channel stays enabled', async () => {
    mocks.useSettingsStore.getState.mockReturnValue({
      telegram_remote_enabled: true,
      feishu_remote_enabled: true,
      wechat_remote_enabled: false,
      remote_control_keep_awake: true,
    });
    await remoteControlLifecycleService.initialize();

    vi.clearAllMocks();
    mocks.useSettingsStore.getState.mockReturnValue({
      telegram_remote_enabled: false,
      feishu_remote_enabled: true,
      wechat_remote_enabled: false,
      remote_control_keep_awake: true,
    });

    await remoteControlLifecycleService.refresh();

    expect(mocks.remoteChatServiceStopChannel).toHaveBeenCalledTimes(1);
    expect(mocks.remoteChatServiceStopChannel).toHaveBeenCalledWith('telegram');
    expect(mocks.remoteChatServiceStartChannel).not.toHaveBeenCalled();
    expect(mocks.remoteChatServiceStart).not.toHaveBeenCalled();
    expect(mocks.remoteChatServiceStop).not.toHaveBeenCalled();
  });

  it('starts only Telegram when enabled while remote control is already running', async () => {
    mocks.useSettingsStore.getState.mockReturnValue({
      telegram_remote_enabled: false,
      feishu_remote_enabled: true,
      wechat_remote_enabled: false,
      remote_control_keep_awake: true,
    });
    await remoteControlLifecycleService.initialize();

    vi.clearAllMocks();
    mocks.useSettingsStore.getState.mockReturnValue({
      telegram_remote_enabled: true,
      feishu_remote_enabled: true,
      wechat_remote_enabled: false,
      remote_control_keep_awake: true,
    });

    await remoteControlLifecycleService.refresh();

    expect(mocks.remoteChatServiceStartChannel).toHaveBeenCalledTimes(1);
    expect(mocks.remoteChatServiceStartChannel).toHaveBeenCalledWith('telegram');
    expect(mocks.remoteChatServiceStopChannel).not.toHaveBeenCalled();
    expect(mocks.remoteChatServiceStart).not.toHaveBeenCalled();
    expect(mocks.remoteChatServiceStop).not.toHaveBeenCalled();
  });
});
