// Marketplace page for discovering and installing agents

import type { RemoteAgentConfig } from '@talkcody/shared/types/remote-agents';
import { Bot, Download, Plus, RefreshCw, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AgentEditorDialog } from '@/components/agents/agent-editor-dialog';
import { ImportGitHubAgentDialog } from '@/components/agents/import-github-agent-dialog';
import { LocalAgentDetailDialog } from '@/components/agents/local-agent-detail-dialog';
import { UnifiedAgentCard } from '@/components/agents/unified-agent-card';
import { MarketplaceAgentCard } from '@/components/marketplace/agent-card';
import { AgentDetailDialog } from '@/components/marketplace/agent-detail-dialog';
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
import { Button } from '@/components/ui/button';
import { HelpTooltip } from '@/components/ui/help-tooltip';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTranslation } from '@/hooks/use-locale';
import { useUnifiedAgents } from '@/hooks/use-unified-agents';
import { getDocLinks } from '@/lib/doc-links';
import { logger } from '@/lib/logger';
import { agentRegistry } from '@/services/agents/agent-registry';
import { isToolAllowedForAgent } from '@/services/agents/agent-tool-access';
import { forkAgent } from '@/services/agents/fork-agent';
import { getAvailableToolsForUISync } from '@/services/agents/tool-registry';
import { agentService } from '@/services/database/agent-service';
import { useAgentStore } from '@/stores/agent-store';
import type { Agent } from '@/types';
import type { ModelType } from '@/types/model-types';

