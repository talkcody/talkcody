// src/components/custom-provider/AddCustomProviderDialog.tsx

import { AlertCircle, CheckCircle, Loader2, Plus, RefreshCw, TestTube, X } from 'lucide-react';
import { useCallback, useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useTranslation } from '@/hooks/use-locale';
import { logger } from '@/lib/logger';
import { refreshModelConfigs } from '@/providers/config/model-config';
import { customModelService, type FetchedModel } from '@/providers/custom/custom-model-service';
import { customProviderService } from '@/providers/custom/custom-provider-service';
import { useProviderStore } from '@/providers/stores/provider-store';
import type {
  CustomProviderConfig,
  CustomProviderTestResult,
  CustomProviderType,
  CustomProviderValidation,
} from '@/types/custom-provider';
import type { ModelConfig } from '@/types/models';

interface AddCustomProviderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider?: CustomProviderConfig;
  onProviderSaved?: () => void;
}

const PROVIDER_TYPES: {
  value: CustomProviderType;
  labelKey: 'openaiCompatible' | 'anthropic';
  descriptionKey: 'openaiCompatibleDescription' | 'anthropicDescription';
}[] = [
  {
    value: 'openai-compatible',
    labelKey: 'openaiCompatible',
    descriptionKey: 'openaiCompatibleDescription',
  },
  {
    value: 'anthropic',
    labelKey: 'anthropic',
    descriptionKey: 'anthropicDescription',
  },
];

type DialogStep = 'provider' | 'model';

