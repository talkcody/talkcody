import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const invoke = vi.fn();
  const listen = vi.fn().mockResolvedValue(vi.fn());
  const useSettingsStore = Object.assign(vi.fn(), {
    getState: vi.fn(),
  });

  return {
    invoke,
    listen,
    useSettingsStore,
  };
});

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: mocks.listen,
}));

vi.mock('@/stores/settings-store', () => ({
  useSettingsStore: mocks.useSettingsStore,
}));

import { TelegramChannelAdapter } from '@/services/remote/channels/telegram-channel-adapter';

describe('telegram-channel-adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('pushes disabled config and stops the gateway when Telegram is turned off', async () => {
    mocks.useSettingsStore.getState.mockReturnValue({
      telegram_remote_enabled: false,
      telegram_remote_token: ' bot-token ',
      telegram_remote_allowed_chats: '123, 456',
      telegram_remote_poll_timeout: '25',
    });

    const adapter = new TelegramChannelAdapter();
    await adapter.start();

    expect(mocks.invoke).toHaveBeenNthCalledWith(1, 'telegram_set_config', {
      config: {
        enabled: false,
        token: 'bot-token',
        allowedChatIds: [123, 456],
        pollTimeoutSecs: 25,
      },
    });
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, 'telegram_stop');
    expect(mocks.invoke).not.toHaveBeenCalledWith('telegram_start');
  });

  it('starts the gateway after syncing enabled config', async () => {
    mocks.useSettingsStore.getState.mockReturnValue({
      telegram_remote_enabled: true,
      telegram_remote_token: ' bot-token ',
      telegram_remote_allowed_chats: '',
      telegram_remote_poll_timeout: '30',
    });

    const adapter = new TelegramChannelAdapter();
    await adapter.start();

    expect(mocks.invoke).toHaveBeenNthCalledWith(1, 'telegram_set_config', {
      config: {
        enabled: true,
        token: 'bot-token',
        allowedChatIds: [],
        pollTimeoutSecs: 30,
      },
    });
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, 'telegram_start');
    expect(mocks.invoke).not.toHaveBeenCalledWith('telegram_stop');
  });
});
