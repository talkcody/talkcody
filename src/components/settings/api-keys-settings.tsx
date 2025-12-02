import { generateText } from 'ai';
import { ChevronDown, ChevronRight, ExternalLink, Eye, EyeOff, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { HelpTooltip } from '@/components/ui/help-tooltip';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useLocale } from '@/hooks/use-locale';
import { DOC_LINKS } from '@/lib/doc-links';
import { logger } from '@/lib/logger';
import { CLAUDE_HAIKU, GEMINI_25_FLASH_LITE, GLM_46, GPT5_NANO } from '@/lib/models';
import { createTauriFetch } from '@/lib/tauri-fetch';
import { PROVIDER_CONFIGS } from '@/providers';
import { aiProviderService } from '@/services/ai-provider-service';
import { isLocalProvider } from '@/services/custom-model-service';
import { settingsManager } from '@/stores/settings-store';
import type { ApiKeySettings } from '@/types/api-keys';

interface ApiKeyVisibility {
  [key: string]: boolean;
}

export function ApiKeysSettings() {
  const { t } = useLocale();
  const [apiKeys, setApiKeys] = useState<ApiKeySettings>({});
  const [baseUrls, setBaseUrls] = useState<Record<string, string>>({});
  const [useCodingPlanSettings, setUseCodingPlanSettings] = useState<Record<string, boolean>>({});
  const [apiKeyVisibility, setApiKeyVisibility] = useState<ApiKeyVisibility>({});
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [apiKeyTimeouts, setApiKeyTimeouts] = useState<{
    [key: string]: ReturnType<typeof setTimeout>;
  }>({});
  const [baseUrlTimeouts, setBaseUrlTimeouts] = useState<{
    [key: string]: ReturnType<typeof setTimeout>;
  }>({});
  const [baseUrlExpanded, setBaseUrlExpanded] = useState<Record<string, boolean>>({});

  // Load settings when component mounts
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const currentApiKeys = await settingsManager.getApiKeys();
        setApiKeys(currentApiKeys);

        // Load base URLs and useCodingPlan settings for all providers
        const loadedBaseUrls: Record<string, string> = {};
        const loadedUseCodingPlanSettings: Record<string, boolean> = {};
        for (const providerId of Object.keys(PROVIDER_CONFIGS)) {
          const baseUrl = await settingsManager.getProviderBaseUrl(providerId);
          if (baseUrl) {
            loadedBaseUrls[providerId] = baseUrl;
          }

          // Load useCodingPlan setting for Zhipu
          if (providerId === 'zhipu') {
            const useCodingPlan = await settingsManager.getProviderUseCodingPlan(providerId);
            loadedUseCodingPlanSettings[providerId] = useCodingPlan;
          }
        }
        setBaseUrls(loadedBaseUrls);
        setUseCodingPlanSettings(loadedUseCodingPlanSettings);
      } catch (error) {
        logger.error('Failed to load API keys settings:', error);
      }
    };

    loadSettings();
  }, []);

  const handleApiKeyChange = async (providerId: string, value: string) => {
    const updatedKeys = { ...apiKeys, [providerId]: value };
    setApiKeys(updatedKeys);

    // Clear existing timeout for this provider
    if (apiKeyTimeouts[providerId]) {
      clearTimeout(apiKeyTimeouts[providerId]);
    }

    // Set new timeout
    const timeoutId = setTimeout(async () => {
      try {
        await settingsManager.setApiKeys({
          [providerId]: value,
        } as ApiKeySettings);
        logger.info('Model service cache invalidated after API key update');
        // Refresh providers after API key change
        await aiProviderService.refreshProviders();
        // Notify components that API keys have been updated
        window.dispatchEvent(new CustomEvent('apiKeysUpdated'));
        logger.info(`${providerId} API key updated`);
      } catch (error) {
        logger.error(`Failed to update ${providerId} API key:`, error);
      }
    }, 1000);

    setApiKeyTimeouts((prev) => ({ ...prev, [providerId]: timeoutId }));
  };

  const handleBaseUrlChange = async (providerId: string, value: string) => {
    const updatedBaseUrls = { ...baseUrls, [providerId]: value };
    setBaseUrls(updatedBaseUrls);

    // Clear existing timeout for this provider
    if (baseUrlTimeouts[providerId]) {
      clearTimeout(baseUrlTimeouts[providerId]);
    }

    // Set new timeout
    const timeoutId = setTimeout(async () => {
      try {
        await settingsManager.setProviderBaseUrl(providerId, value);
        logger.info('Model service cache invalidated after base URL update');
        // Refresh providers after base URL change
        await aiProviderService.refreshProviders();
        logger.info(`${providerId} base URL updated`);
      } catch (error) {
        logger.error(`Failed to update ${providerId} base URL:`, error);
      }
    }, 1000);

    setBaseUrlTimeouts((prev) => ({ ...prev, [providerId]: timeoutId }));
  };

  const handleUseCodingPlanChange = async (providerId: string, value: boolean) => {
    const updatedSettings = { ...useCodingPlanSettings, [providerId]: value };
    setUseCodingPlanSettings(updatedSettings);

    try {
      await settingsManager.setProviderUseCodingPlan(providerId, value);
      logger.info('Model service cache invalidated after useCodingPlan update');
      // Refresh providers after useCodingPlan change
      await aiProviderService.refreshProviders();
      logger.info(`${providerId} useCodingPlan updated to ${value}`);
      toast.success(
        value
          ? t.Settings.apiKeys.codingPlanEnabled(providerId)
          : t.Settings.apiKeys.codingPlanDisabled(providerId)
      );
    } catch (error) {
      logger.error(`Failed to update ${providerId} useCodingPlan:`, error);
      toast.error(t.Settings.apiKeys.codingPlanUpdateFailed(providerId));
    }
  };

  const toggleApiKeyVisibility = (providerId: string) => {
    setApiKeyVisibility((prev) => ({
      ...prev,
      [providerId]: !prev[providerId],
    }));
  };

  const handleTestConnection = async (providerId: string) => {
    setTestingProvider(providerId);
    try {
      logger.info(`Testing connection for ${providerId}...`);

      // Refresh providers first
      await aiProviderService.refreshProviders();

      // For local providers (Ollama, LM Studio), test the connection directly
      if (isLocalProvider(providerId)) {
        // Check if the provider is enabled first
        const currentApiKeys = await settingsManager.getApiKeys();
        const providerKey = providerId as keyof typeof currentApiKeys;
        if (currentApiKeys[providerKey] !== 'enabled') {
          throw new Error(
            `${PROVIDER_CONFIGS[providerId]?.name || providerId} is not enabled. Please enable it in settings first.`
          );
        }

        // Test the connection by making a direct API call to check if the server is running
        try {
          // Different endpoints for different local providers
          const testUrl =
            providerId === 'ollama'
              ? 'http://localhost:11434/api/tags'
              : 'http://localhost:1234/v1/models';

          // Use Tauri fetch to go through the HTTP proxy (native fetch is blocked in webview)
          const tauriFetch = createTauriFetch();
          const response = await tauriFetch(testUrl);
          if (!response.ok) {
            throw new Error(
              `${PROVIDER_CONFIGS[providerId]?.name} API returned status: ${response.status}`
            );
          }
          const data = await response.json();

          if (providerId === 'ollama') {
            logger.info(
              'Ollama connection test successful - server is running and returned models:',
              data.models?.length || 0
            );
          } else {
            logger.info(
              'LM Studio connection test successful - server is running and returned models:',
              data.data?.length || 0
            );
          }

          logger.info(`${providerId} connection test successful`);
          toast.success(
            `${PROVIDER_CONFIGS[providerId]?.name || providerId} connection test successful!`
          );
        } catch (localError) {
          logger.error(`Failed to test ${providerId} connection:`, localError);
          throw new Error(
            `Failed to connect to ${PROVIDER_CONFIGS[providerId]?.name || providerId} server: ${localError instanceof Error ? localError.message : 'Unknown error'}`
          );
        }
      } else {
        // Try to get a simple response from the provider for non-Ollama providers
        const testModel = getTestModelForProvider(providerId);
        if (testModel) {
          const providerModel = await aiProviderService.getProviderModelAsync(testModel);

          await generateText({
            model: providerModel,
            prompt: 'Hello',
          });

          logger.info(`${providerId} connection test successful`);
          toast.success(
            t.Settings.apiKeys.testSuccess(PROVIDER_CONFIGS[providerId]?.name || providerId)
          );
        } else {
          logger.info(`${providerId} connection refreshed (no test model available)`);
          toast.success(
            t.Settings.apiKeys.testSuccess(PROVIDER_CONFIGS[providerId]?.name || providerId)
          );
        }
      }

      // Notify components that providers have been refreshed
      window.dispatchEvent(new CustomEvent('apiKeysUpdated'));
    } catch (error) {
      logger.error(`Failed to test ${providerId} connection:`, error);
      toast.error(t.Settings.apiKeys.testFailed(PROVIDER_CONFIGS[providerId]?.name || providerId));
    } finally {
      setTestingProvider(null);
    }
  };

  const getTestModelForProvider = (providerId: string): string | null => {
    switch (providerId) {
      case 'openai':
        return GPT5_NANO;
      case 'anthropic':
        return CLAUDE_HAIKU;
      case 'google':
        return GEMINI_25_FLASH_LITE;
      case 'zhipu':
        return GLM_46;
      case 'aiGateway':
        return GEMINI_25_FLASH_LITE;
      case 'openRouter':
        return GEMINI_25_FLASH_LITE;
      default:
        return null;
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle className="text-lg">{t.Settings.apiKeys.title}</CardTitle>
          <HelpTooltip
            title={t.Settings.apiKeys.tooltipTitle}
            description={t.Settings.apiKeys.tooltipDescription}
            docUrl={DOC_LINKS.configuration.apiKeys}
          />
        </div>
        <CardDescription>{t.Settings.apiKeys.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {Object.entries(PROVIDER_CONFIGS).map(([providerId, config]) => {
          const currentKey = apiKeys[providerId as keyof ApiKeySettings] || '';
          const isVisible = apiKeyVisibility[providerId] || false;
          const isLocal = isLocalProvider(providerId);
          const hasKey = isLocal ? currentKey === 'enabled' : currentKey.trim().length > 0;

          return (
            <div key={providerId} className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <Label htmlFor={`api-key-${providerId}`} className="flex items-center gap-2">
                    <span className="font-medium">{config.name}</span>
                    {hasKey && (
                      <span className="text-green-600 text-xs bg-green-50 px-2 py-0.5 rounded-full">
                        {t.Settings.apiKeys.configured}
                      </span>
                    )}
                    {DOC_LINKS.apiKeysProviders[
                      providerId as keyof typeof DOC_LINKS.apiKeysProviders
                    ] && (
                      <a
                        href={
                          DOC_LINKS.apiKeysProviders[
                            providerId as keyof typeof DOC_LINKS.apiKeysProviders
                          ]
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        title={t.Settings.apiKeys.viewDocumentation}
                      >
                        <ExternalLink size={14} />
                      </a>
                    )}
                  </Label>
                </div>
                {/* Use Coding Plan toggle for Zhipu - inline with header */}
                {providerId === 'zhipu' && (
                  <div className="flex items-center gap-2">
                    <Label
                      htmlFor={`use-coding-plan-${providerId}`}
                      className="text-sm text-muted-foreground"
                    >
                      {t.Settings.apiKeys.useCodingPlan}
                    </Label>
                    <Switch
                      id={`use-coding-plan-${providerId}`}
                      checked={useCodingPlanSettings[providerId] || false}
                      onCheckedChange={(checked) => handleUseCodingPlanChange(providerId, checked)}
                    />
                  </div>
                )}
              </div>

              {isLocal ? (
                // Special UI for local providers (Ollama, LM Studio) - toggle switch instead of API key input
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Switch
                      id={`${providerId}-enabled`}
                      checked={currentKey === 'enabled'}
                      onCheckedChange={(checked) =>
                        handleApiKeyChange(providerId, checked ? 'enabled' : '')
                      }
                    />
                    <Label htmlFor={`${providerId}-enabled`} className="text-sm">
                      {currentKey === 'enabled' ? t.Common.enabled : t.Common.disabled}
                    </Label>
                  </div>
                  {currentKey === 'enabled' && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleTestConnection(providerId)}
                      disabled={testingProvider !== null}
                    >
                      {testingProvider === providerId ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          {t.Settings.apiKeys.testing}
                        </>
                      ) : (
                        t.Settings.apiKeys.testConnection
                      )}
                    </Button>
                  )}
                </div>
              ) : (
                // Standard API key input for other providers
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      id={`api-key-${providerId}`}
                      type={isVisible ? 'text' : 'password'}
                      placeholder={t.Settings.apiKeys.enterKey(config.name)}
                      value={currentKey}
                      onChange={(e) => handleApiKeyChange(providerId, e.target.value)}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => toggleApiKeyVisibility(providerId)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                    >
                      {isVisible ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>

                  {hasKey && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleTestConnection(providerId)}
                      disabled={testingProvider !== null}
                    >
                      {testingProvider === providerId ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          {t.Settings.apiKeys.testing}
                        </>
                      ) : (
                        t.Settings.apiKeys.testConnection
                      )}
                    </Button>
                  )}
                </div>
              )}

              {/* Base URL configuration for Anthropic and OpenAI */}
              {(providerId === 'anthropic' || providerId === 'openai') && (
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() =>
                      setBaseUrlExpanded((prev) => ({
                        ...prev,
                        [providerId]: !prev[providerId],
                      }))
                    }
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {baseUrlExpanded[providerId] ? (
                      <ChevronDown size={14} />
                    ) : (
                      <ChevronRight size={14} />
                    )}
                    {t.Settings.apiKeys.customBaseUrl}
                  </button>
                  {baseUrlExpanded[providerId] && (
                    <Input
                      id={`base-url-${providerId}`}
                      type="text"
                      placeholder={t.Settings.apiKeys.baseUrlPlaceholder(
                        providerId === 'anthropic'
                          ? 'https://api.anthropic.com'
                          : 'https://api.openai.com/v1'
                      )}
                      value={baseUrls[providerId] || ''}
                      onChange={(e) => handleBaseUrlChange(providerId, e.target.value)}
                      className="text-sm"
                    />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
