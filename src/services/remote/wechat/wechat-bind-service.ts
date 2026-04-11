import { logger } from '@/lib/logger';
import { wechatCredentialsStore } from '@/services/remote/wechat/wechat-credentials-store';
import { WechatIlinkClient } from '@/services/remote/wechat/wechat-ilink-client';
import {
  WECHAT_BASE_URL,
  type WechatBindSession,
  type WechatStoredCredentials,
} from '@/services/remote/wechat/wechat-types';

function createSessionId(): string {
  const suffix =
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  return `wechat-bind-${suffix}`;
}

function decodeBase64ToString(value: string): string | null {
  try {
    return atob(value);
  } catch {
    return null;
  }
}

export function normalizeWechatQrImageUrl(qrImageContent?: string): string {
  if (!qrImageContent) {
    return '';
  }

  if (qrImageContent.startsWith('http') || qrImageContent.startsWith('data:')) {
    return qrImageContent;
  }

  const decoded = decodeBase64ToString(qrImageContent)?.trim();
  if (decoded?.startsWith('http')) {
    return decoded;
  }

  return `data:image/png;base64,${qrImageContent}`;
}

class WechatBindService {
  private session: WechatBindSession | null = null;

  async startBind(baseUrl: string = WECHAT_BASE_URL): Promise<WechatBindSession> {
    const client = new WechatIlinkClient({
      botToken: '',
      botId: '',
      ilinkUserId: '',
      baseUrl,
      updatedAt: Date.now(),
    });
    const response = await client.fetchQrCode();
    client.assertSuccess(response, 'Failed to fetch WeChat QR code');

    const session: WechatBindSession = {
      sessionId: createSessionId(),
      qrCode: response.qrcode || '',
      qrImageUrl: normalizeWechatQrImageUrl(response.qrcode_img_content),
      status: 'wait',
      createdAt: Date.now(),
    };
    this.session = session;
    return session;
  }

  async poll(sessionId: string, baseUrl: string = WECHAT_BASE_URL): Promise<WechatBindSession> {
    if (!this.session || this.session.sessionId !== sessionId) {
      throw new Error('WeChat bind session not found');
    }

    const client = new WechatIlinkClient({
      botToken: '',
      botId: '',
      ilinkUserId: '',
      baseUrl,
      updatedAt: Date.now(),
    });
    const response = await client.pollQrStatus(this.session.qrCode);
    const status = response.status === 'scaned' ? 'scanned' : response.status;

    if (
      status === 'confirmed' &&
      response.bot_token &&
      response.ilink_bot_id &&
      response.ilink_user_id
    ) {
      const credentials: WechatStoredCredentials = {
        botToken: response.bot_token,
        botId: response.ilink_bot_id,
        ilinkUserId: response.ilink_user_id,
        baseUrl: response.baseurl || baseUrl,
        updatedAt: Date.now(),
      };
      await wechatCredentialsStore.save(credentials);
      this.session = {
        ...this.session,
        status: 'confirmed',
        credentials,
      };
      return this.session;
    }

    if (status === 'expired') {
      logger.info('[WechatBindService] QR code expired');
      return this.startBind(baseUrl);
    }

    this.session = {
      ...this.session,
      status: (status as WechatBindSession['status']) || 'wait',
    };
    return this.session;
  }

  clear(): void {
    this.session = null;
  }

  getCurrentSession(): WechatBindSession | null {
    return this.session;
  }
}

export const wechatBindService = new WechatBindService();
