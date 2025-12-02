import { Plus, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ModelSelector } from '@/components/selectors/model-selector';
import { ProviderSelector } from '@/components/selectors/provider-selector';
import {
  AddCustomModelDialog,
  CustomModelList,
} from '@/components/settings/add-custom-model-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { useLocale } from '@/hooks/use-locale';
import { logger } from '@/lib/logger';
import { MODEL_CONFIGS, refreshModelConfigs } from '@/lib/models';
import { modelTypeService } from '@/services/model-type-service';
import { useModelStore } from '@/stores/model-store';
import { settingsManager } from '@/stores/settings-store';
import { DEFAULT_MODELS_BY_TYPE, MODEL_TYPE_SETTINGS_KEYS, ModelType } from '@/types/model-types';

// Helper to get localized model type labels and descriptions
const getModelTypeLocale = (
  modelType: ModelType,
  t: ReturnType<typeof useLocale>['t']
): { title: string; description: string } => {
  switch (modelType) {
    case ModelType.MAIN:
      return {
        title: t.Settings.models.mainModel.title,
        description: t.Settings.models.mainModel.description,
      };
    case ModelType.SMALL:
      return {
        title: t.Settings.models.smallModel.title,
        description: t.Settings.models.smallModel.description,
      };
    case ModelType.IMAGE_GENERATOR:
      return {
        title: t.Settings.models.imageGenerator.title,
        description: t.Settings.models.imageGenerator.description,
      };
    case ModelType.TRANSCRIPTION:
      return {
        title: t.Settings.models.transcription.title,
        description: t.Settings.models.transcription.description,
      };
    default:
      return { title: modelType, description: '' };
  }
};

