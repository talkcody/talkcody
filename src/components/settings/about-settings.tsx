import { getVersion } from '@tauri-apps/api/app';
import { type as osType, platform } from '@tauri-apps/plugin-os';
import { AlertCircle, Download, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { UpdateDialog } from '@/components/update-dialog';
import { useLocale } from '@/hooks/use-locale';
import { useUpdater } from '@/hooks/use-updater';
import { logger } from '@/lib/logger';

export function AboutSettings() {
  const { t } = useLocale();
  const [appVersion, setAppVersion] = useState<string>('');
  const [platformName, setPlatformName] = useState<string>('');
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const [lastCheckTime, setLastCheckTime] = useState<string | null>(null);
  const updater = useUpdater({ checkOnMount: false, periodicCheck: false });

  useEffect(() => {
    const loadVersion = async () => {
      try {
        const version = await getVersion();
        setAppVersion(version);
      } catch (error) {
        logger.error('Failed to get app version:', error);
      }
    };

    const loadPlatform = () => {
      try {
        const os = osType();
        const plat = platform();
        const osNames: Record<string, string> = {
          windows: 'Windows',
          macos: 'macOS',
          linux: 'Linux',
        };
        const displayName = osNames[os] || plat;
        setPlatformName(displayName);
      } catch (error) {
        logger.error('Failed to get platform:', error);
        setPlatformName('Unknown');
      }
    };

    const loadLastCheckTime = () => {
      const lastCheck = localStorage.getItem('last_update_check');
      if (lastCheck) {
        const date = new Date(Number.parseInt(lastCheck, 10));
        setLastCheckTime(date.toLocaleString());
      }
    };

    loadVersion();
    loadPlatform();
    loadLastCheckTime();
  }, []);

  // Update last check time when update check completes
  useEffect(() => {
    if (!updater.checking && lastCheckTime === null) {
      const lastCheck = localStorage.getItem('last_update_check');
      if (lastCheck) {
        const date = new Date(Number.parseInt(lastCheck, 10));
        setLastCheckTime(date.toLocaleString());
      }
    }
  }, [updater.checking, lastCheckTime]);

  const handleCheckForUpdate = async () => {
    await updater.checkForUpdate();

    // Update last check time
    const lastCheck = localStorage.getItem('last_update_check');
    if (lastCheck) {
      const date = new Date(Number.parseInt(lastCheck, 10));
      setLastCheckTime(date.toLocaleString());
    }

    if (updater.available) {
      setUpdateDialogOpen(true);
    } else if (!updater.error) {
      toast.success(t.Settings.about.upToDate);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t.Settings.about.title}</CardTitle>
          <CardDescription>{t.Settings.about.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Version Information */}
          <div className="space-y-3">
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-muted-foreground">{t.Settings.about.version}</span>
              <span className="text-sm font-medium">{appVersion || t.Common.loading}</span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-muted-foreground">{t.Settings.about.platform}</span>
              <span className="text-sm font-medium">{platformName || 'Loading...'}</span>
            </div>
          </div>

          {/* Update Section */}
          <div className="space-y-4 border-t pt-4">
            <div className="space-y-2">
              <h4 className="text-sm font-medium">{t.Settings.about.softwareUpdates}</h4>
              <p className="text-xs text-muted-foreground">
                {t.Settings.about.softwareUpdatesDescription}
              </p>
            </div>

            {lastCheckTime && (
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{t.Settings.about.lastChecked}</span>
                <span>{lastCheckTime}</span>
              </div>
            )}

            <Button
              onClick={handleCheckForUpdate}
              disabled={updater.checking}
              variant="outline"
              className="w-full"
            >
              {updater.checking ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  {t.Settings.about.checkingForUpdates}
                </>
              ) : (
                <>
                  <Download className="mr-2 h-4 w-4" />
                  {t.Settings.about.checkForUpdates}
                </>
              )}
            </Button>

            {updater.error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-xs">{updater.error}</AlertDescription>
              </Alert>
            )}
          </div>

          {/* Links */}
          <div className="space-y-2 border-t pt-4">
            <h4 className="text-sm font-medium">{t.Settings.about.resources}</h4>
            <div className="space-y-1">
              <a
                href="https://github.com/talkcody/talkcody"
                target="_blank"
                rel="noopener noreferrer"
                className="block text-xs text-muted-foreground hover:text-primary"
              >
                {t.Settings.about.githubRepository}
              </a>
              <a
                href="https://talkcody.com"
                target="_blank"
                rel="noopener noreferrer"
                className="block text-xs text-muted-foreground hover:text-primary"
              >
                {t.Settings.about.website}
              </a>
            </div>
          </div>
        </CardContent>
      </Card>

      <UpdateDialog open={updateDialogOpen} onOpenChange={setUpdateDialogOpen} updater={updater} />
    </>
  );
}
