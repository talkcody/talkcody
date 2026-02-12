import { ChevronDown, ChevronRight, ExternalLink, Eye, EyeOff, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CustomProviderSection } from '@/components/custom-provider/CustomProviderSection';
import { OAuthProviderInput } from '@/components/settings/oauth-provider-input';
import { ProviderIcon } from '@/components/settings/provider-icons';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { HelpTooltip } from '@/components/ui/help-tooltip';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useLocale } from '@/hooks/use-locale';
import { useOAuthStatus } from '@/hooks/use-oauth-status';
import { getDocLinks } from '@/lib/doc-links';
import { logger } from '@/lib/logger';
import { simpleFetch } from '@/lib/tauri-fetch';
import { cn } from '@/lib/utils';
import {
  PROVIDER_CONFIGS,
  PROVIDERS_WITH_CODING_PLAN,
  PROVIDERS_WITH_INTERNATIONAL,
} from '@/providers';
import { customModelService, isLocalProvider } from '@/providers/custom/custom-model-service';
import { useProviderStore } from '@/providers/stores/provider-store';
import { databaseService } from '@/services/database-service';
import { settingsManager } from '@/stores/settings-store';
import type { ApiKeySettings } from '@/types/api-keys';

interface ApiKeyVisibility {
  [key: string]: boolean;
}

interface CodingPlanApiKeySettings {
  [providerId: string]: string;
}

