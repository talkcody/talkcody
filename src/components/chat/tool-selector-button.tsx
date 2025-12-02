// src/components/chat/tool-selector-button.tsx

import { Check, ExternalLink, RotateCcw, Wrench } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useLocale } from '@/hooks/use-locale';
import { useAppSettings } from '@/hooks/use-settings';
import { DOC_LINKS } from '@/lib/doc-links';
import { logger } from '@/lib/logger';
import { getAvailableToolsForUISync } from '@/services/agents/tool-registry';
import { useAgentStore } from '@/stores/agent-store';
import { useToolOverrideStore } from '@/stores/tool-override-store';

export function ToolSelectorButton() {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const { settings } = useAppSettings();
  const [toolsLoaded, setToolsLoaded] = useState(false);

  // Subscribe to agents Map (triggers re-render when any agent updates)
  const agents = useAgentStore((state) => state.agents);

  // Get current agent using both store state and external dependency
  const currentAgent = useMemo(() => {
    if (!settings.assistantId) return null;
    return agents.get(settings.assistantId) || null;
  }, [agents, settings.assistantId]);

  // Wait for tools to be loaded before accessing them
  useEffect(() => {
    const checkToolsLoaded = async () => {
      try {
        // Try to access tools, will throw if not loaded
        getAvailableToolsForUISync();
        setToolsLoaded(true);
      } catch {
        // Tools not loaded yet, wait a bit and retry
        const timer = setTimeout(checkToolsLoaded, 100);
        return () => clearTimeout(timer);
      }
    };

    checkToolsLoaded();
  }, []);

  // Get all available built-in tools (excluding hidden tools)
  // Return empty array if tools aren't loaded yet to prevent crash
  const builtInTools = useMemo(() => {
    if (!toolsLoaded) return [];
    try {
      const allTools = getAvailableToolsForUISync();
      // Filter out hidden tools
      return allTools.filter((tool) => {
        const ref = tool.ref as { hidden?: boolean };
        return !ref.hidden;
      });
    } catch (error) {
      logger.error('Failed to get built-in tools:', error);
      return [];
    }
  }, [toolsLoaded]);

  // Subscribe to tool overrides
  const toolOverrides = useToolOverrideStore((state) => state.overrides);

  // Get current agent's selected tools with overrides applied
  const selectedToolIds = useMemo(() => {
    if (!currentAgent) return new Set<string>();

    // Start with base tools from agent
    const baseTools = new Set(Object.keys(currentAgent.tools || {}));

    // Apply tool overrides if they exist
    const override = currentAgent.id ? toolOverrides.get(currentAgent.id) : undefined;
    if (override) {
      // Add overridden tools
      for (const toolId of override.addedTools) {
        baseTools.add(toolId);
      }
      // Remove overridden tools
      for (const toolId of override.removedTools) {
        baseTools.delete(toolId);
      }
    }

    return baseTools;
  }, [currentAgent, toolOverrides]);

  // Only show built-in tools (MCP tools are shown in MCP Servers selector)
  const allAvailableTools = useMemo(() => {
    return builtInTools.map((tool) => ({
      id: tool.id,
      label: tool.label,
      type: 'built-in' as const,
    }));
  }, [builtInTools]);

  const handleToggleTool = (toolId: string) => {
    if (!currentAgent) {
      toast.error(t.Error.generic);
      return;
    }

    try {
      const isSelected = selectedToolIds.has(toolId);

      // Use tool override store for temporary modifications
      if (isSelected) {
        useToolOverrideStore.getState().removeTool(currentAgent.id, toolId);
        toast.success(t.Chat.tools.removedTemp);
      } else {
        useToolOverrideStore.getState().addTool(currentAgent.id, toolId);
        toast.success(t.Chat.tools.addedTemp);
      }
    } catch (error) {
      logger.error('Failed to toggle tool:', error);
      toast.error(t.Error.generic);
    }
  };

  const handleReset = () => {
    if (!currentAgent) return;

    try {
      useToolOverrideStore.getState().clearOverride(currentAgent.id);
      toast.success(t.Chat.tools.resetSuccess);
    } catch (error) {
      logger.error('Failed to reset tool overrides:', error);
      toast.error(t.Error.generic);
    }
  };

  // Only count built-in tools (exclude MCP tools)
  const selectedCount = useMemo(() => {
    const builtInToolIds = new Set(builtInTools.map((t) => t.id));
    return Array.from(selectedToolIds).filter((id) => builtInToolIds.has(id)).length;
  }, [selectedToolIds, builtInTools]);

  const hasOverride = currentAgent
    ? useToolOverrideStore.getState().hasOverride(currentAgent.id)
    : false;

  return (
    <HoverCard>
      <Popover open={open} onOpenChange={setOpen}>
        <HoverCardTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 relative"
              disabled={!currentAgent}
            >
              <Wrench className="h-4 w-4" />
              {selectedCount > 0 && (
                <span
                  className={`absolute -top-1 -right-1 h-4 w-4 rounded-full text-[10px] flex items-center justify-center ${
                    hasOverride ? 'bg-orange-500 text-white' : 'bg-primary text-primary-foreground'
                  }`}
                >
                  {selectedCount}
                </span>
              )}
            </Button>
          </PopoverTrigger>
        </HoverCardTrigger>
        <HoverCardContent side="top" className="w-72">
          <div className="space-y-2">
            <h4 className="font-medium text-sm">{t.Chat.tools.title}</h4>
            <p className="text-xs text-muted-foreground">{t.Chat.tools.description}</p>
            <a
              href={DOC_LINKS.features.tools}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              {t.Common.learnMore}
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </HoverCardContent>

        <PopoverContent className="w-80 p-0" align="start">
          <div className="flex items-center justify-between px-3 py-2 border-b">
            <div className="flex items-center gap-2">
              <div className="font-semibold text-sm">{t.Chat.tools.title}</div>
              {hasOverride && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
                  {t.Chat.tools.modified}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {selectedCount > 0 && (
                <span className="text-xs text-muted-foreground">
                  {t.Chat.tools.selected(selectedCount)}
                </span>
              )}
              {hasOverride && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={handleReset}
                >
                  <RotateCcw className="h-3 w-3 mr-1" />
                  {t.Chat.tools.reset}
                </Button>
              )}
            </div>
          </div>

          <ScrollArea className="h-[400px]">
            {allAvailableTools.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                {t.Chat.tools.noTools}
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {allAvailableTools.map((tool) => {
                  const isSelected = selectedToolIds.has(tool.id);
                  return (
                    /* biome-ignore lint/a11y/useSemanticElements: Complex flex layout requires div, has proper keyboard handling */
                    <div
                      key={tool.id}
                      className={`flex items-center gap-2 p-2 rounded-md cursor-pointer hover:bg-accent ${
                        isSelected ? 'bg-accent/50' : ''
                      }`}
                      onClick={() => handleToggleTool(tool.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleToggleTool(tool.id);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <div
                        className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                          isSelected ? 'bg-primary border-primary' : 'border-input'
                        }`}
                      >
                        {isSelected && <Check className="h-3 w-3 text-primary-foreground" />}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{tool.label}</div>
                      </div>

                      <div className="text-xs text-muted-foreground">{t.Chat.tools.builtIn}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </PopoverContent>
      </Popover>
    </HoverCard>
  );
}
