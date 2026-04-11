import { beforeEach, describe, expect, it, vi } from 'vitest';

const { simpleFetch } = vi.hoisted(() => ({
  simpleFetch: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  readFile: vi.fn(),
}));

vi.mock('@/lib/tauri-fetch', () => ({
  simpleFetch,
}));

import { WechatIlinkClient } from '@/services/remote/wechat/wechat-ilink-client';

describe('wechat-ilink-client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('adds the required client version header when polling QR status', async () => {
    simpleFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 'wait' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const client = new WechatIlinkClient({
      botToken: '',
      botId: '',
      ilinkUserId: '',
      baseUrl: 'https://ilinkai.weixin.qq.com',
      updatedAt: Date.now(),
    });

    await client.pollQrStatus('qr-token');

    expect(simpleFetch).toHaveBeenCalledWith(
      'https://ilinkai.weixin.qq.com/ilink/bot/get_qrcode_status?qrcode=qr-token',
      {
        headers: {
          'iLink-App-ClientVersion': '1',
        },
      }
    );
  });
});
