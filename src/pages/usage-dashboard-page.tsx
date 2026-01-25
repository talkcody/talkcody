// src/pages/usage-dashboard-page.tsx
// Unified dashboard page for displaying usage from multiple providers

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ApiUsageTab,
  GitHubCopilotUsageTab,
  MinimaxUsageTab,
  OpenAIUsageTab,
  ZhipuUsageTab,
} from '@/components/usage';
import { useLocale } from '@/hooks/use-locale';

export function UsageDashboardPage() {
  const { t } = useLocale();

  return (
    <div className="container mx-auto h-full overflow-y-auto p-6">
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold">{t.apiUsage.dashboardTitle}</h1>
          <p className="text-muted-foreground">{t.apiUsage.dashboardDescription}</p>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="api-usage" className="w-full">
          <TabsList className="grid w-full max-w-3xl grid-cols-5">
            <TabsTrigger value="api-usage">{t.apiUsage.tabLabel}</TabsTrigger>
            <TabsTrigger value="openai">OpenAI</TabsTrigger>
            <TabsTrigger value="github-copilot">GitHub Copilot</TabsTrigger>
            <TabsTrigger value="zhipu">Zhipu AI</TabsTrigger>
            <TabsTrigger value="minimax">MiniMax</TabsTrigger>
          </TabsList>
          <TabsContent value="api-usage" className="mt-6">
            <ApiUsageTab />
          </TabsContent>
          <TabsContent value="openai" className="mt-6">
            <OpenAIUsageTab />
          </TabsContent>
          <TabsContent value="github-copilot" className="mt-6">
            <GitHubCopilotUsageTab />
          </TabsContent>
          <TabsContent value="zhipu" className="mt-6">
            <ZhipuUsageTab />
          </TabsContent>
          <TabsContent value="minimax" className="mt-6">
            <MinimaxUsageTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
