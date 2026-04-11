import { readFile } from '@tauri-apps/plugin-fs';
import CryptoJS from 'crypto-js';
import { logger } from '@/lib/logger';
import { simpleFetch } from '@/lib/tauri-fetch';
import { encryptAes128Ecb, getPkcs7PaddedSize } from '@/services/remote/wechat/wechat-crypto';
import {
  createWechatClientId,
  createWechatUinHeader,
} from '@/services/remote/wechat/wechat-header-utils';
import {
  getWechatBaseInfo,
  type ILinkApiError,
  type ILinkGetUpdatesResponse,
  type ILinkGetUploadUrlRequest,
  type ILinkGetUploadUrlResponse,
  type ILinkMedia,
  type ILinkQrCodeResponse,
  type ILinkQrStatusResponse,
  type ILinkSendMessageResponse,
  WECHAT_SESSION_EXPIRED_ERRCODE,
  type WechatStoredCredentials,
} from '@/services/remote/wechat/wechat-types';

const DEFAULT_CDN_BASE_URL = 'https://novac2c.cdn.weixin.qq.com/c2c';
const WECHAT_QR_POLL_HEADERS = {
  'iLink-App-ClientVersion': '1',
} as const;

function toWordArray(bytes: Uint8Array): CryptoJS.lib.WordArray {
  return CryptoJS.lib.WordArray.create(bytes as unknown as number[]);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function buildJsonHeaders(token: string): HeadersInit {
  return {
    'Content-Type': 'application/json',
    AuthorizationType: 'ilink_bot_token',
    Authorization: token ? `Bearer ${token}` : '',
    'X-WECHAT-UIN': createWechatUinHeader(),
  };
}

async function parseJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

function isResponseOk(payload: ILinkApiError | null | undefined): boolean {
  if (!payload) return false;
  if (payload.errcode && payload.errcode !== 0) return false;
  if (payload.ret !== undefined && payload.ret !== 0) return false;
  return true;
}

export class WechatIlinkClient {
  constructor(private readonly credentials: WechatStoredCredentials) {}

  private get baseUrl(): string {
    return this.credentials.baseUrl.replace(/\/$/, '');
  }

  async getUpdates(syncBuf?: string): Promise<ILinkGetUpdatesResponse> {
    const response = await simpleFetch(`${this.baseUrl}/ilink/bot/getupdates`, {
      method: 'POST',
      headers: buildJsonHeaders(this.credentials.botToken),
      body: JSON.stringify({
        get_updates_buf: syncBuf || '',
        base_info: getWechatBaseInfo(),
      }),
    });
    return parseJson<ILinkGetUpdatesResponse>(response);
  }

  async sendText(params: {
    toUserId: string;
    text: string;
    contextToken?: string;
  }): Promise<ILinkSendMessageResponse> {
    const response = await simpleFetch(`${this.baseUrl}/ilink/bot/sendmessage`, {
      method: 'POST',
      headers: buildJsonHeaders(this.credentials.botToken),
      body: JSON.stringify({
        msg: {
          from_user_id: '',
          to_user_id: params.toUserId,
          client_id: createWechatClientId(),
          message_type: 2,
          message_state: 2,
          item_list: [
            {
              type: 1,
              text_item: { text: params.text },
            },
          ],
          context_token: params.contextToken,
        },
        base_info: getWechatBaseInfo(),
      }),
    });
    return parseJson<ILinkSendMessageResponse>(response);
  }

  async getUploadUrl(
    request: Omit<ILinkGetUploadUrlRequest, 'base_info'>
  ): Promise<ILinkGetUploadUrlResponse> {
    const response = await simpleFetch(`${this.baseUrl}/ilink/bot/getuploadurl`, {
      method: 'POST',
      headers: buildJsonHeaders(this.credentials.botToken),
      body: JSON.stringify({
        ...request,
        base_info: getWechatBaseInfo(),
      }),
    });
    return parseJson<ILinkGetUploadUrlResponse>(response);
  }

  async uploadEncryptedMedia(params: {
    uploadParam: string;
    fileKey: string;
    encryptedBytes: Uint8Array;
  }): Promise<string> {
    const uploadUrl = `${DEFAULT_CDN_BASE_URL}/upload?encrypted_query_param=${encodeURIComponent(
      params.uploadParam
    )}&filekey=${encodeURIComponent(params.fileKey)}`;
    const uploadBytes = Uint8Array.from(params.encryptedBytes);
    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
      },
      body: new Blob([uploadBytes], { type: 'application/octet-stream' }),
    });
    if (!response.ok) {
      throw new Error(`CDN upload failed: ${response.status}`);
    }
    const encryptedParam = response.headers.get('x-encrypted-param');
    if (!encryptedParam) {
      throw new Error('CDN upload missing x-encrypted-param');
    }
    return encryptedParam;
  }

  async sendImage(params: {
    toUserId: string;
    filePath: string;
    contextToken?: string;
  }): Promise<ILinkSendMessageResponse> {
    const fileBytes = await readFile(params.filePath);
    const rawsize = fileBytes.length;
    const rawfilemd5 = CryptoJS.MD5(toWordArray(fileBytes)).toString(CryptoJS.enc.Hex);
    const aesKey = crypto.getRandomValues(new Uint8Array(16));
    const fileKey = toHex(crypto.getRandomValues(new Uint8Array(16)));
    const encryptedBytes = encryptAes128Ecb(fileBytes, aesKey);
    const uploadResponse = await this.getUploadUrl({
      filekey: fileKey,
      media_type: 1,
      to_user_id: params.toUserId,
      rawsize,
      rawfilemd5,
      filesize: getPkcs7PaddedSize(rawsize),
      no_need_thumb: true,
      aeskey: toHex(aesKey),
    });

    if (!uploadResponse.upload_param || !isResponseOk(uploadResponse)) {
      throw new Error(uploadResponse.errmsg || 'Failed to get upload URL');
    }

    const encryptedParam = await this.uploadEncryptedMedia({
      uploadParam: uploadResponse.upload_param,
      fileKey,
      encryptedBytes,
    });

    const response = await simpleFetch(`${this.baseUrl}/ilink/bot/sendmessage`, {
      method: 'POST',
      headers: buildJsonHeaders(this.credentials.botToken),
      body: JSON.stringify({
        msg: {
          from_user_id: '',
          to_user_id: params.toUserId,
          client_id: createWechatClientId('talkcody-wx-img'),
          message_type: 2,
          message_state: 2,
          item_list: [
            {
              type: 2,
              image_item: {
                media: {
                  encrypt_query_param: encryptedParam,
                  aes_key: toBase64(aesKey),
                  encrypt_type: 1,
                },
                mid_size: getPkcs7PaddedSize(rawsize),
              },
            },
          ],
          context_token: params.contextToken,
        },
        base_info: getWechatBaseInfo(),
      }),
    });
    return parseJson<ILinkSendMessageResponse>(response);
  }

  async fetchQrCode(): Promise<ILinkQrCodeResponse> {
    const response = await simpleFetch(`${this.baseUrl}/ilink/bot/get_bot_qrcode?bot_type=3`);
    return parseJson<ILinkQrCodeResponse>(response);
  }

  async pollQrStatus(qrcode: string): Promise<ILinkQrStatusResponse> {
    const response = await simpleFetch(
      `${this.baseUrl}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
      {
        headers: WECHAT_QR_POLL_HEADERS,
      }
    );
    return parseJson<ILinkQrStatusResponse>(response);
  }

  async downloadMedia(media: ILinkMedia): Promise<Uint8Array> {
    const url = media.url
      ? `${media.url}${media.encrypt_query_param ? `?${media.encrypt_query_param}` : ''}`
      : `${DEFAULT_CDN_BASE_URL}/download?encrypted_query_param=${encodeURIComponent(
          media.encrypt_query_param || ''
        )}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Media download failed: ${response.status}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  isSessionExpired(response: ILinkApiError | null | undefined): boolean {
    return response?.errcode === WECHAT_SESSION_EXPIRED_ERRCODE;
  }

  assertSuccess(response: ILinkApiError | null | undefined, fallbackMessage: string): void {
    if (isResponseOk(response)) {
      return;
    }
    const errorMessage = response?.err_msg || response?.errmsg || fallbackMessage;
    logger.warn('[WechatIlinkClient] Provider response error', response);
    throw new Error(errorMessage);
  }
}
