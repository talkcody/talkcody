import { ArrowDown, ArrowUp, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ModelSelectorWithSearch } from '@/components/selectors/model-selector-with-search';
import { ProviderSelector } from '@/components/selectors/provider-selector';
import {
  AddCustomModelDialog,
  CustomModelList,
} from '@/components/settings/add-custom-model-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { useLocale } from '@/hooks/use-locale';
import { logger } from '@/lib/logger';
import { generateId } from '@/lib/utils';
import { MODEL_CONFIGS, refreshModelConfigs } from '@/providers/config/model-config';
import { parseModelIdentifier } from '@/providers/core/provider-utils';
import { modelTypeService } from '@/providers/models/model-type-service';
import { useProviderStore } from '@/providers/stores/provider-store';
import { settingsManager } from '@/stores/settings-store';
import type { AvailableModel } from '@/types/api-keys';
import {
  DEFAULT_MODELS_BY_TYPE,
  isOrderedModelType,
  MODEL_TYPE_SETTINGS_KEYS,
  ModelType,
  parseStoredModelTypeValue,
  serializeStoredModelTypeValue,
} from '@/types/model-types';

interface ModelSelectionEntry {
  id: string;
  modelKey: string;
  provider: string;
}

function createModelSelectionEntry(
  modelKey = '',
  provider = '',
  id = generateId()
): ModelSelectionEntry {
  return {
    id,
    modelKey,
    provider,
  };
}

function createEmptySelections(): Record<ModelType, ModelSelectionEntry[]> {
  return Object.values(ModelType).reduce<Record<ModelType, ModelSelectionEntry[]>>(
    (selections, modelType) => {
      selections[modelType] = [];
      return selections;
    },
    {} as Record<ModelType, ModelSelectionEntry[]>
  );
}

function getAvailableProvidersForModel(availableModels: AvailableModel[], modelKey: string) {
  if (!modelKey) {
    return [];
  }

  const providers = availableModels
    .filter((model) => model.key === modelKey)
    .map((model) => ({ id: model.provider, name: model.providerName }));

  return Array.from(new Map(providers.map((provider) => [provider.id, provider])).values());
}

function normalizeEntriesForPersistence(
  entries: ModelSelectionEntry[],
  availableModels: AvailableModel[]
): ModelSelectionEntry[] {
  const normalizedEntries: ModelSelectionEntry[] = [];
  const seenIdentifiers = new Set<string>();

  for (const entry of entries) {
    const modelKey = entry.modelKey.trim();
    if (!modelKey) {
      continue;
    }

    const availableProviders = getAvailableProvidersForModel(availableModels, modelKey);
    const provider =
      availableProviders.find((availableProvider) => availableProvider.id === entry.provider)?.id ||
      entry.provider ||
      availableProviders[0]?.id ||
      '';
    const identifier = provider ? `${modelKey}@${provider}` : modelKey;

    if (seenIdentifiers.has(identifier)) {
      continue;
    }

    seenIdentifiers.add(identifier);
    normalizedEntries.push({ ...entry, modelKey, provider });
  }

  return normalizedEntries;
}

function buildEntriesFromStoredValue(
  value: string | null | undefined,
  modelType: ModelType,
  availableModels: AvailableModel[]
): ModelSelectionEntry[] {
  const entries = parseStoredModelTypeValue(value, modelType).map((modelIdentifier) => {
    const { modelKey, providerId } = parseModelIdentifier(modelIdentifier);
    return createModelSelectionEntry(modelKey, providerId || '');
  });

  return normalizeEntriesForPersistence(entries, availableModels);
}

function getSelectedEntry(entries: ModelSelectionEntry[]): ModelSelectionEntry {
  return entries[0] || createModelSelectionEntry();
}

