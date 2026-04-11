import { logger } from '@/lib/logger';
import type {
  RemoteChannelAdapter,
  RemoteChannelCapabilities,
  RemoteChannelStatus,
} from '@/services/remote/remote-channel-types';
import type {
  RemoteChannelId,
  RemoteEditMessageRequest,
  RemoteInboundMessage,
  RemoteSendMessageRequest,
  RemoteSendMessageResponse,
} from '@/types/remote-control';

export type RemoteInboundHandler = (message: RemoteInboundMessage) => void;

class RemoteChannelManager {
  private adapters = new Map<RemoteChannelId, RemoteChannelAdapter>();
  private inboundHandlers = new Set<RemoteInboundHandler>();
  private unlistenMap = new Map<RemoteChannelId, () => void>();

  registerAdapter(adapter: RemoteChannelAdapter): void {
    logger.info('[RemoteChannelManager] Register adapter', adapter.channelId);
    this.adapters.set(adapter.channelId, adapter);
  }

  unregisterAdapter(channelId: RemoteChannelId): void {
    const existing = this.adapters.get(channelId);
    if (!existing) return;
    logger.info('[RemoteChannelManager] Unregister adapter', channelId);
    const unlisten = this.unlistenMap.get(channelId);
    if (unlisten) {
      unlisten();
      this.unlistenMap.delete(channelId);
    }
    this.adapters.delete(channelId);
  }

  getAdapter(channelId: RemoteChannelId): RemoteChannelAdapter | undefined {
    return this.adapters.get(channelId);
  }

  getCapabilities(channelId: RemoteChannelId): RemoteChannelCapabilities | null {
    return this.adapters.get(channelId)?.capabilities ?? null;
  }

  async getStatus(channelId: RemoteChannelId): Promise<RemoteChannelStatus | null> {
    const adapter = this.adapters.get(channelId);
    if (!adapter?.getStatus) {
      return null;
    }
    try {
      return await adapter.getStatus();
    } catch (error) {
      logger.warn('[RemoteChannelManager] Failed to read adapter status', {
        channelId,
        error,
      });
      return null;
    }
  }

  onInbound(handler: RemoteInboundHandler): () => void {
    this.inboundHandlers.add(handler);
    return () => {
      this.inboundHandlers.delete(handler);
    };
  }

  async startChannel(channelId: RemoteChannelId): Promise<void> {
    const adapter = this.adapters.get(channelId);
    if (!adapter) {
      return;
    }

    await this.startAdapter(adapter);
  }

  async stopChannel(channelId: RemoteChannelId): Promise<void> {
    const adapter = this.adapters.get(channelId);
    if (!adapter) {
      return;
    }

    await this.stopAdapter(adapter);
  }

  async startAll(): Promise<void> {
    logger.info('[RemoteChannelManager] Starting all adapters');
    const startOps = Array.from(this.adapters.values()).map(async (adapter) => {
      await this.startAdapter(adapter);
    });
    await Promise.all(startOps);
  }

  async stopAll(): Promise<void> {
    logger.info('[RemoteChannelManager] Stopping all adapters');
    const stopOps = Array.from(this.adapters.values()).map(async (adapter) => {
      await this.stopAdapter(adapter);
    });
    await Promise.all(stopOps);
  }

  async sendMessage(request: RemoteSendMessageRequest): Promise<RemoteSendMessageResponse> {
    const adapter = this.adapters.get(request.channelId);
    if (!adapter) {
      throw new Error(`Remote channel ${request.channelId} not registered`);
    }
    logger.debug('[RemoteChannelManager] sendMessage', {
      channelId: request.channelId,
      chatId: request.chatId,
      textLen: request.text.length,
    });
    return adapter.sendMessage(request);
  }

  async editMessage(request: RemoteEditMessageRequest): Promise<void> {
    const adapter = this.adapters.get(request.channelId);
    if (!adapter) {
      throw new Error(`Remote channel ${request.channelId} not registered`);
    }
    logger.debug('[RemoteChannelManager] editMessage', {
      channelId: request.channelId,
      chatId: request.chatId,
      messageId: request.messageId,
      textLen: request.text.length,
    });
    await adapter.editMessage(request);
  }

  getRegisteredChannels(): RemoteChannelId[] {
    return Array.from(this.adapters.keys());
  }

  private async startAdapter(adapter: RemoteChannelAdapter): Promise<void> {
    try {
      await adapter.start();
      if (this.unlistenMap.has(adapter.channelId)) {
        return;
      }
      const unlisten = adapter.onInbound((message) => {
        this.emitInbound(message);
      });
      this.unlistenMap.set(adapter.channelId, unlisten);
    } catch (error) {
      logger.error(`[RemoteChannelManager] Failed to start adapter ${adapter.channelId}`, error);
    }
  }

  private async stopAdapter(adapter: RemoteChannelAdapter): Promise<void> {
    try {
      await adapter.stop();
      const unlisten = this.unlistenMap.get(adapter.channelId);
      if (unlisten) {
        unlisten();
        this.unlistenMap.delete(adapter.channelId);
      }
    } catch (error) {
      logger.error(`[RemoteChannelManager] Failed to stop adapter ${adapter.channelId}`, error);
    }
  }

  private emitInbound(message: RemoteInboundMessage): void {
    logger.debug('[RemoteChannelManager] Inbound dispatch', {
      channelId: message.channelId,
      chatId: message.chatId,
      messageId: message.messageId,
      textLen: message.text.length,
      attachments: message.attachments?.length ?? 0,
    });
    for (const handler of this.inboundHandlers) {
      try {
        handler(message);
      } catch (error) {
        logger.warn('[RemoteChannelManager] inbound handler failed', error);
      }
    }
  }
}

export const remoteChannelManager = new RemoteChannelManager();
