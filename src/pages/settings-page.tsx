import {
  Bot,
  Cloud,
  Code,
  FileCode,
  GitBranch,
  Info,
  Key,
  Keyboard,
  Settings,
  Terminal,
  User,
  Wrench,
  Zap,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { AboutSettings } from '@/components/settings/about-settings';
import { AccountSettings } from '@/components/settings/account-settings';
import { ApiKeysSettings } from '@/components/settings/api-keys-settings';
import { CustomToolsSettings } from '@/components/settings/custom-tools-settings';
import { GeneralSettings } from '@/components/settings/general-settings';
import { HooksSettings } from '@/components/settings/hooks-settings';
import { LintSettings } from '@/components/settings/lint-settings';
import { LspSettings } from '@/components/settings/lsp-settings';
import { ModelTypeSettings } from '@/components/settings/model-type-settings';
import { TerminalSettings } from '@/components/settings/terminal-settings';
import { WebdavSettings } from '@/components/settings/webdav-settings';
import { WorktreeSettings } from '@/components/settings/worktree-settings';
import { ShortcutSettingsPanel } from '@/components/shortcuts/shortcut-settings';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useLocale } from '@/hooks/use-locale';

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState('api-keys');
  const { t } = useLocale();

  // Listen for keyboard shortcut to open model settings tab
  useEffect(() => {
    const handleOpenModelSettings = () => {
      setActiveTab('models');
    };

    window.addEventListener('openModelSettingsTab', handleOpenModelSettings);
    return () => {
      window.removeEventListener('openModelSettingsTab', handleOpenModelSettings);
    };
  }, []);

  return (
    <div className="flex h-full bg-white dark:bg-gray-950">
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        orientation="vertical"
        className="flex h-full w-full flex-row"
      >
        {/* Left sidebar navigation */}
        <aside className="w-56 shrink-0 border-r p-4">
          <TabsList className="flex h-auto w-full flex-col gap-1 bg-transparent">
            <TabsTrigger
              value="account"
              className="w-full justify-start gap-2 rounded-md px-3 py-2"
            >
              <User className="size-4" />
              {t.Settings.tabs.account}
            </TabsTrigger>
            <TabsTrigger
              value="api-keys"
              className="w-full justify-start gap-2 rounded-md px-3 py-2"
            >
              <Key className="size-4" />
              {t.Settings.tabs.apiKeys}
            </TabsTrigger>
            <TabsTrigger value="models" className="w-full justify-start gap-2 rounded-md px-3 py-2">
              <Bot className="size-4" />
              {t.Settings.tabs.models}
            </TabsTrigger>

            <Separator className="my-2" />

            <TabsTrigger
              value="general"
              className="w-full justify-start gap-2 rounded-md px-3 py-2"
            >
              <Settings className="size-4" />
              {t.Settings.tabs.general || 'General'}
            </TabsTrigger>

            <TabsTrigger
              value="shortcuts"
              className="w-full justify-start gap-2 rounded-md px-3 py-2"
            >
              <Keyboard className="size-4" />
              {t.Settings.tabs.shortcuts}
            </TabsTrigger>

            <Separator className="my-2" />

            <TabsTrigger
              value="terminal"
              className="w-full justify-start gap-2 rounded-md px-3 py-2"
            >
              <Terminal className="size-4" />
              {t.Settings.tabs.terminal || 'Terminal'}
            </TabsTrigger>
            <TabsTrigger value="lint" className="w-full justify-start gap-2 rounded-md px-3 py-2">
              <FileCode className="size-4" />
              {t.Settings.tabs.lint || 'Lint'}
            </TabsTrigger>
            <TabsTrigger value="lsp" className="w-full justify-start gap-2 rounded-md px-3 py-2">
              <Code className="size-4" />
              {t.Settings.tabs.lsp || 'LSP'}
            </TabsTrigger>
            <TabsTrigger
              value="worktree"
              className="w-full justify-start gap-2 rounded-md px-3 py-2"
            >
              <GitBranch className="size-4" />
              {t.Settings.tabs.worktree || 'Worktree'}
            </TabsTrigger>
            <TabsTrigger
              value="custom-tools"
              className="w-full justify-start gap-2 rounded-md px-3 py-2"
            >
              <Wrench className="size-4" />
              {t.Settings.tabs.customTools}
            </TabsTrigger>
            <TabsTrigger value="hooks" className="w-full justify-start gap-2 rounded-md px-3 py-2">
              <Zap className="size-4" />
              {t.Settings.tabs.hooks}
            </TabsTrigger>
            <TabsTrigger value="webdav" className="w-full justify-start gap-2 rounded-md px-3 py-2">
              <Cloud className="size-4" />
              WebDAV
            </TabsTrigger>

            <Separator className="my-2" />

            <TabsTrigger value="about" className="w-full justify-start gap-2 rounded-md px-3 py-2">
              <Info className="size-4" />
              {t.Settings.tabs.about}
            </TabsTrigger>
          </TabsList>
        </aside>

        {/* Right content area */}
        <main className="flex-1 overflow-y-auto p-6">
          <div className="max-w-5xl">
            <TabsContent value="account" className="mt-0 flex-none space-y-6">
              <AccountSettings />
            </TabsContent>

            <TabsContent value="api-keys" className="mt-0 flex-none space-y-6">
              <ApiKeysSettings />
            </TabsContent>

            <TabsContent value="models" className="mt-0 flex-none space-y-6">
              <ModelTypeSettings />
            </TabsContent>

            <TabsContent value="terminal" className="mt-0 flex-none space-y-6">
              <TerminalSettings />
            </TabsContent>

            <TabsContent value="lint" className="mt-0 flex-none space-y-6">
              <LintSettings />
            </TabsContent>

            <TabsContent value="lsp" className="mt-0 flex-none space-y-6">
              <LspSettings />
            </TabsContent>

            <TabsContent value="worktree" className="mt-0 flex-none space-y-6">
              <WorktreeSettings />
            </TabsContent>

            <TabsContent value="custom-tools" className="mt-0 flex-none space-y-6">
              <CustomToolsSettings />
            </TabsContent>

            <TabsContent value="hooks" className="mt-0 flex-none space-y-6">
              <HooksSettings />
            </TabsContent>

            <TabsContent value="webdav" className="mt-0 flex-none space-y-6">
              <WebdavSettings />
            </TabsContent>

            <TabsContent value="shortcuts" className="mt-0 flex-none space-y-6">
              <ShortcutSettingsPanel />
            </TabsContent>

            <TabsContent value="general" className="mt-0 flex-none space-y-6">
              <GeneralSettings />
            </TabsContent>

            <TabsContent value="about" className="mt-0 flex-none space-y-6">
              <AboutSettings />
            </TabsContent>
          </div>
        </main>
      </Tabs>
    </div>
  );
}
