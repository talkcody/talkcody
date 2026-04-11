import { Bot } from 'lucide-react';
import QRCode from 'qrcode';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useLocale } from '@/hooks/use-locale';
import { logger } from '@/lib/logger';
import { remoteControlLifecycleService } from '@/services/remote/remote-control-lifecycle-service';
import { wechatBindService } from '@/services/remote/wechat/wechat-bind-service';
import { wechatCredentialsStore } from '@/services/remote/wechat/wechat-credentials-store';
import type { WechatBindSession } from '@/services/remote/wechat/wechat-types';
import { settingsManager } from '@/stores/settings-store';

const DEFAULT_TELEGRAM_POLL_TIMEOUT = '25';
const DEFAULT_WECHAT_POLL_TIMEOUT = '35000';
const REMOTE_SECTION_CARD_STYLE = 'border-muted/60';

function toBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value === 'true';
  return false;
}

function valueToString(value: unknown): string {
  if (value === undefined || value === null) return '';
  return String(value);
}

function getWechatStatusText(
  t: ReturnType<typeof useLocale>['t'],
  session: WechatBindSession | null,
  enabled: boolean
): string {
  if (session?.status === 'scanned') return t.Settings.remoteControl.wechat.statusScanned;
  if (session?.status === 'confirmed') return t.Settings.remoteControl.wechat.statusConnected;
  if (session?.status === 'expired') return t.Settings.remoteControl.wechat.statusExpired;
  if (session?.status === 'wait') return t.Settings.remoteControl.wechat.statusWaiting;
  return enabled
    ? t.Settings.remoteControl.wechat.statusConnected
    : t.Settings.remoteControl.wechat.statusIdle;
}