export function AddCustomProviderDialog({
  open,
  onOpenChange,
  provider,
  onProviderSaved,
}: AddCustomProviderDialogProps) {
  const t = useTranslation();

  // Step control
  const [step, setStep] = useState<DialogStep>('provider');
  const [savedProviderId, setSavedProviderId] = useState<string>('');

  // Provider form state
  const [formData, setFormData] = useState<Partial<CustomProviderConfig>>({
    id: '',
    name: '',
    type: 'openai-compatible',
    baseUrl: '',
    apiKey: '',
    enabled: true,
    description: '',
  });

  const [validation, setValidation] = useState<CustomProviderValidation>({
    isValid: false,
    errors: [],
    warnings: [],
  });
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<CustomProviderTestResult | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Model step state
  const [fetchedModels, setFetchedModels] = useState<FetchedModel[]>([]);
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());
  const [manualModelName, setManualModelName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isFetching, setIsFetching] = useState(false);
  const [isAddingModels, setIsAddingModels] = useState(false);
  const [showManualInput, setShowManualInput] = useState(false);

  // Generate unique IDs for form elements
  const nameId = useId();
  const baseUrlId = useId();
  const apiKeyId = useId();
  const enabledId = useId();

  // Reset form when dialog opens/closes or provider changes
  useEffect(() => {
    if (open) {
      // Reset step
      setStep('provider');
      setSavedProviderId('');

      // Reset provider form
      if (provider) {
        setFormData({
          id: provider.id,
          name: provider.name,
          type: provider.type,
          baseUrl: provider.baseUrl,
          apiKey: provider.apiKey,
          enabled: provider.enabled,
          description: provider.description || '',
        });
      } else {
        setFormData({
          id: '',
          name: '',
          type: 'openai-compatible',
          baseUrl: '',
          apiKey: '',
          enabled: true,
          description: '',
        });
      }
      setTestResult(null);

      // Reset model state
      setFetchedModels([]);
      setSelectedModels(new Set());
      setManualModelName('');
      setSearchQuery('');
      setShowManualInput(false);
    }
  }, [open, provider]);

  // Validate form data
  useEffect(() => {
    // Pass existing provider ID when editing to skip conflict check for the same provider
    const result = customProviderService.validateProviderConfig(formData, provider?.id);
    setValidation(result);
  }, [formData, provider?.id]);

  const handleInputChange = (field: keyof CustomProviderConfig, value: string | boolean) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setTestResult(null);
  };

  const handleTestConnection = async () => {
    if (!validation.isValid) {
      toast.error(t.CustomProviderDialog.fixValidationErrors);
      return;
    }

    setIsTesting(true);
    setTestResult(null);

    try {
      const result = await customProviderService.testProviderConnection(
        formData as CustomProviderConfig
      );
      setTestResult(result);

      if (result.success) {
        if (result.responseTime != null) {
          toast.success(t.CustomProviderDialog.connectionSuccessfulWithTime(result.responseTime));
        } else {
          toast.success(t.CustomProviderDialog.connectionSuccessful);
        }
      } else {
        toast.error(t.CustomProviderDialog.connectionFailed(result.error || 'Unknown error'));
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setTestResult({ success: false, error: errorMessage });
      toast.error(t.CustomProviderDialog.testFailed(errorMessage));
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
    if (!validation.isValid) {
      toast.error(t.CustomProviderDialog.fixValidationErrors);
      return;
    }

    setIsSaving(true);

    try {
      let providerId = formData.id;
      if (!providerId) {
        providerId = customProviderService.generateProviderId(formData.type!, formData.name!);
      }

      if (!formData.name || !formData.type || !formData.baseUrl || !formData.apiKey) {
        throw new Error('Missing required fields');
      }

      const providerConfig: CustomProviderConfig = {
        id: providerId,
        name: formData.name,
        type: formData.type,
        baseUrl: formData.baseUrl,
        apiKey: formData.apiKey,
        enabled: formData.enabled ?? true,
        description: formData.description,
      };

      if (provider) {
        // Edit mode - use provider store to update (triggers refresh to rebuild provider instances)
        await useProviderStore.getState().updateCustomProvider(provider.id, providerConfig);
        toast.success(t.CustomProviderDialog.providerUpdated);
        onOpenChange(false);
        onProviderSaved?.();
      } else {
        // Add mode - save and proceed to model step
        await useProviderStore.getState().addCustomProvider(providerConfig);
        toast.success(t.CustomProviderDialog.providerAdded);
        setSavedProviderId(providerId);
        setStep('model');
        onProviderSaved?.();
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast.error(t.CustomProviderDialog.saveFailed(errorMessage));
    } finally {
      setIsSaving(false);
    }
  };

  // Model step functions
  const handleFetchModels = useCallback(async () => {
    if (!savedProviderId) return;

    setIsFetching(true);
    setFetchedModels([]);
    setSelectedModels(new Set());
    setSearchQuery('');

    try {
      const models = await customModelService.fetchProviderModels(savedProviderId);
      setFetchedModels(models);

      if (models.length === 0) {
        toast.info(t.Settings.customModelsDialog.noModelsFound);
        setShowManualInput(true);
      } else {
        setShowManualInput(false);
      }
    } catch (error) {
      logger.error('Failed to fetch models:', error);
      toast.error(
        t.Settings.customModelsDialog.fetchFailed(
          error instanceof Error ? error.message : 'Unknown error'
        )
      );
      setShowManualInput(true);
    } finally {
      setIsFetching(false);
    }
  }, [savedProviderId, t.Settings.customModelsDialog]);

  // Filter models based on search query
  const filteredModels = fetchedModels.filter((model) => {
    if (!searchQuery.trim()) return true;
    const searchTerms = searchQuery.toLowerCase().trim().split(/\s+/);
    const modelId = model.id.toLowerCase();
    return searchTerms.every((term) => modelId.includes(term));
  });

  const toggleModelSelection = (modelId: string) => {
    const newSelection = new Set(selectedModels);
    if (newSelection.has(modelId)) {
      newSelection.delete(modelId);
    } else {
      newSelection.add(modelId);
    }
    setSelectedModels(newSelection);
  };

  const selectAllModels = () => {
    setSelectedModels(new Set(filteredModels.map((m) => m.id)));
  };

  const clearAllSelections = () => {
    setSelectedModels(new Set());
  };

  const handleAddModels = async () => {
    const modelsToAdd: Record<string, ModelConfig> = {};

    // Add selected models from fetched list
    for (const modelId of selectedModels) {
      const fetchedModel = fetchedModels.find((m) => m.id === modelId);
      modelsToAdd[modelId] = {
        name: fetchedModel?.name || modelId,
        providers: [savedProviderId],
        pricing: { input: '0', output: '0' },
      };
    }

    // Add manual model if provided
    if (manualModelName.trim()) {
      modelsToAdd[manualModelName.trim()] = {
        name: manualModelName.trim(),
        providers: [savedProviderId],
        pricing: { input: '0', output: '0' },
      };
    }

    if (Object.keys(modelsToAdd).length === 0) {
      toast.error(t.Settings.customModelsDialog.selectAtLeastOne);
      return;
    }

    setIsAddingModels(true);
    try {
      await customModelService.addCustomModels(modelsToAdd);
      await refreshModelConfigs();
      await useProviderStore.getState().refresh();
      toast.success(t.Settings.customModelsDialog.addedModels(Object.keys(modelsToAdd).length));
      onOpenChange(false);
    } catch (error) {
      logger.error('Failed to add custom models:', error);
      toast.error(t.Settings.customModelsDialog.addFailed);
    } finally {
      setIsAddingModels(false);
    }
  };

  const handleSkipModels = () => {
    onOpenChange(false);
  };

  const supportsModelsFetch = customModelService.supportsModelsFetch(savedProviderId);

  const selectedType = PROVIDER_TYPES.find((t) => t.value === formData.type);
  const isEditMode = !!provider;

  // Render provider step content
  const renderProviderStep = () => (
    <>
      <DialogHeader>
        <DialogTitle>
          {isEditMode ? t.CustomProviderDialog.editTitle : t.CustomProviderDialog.addTitle}
        </DialogTitle>
        <DialogDescription>{t.CustomProviderDialog.description}</DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-4">
        {/* Provider Type */}
        <div className="space-y-2">
          <Label htmlFor="type">{t.CustomProviderDialog.providerType} *</Label>
          <Select
            value={formData.type}
            onValueChange={(value: CustomProviderType) => handleInputChange('type', value)}
          >
            <SelectTrigger>
              <SelectValue placeholder={t.CustomProviderDialog.selectProviderType} />
            </SelectTrigger>
            <SelectContent>
              {PROVIDER_TYPES.map((type) => (
                <SelectItem key={type.value} value={type.value}>
                  {t.CustomProviderDialog[type.labelKey]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedType && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Badge variant="outline">{t.CustomProviderDialog[selectedType.labelKey]}</Badge>
              <span>{t.CustomProviderDialog[selectedType.descriptionKey]}</span>
            </div>
          )}
        </div>

        {/* Provider Name */}
        <div className="space-y-2">
          <Label htmlFor={nameId}>{t.CustomProviderDialog.providerName} *</Label>
          <Input
            id={nameId}
            value={formData.name}
            onChange={(e) => handleInputChange('name', e.target.value)}
            placeholder={t.CustomProviderDialog.providerNamePlaceholder}
          />
        </div>

        {/* Base URL */}
        <div className="space-y-2">
          <Label htmlFor={baseUrlId}>{t.CustomProviderDialog.baseUrl} *</Label>
          <Input
            id={baseUrlId}
            value={formData.baseUrl}
            onChange={(e) => handleInputChange('baseUrl', e.target.value)}
            placeholder={
              formData.type === 'anthropic'
                ? t.CustomProviderDialog.baseUrlPlaceholderAnthropic
                : t.CustomProviderDialog.baseUrlPlaceholderOpenAI
            }
          />
          <p className="text-xs text-muted-foreground">{t.CustomProviderDialog.baseUrlHint}</p>
        </div>

        {/* API Key */}
        <div className="space-y-2">
          <Label htmlFor={apiKeyId}>{t.CustomProviderDialog.apiKey} *</Label>
          <Input
            id={apiKeyId}
            type="password"
            value={formData.apiKey}
            onChange={(e) => handleInputChange('apiKey', e.target.value)}
            placeholder={t.CustomProviderDialog.apiKeyPlaceholder}
          />
        </div>

        {/* Enabled Switch */}
        <div className="flex items-center space-x-2">
          <Switch
            id={enabledId}
            checked={formData.enabled}
            onCheckedChange={(checked) => handleInputChange('enabled', checked)}
          />
          <Label htmlFor={enabledId}>{t.CustomProviderDialog.enabled}</Label>
        </div>

        {/* Validation Errors */}
        {validation.errors.length > 0 && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <div className="space-y-1">
                {validation.errors.map((error) => (
                  <div key={error}>{error}</div>
                ))}
              </div>
            </AlertDescription>
          </Alert>
        )}

        {/* Validation Warnings */}
        {validation.warnings.length > 0 && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <div className="space-y-1">
                {validation.warnings.map((warning) => (
                  <div key={warning}>{warning}</div>
                ))}
              </div>
            </AlertDescription>
          </Alert>
        )}

        {/* Test Results */}
        {testResult && (
          <Alert variant={testResult.success ? 'default' : 'destructive'}>
            {testResult.success ? (
              <CheckCircle className="h-4 w-4" />
            ) : (
              <AlertCircle className="h-4 w-4" />
            )}
            <AlertDescription>
              <div className="space-y-2">
                <div>
                  {testResult.success
                    ? testResult.responseTime != null
                      ? t.CustomProviderDialog.connectionSuccessfulWithTime(testResult.responseTime)
                      : t.CustomProviderDialog.connectionSuccessful
                    : t.CustomProviderDialog.connectionFailed(testResult.error || 'Unknown error')}
                </div>
                {testResult.models && testResult.models.length > 0 && (
                  <div className="text-xs">
                    {t.CustomProviderDialog.availableModelsHint(
                      testResult.models.slice(0, 5).join(', '),
                      testResult.models.length > 5 ? testResult.models.length - 5 : 0
                    )}
                  </div>
                )}
              </div>
            </AlertDescription>
          </Alert>
        )}
      </div>

      <DialogFooter className="flex gap-2 sm:gap-0">
        <Button
          variant="outline"
          onClick={handleTestConnection}
          disabled={!validation.isValid || isTesting}
        >
          {isTesting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t.CustomProviderDialog.testing}
            </>
          ) : (
            <>
              <TestTube className="mr-2 h-4 w-4" />
              {t.CustomProviderDialog.test}
            </>
          )}
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            {t.Common.cancel}
          </Button>
          <Button onClick={handleSave} disabled={!validation.isValid || isSaving}>
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t.CustomProviderDialog.saving}
              </>
            ) : isEditMode ? (
              t.Common.update
            ) : (
              t.Common.add
            )}
          </Button>
        </div>
      </DialogFooter>
    </>
  );

  // Render model step content
  const renderModelStep = () => (
    <>
      <DialogHeader>
        <DialogTitle>{t.CustomProviderDialog.addModelsTitle(formData.name || '')}</DialogTitle>
        <DialogDescription>{t.Settings.customModelsDialog.description}</DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-4">
        {/* Fetch Models Button */}
        {supportsModelsFetch && (
          <Button
            variant="outline"
            onClick={handleFetchModels}
            disabled={isFetching}
            className="w-full"
          >
            {isFetching ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            {t.Settings.customModelsDialog.fetchModels}
          </Button>
        )}

        {/* Models List */}
        {fetchedModels.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>{t.Settings.customModelsDialog.availableModels(fetchedModels.length)}</Label>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={selectAllModels}>
                  {t.Settings.customModelsDialog.selectAll}
                </Button>
                <Button variant="ghost" size="sm" onClick={clearAllSelections}>
                  {t.Settings.customModelsDialog.clear}
                </Button>
              </div>
            </div>

            <div className="relative">
              <Input
                placeholder={t.Settings.customModelsDialog.searchPlaceholder}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 pr-8"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={t.Settings.customModelsDialog.clearSearchAria}
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            <ScrollArea className="h-[200px] rounded-md border p-2">
              <div className="space-y-2">
                {filteredModels.map((model) => (
                  <button
                    key={model.id}
                    type="button"
                    className="flex items-center space-x-2 rounded p-2 hover:bg-accent cursor-pointer w-full text-left"
                    onClick={() => toggleModelSelection(model.id)}
                  >
                    <Checkbox
                      checked={selectedModels.has(model.id)}
                      onCheckedChange={() => toggleModelSelection(model.id)}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{model.id}</div>
                      {model.owned_by && (
                        <div className="text-xs text-muted-foreground">{model.owned_by}</div>
                      )}
                    </div>
                  </button>
                ))}
                {filteredModels.length === 0 && (
                  <div className="text-sm text-muted-foreground text-center py-4">
                    {t.Settings.customModelsDialog.noModelsMatch(searchQuery)}
                  </div>
                )}
              </div>
            </ScrollArea>
            <div className="text-sm text-muted-foreground">
              {t.Settings.customModelsDialog.modelsSelected(selectedModels.size)}
            </div>
          </div>
        )}

        {/* Manual Input */}
        {(showManualInput || !supportsModelsFetch) && (
          <div className="space-y-2">
            <Label>{t.Settings.customModelsDialog.manualModelName}</Label>
            <div className="flex gap-2">
              <Input
                placeholder={t.Settings.customModelsDialog.manualModelPlaceholder}
                value={manualModelName}
                onChange={(e) => setManualModelName(e.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {!supportsModelsFetch
                ? t.Settings.customModelsDialog.noListingSupport
                : t.Settings.customModelsDialog.enterManually}
            </p>
          </div>
        )}

        {/* Toggle Manual Input */}
        {supportsModelsFetch && fetchedModels.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowManualInput(!showManualInput)}
            className="w-full"
          >
            <Plus className="mr-2 h-4 w-4" />
            {showManualInput
              ? t.Settings.customModelsDialog.hideManualInput
              : t.Settings.customModelsDialog.addModelManually}
          </Button>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={handleSkipModels} disabled={isAddingModels}>
          {t.CustomProviderDialog.skip}
        </Button>
        <Button
          onClick={handleAddModels}
          disabled={isAddingModels || (selectedModels.size === 0 && !manualModelName.trim())}
        >
          {isAddingModels && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t.Settings.customModelsDialog.addModels}
        </Button>
      </DialogFooter>
    </>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        {step === 'provider' ? renderProviderStep() : renderModelStep()}
      </DialogContent>
    </Dialog>
  );
}
