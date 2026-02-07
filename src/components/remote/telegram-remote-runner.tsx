import { useEffect } from 'react';
import { telegramRemoteService } from '@/services/remote/telegram-remote-service';

export function TelegramRemoteServiceRunner() {
  useEffect(() => {
    telegramRemoteService.start().catch(console.error);
    return () => {
      telegramRemoteService.stop().catch(console.error);
    };
  }, []);

  return null;
}
