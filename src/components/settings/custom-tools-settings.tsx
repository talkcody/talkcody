import { open } from '@tauri-apps/plugin-dialog';
import { AlertCircle, FolderOpen, RefreshCw } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useLocale } from '@/hooks/use-locale';
import { useCustomToolsStore } from '@/stores/custom-tools-store';
import { useSettingsStore } from '@/stores/settings-store';

export function CustomToolsSettings() {
  const { t } = useLocale();
  const { tools, isLoading, refresh } = useCustomToolsStore();
  const activeRootPath = useSettingsStore((state) => state.current_root_path) || '';
  const customToolsDir = useSettingsStore((state) => state.custom_tools_dir) || '';
  const setCustomToolsDir = useSettingsStore((state) => state.setCustomToolsDir);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleRefresh = () => {
    refresh();
  };

  const handleSelectDirectory = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: t.Settings.customTools.selectDirectory,
    });

    if (selected && typeof selected === 'string') {
      await setCustomToolsDir(selected);
      handleRefresh();
    }
  };

  const handleResetDirectory = async () => {
    await setCustomToolsDir('');
    handleRefresh();
  };

  const workspaceDirectoryLabel = useMemo(() => {
    if (!activeRootPath) return '.talkcody/tools';
    return `${activeRootPath}/.talkcody/tools`;
  }, [activeRootPath]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5" />
            <CardTitle className="text-lg">{t.Settings.customTools.title}</CardTitle>
          </div>
          <CardDescription>{t.Settings.customTools.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3 text-sm">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-muted-foreground sm:max-w-xl">
                {t.Settings.customTools.sourcesHint}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSelectDirectory}
                  disabled={isLoading}
                >
                  <FolderOpen className="h-4 w-4 mr-1" />
                  {t.Settings.customTools.selectDirectory}
                </Button>
                {customToolsDir ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleResetDirectory}
                    disabled={isLoading}
                  >
                    {t.Common.reset}
                  </Button>
                ) : null}
                <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isLoading}>
                  <RefreshCw className="h-4 w-4 mr-1" />
                  {isLoading ? t.Common.loading : t.Common.refresh}
                </Button>
              </div>
            </div>

            <div className="rounded-md border p-3 text-xs space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{t.Settings.customTools.customDirectoryLabel}</span>
                <span className="font-mono truncate" title={customToolsDir || undefined}>
                  {customToolsDir || t.Settings.customTools.customDirectoryUnset}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 text-muted-foreground">
                <span>{t.Settings.customTools.workspaceDirectoryLabel}</span>
                <span className="font-mono truncate" title={workspaceDirectoryLabel}>
                  {workspaceDirectoryLabel}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 text-muted-foreground">
                <span>{t.Settings.customTools.homeDirectoryLabel}</span>
                <span className="font-mono truncate" title="~/.talkcody/tools">
                  ~/.talkcody/tools
                </span>
              </div>
            </div>
          </div>

          {tools.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <AlertCircle className="h-4 w-4" />
              {t.Settings.customTools.empty}
            </div>
          ) : (
            <div className="space-y-2">
              {tools.map((tool) => (
                <div
                  key={`${tool.filePath}-${tool.name}`}
                  className="flex items-center justify-between rounded-md border p-3"
                >
                  <div>
                    <div className="font-medium">{tool.name}</div>
                    <div className="text-xs text-muted-foreground font-mono" title={tool.filePath}>
                      {tool.filePath}
                    </div>
                  </div>
                  <div className="text-xs">
                    {tool.status === 'loaded' ? (
                      <span className="text-green-600 dark:text-green-400">{t.Common.enabled}</span>
                    ) : (
                      <span className="text-red-600 dark:text-red-400">
                        {tool.error || t.Common.error}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