export function ApiKeysSettings() {
  const { t } = useLocale();
  const [apiKeys, setApiKeys] = useState<ApiKeySettings>({});
  const [codingPlanApiKeys, setCodingPlanApiKeys] = useState<CodingPlanApiKeySettings>({});
  const [baseUrls, setBaseUrls] = useState<Record<string, string>>({});
  const [useCodingPlanSettings, setUseCodingPlanSettings] = useState<Record<string, boolean>>({});
  const [useInternationalSettings, setUseInternationalSettings] = useState<Record<string, boolean>>(
    {}
  );
  const [apiKeyVisibility, setApiKeyVisibility] = useState<ApiKeyVisibility>({});
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [apiKeyTimeouts, setApiKeyTimeouts] = useState<{
    [key: string]: ReturnType<typeof setTimeout>;
  }>({});
  const [baseUrlTimeouts, setBaseUrlTimeouts] = useState<{
    [key: string]: ReturnType<typeof setTimeout>;
  }>({});
  const [baseUrlExpanded, setBaseUrlExpanded] = useState<Record<string, boolean>>({});
  const [expandedProviders, setExpandedProviders] = useState<Record<string, boolean>>({});

  // OAuth state
  // OAuth state (unified hook)
  const oauthStatus = useOAuthStatus();

  // Sync API key to Coding Plan MCP servers when enabled
  const syncCodingPlanMcpApiKey = useCallback(async (providerId: string, apiKey: string) => {
    if (!apiKey) return;

    try {
      if (providerId === 'MiniMax') {
        // Sync to minimax-coding-plan MCP
        const server = await databaseService.getMCPServer('minimax-coding-plan');
        if (server) {
          const env = server.stdio_env || {};
          env.MINIMAX_API_KEY = apiKey;
          if (!env.MINIMAX_API_HOST) {
            env.MINIMAX_API_HOST = 'https://api.minimaxi.com';
          }
          await databaseService.updateMCPServer('minimax-coding-plan', {
            stdio_env: env,
          });
          logger.info('Synced API key to minimax-coding-plan MCP');
        }
      } else if (providerId === 'zhipu') {
        // Sync to 3 GLM Coding Plan MCPs
        const glmHttpServers = ['glm-coding-plan-reader', 'glm-coding-plan-search'];
        for (const serverId of glmHttpServers) {
          const server = await databaseService.getMCPServer(serverId);
          if (server) {
            await databaseService.updateMCPServer(serverId, {
              headers: { Authorization: `Bearer ${apiKey}` },
            });
            logger.info(`Synced API key to ${serverId} MCP`);
          }
        }

        // glm-coding-plan-vision uses stdio
        const visionServer = await databaseService.getMCPServer('glm-coding-plan-vision');
        if (visionServer) {
          const env = visionServer.stdio_env || {};
          env.Z_AI_API_KEY = apiKey;
          await databaseService.updateMCPServer('glm-coding-plan-vision', {
            stdio_env: env,
          });
          logger.info('Synced API key to glm-coding-plan-vision MCP');
        }
      }
    } catch (error) {
      logger.error(`Failed to sync API key to Coding Plan MCP for ${providerId}:`, error);
    }
  }, []);

  // Load settings when component mounts
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const currentApiKeys = await settingsManager.getApiKeys();
        setApiKeys(currentApiKeys);

        // Load base URLs and useCodingPlan settings for all providers
        const loadedBaseUrls: Record<string, string> = {};
        const loadedUseCodingPlanSettings: Record<string, boolean> = {};
        const loadedUseInternationalSettings: Record<string, boolean> = {};
        const loadedCodingPlanApiKeys: CodingPlanApiKeySettings = {};
        for (const providerId of Object.keys(PROVIDER_CONFIGS)) {
          const baseUrl = await settingsManager.getProviderBaseUrl(providerId);
          if (baseUrl) {
            loadedBaseUrls[providerId] = baseUrl;
          }

          // Load useCodingPlan setting for providers that support it
          if (PROVIDERS_WITH_CODING_PLAN.includes(providerId)) {
            const useCodingPlan = await settingsManager.getProviderUseCodingPlan(providerId);
            loadedUseCodingPlanSettings[providerId] = useCodingPlan;

            // Load coding plan API key if available
            const codingPlanApiKey = await settingsManager.get(`coding_plan_api_key_${providerId}`);
            if (codingPlanApiKey) {
              loadedCodingPlanApiKeys[providerId] = codingPlanApiKey;
            }
          }

          // Load useInternational setting for providers that support it
          if (PROVIDERS_WITH_INTERNATIONAL.includes(providerId)) {
            const useInternational = await settingsManager.getProviderUseInternational(providerId);
            loadedUseInternationalSettings[providerId] = useInternational;
          }
        }
        setBaseUrls(loadedBaseUrls);
        setUseCodingPlanSettings(loadedUseCodingPlanSettings);
        setUseInternationalSettings(loadedUseInternationalSettings);
        setCodingPlanApiKeys(loadedCodingPlanApiKeys);
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

    // Set new timeout with debounce
    const timeoutId = setTimeout(async () => {
      await saveApiKey(providerId, value);
      // Remove the timeout reference after execution
      setApiKeyTimeouts((prev) => {
        const newTimeouts = { ...prev };
        delete newTimeouts[providerId];
        return newTimeouts;
      });
    }, 1000);

    setApiKeyTimeouts((prev) => ({ ...prev, [providerId]: timeoutId }));
  };

  // Handle coding plan API key changes
  const _handleCodingPlanApiKeyChange = async (providerId: string, value: string) => {
    const updatedKeys = { ...codingPlanApiKeys, [providerId]: value };
    setCodingPlanApiKeys(updatedKeys);

    // Clear existing timeout for this provider
    if (apiKeyTimeouts[`coding_plan_${providerId}`]) {
      clearTimeout(apiKeyTimeouts[`coding_plan_${providerId}`]);
    }

    // Set new timeout with debounce
    const timeoutId = setTimeout(async () => {
      await saveCodingPlanApiKey(providerId, value);
      // Remove the timeout reference after execution
      setApiKeyTimeouts((prev) => {
        const newTimeouts = { ...prev };
        delete newTimeouts[`coding_plan_${providerId}`];
        return newTimeouts;
      });
    }, 1000);

    setApiKeyTimeouts((prev) => ({ ...prev, [`coding_plan_${providerId}`]: timeoutId }));
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
        await useProviderStore.getState().setBaseUrl(providerId, value);
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

      // Sync API key to Coding Plan MCP servers when enabled
      if (value) {
        await syncCodingPlanMcpApiKey(
          providerId,
          apiKeys[providerId as keyof ApiKeySettings] || ''
        );
      }

      // Refresh providers after useCodingPlan change
      await useProviderStore.getState().refresh();
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

  const handleUseInternationalChange = async (providerId: string, value: boolean) => {
    const updatedSettings = { ...useInternationalSettings, [providerId]: value };
    setUseInternationalSettings(updatedSettings);

    try {
      await settingsManager.setProviderUseInternational(providerId, value);
      logger.info('Model service cache invalidated after useInternational update');

      // Refresh providers after useInternational change
      await useProviderStore.getState().refresh();
      logger.info(`${providerId} useInternational updated to ${value}`);
      toast.success(
        value
          ? t.Settings.apiKeys.internationalEnabled(providerId)
          : t.Settings.apiKeys.internationalDisabled(providerId)
      );
    } catch (error) {
      logger.error(`Failed to update ${providerId} useInternational:`, error);
      toast.error(t.Settings.apiKeys.internationalUpdateFailed(providerId));
    }
  };

  const toggleApiKeyVisibility = (providerId: string) => {
    setApiKeyVisibility((prev) => ({
      ...prev,
      [providerId]: !prev[providerId],
    }));
  };

  // Helper function to save API key (extracted for reuse)
  const saveApiKey = async (providerId: string, value: string) => {
    try {
      // Use provider store to set API key - this handles both persistence and provider rebuild
      await useProviderStore.getState().setApiKey(providerId, value);
      logger.info(`${providerId} API key updated`);

      // If Coding Plan is enabled, sync API key to MCP servers
      if (PROVIDERS_WITH_CODING_PLAN.includes(providerId) && useCodingPlanSettings[providerId]) {
        await syncCodingPlanMcpApiKey(providerId, value);
      }
    } catch (error) {
      logger.error(`Failed to update ${providerId} API key:`, error);
    }
  };

  // Helper function to save Coding Plan API key
  const saveCodingPlanApiKey = async (providerId: string, value: string) => {
    try {
      // Save coding plan API key using settings manager
      await settingsManager.set(`coding_plan_api_key_${providerId}`, value);
      logger.info(`${providerId} Coding Plan API key updated`);
    } catch (error) {
      logger.error(`Failed to update ${providerId} Coding Plan API key:`, error);
    }
  };

  const handleTestConnection = async (providerId: string) => {
    setTestingProvider(providerId);
    let testedUrl = ''; // Track the URL being tested for error messages
    try {
      logger.info(`Testing connection for ${providerId}...`);

      // If there's a pending API key save, flush it immediately
      if (apiKeyTimeouts[providerId]) {
        clearTimeout(apiKeyTimeouts[providerId]);
        setApiKeyTimeouts((prev) => {
          const newTimeouts = { ...prev };
          delete newTimeouts[providerId];
          return newTimeouts;
        });
        // Save the current API key value immediately
        const currentKeyValue = apiKeys[providerId as keyof ApiKeySettings] || '';
        await saveApiKey(providerId, currentKeyValue);
      } else {
        // Refresh providers first (only if no pending save)
        await useProviderStore.getState().refresh();
      }

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
          testedUrl =
            providerId === 'ollama'
              ? 'http://localhost:11434/api/tags'
              : 'http://localhost:1234/v1/models';

          // Use Tauri fetch to go through the HTTP proxy (native fetch is blocked in webview)
          const response = await simpleFetch(testedUrl);
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
        // Test connection using /v1/models endpoint (faster and more reliable)
        if (customModelService.supportsModelsFetch(providerId)) {
          // Get the actual URL that will be tested (including custom base URL if set)
          const customBaseUrl = await settingsManager.getProviderBaseUrl(providerId);
          if (customBaseUrl) {
            testedUrl = `${customBaseUrl.replace(/\/+$/, '')}/models`;
          } else {
            const useInternational = useInternationalSettings[providerId] || false;
            const providerConfig = PROVIDER_CONFIGS[providerId];
            const internationalBaseUrl = providerConfig?.internationalBaseUrl;
            testedUrl =
              useInternational && internationalBaseUrl
                ? `${internationalBaseUrl.replace(/\/+$/, '')}/models`
                : customModelService.getModelsEndpoint(providerId) || '';
          }

          const models = await customModelService.fetchProviderModels(providerId);
          logger.info(`${providerId} connection test successful - found ${models.length} models`);
          toast.success(
            t.Settings.apiKeys.testSuccess(PROVIDER_CONFIGS[providerId]?.name || providerId)
          );
        } else {
          // For providers without /v1/models endpoint (tavily, elevenlabs), just refresh
          logger.info(`${providerId} connection refreshed (no models endpoint available)`);
          toast.success(
            t.Settings.apiKeys.testSuccess(PROVIDER_CONFIGS[providerId]?.name || providerId)
          );
        }
      }

      // No need to dispatch events - Zustand handles reactivity automatically
    } catch (error) {
      logger.error(`Failed to test ${providerId} connection:`, error);
      const providerName = PROVIDER_CONFIGS[providerId]?.name || providerId;
      const errorMessage = testedUrl
        ? `${providerName} connection test failed. URL: ${testedUrl}`
        : t.Settings.apiKeys.testFailed(providerName);
      toast.error(errorMessage);
    } finally {
      setTestingProvider(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Built-in Providers */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle className="text-lg">{t.Settings.apiKeys.title}</CardTitle>
            <HelpTooltip
              title={t.Settings.apiKeys.tooltipTitle}
              description={t.Settings.apiKeys.tooltipDescription}
              docUrl={getDocLinks().configuration.apiKeys}
            />
          </div>
          <CardDescription>{t.Settings.apiKeys.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {Object.entries(PROVIDER_CONFIGS)
            .filter(([providerId]) => providerId !== 'talkcody')
            .map(([providerId, config]) => {
              const currentKey = apiKeys[providerId as keyof ApiKeySettings] || '';
              const isVisible = apiKeyVisibility[providerId] || false;
              const isLocal = isLocalProvider(providerId);

              // Check if provider is OAuth-connected (unified check)
              const isOAuthConnected = oauthStatus[providerId as keyof typeof oauthStatus] || false;

              // Determine if provider has valid credentials (API key or OAuth)
              const hasKey = isLocal
                ? currentKey === 'enabled'
                : isOAuthConnected || currentKey.trim().length > 0;
              const isExpanded = expandedProviders[providerId] ?? false;
              const docLink =
                getDocLinks().apiKeysProviders[
                  providerId as keyof ReturnType<typeof getDocLinks>['apiKeysProviders']
                ];

              return (
                <Collapsible
                  key={providerId}
                  open={isExpanded}
                  onOpenChange={(open) =>
                    setExpandedProviders((prev) => ({ ...prev, [providerId]: open }))
                  }
                  className="border rounded-lg"
                >
                  <div className="flex items-center">
                    <CollapsibleTrigger className="flex items-center gap-2 flex-1 p-3 hover:bg-muted/50 transition-colors rounded-lg">
                      <ChevronRight
                        className={cn(
                          'h-4 w-4 shrink-0 transition-transform duration-200',
                          isExpanded && 'rotate-90'
                        )}
                      />
                      <ProviderIcon providerId={providerId} size={18} className="shrink-0" />
                      <span className="font-medium text-sm">{config.name}</span>
                      {hasKey && (
                        <span className="text-green-600 dark:text-green-400 text-xs bg-green-50 dark:bg-green-950 px-2 py-0.5 rounded-full ml-auto">
                          {t.Settings.apiKeys.configured}
                        </span>
                      )}
                    </CollapsibleTrigger>
                    {docLink && (
                      <a
                        href={docLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-foreground transition-colors p-3"
                        title={t.Settings.apiKeys.viewDocumentation}
                      >
                        <ExternalLink size={14} />
                      </a>
                    )}
                  </div>

                  <CollapsibleContent className="px-3 pb-3 pt-0 border-t">
                    <div className="pt-3 space-y-3">
                      {/* Use International toggle for providers that support it */}
                      {PROVIDERS_WITH_INTERNATIONAL.includes(providerId) && (
                        <div className="flex items-center justify-between">
                          <Label
                            htmlFor={`use-international-${providerId}`}
                            className="text-sm text-muted-foreground"
                          >
                            {t.Settings.apiKeys.useInternational}
                          </Label>
                          <Switch
                            id={`use-international-${providerId}`}
                            checked={useInternationalSettings[providerId] || false}
                            onCheckedChange={(checked) =>
                              handleUseInternationalChange(providerId, checked)
                            }
                          />
                        </div>
                      )}

                      {/* Use Coding Plan toggle for providers that support it*/}
                      {PROVIDERS_WITH_CODING_PLAN.includes(providerId) && (
                        <div className="flex items-center justify-between">
                          <Label
                            htmlFor={`use-coding-plan-${providerId}`}
                            className="text-sm text-muted-foreground"
                          >
                            {t.Settings.apiKeys.useCodingPlan}
                          </Label>
                          <Switch
                            id={`use-coding-plan-${providerId}`}
                            checked={useCodingPlanSettings[providerId] || false}
                            onCheckedChange={(checked) =>
                              handleUseCodingPlanChange(providerId, checked)
                            }
                          />
                        </div>
                      )}

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
                      ) : config.supportsOAuth ? (
                        // OAuth provider with API key fallback
                        <OAuthProviderInput
                          providerId={providerId}
                          config={config}
                          currentKey={currentKey}
                          isVisible={isVisible}
                          onApiKeyChange={handleApiKeyChange}
                          onTestConnection={handleTestConnection}
                          toggleVisibility={toggleApiKeyVisibility}
                          testingProvider={testingProvider}
                        />
                      ) : (
                        // Standard API key input for other providers
                        <div className="flex gap-2 items-center">
                          <div className="relative flex-1">
                            <Input
                              id={`api-key-${providerId}`}
                              type={isVisible ? 'text' : 'password'}
                              placeholder={t.Settings.apiKeys.enterKey(config.name)}
                              value={currentKey}
                              onChange={(e) => handleApiKeyChange(providerId, e.target.value)}
                              className="h-9 pr-10"
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
                              className="h-9"
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
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
        </CardContent>
      </Card>

      <CustomProviderSection />
    </div>
  );
}
