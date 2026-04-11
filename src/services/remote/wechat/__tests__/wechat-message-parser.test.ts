import { describe, expect, it, vi } from 'vitest';
import { WechatMessageParser } from '@/services/remote/wechat/wechat-message-parser';

vi.mock('@/services/remote/wechat/wechat-media-service', () => ({
  wechatMediaService: {
    saveDecryptedMedia: vi.fn().mockResolvedValue({
      filePath: '/tmp/test-image.jpg',
      filename: 'test-image.jpg',
      mimeType: 'image/jpeg',
      size: 123,
    }),
    logDownloadFailure: vi.fn(),
  },
}));

describe('wechat-message-parser', () => {
  it('parses text and quoted text', async () => {
    const parser = new WechatMessageParser(vi.fn());
    const parsed = await parser.parse({
      msg_id: 1,
      from_user_id: 'user@wx',
      create_time_ms: 123,
      context_token: 'ctx-1',
      item_list: [
        {
          type: 1,
          text_item: { text: 'hello' },
          ref_msg: {
            title: 'earlier',
            message_item: {
              text_item: { text: 'quoted body' },
            },
          },
        },
      ],
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.chatId).toBe('user@wx');
    expect(parsed?.text).toContain('[Quoted: earlier | quoted body]');
    expect(parsed?.text).toContain('hello');
    expect(parsed?.contextToken).toBe('ctx-1');
  });

  it('filters group messages', async () => {
    const parser = new WechatMessageParser(vi.fn());
    const parsed = await parser.parse({
      msg_id: 2,
      from_user_id: 'user@wx',
      group_id: 'group-1',
      item_list: [{ type: 1, text_item: { text: 'ignored' } }],
    });

    expect(parsed).toBeNull();
  });

  it('creates placeholder text for media-only messages', async () => {
    const parser = new WechatMessageParser(
      vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3, 4]))
    );

    const parsed = await parser.parse({
      msg_id: 3,
      from_user_id: 'user@wx',
      item_list: [
        {
          type: 2,
          image_item: {
            media: {
              encrypt_query_param: 'eqp',
              aes_key: 'AQIDBAUGBwgJCgsMDQ4PEA==',
            },
          },
        },
      ],
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.text).toContain('[Image received]');
    expect(parsed?.attachments).toHaveLength(1);
  });
});