export function AgentsPage() {
  const [activeTab, setActiveTab] = useState('myagents');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedAgent, setSelectedAgent] = useState<RemoteAgentConfig | null>(null);
  const [installingAgentId, setInstallingAgentId] = useState<string | null>(null);

  // Local agent management state
  const [selectedLocalAgent, setSelectedLocalAgent] = useState<Agent | null>(null);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [deletingAgentId, setDeletingAgentId] = useState<string | null>(null);
  const [isGitHubImportOpen, setIsGitHubImportOpen] = useState(false);

  // Tab-specific loading state
  const [isMarketplaceDataLoaded, setIsMarketplaceDataLoaded] = useState(false);

  const t = useTranslation();
  const refreshAgents = useAgentStore((state) => state.refreshAgents);

  const {
    marketplaceAgents,
    myAgents,
    isLoading,
    loadMarketplaceAgents,
    loadCategories,
    loadTags,
    loadFeaturedAgents,
    installAgent,
    refreshLocalAgents,
    categories,
  } = useUnifiedAgents();

  // Apply local filtering and sorting to myAgents
  const filteredMyAgents = useMemo(() => {
    let result = [...myAgents];

    // Apply search filter
    if (searchQuery) {
      const searchLower = searchQuery.toLowerCase();
      result = result.filter(
        (agent) =>
          agent.name.toLowerCase().includes(searchLower) ||
          agent.description?.toLowerCase().includes(searchLower) ||
          agent.id.toLowerCase().includes(searchLower)
      );
    }

    return result;
  }, [myAgents, searchQuery]);

  const filteredMarketplaceAgents = useMemo(() => {
    let result = [...marketplaceAgents];

    if (searchQuery) {
      const searchLower = searchQuery.toLowerCase();
      result = result.filter(
        (agent) =>
          agent.name.toLowerCase().includes(searchLower) ||
          agent.description?.toLowerCase().includes(searchLower) ||
          agent.id.toLowerCase().includes(searchLower)
      );
    }

    if (selectedCategory !== 'all') {
      result = result.filter((agent) => agent.category === selectedCategory);
    }

    return result;
  }, [marketplaceAgents, searchQuery, selectedCategory]);

  // Load local agents on mount only
  useEffect(() => {
    const initializeAgents = async () => {
      try {
        await refreshLocalAgents();
      } catch (error) {
        logger.error('Failed to initialize agents:', error);
      }
    };

    initializeAgents();
  }, [refreshLocalAgents]);

  // Load marketplace data only when switching to marketplace tab
  useEffect(() => {
    if (activeTab === 'all' && !isMarketplaceDataLoaded) {
      logger.info('Loading marketplace data for first time...');
      const loadMarketplaceData = async () => {
        try {
          await Promise.all([
            loadCategories(),
            loadTags(),
            loadFeaturedAgents(),
            loadMarketplaceAgents(),
          ]);
          setIsMarketplaceDataLoaded(true);
        } catch (error) {
          logger.error('Failed to load marketplace data:', error);
        }
      };

      loadMarketplaceData();
    }
  }, [
    activeTab,
    isMarketplaceDataLoaded,
    loadCategories,
    loadTags,
    loadFeaturedAgents,
    loadMarketplaceAgents,
  ]);

  // Load marketplace data when filters change and we're on marketplace tab
  useEffect(() => {
    if (activeTab === 'all' && isMarketplaceDataLoaded) {
      loadMarketplaceAgents();
    }
  }, [activeTab, isMarketplaceDataLoaded, loadMarketplaceAgents]);

  const handleRefresh = async () => {
    logger.info('Refreshing data...');
    if (activeTab === 'myagents') {
      await refreshLocalAgents();
    } else {
      // Directly reload marketplace data without tab switching hack
      setIsMarketplaceDataLoaded(false);
      try {
        await Promise.all([
          loadCategories(),
          loadTags(),
          loadFeaturedAgents(),
          loadMarketplaceAgents(),
        ]);
        setIsMarketplaceDataLoaded(true);
      } catch (error) {
        logger.error('Failed to refresh marketplace data:', error);
        setIsMarketplaceDataLoaded(true);
      }
    }
  };

  const handleSearch = (value: string) => {
    setSearchQuery(value);
  };

  const handleCategoryChange = (value: string) => {
    setSelectedCategory(value);
  };

  const handleAgentClick = (agent: RemoteAgentConfig) => {
    setSelectedAgent(agent);
  };

  const handleCloseDetail = () => {
    setSelectedAgent(null);
  };

  const handleInstall = async (agent: RemoteAgentConfig) => {
    try {
      setInstallingAgentId(agent.id);
      await installAgent(agent.id, agent.version || '1.0.0');
      await refreshLocalAgents();
    } catch (error) {
      logger.error('Failed to install agent:', error);
    } finally {
      setInstallingAgentId(null);
    }
  };

  // Local agent management handlers
  const handleCreateAgent = () => {
    setEditingAgent(null);
    setIsCreating(true);
  };

  const handleEditAgent = (agent: Agent) => {
    setEditingAgent(agent);
    setIsCreating(true);
  };

  const handleSaveAgent = useCallback(
    async (agentData: {
      id?: string;
      name: string;
      description?: string;
      modelType: ModelType;
      systemPrompt: string;
      selectedTools: string[];
      rules?: string;
      outputFormat?: string;
      dynamicEnabled: boolean;
      dynamicProviders: string[];
      dynamicVariables: Record<string, string>;
      dynamicProviderSettings?: Record<string, unknown>;
    }) => {
      try {
        // Build tools from selected names
        const availableTools = getAvailableToolsForUISync();
        // biome-ignore lint/suspicious/noExplicitAny: Tools are dynamically built with refs of various types
        const tools: Record<string, any> = {};
        for (const t of agentData.selectedTools) {
          if (!isToolAllowedForAgent(agentData.id, t)) continue;
          const match = availableTools.find((x) => x.id === t);
          if (match) {
            tools[t] = match.ref;
          } else if (t.includes('__')) {
            // Handle MCP tools with server prefix format: {server_id}__{tool_name}
            tools[t] = { _isMCPTool: true, _mcpToolName: t };
          }
        }

        if (agentData.id) {
          // Update existing agent
          await agentRegistry.update(agentData.id, {
            name: agentData.name,
            description: agentData.description,
            modelType: agentData.modelType,
            systemPrompt: agentData.systemPrompt,
            tools,
            rules: agentData.rules,
            outputFormat: agentData.outputFormat,
            dynamicPrompt: {
              enabled: agentData.dynamicEnabled,
              providers: agentData.dynamicProviders,
              variables: agentData.dynamicVariables,
              providerSettings: agentData.dynamicProviderSettings,
            },
          });
        } else {
          // Create new agent
          const baseId = agentData.name
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)/g, '');

          let newId = baseId;
          let counter = 1;
          while (await agentRegistry.get(newId)) {
            newId = `${baseId}-${counter++}`;
          }

          await agentRegistry.forceRegister({
            id: newId,
            name: agentData.name,
            description: agentData.description,
            // Default modelType to 'main_model' if not provided (fixes NOT NULL constraint)
            modelType: agentData.modelType || 'main_model',
            systemPrompt: agentData.systemPrompt,
            tools,
            rules: agentData.rules,
            outputFormat: agentData.outputFormat,
            hidden: false,
            isDefault: false,
            dynamicPrompt: {
              enabled: agentData.dynamicEnabled,
              providers: agentData.dynamicProviders,
              variables: agentData.dynamicVariables,
              providerSettings: agentData.dynamicProviderSettings,
            },
          });
        }

        await refreshLocalAgents();
        await refreshAgents();
      } catch (error) {
        logger.error('Failed to save agent:', error);
        throw error;
      }
    },
    [refreshLocalAgents, refreshAgents]
  );

  const handleDeleteAgent = async (agentId: string) => {
    try {
      await agentRegistry.delete(agentId);
      toast.success(t.Agents.page.deleted);
      setDeletingAgentId(null);
      await refreshLocalAgents();
      await refreshAgents();
    } catch (error) {
      logger.error('Failed to delete agent:', error);
      toast.error(t.Agents.deleteFailed);
    }
  };

  const handleForkAgent = async (agentId: string) => {
    try {
      const newId = await forkAgent(agentId);
      if (newId) {
        toast.success(t.Agents.page.forked);
        await refreshLocalAgents();
        await refreshAgents();
      } else {
        toast.error(t.Agents.page.forkFailed);
      }
    } catch (error) {
      logger.error('Fork agent error:', error);
      toast.error(t.Agents.page.forkError);
    }
  };

  const handleToggleActive = async (agent: Agent) => {
    try {
      // Ensure is_enabled is boolean
      const currentEnabled = Boolean(agent.is_enabled);
      const newEnabled = !currentEnabled;

      if (agent.source_type === 'system') {
        // For system agents, update in-memory state only
        agentRegistry.setSystemAgentEnabled(agent.id, newEnabled);
        await refreshLocalAgents();
        await refreshAgents();
        toast.success(
          t.Agents.page.toggleSuccess(currentEnabled ? t.Skills.deactivate : t.Skills.activate)
        );
      } else {
        // For user agents, update database
        await agentService.updateAgent(agent.id, {
          is_enabled: newEnabled,
        });
        await refreshLocalAgents();
        await refreshAgents();
        // Show success toast for non-system agents as well
        toast.success(
          t.Agents.page.toggleSuccess(currentEnabled ? t.Skills.deactivate : t.Skills.activate)
        );
      }
    } catch (error) {
      logger.error('Failed to toggle agent:', error);
      toast.error(t.Agents.page.updateFailed);
    }
  };

  const handlePublishSuccess = async () => {
    await refreshLocalAgents();
    await refreshAgents();
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-6 border-b border-border">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Bot className="h-6 w-6 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold">{t.Agents.title}</h1>
                <HelpTooltip
                  title={t.Agents.page.tooltipTitle}
                  description={t.Agents.page.tooltipDescription}
                  docUrl={getDocLinks().features.agents}
                />
              </div>
              <p className="text-sm text-muted-foreground">
                {activeTab === 'myagents'
                  ? t.Agents.page.description
                  : t.Agents.page.marketplaceDescription}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {activeTab === 'myagents' && (
              <Button variant="default" size="sm" onClick={handleCreateAgent}>
                <Plus className="h-4 w-4 mr-2" />
                {t.Agents.page.addAgent}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => setIsGitHubImportOpen(true)}>
              <Download className="h-4 w-4 mr-2" />
              {t.Agents.page.importFromGitHub}
            </Button>
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isLoading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
              {t.Agents.page.refresh}
            </Button>
          </div>
        </div>

        {/* Search and Filters */}
        <div className="flex items-center gap-2">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t.Agents.page.searchPlaceholder}
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          <Select value={selectedCategory} onValueChange={handleCategoryChange}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t.Agents.page.allCategories}</SelectItem>
              {categories.map((category) => {
                if (typeof category === 'string') {
                  return (
                    <SelectItem key={category} value={category}>
                      {category}
                    </SelectItem>
                  );
                }

                const { slug, name } = category ?? {};
                const categoryName = name || String(category);
                const categoryValue = slug || name || String(category);

                return (
                  <SelectItem key={categoryValue} value={categoryValue}>
                    {categoryName}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full">
          <div className="px-6 pt-4">
            <TabsList>
              <TabsTrigger value="myagents">{t.Agents.page.localAgents}</TabsTrigger>
              {/* <TabsTrigger value="featured">Featured</TabsTrigger> */}
              <TabsTrigger value="all">{t.Agents.page.remoteAgents}</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="all" className="px-6 pb-6 mt-4">
            {/* Only show loading if marketplace data is being loaded for the first time */}
            {isLoading && !isMarketplaceDataLoaded ? (
              <div className="flex items-center justify-center h-64">
                <div className="text-muted-foreground">{t.Agents.page.loading}</div>
              </div>
            ) : filteredMarketplaceAgents.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-center">
                <p className="text-muted-foreground mb-2">{t.Agents.page.noAgentsFound}</p>
                <p className="text-sm text-muted-foreground">{t.Agents.page.adjustFilters}</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredMarketplaceAgents.map((agent) => (
                  <MarketplaceAgentCard
                    key={agent.id}
                    agent={agent}
                    onClick={() => handleAgentClick(agent)}
                    onInstall={handleInstall}
                    isInstalling={installingAgentId === agent.id}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="myagents" className="px-6 pb-6 mt-4">
            {isLoading ? (
              <div className="flex items-center justify-center h-64">
                <div className="text-muted-foreground">{t.Agents.page.loadingYourAgents}</div>
              </div>
            ) : myAgents.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-center">
                <p className="text-muted-foreground mb-2">{t.Agents.page.noAgentsYet}</p>
                <p className="text-sm text-muted-foreground mb-4">
                  {t.Agents.page.createFirstAgent}
                </p>
                <Button onClick={handleCreateAgent}>
                  <Plus className="h-4 w-4 mr-2" />
                  {t.Agents.createNew}
                </Button>
              </div>
            ) : filteredMyAgents.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-center">
                <p className="text-muted-foreground mb-2">{t.Agents.page.noAgentsMatch}</p>
                <p className="text-sm text-muted-foreground">{t.Agents.page.adjustSearch}</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredMyAgents.map((agent) => (
                  <UnifiedAgentCard
                    key={agent.id}
                    agent={agent}
                    onClick={() => setSelectedLocalAgent(agent)}
                    onEdit={() => handleEditAgent(agent)}
                    onDelete={() => setDeletingAgentId(agent.id)}
                    onFork={() => handleForkAgent(agent.id)}
                    onToggleActive={() => handleToggleActive(agent)}
                  />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Agent Detail Dialog */}
      {selectedAgent && (
        <AgentDetailDialog
          agent={selectedAgent}
          open={!!selectedAgent}
          onClose={handleCloseDetail}
        />
      )}

      {/* Agent Editor Dialog */}
      <AgentEditorDialog
        agent={
          editingAgent
            ? {
                id: editingAgent.id,
                name: editingAgent.name,
                description: editingAgent.description,
                modelType: editingAgent.model_type as ModelType,
                systemPrompt: editingAgent.system_prompt,
                tools: editingAgent.tools_config
                  ? (() => {
                      try {
                        return JSON.parse(editingAgent.tools_config);
                      } catch (e) {
                        logger.error('Failed to parse tools_config:', e);
                        return {};
                      }
                    })()
                  : {},
                hidden: editingAgent.is_hidden,
                rules: editingAgent.rules,
                outputFormat: editingAgent.output_format,
                isDefault: editingAgent.is_default,
                dynamicPrompt: {
                  enabled: editingAgent.dynamic_enabled ?? false,
                  providers: editingAgent.dynamic_providers
                    ? JSON.parse(editingAgent.dynamic_providers)
                    : [],
                  variables: editingAgent.dynamic_variables
                    ? JSON.parse(editingAgent.dynamic_variables)
                    : {},
                  providerSettings: {},
                },
              }
            : null
        }
        open={isCreating}
        onOpenChange={setIsCreating}
        onSave={handleSaveAgent}
        onClose={() => {
          setIsCreating(false);
          setEditingAgent(null);
        }}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={!!deletingAgentId}
        onOpenChange={(open) => !open && setDeletingAgentId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.Agents.page.deleteTitle}</AlertDialogTitle>
            <AlertDialogDescription>{t.Agents.page.deleteDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.Common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingAgentId && handleDeleteAgent(deletingAgentId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t.Common.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Import Agent from GitHub */}
      <ImportGitHubAgentDialog
        open={isGitHubImportOpen}
        onOpenChange={setIsGitHubImportOpen}
        onImportComplete={handlePublishSuccess}
      />

      {/* Local Agent Detail Dialog */}
      {selectedLocalAgent && (
        <LocalAgentDetailDialog
          agent={selectedLocalAgent}
          open={!!selectedLocalAgent}
          onClose={() => setSelectedLocalAgent(null)}
          onEdit={() => {
            handleEditAgent(selectedLocalAgent);
            setSelectedLocalAgent(null);
          }}
        />
      )}
    </div>
  );
}
