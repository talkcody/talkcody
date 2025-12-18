import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { platform } from '@tauri-apps/plugin-os';
import {
  AlertCircle,
  AlertTriangle,
  Check,
  ExternalLink,
  FolderOpen,
  GitBranch,
  Info,
  Moon,
  Settings,
  Sun,
  Terminal,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { LINT_SUPPORTED_LANGUAGES_DISPLAY } from '@/constants/lint';
import { useLocale } from '@/hooks/use-locale';
import { useTheme } from '@/hooks/use-theme';
import type { SupportedLocale } from '@/locales';
import { useLintStore } from '@/stores/lint-store';
import { useSettingsStore } from '@/stores/settings-store';

interface RuntimeStatus {
  bun_available: boolean;
  node_available: boolean;
}

// Shell options for Windows
const SHELL_OPTIONS = [
  { value: 'auto', label: 'Auto', description: 'Automatically detect best shell' },
  { value: 'pwsh', label: 'PowerShell Core', description: 'Modern cross-platform PowerShell' },
  { value: 'powershell', label: 'Windows PowerShell', description: 'Built-in Windows PowerShell' },
  { value: 'cmd', label: 'CMD', description: 'Windows Command Prompt' },
] as const;

export function GeneralSettings() {
  const { locale, t, setLocale, supportedLocales } = useLocale();
  const { resolvedTheme, toggleTheme } = useTheme();
  const { settings, updateSettings } = useLintStore();
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(null);
  const [isWindows, setIsWindows] = useState(false);
  const [defaultWorktreeRoot, setDefaultWorktreeRoot] = useState<string>('');
  const terminalShell = useSettingsStore((state) => state.terminal_shell);
  const setTerminalShell = useSettingsStore((state) => state.setTerminalShell);
  const worktreeRootPath = useSettingsStore((state) => state.worktree_root_path);
  const setWorktreeRootPath = useSettingsStore((state) => state.setWorktreeRootPath);

  useEffect(() => {
    // Detect Windows platform
    setIsWindows(platform() === 'windows');
  }, []);

  useEffect(() => {
    invoke<RuntimeStatus>('check_lint_runtime')
      .then(setRuntimeStatus)
      .catch(() => {
        // If the command fails, assume no runtime is available
        setRuntimeStatus({ bun_available: false, node_available: false });
      });
  }, []);

  useEffect(() => {
    invoke<string>('git_get_default_worktree_root')
      .then(setDefaultWorktreeRoot)
      .catch(console.error);
  }, []);

  const handleLanguageChange = async (value: SupportedLocale) => {
    await setLocale(value);
  };

  const handleLintToggle = (key: keyof typeof settings) => (value: boolean) => {
    updateSettings({ [key]: value });
  };

  const handleSelectWorktreeRoot = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: t.Settings.worktree?.selectDirectory || 'Select Worktree Directory',
    });
    if (selected && typeof selected === 'string') {
      await setWorktreeRootPath(selected);
    }
  };

  const handleResetWorktreeRoot = async () => {
    await setWorktreeRootPath('');
  };

  return (
    <div className="space-y-6">
      {/* Language & Theme Settings */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            <CardTitle className="text-lg">{t.Settings.tabs.general || 'General'}</CardTitle>
          </div>
          <CardDescription>{t.Settings.general.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Language Section */}
          <div>
            <h3 className="mb-3 text-sm font-medium">{t.Settings.language.title}</h3>
            <div className="space-y-2">
              {supportedLocales.map((lang) => (
                <button
                  type="button"
                  key={lang.code}
                  className="flex w-full items-center justify-between rounded-lg border p-4 text-left transition-colors hover:bg-accent"
                  onClick={() => handleLanguageChange(lang.code)}
                >
                  <span className="font-medium">{lang.name}</span>
                  {locale === lang.code && <Check className="h-4 w-4 text-primary" />}
                </button>
              ))}
            </div>
          </div>

          {/* Theme Section */}
          <div>
            <h3 className="mb-3 text-sm font-medium">{t.Settings.theme.title}</h3>
            <div className="space-y-2">
              <button
                type="button"
                className="flex w-full items-center justify-between rounded-lg border p-4 text-left transition-colors hover:bg-accent"
                onClick={() => toggleTheme()}
              >
                <div className="flex items-center gap-3">
                  {resolvedTheme === 'light' ? (
                    <Sun className="h-4 w-4" />
                  ) : (
                    <Moon className="h-4 w-4" />
                  )}
                  <span className="font-medium">{t.Settings.theme.options[resolvedTheme]}</span>
                </div>
                <span className="text-sm text-gray-500">
                  {t.Settings.theme.switchTo}{' '}
                  {t.Settings.theme.options[resolvedTheme === 'light' ? 'dark' : 'light']}
                </span>
              </button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Lint Settings */}
      <Card>
        <CardHeader>
          <CardTitle>{t.Lint.settings.title}</CardTitle>
          <CardDescription>{t.Lint.settings.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Runtime Warning */}
          {runtimeStatus && !runtimeStatus.bun_available && !runtimeStatus.node_available && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>{t.Lint.settings.runtimeWarning}</AlertTitle>
              <AlertDescription>
                <p className="mb-3">{t.Lint.settings.runtimeWarningDesc}</p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" asChild>
                    <a
                      href="https://nodejs.org/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="gap-1"
                    >
                      {t.Lint.settings.downloadNode}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </Button>
                  <Button variant="outline" size="sm" asChild>
                    <a
                      href="https://bun.sh/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="gap-1"
                    >
                      {t.Lint.settings.downloadBun}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {/* Enable Lint */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">{t.Lint.settings.enableLint}</Label>
              <p className="text-sm text-muted-foreground">{t.Lint.settings.enableLintDesc}</p>
            </div>
            <Switch checked={settings.enabled} onCheckedChange={handleLintToggle('enabled')} />
          </div>
          <Separator />
          {/* Supported Languages */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">{t.Lint.settings.supportedLanguages}</Label>
            <div className="flex flex-wrap gap-2">
              {LINT_SUPPORTED_LANGUAGES_DISPLAY.map((lang) => (
                <Badge key={lang.name} variant="secondary" className="text-xs">
                  {lang.name} ({lang.extensions})
                </Badge>
              ))}
            </div>
          </div>
          <Separator />
          {/* Severity Settings */}
          <div className="space-y-4">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">{t.Lint.settings.severitySettings}</Label>
              <p className="text-xs text-muted-foreground">
                {t.Lint.settings.severitySettingsDesc}
              </p>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-red-500" />
                  <span className="text-sm">{t.Lint.showErrors}</span>
                </div>
                <Switch
                  checked={settings.showErrors}
                  onCheckedChange={handleLintToggle('showErrors')}
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-yellow-500" />
                  <span className="text-sm">{t.Lint.showWarnings}</span>
                </div>
                <Switch
                  checked={settings.showWarnings}
                  onCheckedChange={handleLintToggle('showWarnings')}
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Info className="h-4 w-4 text-blue-500" />
                  <span className="text-sm">{t.Lint.showInfo}</span>
                </div>
                <Switch
                  checked={settings.showInfo}
                  onCheckedChange={handleLintToggle('showInfo')}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Terminal Settings - Windows Only */}
      {isWindows && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Terminal className="h-5 w-5" />
              <CardTitle className="text-lg">{t.Settings.terminal?.title || 'Terminal'}</CardTitle>
            </div>
            <CardDescription>
              {t.Settings.terminal?.description ||
                'Configure default shell for the integrated terminal'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label className="text-sm font-medium">
                {t.Settings.terminal?.defaultShell || 'Default Shell'}
              </Label>
              <Select
                value={terminalShell || 'auto'}
                onValueChange={(value) => setTerminalShell(value)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select shell" />
                </SelectTrigger>
                <SelectContent>
                  {SHELL_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      <div className="flex flex-col">
                        <span>{option.label}</span>
                        <span className="text-xs text-muted-foreground">{option.description}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t.Settings.terminal?.shellHint ||
                  'Changes will take effect on the next terminal session.'}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Worktree Settings */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <GitBranch className="h-5 w-5" />
            <CardTitle className="text-lg">
              {t.Settings.worktree?.title || 'Worktree Settings'}
            </CardTitle>
          </div>
          <CardDescription>
            {t.Settings.worktree?.description || 'Configure where worktree directories are stored'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-sm font-medium">
              {t.Settings.worktree?.rootPath || 'Worktree Root Directory'}
            </Label>
            <div className="flex gap-2">
              <Input
                value={worktreeRootPath || defaultWorktreeRoot}
                placeholder={defaultWorktreeRoot}
                readOnly
                className="flex-1"
              />
              <Button variant="outline" size="icon" onClick={handleSelectWorktreeRoot}>
                <FolderOpen className="h-4 w-4" />
              </Button>
              {worktreeRootPath && (
                <Button variant="outline" onClick={handleResetWorktreeRoot}>
                  {t.Common?.reset || 'Reset'}
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {worktreeRootPath
                ? t.Settings.worktree?.customPathHint ||
                  'Using custom path. Click reset to use default.'
                : (t.Settings.worktree?.defaultPathHint || 'Using default path: {path}').replace(
                    '{path}',
                    defaultWorktreeRoot
                  )}
            </p>
          </div>

          {/* Path Preview */}
          <div className="rounded-md bg-muted p-3">
            <p className="mb-1 text-xs font-medium">
              {t.Settings.worktree?.pathPreview || 'Example worktree path:'}
            </p>
            <code className="text-xs">
              {worktreeRootPath || defaultWorktreeRoot}/project-name/pool-0
            </code>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