function getModelTypeLocale(
  modelType: ModelType,
  t: ReturnType<typeof useLocale>['t']
): { title: string; description: string } {
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
    case ModelType.MESSAGE_COMPACTION:
      return {
        title: t.Settings.models.messageCompaction.title,
        description: t.Settings.models.messageCompaction.description,
      };
    case ModelType.PLAN:
      return {
        title: t.Settings.models.planModel.title,
        description: t.Settings.models.planModel.description,
      };
    case ModelType.CODE_REVIEW:
      return {
        title: t.Settings.models.codeReviewModel.title,
        description: t.Settings.models.codeReviewModel.description,
      };
    default:
      return { title: modelType, description: '' };
  }
}

export function ModelTypeSettings() {
  const { t } = useLocale();
  const availableModels = useProviderStore((state) => state.availableModels);
  const refreshModels = useProviderStore((state) => state.refresh);

  const [selectedEntries, setSelectedEntries] =
    useState<Record<ModelType, ModelSelectionEntry[]>>(createEmptySelections);
  const [isLoading, setIsLoading] = useState(false);
  const [isCustomModelDialogOpen, setIsCustomModelDialogOpen] = useState(false);

  const getPlaceholder = useCallback(
    (modelType: ModelType) => {
      const defaultModelKey = DEFAULT_MODELS_BY_TYPE[modelType];
      const modelConfig = MODEL_CONFIGS[defaultModelKey];
      if (modelConfig) {
        return modelConfig.name;
      }
      return t.Settings.models.selectModel;
    },
    [t.Settings.models.selectModel]
  );

  const loadModelTypeSettings = useCallback(async () => {
    try {
      setIsLoading(true);
      const availableModelsSnapshot = useProviderStore.getState().availableModels;
      const nextEntries = createEmptySelections();

      for (const modelType of Object.values(ModelType)) {
        const settingsKey = MODEL_TYPE_SETTINGS_KEYS[modelType];
        const value = await settingsManager.get(settingsKey);
        nextEntries[modelType] = buildEntriesFromStoredValue(
          value,
          modelType,
          availableModelsSnapshot
        );
      }

      setSelectedEntries(nextEntries);
    } catch (error) {
      logger.error('Failed to load model type settings:', error);
      toast.error(t.Settings.apiKeys.loadFailed);
    } finally {
      setIsLoading(false);
    }
  }, [t.Settings.apiKeys.loadFailed]);

  useEffect(() => {
    const initializeSettings = async () => {
      await refreshModels();
      await loadModelTypeSettings();
      logger.info('[ModelTypeSettings] Initialization completed');
    };

    initializeSettings();

    const handleApiKeysUpdated = async () => {
      try {
        await refreshModels();
        await loadModelTypeSettings();
      } catch (error) {
        logger.error('[ModelTypeSettings] Failed to refresh models after API key update:', error);
      }
    };

    window.addEventListener('apiKeysUpdated', handleApiKeysUpdated);
    window.addEventListener('customModelsUpdated', handleApiKeysUpdated);
    window.addEventListener('customProvidersUpdated', handleApiKeysUpdated);

    return () => {
      window.removeEventListener('apiKeysUpdated', handleApiKeysUpdated);
      window.removeEventListener('customModelsUpdated', handleApiKeysUpdated);
      window.removeEventListener('customProvidersUpdated', handleApiKeysUpdated);
    };
  }, [loadModelTypeSettings, refreshModels]);

  const persistSelections = useCallback(
    async (modelType: ModelType, entries: ModelSelectionEntry[], showToast = true) => {
      try {
        const normalizedEntries = normalizeEntriesForPersistence(entries, availableModels);
        const settingsKey = MODEL_TYPE_SETTINGS_KEYS[modelType];
        const serializedValue = serializeStoredModelTypeValue(
          modelType,
          normalizedEntries.map((entry) =>
            entry.provider ? `${entry.modelKey}@${entry.provider}` : entry.modelKey
          )
        );

        setSelectedEntries((previousEntries) => ({
          ...previousEntries,
          [modelType]: normalizedEntries,
        }));
        await settingsManager.set(settingsKey, serializedValue);

        if (showToast) {
          toast.success(t.Settings.models.updated(getModelTypeLocale(modelType, t).title));
        }
      } catch (error) {
        logger.error(`Failed to update ${modelType}:`, error);
        toast.error(t.Settings.models.updateFailed(getModelTypeLocale(modelType, t).title));
      }
    },
    [availableModels, t]
  );

  const handleSingleModelChange = async (modelType: ModelType, modelKey: string) => {
    const defaultProvider = getAvailableProvidersForModel(availableModels, modelKey)[0]?.id || '';
    const currentEntry = getSelectedEntry(selectedEntries[modelType]);
    await persistSelections(
      modelType,
      modelKey ? [createModelSelectionEntry(modelKey, defaultProvider, currentEntry.id)] : []
    );
  };

  const handleSingleProviderChange = async (modelType: ModelType, provider: string) => {
    const selectedEntry = getSelectedEntry(selectedEntries[modelType]);
    if (!selectedEntry.modelKey) {
      return;
    }

    await persistSelections(modelType, [{ ...selectedEntry, provider }], false);
    toast.success(t.Settings.models.providerUpdated(getModelTypeLocale(modelType, t).title));
  };

  const handleOrderedEntryModelChange = (modelType: ModelType, index: number, modelKey: string) => {
    const nextEntries = [...selectedEntries[modelType]];
    const defaultProvider = getAvailableProvidersForModel(availableModels, modelKey)[0]?.id || '';
    const currentEntry = nextEntries[index];
    if (!currentEntry) {
      return;
    }

    nextEntries[index] = { ...currentEntry, modelKey, provider: defaultProvider };
    void persistSelections(modelType, nextEntries);
  };

  const handleOrderedEntryProviderChange = (
    modelType: ModelType,
    index: number,
    provider: string
  ) => {
    const nextEntries = [...selectedEntries[modelType]];
    const currentEntry = nextEntries[index];
    if (!currentEntry) {
      return;
    }

    nextEntries[index] = { ...currentEntry, provider };
    void persistSelections(modelType, nextEntries);
  };

  const handleAddOrderedEntry = (modelType: ModelType) => {
    setSelectedEntries((previousEntries) => ({
      ...previousEntries,
      [modelType]: [...previousEntries[modelType], createModelSelectionEntry()],
    }));
  };

  const handleMoveOrderedEntry = (modelType: ModelType, index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    const nextEntries = [...selectedEntries[modelType]];

    if (nextIndex < 0 || nextIndex >= nextEntries.length) {
      return;
    }

    const currentEntry = nextEntries[index];
    const targetEntry = nextEntries[nextIndex];
    if (!currentEntry || !targetEntry) {
      return;
    }

    nextEntries[index] = targetEntry;
    nextEntries[nextIndex] = currentEntry;
    void persistSelections(modelType, nextEntries, false);
  };

  const handleRemoveOrderedEntry = (modelType: ModelType, index: number) => {
    const nextEntries = selectedEntries[modelType].filter((_, entryIndex) => entryIndex !== index);
    void persistSelections(modelType, nextEntries, false);
  };

  const handleResetToDefault = async (modelType: ModelType) => {
    try {
      await modelTypeService.clearModelForType(modelType);
      setSelectedEntries((previousEntries) => ({
        ...previousEntries,
        [modelType]: [],
      }));
      toast.success(t.Settings.models.updated(getModelTypeLocale(modelType, t).title));
    } catch (error) {
      logger.error(`Failed to reset ${modelType}:`, error);
      toast.error(t.Settings.models.updateFailed(getModelTypeLocale(modelType, t).title));
    }
  };

  const handleCustomModelsAdded = async () => {
    await refreshModelConfigs();
    await refreshModels();
    await loadModelTypeSettings();
  };

  const orderedModelTypes = useMemo(
    () => new Set<ModelType>([ModelType.SMALL, ModelType.MESSAGE_COMPACTION]),
    []
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {Object.values(ModelType).map((modelType) => {
        const isOrderedType = orderedModelTypes.has(modelType) || isOrderedModelType(modelType);
        const modelEntries = selectedEntries[modelType];
        const selectedEntry = getSelectedEntry(modelEntries);

        return (
          <Card key={modelType}>
            <CardHeader>
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1">
                  <CardTitle className="text-lg">
                    {getModelTypeLocale(modelType, t).title}
                  </CardTitle>
                  <CardDescription className="mt-1.5">
                    {getModelTypeLocale(modelType, t).description}
                  </CardDescription>
                </div>
                {modelEntries.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleResetToDefault(modelType)}
                    className="shrink-0"
                  >
                    {t.Settings.models.resetToDefault}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {isOrderedType ? (
                <div className="space-y-4">
                  {modelEntries.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {t.Settings.models.noFallbackModels}
                    </p>
                  ) : (
                    modelEntries.map((entry, index) => {
                      const availableProviders = getAvailableProvidersForModel(
                        availableModels,
                        entry.modelKey
                      );

                      return (
                        <div key={entry.id} className="space-y-3 rounded-lg border p-4">
                          <div className="flex items-center justify-between gap-3">
                            <Badge variant="secondary">
                              {t.Settings.models.priority(index + 1)}
                            </Badge>
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleMoveOrderedEntry(modelType, index, -1)}
                                disabled={index === 0}
                                aria-label={t.Settings.models.moveUp}
                              >
                                <ArrowUp className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleMoveOrderedEntry(modelType, index, 1)}
                                disabled={index === modelEntries.length - 1}
                                aria-label={t.Settings.models.moveDown}
                              >
                                <ArrowDown className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleRemoveOrderedEntry(modelType, index)}
                                aria-label={t.Settings.models.remove}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-x-12 gap-y-3">
                            <div className="flex items-center gap-2">
                              <Label className="shrink-0 font-medium text-sm">
                                {t.Settings.models.customModels.model}
                              </Label>
                              <ModelSelectorWithSearch
                                value={entry.modelKey}
                                onChange={(value) =>
                                  handleOrderedEntryModelChange(modelType, index, value)
                                }
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

                            {entry.modelKey && availableProviders.length > 1 && (
                              <div className="flex items-center gap-2">
                                <Label className="shrink-0 font-medium text-sm">
                                  {t.Settings.models.customModels.provider}
                                </Label>
                                <ProviderSelector
                                  modelKey={entry.modelKey}
                                  value={entry.provider}
                                  onChange={(value) =>
                                    handleOrderedEntryProviderChange(modelType, index, value)
                                  }
                                  placeholder={t.Settings.models.customModels.selectProvider}
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm text-muted-foreground">
                      {t.Settings.models.orderedRetryHint}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleAddOrderedEntry(modelType)}
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      {t.Settings.models.addFallbackModel}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-x-32 gap-y-4">
                  <div className="flex items-center gap-2">
                    <Label
                      htmlFor={`model-type-${modelType}`}
                      className="shrink-0 font-medium text-sm"
                    >
                      {t.Settings.models.customModels.model}
                    </Label>
                    <ModelSelectorWithSearch
                      value={selectedEntry.modelKey}
                      onChange={(value) => handleSingleModelChange(modelType, value)}
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

                  {selectedEntry.modelKey &&
                    getAvailableProvidersForModel(availableModels, selectedEntry.modelKey).length >
                      1 && (
                      <div className="flex items-center gap-2">
                        <Label
                          htmlFor={`provider-type-${modelType}`}
                          className="shrink-0 font-medium text-sm"
                        >
                          {t.Settings.models.customModels.provider}
                        </Label>
                        <ProviderSelector
                          modelKey={selectedEntry.modelKey}
                          value={selectedEntry.provider}
                          onChange={(value) => handleSingleProviderChange(modelType, value)}
                          placeholder={t.Settings.models.customModels.selectProvider}
                        />
                      </div>
                    )}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

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

      <AddCustomModelDialog
        open={isCustomModelDialogOpen}
        onOpenChange={setIsCustomModelDialogOpen}
        onModelsAdded={handleCustomModelsAdded}
      />
    </div>
  );
}
