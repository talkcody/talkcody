import { Cloud, RefreshCw, Upload } from 'lucide-react';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useLocale } from '@/hooks/use-locale';
import { logger } from '@/lib/logger';
import { s3SyncService, validateS3SyncConfig } from '@/services/s3-sync-service';
import { settingsManager } from '@/stores/settings-store';

function toBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value === 'true';
  return false;
}

function valueToString(value: unknown): string {
  if (value === undefined || value === null) return '';
  return String(value);
}

export function S3SyncSettings() {
  const { t } = useLocale();

  const endpointId = useId();
  const regionId = useId();
  const bucketId = useId();
  const accessKeyId = useId();
  const secretAccessKeyId = useId();
  const sessionTokenId = useId();
  const namespaceId = useId();
  const keyPrefixId = useId();

  const [enabled, setEnabled] = useState(toBoolean(settingsManager.get('s3_sync_enabled')));
  const [endpoint, setEndpoint] = useState(valueToString(settingsManager.get('s3_sync_endpoint')));
  const [region, setRegion] = useState(
    valueToString(settingsManager.get('s3_sync_region')) || 'us-east-1'
  );
  const [bucket, setBucket] = useState(valueToString(settingsManager.get('s3_sync_bucket')));
  const [accessKey, setAccessKey] = useState(
    valueToString(settingsManager.get('s3_sync_access_key_id'))
  );
  const [secretAccessKey, setSecretAccessKey] = useState(
    valueToString(settingsManager.get('s3_sync_secret_access_key'))
  );
  const [sessionToken, setSessionToken] = useState(
    valueToString(settingsManager.get('s3_sync_session_token'))
  );
  const [pathStyle, setPathStyle] = useState(toBoolean(settingsManager.get('s3_sync_path_style')));
  const [namespace, setNamespace] = useState(
    valueToString(settingsManager.get('s3_sync_namespace'))
  );
  const [keyPrefix, setKeyPrefix] = useState(
    valueToString(settingsManager.get('s3_sync_key_prefix')) || 'talkcody-sync'
  );
  const [busy, setBusy] = useState(false);
  const [lastBackupAt, setLastBackupAt] = useState(
    valueToString(settingsManager.get('s3_sync_last_backup_at'))
  );

  const buildConfig = () => ({
    bucket: {
      endpoint,
      region,
      bucket,
      pathStyle,
    },
    credentials: {
      accessKeyId: accessKey,
      secretAccessKey,
      sessionToken: sessionToken.trim() ? sessionToken : undefined,
    },
    namespace: namespace.trim() ? namespace.trim() : undefined,
    keyPrefix,
  });

  const validateOrToast = () => {
    const err = validateS3SyncConfig(buildConfig());
    if (err) {
      toast.error(t.Settings.s3Sync.errors.invalidConfig);
      return false;
    }
    return true;
  };

  const handleSave = async () => {
    try {
      await settingsManager.initialize();
      await settingsManager.setS3SyncEnabled(enabled);
      await settingsManager.setBatch({
        s3_sync_endpoint: endpoint.trim(),
        s3_sync_region: region.trim(),
        s3_sync_bucket: bucket.trim(),
        s3_sync_access_key_id: accessKey.trim(),
        s3_sync_secret_access_key: secretAccessKey.trim(),
        s3_sync_session_token: sessionToken.trim(),
        s3_sync_namespace: namespace.trim(),
        s3_sync_key_prefix: keyPrefix.trim() || 'talkcody-sync',
      });
      await settingsManager.setS3SyncPathStyle(pathStyle);
      toast.success(t.Settings.s3Sync.saved);
    } catch (error) {
      logger.error('[S3SyncSettings] Failed to save S3 sync settings:', error);
      toast.error(t.Settings.s3Sync.saveFailed);
    }
  };

  const handleTest = async () => {
    if (!validateOrToast()) return;
    if (!enabled) {
      toast.error(t.Settings.s3Sync.errors.notEnabled);
      return;
    }

    setBusy(true);
    try {
      await s3SyncService.testConnection(buildConfig());
      toast.success(t.Settings.s3Sync.testSuccess);
    } catch (error) {
      logger.error('[S3SyncSettings] Test failed:', error);
      toast.error(t.Settings.s3Sync.testFailed);
    } finally {
      setBusy(false);
    }
  };

  const handleBackup = async () => {
    if (!validateOrToast()) return;
    if (!enabled) {
      toast.error(t.Settings.s3Sync.errors.notEnabled);
      return;
    }

    setBusy(true);
    try {
      const result = await s3SyncService.backup(buildConfig());
      const at = String(result.createdAtMs);
      setLastBackupAt(at);
      await settingsManager.set('s3_sync_last_backup_at', at);
      toast.success(t.Settings.s3Sync.backupSuccess);
    } catch (error) {
      logger.error('[S3SyncSettings] Backup failed:', error);
      toast.error(t.Settings.s3Sync.backupFailed);
    } finally {
      setBusy(false);
    }
  };

  const handleRestore = async () => {
    if (!validateOrToast()) return;
    if (!enabled) {
      toast.error(t.Settings.s3Sync.errors.notEnabled);
      return;
    }

    setBusy(true);
    try {
      await s3SyncService.scheduleRestore(buildConfig());
      toast.success(t.Settings.s3Sync.restoreScheduled);
    } catch (error) {
      logger.error('[S3SyncSettings] Restore schedule failed:', error);
      toast.error(t.Settings.s3Sync.restoreScheduleFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="border-muted/60">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Cloud className="h-5 w-5" />
            <CardTitle className="text-lg">{t.Settings.s3Sync.title}</CardTitle>
          </div>
          <CardDescription>{t.Settings.s3Sync.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <Label className="text-sm font-medium">{t.Settings.s3Sync.enabled}</Label>
              <p className="text-xs text-muted-foreground">{t.Settings.s3Sync.enabledHint}</p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>

          <p className="text-xs text-muted-foreground">{t.Settings.s3Sync.warning}</p>

          <div className="space-y-2">
            <Label htmlFor={endpointId}>{t.Settings.s3Sync.endpoint}</Label>
            <Input
              id={endpointId}
              placeholder={t.Settings.s3Sync.endpointPlaceholder}
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={regionId}>{t.Settings.s3Sync.region}</Label>
              <Input
                id={regionId}
                placeholder="us-east-1"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor={bucketId}>{t.Settings.s3Sync.bucket}</Label>
              <Input
                id={bucketId}
                placeholder={t.Settings.s3Sync.bucketPlaceholder}
                value={bucket}
                onChange={(e) => setBucket(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor={accessKeyId}>{t.Settings.s3Sync.accessKeyId}</Label>
            <Input
              id={accessKeyId}
              placeholder={t.Settings.s3Sync.accessKeyIdPlaceholder}
              value={accessKey}
              onChange={(e) => setAccessKey(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={secretAccessKeyId}>{t.Settings.s3Sync.secretAccessKey}</Label>
            <Input
              id={secretAccessKeyId}
              type="password"
              placeholder={t.Settings.s3Sync.secretAccessKeyPlaceholder}
              value={secretAccessKey}
              onChange={(e) => setSecretAccessKey(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={sessionTokenId}>{t.Settings.s3Sync.sessionToken}</Label>
            <Input
              id={sessionTokenId}
              type="password"
              placeholder={t.Settings.s3Sync.sessionTokenPlaceholder}
              value={sessionToken}
              onChange={(e) => setSessionToken(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t.Settings.s3Sync.sessionTokenHint}</p>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div>
              <Label className="text-sm font-medium">{t.Settings.s3Sync.pathStyle}</Label>
              <p className="text-xs text-muted-foreground">{t.Settings.s3Sync.pathStyleHint}</p>
            </div>
            <Switch checked={pathStyle} onCheckedChange={setPathStyle} />
          </div>

          <div className="space-y-2">
            <Label htmlFor={namespaceId}>{t.Settings.s3Sync.namespace}</Label>
            <Input
              id={namespaceId}
              placeholder={t.Settings.s3Sync.namespacePlaceholder}
              value={namespace}
              onChange={(e) => setNamespace(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t.Settings.s3Sync.namespaceHint}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor={keyPrefixId}>{t.Settings.s3Sync.keyPrefix}</Label>
            <Input
              id={keyPrefixId}
              placeholder="talkcody-sync"
              value={keyPrefix}
              onChange={(e) => setKeyPrefix(e.target.value)}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-muted-foreground">
              {lastBackupAt
                ? t.Settings.s3Sync.lastBackupAt(new Date(Number(lastBackupAt)).toLocaleString())
                : t.Settings.s3Sync.lastBackupNone}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent disabled:opacity-60"
                disabled={busy}
                onClick={handleTest}
              >
                <RefreshCw className="h-4 w-4" />
                {t.Settings.s3Sync.testConnection}
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent disabled:opacity-60"
                disabled={busy}
                onClick={handleBackup}
              >
                <Upload className="h-4 w-4" />
                {t.Settings.s3Sync.backupNow}
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent disabled:opacity-60"
                disabled={busy}
                onClick={handleRestore}
              >
                <Upload className="h-4 w-4 rotate-180" />
                {t.Settings.s3Sync.restore}
              </button>
              <button
                type="button"
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
                disabled={busy}
                onClick={async () => {
                  await handleSave();
                }}
              >
                {t.Settings.s3Sync.save}
              </button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