export function ModelTypeSettings() {
  const { t } = useLocale();
  const { availableModels, refreshModels } = useModelStore();

  // Store model key (without provider)
  const [selectedModels, setSelectedModels] = useState<Record<ModelType, string>>({
    [ModelType.MAIN]: '',
    [ModelType.SMALL]: '',
    [ModelType.IMAGE_GENERATOR]: '',
    [ModelType.TRANSCRIPTION]: '',
  });

  // Store selected provider for each model type
  const [selectedProviders, setSelectedProviders] = useState<Record<ModelType, string>>({
    [ModelType.MAIN]: '',
    [ModelType.SMALL]: '',
    [ModelType.IMAGE_GENERATOR]: '',
    [ModelType.TRANSCRIPTION]: '',
  });

  const [isLoading, setIsLoading] = useState(false);
  const [isCustomModelDialogOpen, setIsCustomModelDialogOpen] = useState(false);

  // Helper function to get placeholder text for model type
  const getPlaceholder = (modelType: ModelType): string => {
    const defaultModelKey = DEFAULT_MODELS_BY_TYPE[modelType];
    const modelConfig = MODEL_CONFIGS[defaultModelKey];
    if (modelConfig) {
      return `${modelConfig.name}`;
    }
    return t.Settings.models.selectModel;
  };

  const loadModelTypeSettings = useCallback(async () => {
    try {
      setIsLoading(true);
      const models: Record<string, string> = {};
      const providers: Record<string, string> = {};

      for (const modelType of Object.values(ModelType)) {
        const settingsKey = MODEL_TYPE_SETTINGS_KEYS[modelType];
        const value = await settingsManager.get(settingsKey);

        if (value) {
          // Parse "modelKey@provider" format
          const [modelKey, provider] = value.split('@');
          models[modelType] = modelKey || '';
          providers[modelType] = provider || '';
        } else {
          models[modelType] = '';
          providers[modelType] = '';
        }
      }

      setSelectedModels(models as Record<ModelType, string>);
      setSelectedProviders(providers as Record<ModelType, string>);
    } catch (error) {
      logger.error('Failed to load model type settings:', error);
      toast.error(t.Settings.apiKeys.loadFailed);
    } finally {
      setIsLoading(false);
    }
  }, [t.Settings.apiKeys.loadFailed]);

  useEffect(() => {
    // Initial load
    const initializeSettings = async () => {
      logger.info('[ModelTypeSettings] Component mounted, starting initialization');

      // First load the model type settings
      await loadModelTypeSettings();

      // Check if models need to be refreshed (e.g., if API keys changed)
      // This ensures we always show the latest data when the page opens
      logger.info('[ModelTypeSettings] Checking if models refresh is needed');
      await refreshModels();

      logger.info('[ModelTypeSettings] Initialization completed');
    };

    initializeSettings();

    // Listen for API key updates to refresh models
    const handleApiKeysUpdated = async () => {
      logger.info('[ModelTypeSettings] API keys updated event received, starting refresh');
      try {
        logger.info('[ModelTypeSettings] Calling refreshModels()');
        await refreshModels();
        logger.info('[ModelTypeSettings] refreshModels() completed');

        // Reload model type settings after models are refreshed
        logger.info('[ModelTypeSettings] Calling loadModelTypeSettings()');
        await loadModelTypeSettings();
        logger.info('[ModelTypeSettings] loadModelTypeSettings() completed');

        logger.info('[ModelTypeSettings] Full refresh cycle completed successfully');
      } catch (error) {
        logger.error('[ModelTypeSettings] Failed to refresh models after API key update:', error);
      }
    };

    window.addEventListener('apiKeysUpdated', handleApiKeysUpdated);

    return () => {
      window.removeEventListener('apiKeysUpdated', handleApiKeysUpdated);
    };
  }, [loadModelTypeSettings, refreshModels]);

  // Get available providers for a model (memoized to ensure reactivity)
  const getAvailableProviders = useMemo(() => {
    return (modelKey: string) => {
      if (!modelKey) return [];

      const providers = availableModels
        .filter((m) => m.key === modelKey)
        .map((m) => ({ id: m.provider, name: m.providerName, priority: m.priority }));

      // Deduplicate by provider id
      const dedupedProviders = Array.from(new Map(providers.map((p) => [p.id, p])).values()).sort(
        (a, b) => a.priority - b.priority
      );

      return dedupedProviders;
    };
  }, [availableModels]);

  // Handle model selection
  const handleModelChange = async (modelType: ModelType, modelKey: string) => {
    try {
      setSelectedModels((prev) => ({ ...prev, [modelType]: modelKey }));

      // Get available providers for this model
      const providers = getAvailableProviders(modelKey);
      // logger.info(`Available providers for model ${modelKey}:`, providers);

      // Auto-select the first (highest priority) provider
      const defaultProvider = providers[0]?.id || '';
      setSelectedProviders((prev) => ({ ...prev, [modelType]: defaultProvider }));

      // Save to settings in "modelKey@provider" format
      const settingsKey = MODEL_TYPE_SETTINGS_KEYS[modelType];
      const value = defaultProvider ? `${modelKey}@${defaultProvider}` : modelKey;
      await settingsManager.set(settingsKey, value);

      toast.success(t.Settings.models.updated(getModelTypeLocale(modelType, t).title));
    } catch (error) {
      logger.error(`Failed to update ${modelType}:`, error);
      toast.error(t.Settings.models.updateFailed(getModelTypeLocale(modelType, t).title));
    }
  };

  // Handle provider selection
  const handleProviderChange = async (modelType: ModelType, provider: string) => {
    try {
      setSelectedProviders((prev) => ({ ...prev, [modelType]: provider }));

      const modelKey = selectedModels[modelType];
      if (!modelKey) return;

      // Save to settings in "modelKey@provider" format
      const settingsKey = MODEL_TYPE_SETTINGS_KEYS[modelType];
      const value = `${modelKey}@${provider}`;
      await settingsManager.set(settingsKey, value);

      toast.success(t.Settings.models.providerUpdated(getModelTypeLocale(modelType, t).title));
    } catch (error) {
      logger.error(`Failed to update provider for ${modelType}:`, error);
      toast.error(t.Settings.models.updateFailed(getModelTypeLocale(modelType, t).title));
    }
  };

  const handleResetToDefault = async (modelType: ModelType) => {
    try {
      await modelTypeService.clearModelForType(modelType);
      setSelectedModels((prev) => ({ ...prev, [modelType]: '' }));
      setSelectedProviders((prev) => ({ ...prev, [modelType]: '' }));

      toast.success(t.Settings.models.updated(getModelTypeLocale(modelType, t).title));
    } catch (error) {
      logger.error(`Failed to reset ${modelType}:`, error);
      toast.error(t.Settings.models.updateFailed(getModelTypeLocale(modelType, t).title));
    }
  };

  // Handle custom models added
  const handleCustomModelsAdded = async () => {
    // Refresh model configs to include new custom models
    await refreshModelConfigs();
    // Refresh available models in the store
    await refreshModels();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Custom Models Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <CardTitle className="text-lg">{t.Settings.models.customModels.title}</CardTitle>
              <CardDescription className="mt-1.5">
                {t.Settings.models.customModels.description}
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsCustomModelDialogOpen(true)}
              className="ml-4"
            >
              <Plus className="mr-2 h-4 w-4" />
              {t.Settings.models.customModels.addModel}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <CustomModelList onRefresh={handleCustomModelsAdded} />
        </CardContent>
      </Card>

      {/* Model Type Cards */}
      {Object.values(ModelType).map((modelType) => (
        <Card key={modelType}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <CardTitle className="text-lg">{getModelTypeLocale(modelType, t).title}</CardTitle>
                <CardDescription className="mt-1.5">
                  {getModelTypeLocale(modelType, t).description}
                </CardDescription>
              </div>
              {selectedModels[modelType] && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleResetToDefault(modelType)}
                  className="ml-4"
                >
                  {t.Settings.models.resetToDefault}
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex gap-3">
              <div className="flex-1 space-y-2">
                <Label htmlFor={`model-type-${modelType}`} className="font-medium text-sm">
                  {t.Settings.models.customModels.model}
                </Label>
                <ModelSelector
                  value={selectedModels[modelType]}
                  onChange={(value) => handleModelChange(modelType, value)}
                  placeholder={getPlaceholder(modelType)}
                  filterFn={
                    modelType === ModelType.IMAGE_GENERATOR
                      ? (model) => model.imageOutput === true
                      : modelType === ModelType.TRANSCRIPTION
                        ? (model) => model.audioInput === true
                        : undefined
                  }
                />
              </div>

              {/* Show provider selector only if model has multiple providers */}
              {selectedModels[modelType] &&
                getAvailableProviders(selectedModels[modelType]).length > 1 && (
                  <div className="flex-1 space-y-2">
                    <Label htmlFor={`provider-type-${modelType}`} className="font-medium text-sm">
                      {t.Settings.models.customModels.provider}
                    </Label>
                    <ProviderSelector
                      modelKey={selectedModels[modelType]}
                      value={selectedProviders[modelType]}
                      onChange={(value) => handleProviderChange(modelType, value)}
                      placeholder={t.Settings.models.customModels.selectProvider}
                    />
                  </div>
                )}
            </div>
          </CardContent>
        </Card>
      ))}

      {/* Add Custom Model Dialog */}
      <AddCustomModelDialog
        open={isCustomModelDialogOpen}
        onOpenChange={setIsCustomModelDialogOpen}
        onModelsAdded={handleCustomModelsAdded}
      />
    </div>
  );
}
