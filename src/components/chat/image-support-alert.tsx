import { AlertTriangle, Image as ImageIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useLocale } from '@/hooks/use-locale';
import { logger } from '@/lib/logger';
import { useModelStore } from '@/stores/model-store';

interface ImageSupportAlertProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onModelSelect: (modelKey: string) => Promise<void>;
  onCancel?: () => void;
}

export function ImageSupportAlert({
  open,
  onOpenChange,
  onModelSelect,
  onCancel,
}: ImageSupportAlertProps) {
  const { t } = useLocale();
  const { availableModels } = useModelStore();
  const [imageSupportedModels, setImageSupportedModels] = useState<string[]>([]);

  useEffect(() => {
    // Get models that support image input
    const supportedModels = availableModels
      .filter((model) => model.imageInput === true)
      .map((model) => model.key);

    setImageSupportedModels(supportedModels);
  }, [availableModels]);

  const handleKeepCurrentModel = () => {
    if (onCancel) {
      onCancel();
    }
    onOpenChange(false);
  };

  const handleModelClick = async (modelKey: string) => {
    try {
      // Close the dialog first
      onOpenChange(false);
      // Then call onModelSelect (this is async but we don't await it here to avoid blocking)
      onModelSelect(modelKey).then(() => {
        toast.success(t.Chat.model.switchSuccess);
      });
    } catch (error) {
      logger.error('Error handling model click:', error);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="flex items-center gap-2">
            <ImageIcon className="h-5 w-5 text-orange-500" />
            <AlertDialogTitle>{t.Chat.image.notSupported}</AlertDialogTitle>
          </div>
          <AlertDialogDescription>{t.Chat.image.notSupportedDescription}</AlertDialogDescription>
        </AlertDialogHeader>

        {imageSupportedModels.length > 0 && (
          <div className="space-y-3 py-3">
            <div className="text-sm font-medium">{t.Chat.image.supportedModels}</div>
            <div className="grid gap-2 max-h-48 overflow-y-auto">
              {imageSupportedModels.map((modelKey) => {
                const model = availableModels.find((m) => m.key === modelKey);
                return (
                  <button
                    type="button"
                    key={modelKey}
                    onClick={() => handleModelClick(modelKey)}
                    className="flex items-center justify-between rounded-lg border p-3 text-left hover:bg-accent transition-colors cursor-pointer"
                  >
                    <div>
                      <div className="font-medium">{model?.name || modelKey}</div>
                      <div className="text-sm text-muted-foreground">{model?.providerName}</div>
                    </div>
                    <div className="flex items-center gap-1">
                      <ImageIcon className="h-4 w-4 text-green-500" />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {imageSupportedModels.length === 0 && (
          <div className="flex items-center gap-2 p-3 bg-orange-50 dark:bg-orange-950/30 rounded-lg">
            <AlertTriangle className="h-4 w-4 text-orange-500" />
            <div className="text-sm">{t.Chat.image.noModelsAvailable}</div>
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleKeepCurrentModel}>
            {t.Chat.image.keepCurrentModel}
          </AlertDialogCancel>
          {imageSupportedModels.length > 0 && (
            <AlertDialogAction onClick={() => onOpenChange(false)}>
              {t.Chat.image.chooseModel}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
