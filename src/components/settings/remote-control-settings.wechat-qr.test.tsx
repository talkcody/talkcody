import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getLocale } from '@/locales';
import { RemoteControlSettings } from '@/components/settings/remote-control-settings';

const { qrCodeToCanvas, mocks } = vi.hoisted(() => ({
  qrCodeToCanvas: vi.fn().mockResolvedValue(undefined),
  mocks: {
    startBind: vi.fn(),
    poll: vi.fn(),
    clear: vi.fn(),
    getCurrentSession: vi.fn(),
    loadCredentials: vi.fn(),
    clearCredentials: vi.fn(),
    refresh: vi.fn().mockResolvedValue(undefined),
    settingsGet: vi.fn(),
    settingsInitialize: vi.fn().mockResolvedValue(undefined),
    settingsSet: vi.fn().mockResolvedValue(undefined),
  },
}));



vi.mock('qrcode', () => ({
  default: {
    toCanvas: qrCodeToCanvas,
  },
}));

vi.mock('@/services/remote/wechat/wechat-bind-service', () => ({
  wechatBindService: {
    startBind: mocks.startBind,
    poll: mocks.poll,
    clear: mocks.clear,
    getCurrentSession: mocks.getCurrentSession,
  },
}));

vi.mock('@/services/remote/wechat/wechat-credentials-store', () => ({
  wechatCredentialsStore: {
    load: mocks.loadCredentials,
    clear: mocks.clearCredentials,
  },
}));

vi.mock('@/services/remote/remote-control-lifecycle-service', () => ({
  remoteControlLifecycleService: {
    refresh: mocks.refresh,
  },
}));

vi.mock('@/hooks/use-locale', () => ({
  useLocale: () => ({
    t: getLocale('en'),
  }),
}));

vi.mock('@/stores/settings-store', () => ({
  settingsManager: {
    get: mocks.settingsGet,
    initialize: mocks.settingsInitialize,
    set: mocks.settingsSet,
    setTelegramRemoteEnabled: vi.fn().mockResolvedValue(false),
    setFeishuRemoteEnabled: vi.fn().mockResolvedValue(false),
    setFeishuRemoteAppId: vi.fn().mockResolvedValue(undefined),
    setFeishuRemoteAppSecret: vi.fn().mockResolvedValue(undefined),
    setFeishuRemoteEncryptKey: vi.fn().mockResolvedValue(undefined),
    setFeishuRemoteVerificationToken: vi.fn().mockResolvedValue(undefined),
    setFeishuRemoteAllowedOpenIds: vi.fn().mockResolvedValue(undefined),
    setWechatRemoteEnabled: vi.fn().mockResolvedValue(true),
    setWechatRemoteBaseUrl: vi.fn().mockResolvedValue(undefined),
    setWechatRemoteAllowedUserIds: vi.fn().mockResolvedValue(undefined),
    setWechatRemotePollTimeoutMs: vi.fn().mockResolvedValue(undefined),
    setWechatRemoteBotToken: vi.fn().mockResolvedValue(undefined),
    setWechatRemoteBotId: vi.fn().mockResolvedValue(undefined),
    setWechatRemoteIlinkUserId: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('RemoteControlSettings WeChat QR', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.settingsGet.mockImplementation((key: string) => {
      const defaults: Record<string, string> = {
        telegram_remote_enabled: 'false',
        telegram_remote_token: '',
        telegram_remote_allowed_chats: '',
        telegram_remote_poll_timeout: '25',
        feishu_remote_enabled: 'false',
        feishu_remote_app_id: '',
        feishu_remote_app_secret: '',
        feishu_remote_encrypt_key: '',
        feishu_remote_verification_token: '',
        feishu_remote_allowed_open_ids: '',
        wechat_remote_enabled: 'true',
        wechat_remote_base_url: 'https://ilinkai.weixin.qq.com',
        wechat_remote_allowed_user_ids: '',
        wechat_remote_poll_timeout_ms: '35000',
        remote_control_keep_awake: 'true',
      };
      return defaults[key] ?? '';
    });
    mocks.startBind.mockResolvedValue({
      sessionId: 'session-1',
      qrCode: 'wechat-qr-token',
      qrImageUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',
      status: 'wait',
      createdAt: Date.now(),
    });
    mocks.getCurrentSession.mockReturnValue(null);
    mocks.loadCredentials.mockResolvedValue(null);
    mocks.clearCredentials.mockResolvedValue(undefined);
  });

  it('auto-saves confirmed WeChat sessions and refreshes the lifecycle service', async () => {
    mocks.startBind.mockResolvedValueOnce({
      sessionId: 'session-confirmed',
      qrCode: 'wechat-qr-token-confirmed',
      qrImageUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',
      status: 'confirmed',
      createdAt: Date.now(),
      credentials: {
        botToken: 'bot-token',
        botId: 'bot-id',
        ilinkUserId: 'ilink-user-id',
        baseUrl: 'https://ilinkai.weixin.qq.com',
        updatedAt: Date.now(),
      },
    });

    render(<RemoteControlSettings />);

    fireEvent.click(screen.getByRole('button', { name: 'Connect WeChat' }));

    await waitFor(() => {
      expect(mocks.refresh).toHaveBeenCalled();
    });
  });

  it('renders image payloads returned by the bind service without re-encoding them', async () => {
    render(<RemoteControlSettings />);

    fireEvent.click(screen.getByRole('button', { name: 'Connect WeChat' }));

    await waitFor(() => {
      expect(mocks.startBind).toHaveBeenCalled();
    });

    const image = await screen.findByAltText('WeChat QR');
    expect(image).toHaveAttribute(
      'src',
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB'
    );
    expect(qrCodeToCanvas).not.toHaveBeenCalled();
  });

  it('renders QR text payloads to a canvas so they remain scannable', async () => {
    mocks.startBind.mockResolvedValueOnce({
      sessionId: 'session-2',
      qrCode: 'wechat-qr-token-2',
      qrImageUrl: 'https://ilinkai.weixin.qq.com/connect?uuid=abc123',
      status: 'wait',
      createdAt: Date.now(),
    });

    render(<RemoteControlSettings />);

    fireEvent.click(screen.getByRole('button', { name: 'Connect WeChat' }));

    const canvas = await screen.findByLabelText('WeChat QR');
    expect(canvas.tagName).toBe('CANVAS');

    await waitFor(() => {
      expect(qrCodeToCanvas).toHaveBeenCalledWith(
        expect.any(HTMLCanvasElement),
        'https://ilinkai.weixin.qq.com/connect?uuid=abc123',
        { width: 192, margin: 1 }
      );
    });
  });
});
