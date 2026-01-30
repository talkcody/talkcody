import { Cloud, RefreshCw, TestTube, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useLocale } from '@/hooks/use-locale';
import { logger } from '@/lib/logger';
import { WebDAVClient } from '@/services/sync';
import { useSyncStore } from '@/stores/sync-store';
import type { SyncConfig } from '@/types';
import { ConflictResolution, SyncDirection } from '@/types';

export function WebdavSettings() {
  const { t } = useLocale();
  const syncStore = useSyncStore();

  // Form state
  const [url, setUrl] = useState('https://dav.jianguoyun.com/dav/');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [syncPath, setSyncPath] = useState('/talkcody');
  const [autoSync, setAutoSync] = useState(false);
  const [syncInterval, setSyncInterval] = useState('60');

  // UI state
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  const { isInitialized, isEnabled, isSyncing, syncState } = syncStore;

  // Test WebDAV connection
  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);

    try {
      const testConfig: SyncConfig = {
        webdav: {
          url: url.trim(),
          username: username.trim(),
          password: password.trim(),
          syncPath: syncPath.trim(),
          timeout: 10000,
        },
        direction: SyncDirection.BIDIRECTIONAL,
        conflictResolution: ConflictResolution.TIMESTAMP,
        autoSync: false,
      };

      // Create a temporary WebDAV client to test connection
      const client = new WebDAVClient(testConfig.webdav);
      const result = await client.testConnection();

      if (result.success) {
        if (result.pathExists === false) {
          // 连接成功但路径不存在
          setTestResult({
            success: true,
            message: result.error || t.Settings.webdav.messages.testSuccessPathNotExists,
          });
        } else {
          setTestResult({
            success: true,
            message: t.Settings.webdav.messages.testSuccess,
          });
        }
        logger.info('WebDAV connection test successful');
      } else {
        setTestResult({
          success: false,
          message: t.Settings.webdav.messages.testFailed(result.error || '未知错误'),
        });
        logger.error('WebDAV connection test failed:', result.error);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      setTestResult({
        success: false,
        message: t.Settings.webdav.messages.testFailed(errorMessage),
      });
      logger.error('WebDAV connection test failed:', error);
    } finally {
      setTesting(false);
    }
  };

  // Save configuration
  const handleSaveConfig = async () => {
    setSaving(true);
    setTestResult(null);

    try {
      const config: SyncConfig = {
        webdav: {
          url: url.trim(),
          username: username.trim(),
          password: password.trim(),
          syncPath: syncPath.trim(),
          timeout: 30000,
        },
        direction: SyncDirection.BIDIRECTIONAL,
        conflictResolution: ConflictResolution.TIMESTAMP,
        autoSync: autoSync,
        autoSyncInterval: parseInt(syncInterval, 10) * 1000,
      };

      // 测试连接并创建同步目录
      const client = new WebDAVClient(config.webdav);
      const testResult = await client.testConnection();

      if (!testResult.success) {
        setTestResult({
          success: false,
          message: t.Settings.webdav.messages.connectFailed(testResult.error || '未知错误'),
        });
        return;
      }

      // 如果路径不存在，尝试创建
      if (testResult.pathExists === false) {
        try {
          logger.info('Creating sync path:', config.webdav.syncPath);
          await client.createDirectory('');
          logger.info('Sync path created successfully');
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          setTestResult({
            success: false,
            message: t.Settings.webdav.messages.createPathFailed(errorMessage),
          });
          logger.error('Failed to create sync path:', error);
          return;
        }
      }

      if (isInitialized) {
        // Update existing config
        await syncStore.updateConfig(config);
      } else {
        // Initialize new config
        await syncStore.initialize(config);
      }

      // Enable sync if disabled
      if (!isEnabled) {
        await syncStore.enableSync();
      }

      setTestResult({
        success: true,
        message: t.Settings.webdav.messages.saveSuccess,
      });
      logger.info('WebDAV config saved successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      setTestResult({
        success: false,
        message: t.Settings.webdav.messages.saveFailed(errorMessage),
      });
      logger.error('Failed to save WebDAV config:', error);
    } finally {
      setSaving(false);
    }
  };

  // Clear configuration
  const handleClearConfig = async () => {
    try {
      await syncStore.destroy();
      setUsername('');
      setPassword('');
      setAutoSync(false);
      setTestResult({
        success: true,
        message: t.Settings.webdav.messages.clearSuccess,
      });
      logger.info('WebDAV config cleared');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      setTestResult({
        success: false,
        message: t.Settings.webdav.messages.clearFailed(errorMessage),
      });
      logger.error('Failed to clear WebDAV config:', error);
    }
  };

  // Manual sync
  const handleManualSync = async () => {
    try {
      await syncStore.performSync(
        async () => ({}),
        async (_id) => ({ data: 'value' }),
        async (_id, _data) => {},
        async (_id) => {}
      );
      setTestResult({
        success: true,
        message: t.Settings.webdav.messages.syncSuccess,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      setTestResult({
        success: false,
        message: t.Settings.webdav.messages.syncFailed(errorMessage),
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Main Configuration Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Cloud className="h-5 w-5" />
            <CardTitle className="text-lg">{t.Settings.webdav.title}</CardTitle>
          </div>
          <CardDescription>{t.Settings.webdav.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Status Section */}
          {isInitialized && (
            <div className="rounded-lg border p-4">
              <h3 className="mb-2 font-medium">{t.Settings.webdav.status.title}</h3>
              <div className="space-y-1 text-sm text-gray-600 dark:text-gray-400">
                <div className="flex items-center justify-between">
                  <span>{t.Settings.webdav.status.configured}:</span>
                  <span className="font-medium">{isEnabled ? t.Common.yes : t.Common.no}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>{t.Settings.webdav.status.status}:</span>
                  <span className="font-medium">
                    {isSyncing ? t.Settings.webdav.status.syncing : syncState.status}
                  </span>
                </div>
                {syncState.lastSyncTime && (
                  <div className="flex items-center justify-between">
                    <span>{t.Settings.webdav.status.lastSync}:</span>
                    <span className="font-medium">
                      {new Date(syncState.lastSyncTime).toLocaleString()}
                    </span>
                  </div>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={handleManualSync}
                disabled={isSyncing}
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`} />
                {t.Settings.webdav.syncNow}
              </Button>
            </div>
          )}

          {/* WebDAV URL */}
          <div className="space-y-2">
            <Label htmlFor="webdav-url">{t.Settings.webdav.serverUrl}</Label>
            <Input
              id="webdav-url"
              placeholder={t.Settings.webdav.serverUrlPlaceholder}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={isSyncing}
            />
            <p className="text-xs text-gray-500">{t.Settings.webdav.serverUrlHint}</p>
          </div>

          {/* Username */}
          <div className="space-y-2">
            <Label htmlFor="webdav-username">{t.Settings.webdav.username}</Label>
            <Input
              id="webdav-username"
              placeholder={t.Settings.webdav.usernamePlaceholder}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={isSyncing}
            />
            <p className="text-xs text-gray-500">{t.Settings.webdav.usernameHint}</p>
          </div>

          {/* Password */}
          <div className="space-y-2">
            <Label htmlFor="webdav-password">{t.Settings.webdav.password}</Label>
            <Input
              id="webdav-password"
              type="password"
              placeholder={t.Settings.webdav.passwordPlaceholder}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isSyncing}
            />
            <p className="text-xs text-gray-500">{t.Settings.webdav.passwordHint}</p>
          </div>

          {/* Sync Path */}
          <div className="space-y-2">
            <Label htmlFor="webdav-path">{t.Settings.webdav.syncPath}</Label>
            <Input
              id="webdav-path"
              placeholder={t.Settings.webdav.syncPathPlaceholder}
              value={syncPath}
              onChange={(e) => setSyncPath(e.target.value)}
              disabled={isSyncing}
            />
            <p className="text-xs text-gray-500">{t.Settings.webdav.syncPathHint}</p>
          </div>

          {/* Auto Sync */}
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="space-y-0.5">
              <Label htmlFor="auto-sync">{t.Settings.webdav.autoSync}</Label>
              <p className="text-xs text-gray-500">{t.Settings.webdav.autoSyncDescription}</p>
            </div>
            <div className="flex items-center gap-4">
              <Input
                type="number"
                min="1"
                max="1440"
                value={syncInterval}
                onChange={(e) => setSyncInterval(e.target.value)}
                disabled={isSyncing || !autoSync}
                className="w-20"
              />
              <span className="text-sm text-gray-600">{t.Settings.webdav.syncIntervalUnit}</span>
              <Switch
                id="auto-sync"
                checked={autoSync}
                onCheckedChange={setAutoSync}
                disabled={isSyncing}
              />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={handleTestConnection}
              disabled={testing || isSyncing || !url || !username || !password}
              variant="outline"
            >
              <TestTube className={`mr-2 h-4 w-4 ${testing ? 'animate-pulse' : ''}`} />
              {testing ? t.Settings.webdav.testing : t.Settings.webdav.testConnection}
            </Button>
            <Button
              onClick={handleSaveConfig}
              disabled={saving || isSyncing || !url || !username || !password}
            >
              {saving ? t.Settings.webdav.saving : t.Settings.webdav.saveConfig}
            </Button>
            {isInitialized && (
              <Button onClick={handleClearConfig} disabled={isSyncing} variant="destructive">
                <Trash2 className="mr-2 h-4 w-4" />
                {t.Settings.webdav.clearConfig}
              </Button>
            )}
          </div>

          {/* Test Result */}
          {testResult && (
            <div
              className={`rounded-lg border p-4 ${
                testResult.success
                  ? 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950'
                  : 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950'
              }`}
            >
              <p
                className={`text-sm ${
                  testResult.success
                    ? 'text-green-800 dark:text-green-200'
                    : 'text-red-800 dark:text-red-200'
                }`}
              >
                {testResult.message}
              </p>
            </div>
          )}

          {/* Help Section */}
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950">
            <h4 className="mb-2 font-medium text-blue-900 dark:text-blue-100">
              {t.Settings.webdav.help.title}
            </h4>
            <ul className="space-y-1 text-xs text-blue-800 dark:text-blue-200">
              <li>{t.Settings.webdav.help.jianguoyun}</li>
              <li>{t.Settings.webdav.help.nextcloud}</li>
              <li>{t.Settings.webdav.help.network}</li>
              <li>{t.Settings.webdav.help.firstTime}</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
