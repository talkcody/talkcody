// src/components/chat/prompt-enhancement-options-button.tsx

import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useLocale } from '@/hooks/use-locale';
import { useProviderStore } from '@/providers/stores/provider-store';
import { useSettingsStore } from '@/stores/settings-store';

export function PromptEnhancementOptionsButton() {
  const { t } = useLocale();
  const enhancementContextEnabled = useSettingsStore(
    (state) => state.prompt_enhancement_context_enabled
  );
  const enhancementModel = useSettingsStore((state) => state.prompt_enhancement_model);
  const availableModels = useProviderStore((state) => state.availableModels);

  return (
    <HoverCard>
      <Popover>
        <HoverCardTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 relative">
              <Sparkles className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
        </HoverCardTrigger>
        <HoverCardContent side="top" className="w-56">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              <h4 className="font-medium text-sm">{t.Chat.promptEnhancement.optionsButton}</h4>
            </div>
            <p className="text-xs text-muted-foreground">
              {t.Chat.promptEnhancement.contextExtractionDescription}
            </p>
          </div>
        </HoverCardContent>
        <PopoverContent className="w-72" align="end">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <label className="text-sm font-medium">
                  {t.Chat.promptEnhancement.contextExtraction}
                </label>
                <p className="text-xs text-muted-foreground">
                  {t.Chat.promptEnhancement.contextExtractionDescription}
                </p>
              </div>
              <Switch
                checked={enhancementContextEnabled}
                onCheckedChange={(checked) => {
                  useSettingsStore.getState().setPromptEnhancementContextEnabled(checked);
                }}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">{t.Chat.promptEnhancement.modelSelect}</label>
              <Select
                value={enhancementModel || '__follow__'}
                onValueChange={(value) => {
                  useSettingsStore
                    .getState()
                    .setPromptEnhancementModel(value === '__follow__' ? '' : value);
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t.Chat.promptEnhancement.modelPlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__follow__">
                    {t.Chat.promptEnhancement.followCurrentModel}
                  </SelectItem>
                  {availableModels.map((model) => (
                    <SelectItem
                      key={`${model.key}@${model.provider}`}
                      value={`${model.key}@${model.provider}`}
                    >
                      {model.name} ({model.providerName})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </HoverCard>
  );
}
