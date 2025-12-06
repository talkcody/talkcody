import { Loader2, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
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
import { useTranslation } from '@/hooks/use-locale';
import { logger } from '@/lib/logger';
import { customModelService, type FetchedModel } from '@/services/custom-model-service';
import type { ModelConfig } from '@/types/models';

interface AddCustomModelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onModelsAdded?: () => void;
}

export function AddCustomModelDialog({
  open,
  onOpenChange,
  onModelsAdded,
}: AddCustomModelDialogProps) {
  const t = useTranslation();
  const [availableProviders, setAvailableProviders] = useState<Array<{ id: string; name: string }>>(
    []
  );
  const [selectedProvider, setSelectedProvider] = useState<string>('');
  const [fetchedModels, setFetchedModels] = useState<FetchedModel[]>([]);
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());
  const [manualModelName, setManualModelName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [showManualInput, setShowManualInput] = useState(false);

  // Load available providers on mount
  useEffect(() => {
    if (open) {
      const providers = customModelService.getAvailableProvidersForFetch();
      setAvailableProviders(providers);
      // Reset state when dialog opens
      setSelectedProvider('');
      setFetchedModels([]);
      setSelectedModels(new Set());
      setManualModelName('');
      setSearchQuery('');
      setShowManualInput(false);
    }
  }, [open]);

  // Fetch models when provider is selected
  const handleFetchModels = useCallback(async () => {
    if (!selectedProvider) return;

    setIsFetching(true);
    setFetchedModels([]);
    setSelectedModels(new Set());
    setSearchQuery('');

    try {
      const models = await customModelService.fetchProviderModels(selectedProvider);
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
  }, [
    selectedProvider,
    t.Settings.customModelsDialog.fetchFailed,
    t.Settings.customModelsDialog.noModelsFound,
  ]);

  // Filter models based on search query
  const filteredModels = fetchedModels.filter((model) => {
    if (!searchQuery.trim()) return true;
    const searchTerms = searchQuery.toLowerCase().trim().split(/\s+/);
    const modelId = model.id.toLowerCase();
    return searchTerms.every((term) => modelId.includes(term));
  });

  // Toggle model selection
  const toggleModelSelection = (modelId: string) => {
    const newSelection = new Set(selectedModels);
    if (newSelection.has(modelId)) {
      newSelection.delete(modelId);
    } else {
      newSelection.add(modelId);
    }
    setSelectedModels(newSelection);
  };

  // Select all models
  const selectAllModels = () => {
    const newSelection = new Set(selectedModels);
    filteredModels.forEach((m) => {
      newSelection.add(m.id);
    });
    setSelectedModels(newSelection);
  };

  // Clear all selections
  const clearAllSelections = () => {
    setSelectedModels(new Set());
  };

  // Add selected models
  const handleAddModels = async () => {
    const modelsToAdd: Record<string, ModelConfig> = {};

    // Add selected models from fetched list
    for (const modelId of selectedModels) {
      const fetchedModel = fetchedModels.find((m) => m.id === modelId);
      modelsToAdd[modelId] = {
        name: fetchedModel?.name || modelId,
        providers: [selectedProvider],
        pricing: { input: '0', output: '0' },
      };
    }

    // Add manual model if provided
    if (manualModelName.trim()) {
      modelsToAdd[manualModelName.trim()] = {
        name: manualModelName.trim(),
        providers: [selectedProvider],
        pricing: { input: '0', output: '0' },
      };
    }

    if (Object.keys(modelsToAdd).length === 0) {
      toast.error(t.Settings.customModelsDialog.selectAtLeastOne);
      return;
    }

    setIsLoading(true);
    try {
      await customModelService.addCustomModels(modelsToAdd);
      toast.success(t.Settings.customModelsDialog.addedModels(Object.keys(modelsToAdd).length));
      onOpenChange(false);
      onModelsAdded?.();
    } catch (error) {
      logger.error('Failed to add custom models:', error);
      toast.error(t.Settings.customModelsDialog.addFailed);
    } finally {
      setIsLoading(false);
    }
  };

  const supportsModelsFetch = selectedProvider
    ? customModelService.supportsModelsFetch(selectedProvider)
    : false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>{t.Settings.customModelsDialog.title}</DialogTitle>
          <DialogDescription>{t.Settings.customModelsDialog.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Provider Selection */}
          <div className="space-y-2">
            <Label>{t.Settings.customModelsDialog.provider}</Label>
            <Select value={selectedProvider} onValueChange={setSelectedProvider}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t.Settings.customModelsDialog.selectProvider} />
              </SelectTrigger>
              <SelectContent>
                {availableProviders.map((provider) => (
                  <SelectItem key={provider.id} value={provider.id}>
                    {provider.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Fetch Models Button */}
          {selectedProvider && supportsModelsFetch && (
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
                  placeholder="Search models..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-8 pr-8"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label="Clear search"
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
                      No models found matching "{searchQuery}"
                    </div>
                  )}
                </div>
              </ScrollArea>
              <div className="text-sm text-muted-foreground">
                {t.Settings.customModelsDialog.modelsSelected(selectedModels.size)}
              </div>
            </div>
          )}

          {/* Manual Input (for providers without /v1/models or as fallback) */}
          {selectedProvider && (showManualInput || !supportsModelsFetch) && (
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
          {selectedProvider && supportsModelsFetch && fetchedModels.length > 0 && (
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
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
            {t.Common.cancel}
          </Button>
          <Button
            onClick={handleAddModels}
            disabled={
              isLoading ||
              (selectedModels.size === 0 && !manualModelName.trim()) ||
              !selectedProvider
            }
          >
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t.Settings.customModelsDialog.addModels}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface CustomModelListProps {
  onRefresh?: () => void;
}

export function CustomModelList({ onRefresh }: CustomModelListProps) {
  const t = useTranslation();
  const [customModels, setCustomModels] = useState<Record<string, ModelConfig>>({});
  const [isLoading, setIsLoading] = useState(true);

  const loadCustomModels = useCallback(async () => {
    try {
      const config = await customModelService.getCustomModels();
      setCustomModels(config.models);
    } catch (error) {
      logger.error('Failed to load custom models:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCustomModels();

    // Listen for updates
    const handleUpdate = () => {
      loadCustomModels();
    };
    window.addEventListener('customModelsUpdated', handleUpdate);
    return () => window.removeEventListener('customModelsUpdated', handleUpdate);
  }, [loadCustomModels]);

  const handleRemoveModel = async (modelId: string) => {
    try {
      await customModelService.removeCustomModel(modelId);
      toast.success(`Removed custom model: ${modelId}`);
      onRefresh?.();
    } catch (error) {
      logger.error('Failed to remove custom model:', error);
      toast.error(t.Settings.customModelsDialog.addFailed);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const modelEntries = Object.entries(customModels);

  if (modelEntries.length === 0) {
    return (
      <div className="text-sm text-muted-foreground text-center py-4">
        {t.Settings.models.customModels.noModels}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {modelEntries.map(([modelId, config]) => (
        <div
          key={modelId}
          className="flex items-center justify-between rounded-md border p-3 bg-muted/30"
        >
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{config.name}</div>
            <div className="text-xs text-muted-foreground">
              {modelId} - {config.providers.join(', ')}
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleRemoveModel(modelId)}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
    </div>
  );
}
