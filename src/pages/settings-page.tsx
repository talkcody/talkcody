import { useEffect, useState } from 'react';
import { AboutSettings } from '@/components/settings/about-settings';
import { AccountSettings } from '@/components/settings/account-settings';
import { ApiKeysSettings } from '@/components/settings/api-keys-settings';
import { LanguageSettings } from '@/components/settings/language-settings';
import { ModelTypeSettings } from '@/components/settings/model-type-settings';
import { ShortcutSettingsPanel } from '@/components/shortcuts/shortcut-settings';
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
    <div className="flex h-full flex-col bg-white dark:bg-gray-950">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-6 py-4">
        <div>
          <h1 className="text-2xl font-bold">{t.Settings.title}</h1>
          <p className="mt-1 text-gray-600 dark:text-gray-400">{t.Settings.description}</p>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl p-6">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full w-full">
            <TabsList className="grid w-full grid-cols-6">
              <TabsTrigger value="account">{t.Settings.tabs.account}</TabsTrigger>
              <TabsTrigger value="api-keys">{t.Settings.tabs.apiKeys}</TabsTrigger>
              <TabsTrigger value="models">{t.Settings.tabs.models}</TabsTrigger>
              <TabsTrigger value="shortcuts">{t.Settings.tabs.shortcuts}</TabsTrigger>
              <TabsTrigger value="language">{t.Settings.tabs.language}</TabsTrigger>
              <TabsTrigger value="about">{t.Settings.tabs.about}</TabsTrigger>
            </TabsList>

            <div className="pt-6">
              <TabsContent value="account" className="space-y-6">
                <AccountSettings />
              </TabsContent>

              <TabsContent value="api-keys" className="space-y-6">
                <ApiKeysSettings />
              </TabsContent>

              <TabsContent value="models" className="space-y-6">
                <ModelTypeSettings />
              </TabsContent>

              <TabsContent value="shortcuts" className="space-y-6">
                <ShortcutSettingsPanel />
              </TabsContent>

              <TabsContent value="language" className="space-y-6">
                <LanguageSettings />
              </TabsContent>

              <TabsContent value="about" className="space-y-6">
                <AboutSettings />
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
