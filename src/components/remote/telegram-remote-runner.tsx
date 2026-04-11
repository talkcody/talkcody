import { useEffect } from 'react';
import { FeishuChannelAdapter } from '@/services/remote/channels/feishu-channel-adapter';
import { TelegramChannelAdapter } from '@/services/remote/channels/telegram-channel-adapter';
import { WechatChannelAdapter } from '@/services/remote/channels/wechat-channel-adapter';
import { remoteChannelManager } from '@/services/remote/remote-channel-manager';
import { remoteControlLifecycleService } from '@/services/remote/remote-control-lifecycle-service';

const telegramAdapter = new TelegramChannelAdapter();
const feishuAdapter = new FeishuChannelAdapter();
const wechatAdapter = new WechatChannelAdapter();
remoteChannelManager.registerAdapter(telegramAdapter);
remoteChannelManager.registerAdapter(feishuAdapter);
remoteChannelManager.registerAdapter(wechatAdapter);

export function RemoteServiceRunner() {
  useEffect(() => {
    remoteControlLifecycleService.initialize().catch(console.error);
    return () => {
      remoteControlLifecycleService.shutdown().catch(console.error);
    };
  }, []);

  return null;
}
