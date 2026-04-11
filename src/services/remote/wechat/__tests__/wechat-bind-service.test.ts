import { describe, expect, it } from 'vitest';
import { normalizeWechatQrImageUrl } from '@/services/remote/wechat/wechat-bind-service';

describe('wechat-bind-service', () => {
  it('keeps direct http QR URLs unchanged', () => {
    expect(normalizeWechatQrImageUrl('https://example.com/qr.png')).toBe(
      'https://example.com/qr.png'
    );
  });

  it('decodes base64-encoded QR URLs', () => {
    const encodedUrl = btoa('https://example.com/qr.png');
    expect(normalizeWechatQrImageUrl(encodedUrl)).toBe('https://example.com/qr.png');
  });

  it('wraps raw base64 image payloads as data URLs', () => {
    const pngPayload = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';
    expect(normalizeWechatQrImageUrl(pngPayload)).toBe(`data:image/png;base64,${pngPayload}`);
  });
});
