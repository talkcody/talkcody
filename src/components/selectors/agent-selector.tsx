// src/components/selectors/agent-selector.tsx
import { useEffect, useMemo, useState } from 'react';
import { BetaBadge } from '@/components/beta-badge';
import { useUiNavigation } from '@/contexts/ui-navigation';
import { useAppSettings } from '@/hooks/use-settings';
import { logger } from '@/lib/logger';
import { agentRegistry } from '@/services/agents/agent-registry';
import { agentService } from '@/services/database/agent-service';
import { useAgentStore } from '@/stores/agent-store';
import { NavigationView } from '@/types/navigation';
import { BaseSelector } from './base-selector';

interface AgentSelectorProps {
  disabled?: boolean;
}

export function AgentSelector({ disabled = false }: AgentSelectorProps) {
  const { settings, setAssistantId, loading: settingsLoading } = useAppSettings();
  const { setActiveView } = useUiNavigation();

  // Subscribe to agent store to trigger re-renders when agents are loaded
  const agentsMap = useAgentStore((state) => state.agents);
  const isLoadingAgents = useAgentStore((state) => state.isLoading);
  const refreshToken = useAgentStore((state) => state.refreshToken);

  // Track enabled state for database agents
  const [dbAgentEnabledMap, setDbAgentEnabledMap] = useState<Map<string, boolean>>(new Map());

  // Load enabled state for database agents
  useEffect(() => {
    const loadEnabledState = async (refreshKey: number) => {
      try {
        const dbAgents = await agentService.listAgents({ includeHidden: false });
        const enabledMap = new Map<string, boolean>();
        for (const agent of dbAgents) {
          enabledMap.set(agent.id, agent.is_enabled);
        }
        setDbAgentEnabledMap(enabledMap);
      } catch (error) {
        logger.error('Failed to load agent enabled state:', error);
      }
    };
    loadEnabledState(refreshToken);
  }, [refreshToken]);

  const agents = useMemo(() => {
    const allAgents = Array.from(agentsMap.values());
    return allAgents.filter((a) => {
      // Filter hidden agents
      if (a.hidden) return false;

      // For system agents, check in-memory enabled state
      if (a.isDefault) {
        return agentRegistry.isSystemAgentEnabled(a.id);
      }

      // For user agents, check database enabled state
      const isEnabled = dbAgentEnabledMap.get(a.id);
      return isEnabled !== false; // Default to true if not found
    });
  }, [agentsMap, dbAgentEnabledMap]);

  const agentItems = useMemo(
    () => [
      ...agents.map((agent) => ({
        value: agent.id,
        label: agent.name,
        content: (
          <div className="flex items-center gap-2 text-xs">
            <span className="truncate">{agent.name}</span>
            {agent.isBeta && <BetaBadge />}
          </div>
        ),
      })),
      {
        value: '__manage__',
        label: 'Manage agents…',
        content: <div className="flex items-center gap-2 text-xs text-gray-600">Manage agents</div>,
      },
    ],
    [agents]
  );

  const handleChange = async (id: string) => {
    try {
      if (id === '__manage__') {
        setActiveView(NavigationView.AGENTS_MARKETPLACE);
        return;
      }
      await setAssistantId(id);
    } catch (error) {
      logger.error('Failed to update agent:', error);
    }
  };

  if (settingsLoading) return null;

  return (
    <BaseSelector
      disabled={disabled || isLoadingAgents}
      items={agentItems}
      onValueChange={handleChange}
      placeholder="Select agent"
      value={settings.assistantId}
    />
  );
}
