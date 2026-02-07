import { Bot } from 'lucide-react';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useLocale } from '@/hooks/use-locale';
import { telegramRemoteService } from '@/services/remote/telegram-remote-service';
import { settingsManager } from '@/stores/settings-store';

const DEFAULT_POLL_TIMEOUT = '25';

export function RemoteControlSettings() {
  const { t } = useLocale();
  const tokenId = useId();
  const allowedChatsId = useId();
  const pollTimeoutId = useId();
  const [remoteEnabled, setRemoteEnabled] = useState(
    settingsManager.get('telegram_remote_enabled') === 'true'
  );
  const [remoteToken, setRemoteToken] = useState(settingsManager.get('telegram_remote_token'));
  const [allowedChats, setAllowedChats] = useState(
    settingsManager.get('telegram_remote_allowed_chats')
  );
  const [pollTimeout, setPollTimeout] = useState(
    settingsManager.get('telegram_remote_poll_timeout') || DEFAULT_POLL_TIMEOUT
  );

  const validateRemoteSettings = () => {
    if (!remoteEnabled) {
      return null;
    }
    if (!remoteToken.trim()) {
      return t.Settings.remoteControl.errors.tokenMissing;
    }
    const timeoutValue = Number(pollTimeout);
    if (!Number.isFinite(timeoutValue) || timeoutValue < 5 || timeoutValue > 60) {
      return t.Settings.remoteControl.errors.pollTimeoutRange;
    }
    return null;
  };

  const handleRemoteSave = async () => {
    const validationError = validateRemoteSettings();
    if (validationError) {
      toast.error(validationError);
      return;
    }

    try {
      await settingsManager.set('telegram_remote_enabled', remoteEnabled.toString());
      await settingsManager.set('telegram_remote_token', remoteToken.trim());
      await settingsManager.set('telegram_remote_allowed_chats', allowedChats.trim());
      await settingsManager.set(
        'telegram_remote_poll_timeout',
        pollTimeout || DEFAULT_POLL_TIMEOUT
      );
      await telegramRemoteService.refresh();
      toast.success(t.Settings.remoteControl.saved);
    } catch (_error) {
      toast.error(t.Settings.remoteControl.saveFailed);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5" />
          <CardTitle className="text-lg">{t.Settings.remoteControl.title}</CardTitle>
        </div>
        <CardDescription>{t.Settings.remoteControl.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <Label className="text-sm font-medium">{t.Settings.remoteControl.enabled}</Label>
          </div>
          <Switch checked={remoteEnabled} onCheckedChange={setRemoteEnabled} />
        </div>

        <div className="space-y-2">
          <Label htmlFor={tokenId}>{t.Settings.remoteControl.tokenLabel}</Label>
          <Input
            id={tokenId}
            type="password"
            placeholder={t.Settings.remoteControl.tokenPlaceholder}
            value={remoteToken}
            onChange={(event) => setRemoteToken(event.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor={allowedChatsId}>{t.Settings.remoteControl.allowedChatsLabel}</Label>
          <Input
            id={allowedChatsId}
            placeholder={t.Settings.remoteControl.allowedChatsPlaceholder}
            value={allowedChats}
            onChange={(event) => setAllowedChats(event.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor={pollTimeoutId}>{t.Settings.remoteControl.pollTimeoutLabel}</Label>
          <Input
            id={pollTimeoutId}
            placeholder={t.Settings.remoteControl.pollTimeoutPlaceholder}
            value={pollTimeout}
            onChange={(event) => setPollTimeout(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            {t.Settings.remoteControl.pollTimeoutHint}
          </p>
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            onClick={handleRemoteSave}
          >
            {t.Settings.remoteControl.save}
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
