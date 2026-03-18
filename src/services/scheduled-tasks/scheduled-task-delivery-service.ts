import { logger } from '@/lib/logger';
import { remoteChannelManager } from '@/services/remote/remote-channel-manager';
import type { RemoteChannelId } from '@/types/remote-control';
import type {
  ScheduledTaskDeliveryPolicy,
  ScheduledTaskDeliveryResult,
} from '@/types/scheduled-task';

class ScheduledTaskDeliveryService {
  async deliver(params: {
    policy?: ScheduledTaskDeliveryPolicy | null;
    title: string;
    body: string;
  }): Promise<ScheduledTaskDeliveryResult> {
    const policy = params.policy;
    if (!policy || !policy.enabled || !policy.channelId || !policy.target) {
      return { status: 'none', deliveredAt: null };
    }

    try {
      await remoteChannelManager.sendMessage({
        channelId: policy.channelId as RemoteChannelId,
        chatId: policy.target,
        text: `${params.title}\n\n${params.body}`,
        disableWebPagePreview: true,
        parseMode: 'plain',
      });

      return { status: 'delivered', deliveredAt: Date.now() };
    } catch (error) {
      logger.error('[ScheduledTaskDeliveryService] Delivery failed', error);
      return {
        status: 'failed',
        deliveredAt: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export const scheduledTaskDeliveryService = new ScheduledTaskDeliveryService();