function WechatQrPreview({ value }: { value: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isImagePayload = value.startsWith('data:image/');

  useEffect(() => {
    if (isImagePayload || !value || !canvasRef.current) {
      return;
    }

    void QRCode.toCanvas(canvasRef.current, value, {
      width: 192,
      margin: 1,
    }).catch((error: unknown) => {
      logger.error('[RemoteControlSettings] Failed to render WeChat QR code', error);
    });
  }, [isImagePayload, value]);

  if (isImagePayload) {
    return <img src={value} alt="WeChat QR" className="h-48 w-48 rounded-md border bg-white p-2" />;
  }

  return (
    <canvas
      ref={canvasRef}
      aria-label="WeChat QR"
      className="h-48 w-48 rounded-md border bg-white p-2"
    />
  );
}

export function RemoteControlSettings() {
  const { t } = useLocale();
  const tokenId = useId();
  const allowedChatsId = useId();
  const pollTimeoutId = useId();
  const feishuAppId = useId();
  const feishuAppSecret = useId();
  const feishuEncryptKey = useId();
  const feishuVerificationToken = useId();
  const feishuAllowedOpenIds = useId();
  const wechatBaseUrlId = useId();
  const wechatAllowedUserIdsId = useId();
  const wechatPollTimeoutId = useId();

  const [telegramEnabled, setTelegramEnabled] = useState(
    toBoolean(settingsManager.get('telegram_remote_enabled'))
  );
  const [telegramToken, setTelegramToken] = useState(
    valueToString(settingsManager.get('telegram_remote_token'))
  );
  const [telegramAllowedChats, setTelegramAllowedChats] = useState(
    valueToString(settingsManager.get('telegram_remote_allowed_chats'))
  );
  const [telegramPollTimeout, setTelegramPollTimeout] = useState(
    valueToString(settingsManager.get('telegram_remote_poll_timeout')) ||
      DEFAULT_TELEGRAM_POLL_TIMEOUT
  );

  const [feishuEnabled, setFeishuEnabled] = useState(
    toBoolean(settingsManager.get('feishu_remote_enabled'))
  );
  const [feishuAppIdValue, setFeishuAppIdValue] = useState(
    valueToString(settingsManager.get('feishu_remote_app_id'))
  );
  const [feishuAppSecretValue, setFeishuAppSecretValue] = useState(
    valueToString(settingsManager.get('feishu_remote_app_secret'))
  );
  const [feishuEncryptKeyValue, setFeishuEncryptKeyValue] = useState(
    valueToString(settingsManager.get('feishu_remote_encrypt_key'))
  );
  const [feishuVerificationTokenValue, setFeishuVerificationTokenValue] = useState(
    valueToString(settingsManager.get('feishu_remote_verification_token'))
  );
  const [feishuAllowedOpenIdsValue, setFeishuAllowedOpenIdsValue] = useState(
    valueToString(settingsManager.get('feishu_remote_allowed_open_ids'))
  );

  const [wechatEnabled, setWechatEnabled] = useState(
    toBoolean(settingsManager.get('wechat_remote_enabled'))
  );
  const [wechatBaseUrl, setWechatBaseUrl] = useState(
    valueToString(settingsManager.get('wechat_remote_base_url')) || 'https://ilinkai.weixin.qq.com'
  );
  const [wechatAllowedUserIds, setWechatAllowedUserIds] = useState(
    valueToString(settingsManager.get('wechat_remote_allowed_user_ids'))
  );
  const [wechatPollTimeout, setWechatPollTimeout] = useState(
    valueToString(settingsManager.get('wechat_remote_poll_timeout_ms')) ||
      DEFAULT_WECHAT_POLL_TIMEOUT
  );
  const [wechatSession, setWechatSession] = useState<WechatBindSession | null>(null);
  const [wechatBinding, setWechatBinding] = useState(false);
  const persistedWechatSessionIdRef = useRef<string | null>(null);

  const [keepAwakeEnabled, setKeepAwakeEnabled] = useState(
    toBoolean(settingsManager.get('remote_control_keep_awake'))
  );

  useEffect(() => {
    let cancelled = false;
    if (!wechatSession || !['wait', 'scanned'].includes(wechatSession.status)) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      if (cancelled) {
        return;
      }
      wechatBindService
        .poll(wechatSession.sessionId, wechatBaseUrl.trim() || 'https://ilinkai.weixin.qq.com')
        .then((nextSession) => {
          if (!cancelled) {
            setWechatSession(nextSession);
          }
        })
        .catch((error) => {
          logger.warn('[RemoteControlSettings] WeChat bind poll failed', error);
        });
    }, 2500);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [wechatBaseUrl, wechatSession]);

  const persistWechatSettings = useCallback(
    async (credentials = wechatSession?.credentials ?? null): Promise<void> => {
      await settingsManager.initialize();
      await settingsManager.setWechatRemoteEnabled(wechatEnabled);
      await settingsManager.setWechatRemoteBaseUrl(
        wechatBaseUrl.trim() || 'https://ilinkai.weixin.qq.com'
      );
      await settingsManager.setWechatRemoteAllowedUserIds(wechatAllowedUserIds.trim());
      await settingsManager.setWechatRemotePollTimeoutMs(
        wechatPollTimeout || DEFAULT_WECHAT_POLL_TIMEOUT
      );

      const resolvedCredentials = credentials ?? (await wechatCredentialsStore.load());
      await settingsManager.setWechatRemoteBotToken(resolvedCredentials?.botToken ?? '');
      await settingsManager.setWechatRemoteBotId(resolvedCredentials?.botId ?? '');
      await settingsManager.setWechatRemoteIlinkUserId(resolvedCredentials?.ilinkUserId ?? '');
    },
    [wechatAllowedUserIds, wechatBaseUrl, wechatEnabled, wechatPollTimeout, wechatSession]
  );

  useEffect(() => {
    if (wechatSession?.status !== 'confirmed' || !wechatSession.credentials) {
      return undefined;
    }

    if (persistedWechatSessionIdRef.current === wechatSession.sessionId) {
      return undefined;
    }

    let cancelled = false;

    void (async () => {
      try {
        await persistWechatSettings(wechatSession.credentials);
        await remoteControlLifecycleService.refresh();
        if (cancelled) {
          return;
        }
        persistedWechatSessionIdRef.current = wechatSession.sessionId;
        toast.success(t.Settings.remoteControl.saved);
      } catch (error) {
        logger.error('[RemoteControlSettings] Failed to auto-save confirmed WeChat session', error);
        if (!cancelled) {
          toast.error(t.Settings.remoteControl.saveFailed);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    persistWechatSettings,
    t.Settings.remoteControl.saveFailed,
    t.Settings.remoteControl.saved,
    wechatSession,
  ]);

  const hasAnyRemoteEnabled = useMemo(
    () => telegramEnabled || feishuEnabled || wechatEnabled,
    [telegramEnabled, feishuEnabled, wechatEnabled]
  );

  const validateSettings = () => {
    if (telegramEnabled) {
      if (!telegramToken.trim()) {
        return t.Settings.remoteControl.errors.tokenMissing;
      }
      const timeoutValue = Number(telegramPollTimeout);
      if (!Number.isFinite(timeoutValue) || timeoutValue < 5 || timeoutValue > 60) {
        return t.Settings.remoteControl.errors.pollTimeoutRange;
      }
    }

    if (feishuEnabled) {
      if (!feishuAppIdValue.trim()) {
        return t.Settings.remoteControl.feishu.errors.appIdMissing;
      }
      if (!feishuAppSecretValue.trim()) {
        return t.Settings.remoteControl.feishu.errors.appSecretMissing;
      }
    }

    if (wechatEnabled) {
      if (!wechatBaseUrl.trim()) {
        return t.Settings.remoteControl.wechat.errors.baseUrlMissing;
      }
      const timeoutValue = Number(wechatPollTimeout);
      if (!Number.isFinite(timeoutValue) || timeoutValue < 5000 || timeoutValue > 120000) {
        return t.Settings.remoteControl.wechat.errors.pollTimeoutRange;
      }
    }

    return null;
  };

  const handleWechatConnect = async () => {
    try {
      setWechatBinding(true);
      persistedWechatSessionIdRef.current = null;
      const session = await wechatBindService.startBind(
        wechatBaseUrl.trim() || 'https://ilinkai.weixin.qq.com'
      );
      setWechatSession(session);
    } catch (error) {
      logger.error('[RemoteControlSettings] Failed to start WeChat bind', error);
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setWechatBinding(false);
    }
  };

  const handleWechatDisconnect = async () => {
    persistedWechatSessionIdRef.current = null;
    await wechatCredentialsStore.clear();
    await settingsManager.setWechatRemoteBotToken('');
    await settingsManager.setWechatRemoteBotId('');
    await settingsManager.setWechatRemoteIlinkUserId('');
    setWechatSession(null);
    toast.success(t.Settings.remoteControl.saved);
  };

  const handleRemoteSave = async () => {
    const validationError = validateSettings();
    if (validationError) {
      toast.error(validationError);
      return;
    }

    try {
      await settingsManager.initialize();
      await settingsManager.setTelegramRemoteEnabled(telegramEnabled);
      await settingsManager.set('telegram_remote_token', telegramToken.trim());
      await settingsManager.set('telegram_remote_allowed_chats', telegramAllowedChats.trim());
      await settingsManager.set(
        'telegram_remote_poll_timeout',
        telegramPollTimeout || DEFAULT_TELEGRAM_POLL_TIMEOUT
      );

      await settingsManager.setFeishuRemoteEnabled(feishuEnabled);
      await settingsManager.setFeishuRemoteAppId(feishuAppIdValue.trim());
      await settingsManager.setFeishuRemoteAppSecret(feishuAppSecretValue.trim());
      await settingsManager.setFeishuRemoteEncryptKey(feishuEncryptKeyValue.trim());
      await settingsManager.setFeishuRemoteVerificationToken(feishuVerificationTokenValue.trim());
      await settingsManager.setFeishuRemoteAllowedOpenIds(feishuAllowedOpenIdsValue.trim());

      await persistWechatSettings();

      await settingsManager.set('remote_control_keep_awake', keepAwakeEnabled.toString());
      await remoteControlLifecycleService.refresh();
      toast.success(t.Settings.remoteControl.saved);
    } catch (error) {
      logger.error('[RemoteControlSettings] Failed to save remote control settings:', error);
      toast.error(t.Settings.remoteControl.saveFailed);
    }
  };

  const wechatStatusText = getWechatStatusText(t, wechatSession, wechatEnabled);

  return (
    <div className="space-y-6">
      <Card className={REMOTE_SECTION_CARD_STYLE}>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5" />
            <CardTitle className="text-lg">{t.Settings.remoteControl.title}</CardTitle>
          </div>
          <CardDescription>{t.Settings.remoteControl.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <Label className="text-sm font-medium">{t.Settings.remoteControl.enabled}</Label>
            <Switch checked={telegramEnabled} onCheckedChange={setTelegramEnabled} />
          </div>

          <div className="space-y-2">
            <Label htmlFor={tokenId}>{t.Settings.remoteControl.tokenLabel}</Label>
            <Input
              id={tokenId}
              type="password"
              placeholder={t.Settings.remoteControl.tokenPlaceholder}
              value={telegramToken}
              onChange={(event) => setTelegramToken(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={allowedChatsId}>{t.Settings.remoteControl.allowedChatsLabel}</Label>
            <Input
              id={allowedChatsId}
              placeholder={t.Settings.remoteControl.allowedChatsPlaceholder}
              value={telegramAllowedChats}
              onChange={(event) => setTelegramAllowedChats(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={pollTimeoutId}>{t.Settings.remoteControl.pollTimeoutLabel}</Label>
            <Input
              id={pollTimeoutId}
              placeholder={t.Settings.remoteControl.pollTimeoutPlaceholder}
              value={telegramPollTimeout}
              onChange={(event) => setTelegramPollTimeout(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {t.Settings.remoteControl.pollTimeoutHint}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className={REMOTE_SECTION_CARD_STYLE}>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5" />
            <CardTitle className="text-lg">{t.Settings.remoteControl.feishu.title}</CardTitle>
          </div>
          <CardDescription>{t.Settings.remoteControl.feishu.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <Label className="text-sm font-medium">{t.Settings.remoteControl.feishu.enabled}</Label>
            <Switch checked={feishuEnabled} onCheckedChange={setFeishuEnabled} />
          </div>

          <div className="space-y-2">
            <Label htmlFor={feishuAppId}>{t.Settings.remoteControl.feishu.appIdLabel}</Label>
            <Input
              id={feishuAppId}
              placeholder={t.Settings.remoteControl.feishu.appIdPlaceholder}
              value={feishuAppIdValue}
              onChange={(event) => setFeishuAppIdValue(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={feishuAppSecret}>
              {t.Settings.remoteControl.feishu.appSecretLabel}
            </Label>
            <Input
              id={feishuAppSecret}
              type="password"
              placeholder={t.Settings.remoteControl.feishu.appSecretPlaceholder}
              value={feishuAppSecretValue}
              onChange={(event) => setFeishuAppSecretValue(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={feishuEncryptKey}>
              {t.Settings.remoteControl.feishu.encryptKeyLabel}
            </Label>
            <Input
              id={feishuEncryptKey}
              type="password"
              placeholder={t.Settings.remoteControl.feishu.encryptKeyPlaceholder}
              value={feishuEncryptKeyValue}
              onChange={(event) => setFeishuEncryptKeyValue(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={feishuVerificationToken}>
              {t.Settings.remoteControl.feishu.verificationTokenLabel}
            </Label>
            <Input
              id={feishuVerificationToken}
              type="password"
              placeholder={t.Settings.remoteControl.feishu.verificationTokenPlaceholder}
              value={feishuVerificationTokenValue}
              onChange={(event) => setFeishuVerificationTokenValue(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={feishuAllowedOpenIds}>
              {t.Settings.remoteControl.feishu.allowedOpenIdsLabel}
            </Label>
            <Input
              id={feishuAllowedOpenIds}
              placeholder={t.Settings.remoteControl.feishu.allowedOpenIdsPlaceholder}
              value={feishuAllowedOpenIdsValue}
              onChange={(event) => setFeishuAllowedOpenIdsValue(event.target.value)}
            />
          </div>

          <p className="text-xs text-muted-foreground">
            {t.Settings.remoteControl.feishu.allowlistHint}
          </p>
        </CardContent>
      </Card>

      <Card className={REMOTE_SECTION_CARD_STYLE}>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5" />
            <CardTitle className="text-lg">{t.Settings.remoteControl.wechat.title}</CardTitle>
          </div>
          <CardDescription>{t.Settings.remoteControl.wechat.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <Label className="text-sm font-medium">{t.Settings.remoteControl.wechat.enabled}</Label>
            <Switch checked={wechatEnabled} onCheckedChange={setWechatEnabled} />
          </div>

          <div className="space-y-2">
            <Label htmlFor={wechatBaseUrlId}>{t.Settings.remoteControl.wechat.baseUrlLabel}</Label>
            <Input
              id={wechatBaseUrlId}
              placeholder={t.Settings.remoteControl.wechat.baseUrlPlaceholder}
              value={wechatBaseUrl}
              onChange={(event) => setWechatBaseUrl(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={wechatAllowedUserIdsId}>
              {t.Settings.remoteControl.wechat.allowedUserIdsLabel}
            </Label>
            <Input
              id={wechatAllowedUserIdsId}
              placeholder={t.Settings.remoteControl.wechat.allowedUserIdsPlaceholder}
              value={wechatAllowedUserIds}
              onChange={(event) => setWechatAllowedUserIds(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={wechatPollTimeoutId}>
              {t.Settings.remoteControl.wechat.pollTimeoutLabel}
            </Label>
            <Input
              id={wechatPollTimeoutId}
              placeholder={t.Settings.remoteControl.wechat.pollTimeoutPlaceholder}
              value={wechatPollTimeout}
              onChange={(event) => setWechatPollTimeout(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {t.Settings.remoteControl.wechat.pollTimeoutHint}
            </p>
          </div>

          <div className="rounded-md border border-dashed p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{wechatStatusText}</p>
                <p className="text-xs text-muted-foreground">
                  {t.Settings.remoteControl.wechat.personalOnlyHint}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleWechatConnect}
                  disabled={wechatBinding}
                >
                  {wechatSession?.status === 'confirmed'
                    ? t.Settings.remoteControl.wechat.reconnect
                    : t.Settings.remoteControl.wechat.connect}
                </Button>
                <Button type="button" variant="outline" onClick={handleWechatDisconnect}>
                  {t.Settings.remoteControl.wechat.disconnect}
                </Button>
              </div>
            </div>

            {wechatSession?.qrImageUrl ? (
              <div className="mt-4 flex flex-col items-center gap-2">
                <WechatQrPreview value={wechatSession.qrImageUrl} />
                <p className="text-xs text-muted-foreground">
                  {t.Settings.remoteControl.wechat.qrHint}
                </p>
              </div>
            ) : null}

            <p className="mt-3 text-xs text-muted-foreground">
              {t.Settings.remoteControl.wechat.contextHint}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className={REMOTE_SECTION_CARD_STYLE}>
        <CardContent className="space-y-4 pt-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <Label className="text-sm font-medium">
                {t.Settings.remoteControl.keepAwakeLabel}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t.Settings.remoteControl.keepAwakeHint}
              </p>
            </div>
            <Switch checked={keepAwakeEnabled} onCheckedChange={setKeepAwakeEnabled} />
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="text-xs text-muted-foreground">
              {hasAnyRemoteEnabled
                ? t.Settings.remoteControl.statusEnabled
                : t.Settings.remoteControl.statusDisabled}
            </div>
            <Button type="button" onClick={handleRemoteSave}>
              {t.Settings.remoteControl.save}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
