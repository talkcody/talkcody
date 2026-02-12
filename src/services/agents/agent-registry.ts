import { z } from 'zod';
import { logger } from '@/lib/logger';
import { multiMCPAdapter } from '@/lib/mcp/multi-mcp-adapter';
import { convertToolsForAI } from '@/lib/tool-adapter';
import { type ToolOverride, useToolOverrideStore } from '@/stores/tool-override-store';
import type { Agent, CreateAgentData, UpdateAgentData } from '@/types';
import type { AgentDefinition, AgentToolSet, DynamicPromptConfig } from '@/types/agent';
import { getModelType } from '@/types/model-types';
import type { MCPToolPlaceholder, ToolWithUI } from '@/types/tool';
import { agentDatabaseService } from '../agent-database-service';
import { agentService } from '../database/agent-service';
import { filterToolSetForAgent, isToolAllowedForAgent } from './agent-tool-access';
import { FileAgentImporter } from './file-agent-importer';
import { resolveAgentTools } from './github-import-agent-service';
import { getToolByName, restoreToolsFromConfig } from './tool-registry';

class AgentRegistry {
  private systemAgents = new Map<string, AgentDefinition>(); // System agents (loaded from code, memory-only)
  private persistentAgents = new Map<string, AgentDefinition>(); // User agents (loaded from database)
  private systemAgentEnabledState = new Map<string, boolean>(); // Track enabled state for system agents
  private loaded = false;

  private enforceRestrictedTools(agent: AgentDefinition): AgentDefinition {
    if (!agent.tools || Object.keys(agent.tools).length === 0) return agent;

    const { tools, removedToolIds } = filterToolSetForAgent(agent.id, agent.tools);
    if (removedToolIds.length === 0) return agent;

    logger.warn(`Removed restricted tools from agent '${agent.id}':`, removedToolIds);
    return { ...agent, tools: tools as AgentToolSet };
  }

  async loadAllAgents(): Promise<void> {
    const totalAgents = this.systemAgents.size + this.persistentAgents.size;

    // Check if already loaded
    if (this.loaded && totalAgents > 0) {
      return;
    }

    // If loaded with zero agents, force a reset and reload to allow file agents to appear
    if (this.loaded && totalAgents === 0) {
      logger.warn('loadAllAgents: Loaded flag set but no agents found, forcing reload');
      this.loaded = false;
    }

    logger.info('loadAllAgents: Loading agents...');

    try {
      // 1. Load system agents from code (always fresh)
      await this.loadSystemAgents();

      // 2. Load user agents from database
      await this.loadPersistentAgents();

      // 3. Load file-based agents from local directories
      await this.loadFileAgents();

      this.loaded = true;
      logger.info(
        `loadFromDatabase: Loaded ${this.systemAgents.size} system agents and ${this.persistentAgents.size} user agents`
      );
    } catch (error) {
      logger.error('Failed to load agents:', error);
      this.loaded = true; // Mark as loaded even if failed
    }
  }

  private async loadSystemAgents(): Promise<void> {
    logger.info('loadSystemAgents: Loading system agents from code...');

    const { PlannerAgent } = await import('./code-planner-agent');
    const { PlanAgent } = await import('./plan-agent');
    const { CodeReviewAgent } = await import('./code-review-agent');
    const { GeneralAgent } = await import('./general-agent');
    const { ExploreAgent } = await import('./explore-agent');
    const { DocumentWriterAgent } = await import('./document-writer-agent');
    const { TestWriterAgent } = await import('./test-writer-agent');
    const { CodingAgent } = await import('./coding-agent');
    const { InitProjectAgent } = await import('./init-project-agent');
    const { CreateToolAgent } = await import('./create-tool-agent');
    const { CreateAgentAgent } = await import('./create-agent-agent');
    const { CreateSkillAgent } = await import('./create-skill-agent');
    const { ImageGeneratorAgent } = await import('./image-generator-agent');

    const plannerTools = await this.buildPlannerTools();

    // Get all system agent definitions
    const systemAgents = [
      PlannerAgent.getDefinition(plannerTools),
      PlanAgent.getDefinition(),
      CodeReviewAgent.getDefinition(),
      GeneralAgent.getDefinition(),
      ExploreAgent.getDefinition(),
      DocumentWriterAgent.getDefinition(),
      TestWriterAgent.getDefinition(),
      CodingAgent.getDefinition(),
      InitProjectAgent.getDefinition(),
      CreateToolAgent.getDefinition(),
      CreateAgentAgent.getDefinition(),
      CreateSkillAgent.getDefinition(),
      ImageGeneratorAgent.getDefinition(),
    ];

    // Load into memory and register UI renderers
    for (const agent of systemAgents) {
      // Convert tools to register UI renderers if tools are present
      let convertedAgent = agent;
      if (agent.tools && Object.keys(agent.tools).length > 0) {
        const convertedTools = convertToolsForAI(agent.tools);
        convertedAgent = { ...agent, tools: convertedTools as AgentToolSet };
      }

      this.systemAgents.set(convertedAgent.id, convertedAgent);
      // logger.info(`loadSystemAgents: Loaded ${agent.name} v${agent.version}`);
    }
  }

  private async loadPersistentAgents(): Promise<void> {
    logger.info('loadPersistentAgents: Loading user agents from database...');

    // Ensure database is initialized
    await agentDatabaseService.initialize();

    // Load only user agents (isDefault = false) from database
    const dbAgents = await agentService.listAgents({
      includeHidden: true,
      onlyUserAgents: true,
    });

    for (const dbAgent of dbAgents) {
      try {
        const agentDef = await this.dbAgentToDefinition(dbAgent);
        this.persistentAgents.set(agentDef.id, agentDef);
      } catch (conversionError) {
        logger.error(
          `loadPersistentAgents: Failed to convert agent ${dbAgent.id}:`,
          conversionError
        );
      }
    }

    logger.info(`loadPersistentAgents: Loaded ${dbAgents.length} user agents from database`);
  }

  private async loadFileAgents(): Promise<void> {
    logger.info('loadFileAgents: Loading agents from local directories...');

    try {
      const { agents } = await FileAgentImporter.importAgentsFromDirectories();
      const loadedFileIds = new Set(agents.map((agent) => agent.id));

      for (const agentConfig of agents) {
        try {
          // Skip if it's a system agent (loaded from code)
          if (this.systemAgents.has(agentConfig.id)) {
            continue;
          }

          const tools = await resolveAgentTools(agentConfig);
          const agentDef: AgentDefinition = {
            id: agentConfig.id,
            name: agentConfig.name,
            description: agentConfig.description || '',
            modelType: getModelType(agentConfig.modelType),
            systemPrompt: agentConfig.systemPrompt,
            tools,
            hidden: agentConfig.hidden || false,
            rules: agentConfig.rules,
            outputFormat: agentConfig.outputFormat,
            isDefault: false,
            dynamicPrompt: agentConfig.dynamicPrompt,
            defaultSkills: agentConfig.defaultSkills,
            isBeta: agentConfig.isBeta,
            role: agentConfig.role,
            canBeSubagent: agentConfig.canBeSubagent,
          };

          // Always update from file source - file content takes precedence over database
          // This ensures that when users edit agent files and click refresh, the changes are reflected
          this.persistentAgents.set(agentDef.id, agentDef);
        } catch (error) {
          logger.warn('loadFileAgents: Failed to load local agent:', error);
        }
      }

      if (agents.length > 0) {
        try {
          const dbAgents = await agentService.listAgents({ includeHidden: true });
          const fileAgentIds = new Set(dbAgents.map((agent) => agent.id));

          for (const agentDef of this.persistentAgents.values()) {
            if (agentDef.isDefault) continue;
            if (!loadedFileIds.has(agentDef.id)) continue;
            if (fileAgentIds.has(agentDef.id)) continue;

            const createData = await this.definitionToCreateData(agentDef);
            await agentService.createAgent(createData);
          }
        } catch (error) {
          logger.warn('loadFileAgents: Failed to persist local file agents:', error);
        }
      }

      logger.info(`loadFileAgents: Loaded ${agents.length} local agent(s) from files`);
    } catch (error) {
      logger.warn('loadFileAgents: Failed to load local agents from files:', error);
    }
  }

  private async buildPlannerTools(): Promise<AgentToolSet> {
    // IMPORTANT: Do NOT merge MCP tools into the system planner toolset.
    // MCP tools must be explicitly enabled/selected by the user per-agent.
    const { getTool } = await import('@/lib/tools');

    // Get all required tools from centralized registry
    const bash = await getTool('bash');
    const callAgent = await getTool('callAgent');
    const readFile = await getTool('readFile');
    const codeSearch = await getTool('codeSearch');
    const glob = await getTool('glob');
    const lsp = await getTool('lsp');
    const listFiles = await getTool('listFiles');
    const todoWrite = await getTool('todoWrite');
    const writeFile = await getTool('writeFile');
    const editFile = await getTool('editFile');
    const webSearch = await getTool('webSearch');
    const webFetch = await getTool('webFetch');

    return {
      bash,
      callAgent,
      readFile,
      codeSearch,
      glob,
      lsp,
      listFiles,
      todoWrite,
      writeFile,
      editFile,
      webSearch,
      webFetch,
    } as AgentToolSet;
  }

  async register(agent: AgentDefinition): Promise<void> {
    // Convert tools to register UI renderers if tools are present
    let convertedAgent = agent;
    if (agent.tools && Object.keys(agent.tools).length > 0) {
      const convertedTools = convertToolsForAI(agent.tools);
      convertedAgent = { ...agent, tools: convertedTools as AgentToolSet };
    }
    this.persistentAgents.set(agent.id, convertedAgent);

    try {
      const exists = await agentService.agentExists(agent.id);
      if (!exists) {
        const createData = await this.definitionToCreateData(convertedAgent);
        await agentService.createAgent(createData);
      }
      // If agent exists, don't update it to preserve user modifications
    } catch (error) {
      logger.error(`Failed to persist agent ${agent.id} to database:`, error);
    }
  }

  // Method to force register/update an agent (used for explicit updates)
  async forceRegister(agent: AgentDefinition): Promise<void> {
    // Convert tools to register UI renderers if tools are present
    let convertedAgent = agent;
    if (agent.tools && Object.keys(agent.tools).length > 0) {
      const convertedTools = convertToolsForAI(agent.tools);
      convertedAgent = { ...agent, tools: convertedTools as AgentToolSet };
      logger.info(
        `Converted and registered UI renderers for agent ${agent.id} tools (forceRegister)`
      );
    }

    // System agents: only store in memory, never persist
    if (convertedAgent.isDefault) {
      this.systemAgents.set(agent.id, convertedAgent);
      logger.warn(
        `forceRegister: Attempted to force register system agent ${agent.id} - only updated in memory`
      );
      return;
    }

    // User agents: update in memory and database
    this.persistentAgents.set(agent.id, convertedAgent);

    try {
      const exists = await agentService.agentExists(agent.id);
      if (exists) {
        const updateData = await this.definitionToUpdateData(convertedAgent);
        await agentService.updateAgent(agent.id, updateData);
      } else {
        const createData = await this.definitionToCreateData(convertedAgent);
        await agentService.createAgent(createData);
      }
    } catch (error) {
      logger.error(`Failed to persist agent ${agent.id} to database:`, error);
    }
  }

  async update(id: string, partial: Partial<AgentDefinition>): Promise<void> {
    // Try to find in either Map
    const existing = this.systemAgents.get(id) || this.persistentAgents.get(id);
    if (!existing) return;

    // Prevent updates to system agents
    if (existing.isDefault) {
      logger.warn(`agentRegistry.update: Cannot update system agent ${id}`);
      throw new Error(
        `Cannot modify system agent ${id}. Please fork it to create a customizable copy.`
      );
    }

    logger.info(`agentRegistry.update: Updating agent ${id}:`, {
      existingHidden: existing.hidden,
      partialHidden: partial.hidden,
      willBeHidden: partial.hidden !== undefined ? partial.hidden : existing.hidden,
    });

    const updated = { ...existing, ...partial } as AgentDefinition;
    this.persistentAgents.set(id, updated);

    // Persist to database
    try {
      const updateData = await this.definitionToUpdateData(partial);
      logger.info(`agentRegistry.update: UpdateData for ${id}:`, updateData);
      await agentService.updateAgent(id, updateData);
    } catch (error) {
      logger.error(`Failed to update agent ${id} in database:`, error);
    }
  }

  async delete(id: string): Promise<void> {
    // Check if it's a system agent
    if (this.systemAgents.has(id)) {
      logger.warn(`agentRegistry.delete: Cannot delete system agent ${id}`);
      throw new Error(`Cannot delete system agent ${id}. System agents are read-only.`);
    }

    // Delete user agent
    this.persistentAgents.delete(id);

    try {
      await agentService.deleteAgent(id);
    } catch (error) {
      logger.error(`Failed to delete agent ${id} from database:`, error);
    }
  }

  async get(id: string): Promise<AgentDefinition | undefined> {
    // Auto-load agents if not yet loaded to prevent race conditions
    if (!this.loaded) {
      await this.loadAllAgents();
    }
    return this.systemAgents.get(id) || this.persistentAgents.get(id);
  }

  async listAll(): Promise<AgentDefinition[]> {
    if (!this.loaded) {
      await this.loadAllAgents();
    }
    return this.list();
  }

  list(): AgentDefinition[] {
    // Combine system agents and persistent agents
    return [
      ...Array.from(this.systemAgents.values()),
      ...Array.from(this.persistentAgents.values()),
    ];
  }

  // System agent enabled state management
  setSystemAgentEnabled(id: string, enabled: boolean): void {
    const agent = this.systemAgents.get(id);
    if (!agent) {
      logger.warn(`setSystemAgentEnabled: Agent ${id} is not a system agent`);
      return;
    }
    this.systemAgentEnabledState.set(id, enabled);
    logger.info(`System agent ${id} ${enabled ? 'enabled' : 'disabled'}`);
  }

  isSystemAgentEnabled(id: string): boolean {
    // Default to true if not explicitly disabled
    return this.systemAgentEnabledState.get(id) !== false;
  }

  /**
   * Reset the registry to initial state. Useful for handling hot reload scenarios.
   */
  reset(): void {
    logger.info('agentRegistry.reset(): Clearing all agents and resetting loaded flag');
    this.systemAgents.clear();
    this.persistentAgents.clear();
    this.loaded = false;
  }

  /**
   * Check if the registry is in a consistent state
   */
  isConsistent(): boolean {
    const totalAgents = this.systemAgents.size + this.persistentAgents.size;
    const consistent = !this.loaded || totalAgents > 0;
    if (!consistent) {
      logger.warn(
        'agentRegistry.isConsistent(): Inconsistent state detected - loaded=true but both Maps empty'
      );
    }
    return consistent;
  }

  // Method to directly set an agent in memory (used for restoring system functions)
  setAgent(id: string, agent: AgentDefinition): void {
    // Convert tools to register UI renderers if tools are present
    let convertedAgent = agent;
    if (agent.tools && Object.keys(agent.tools).length > 0) {
      const convertedTools = convertToolsForAI(agent.tools);
      convertedAgent = { ...agent, tools: convertedTools as AgentToolSet };
      logger.info(`Converted and registered UI renderers for agent ${id} tools (setAgent)`);
    }

    // Route to correct Map based on isDefault
    if (convertedAgent.isDefault) {
      this.systemAgents.set(id, convertedAgent);
    } else {
      this.persistentAgents.set(id, convertedAgent);
    }
  }

  async incrementUsage(id: string): Promise<void> {
    try {
      await agentService.incrementUsageCount(id);
    } catch (error) {
      logger.error(`Failed to increment usage count for agent ${id}:`, error);
    }
  }

  /**
   * Resolve MCP tools in a tool set at runtime
   * This converts MCP tool placeholders to actual MCP tools
   */
  async resolveToolsWithMCP(tools: AgentToolSet): Promise<AgentToolSet> {
    const resolvedTools: AgentToolSet = {};

    for (const [toolName, tool] of Object.entries(tools)) {
      if (this.isMCPToolPlaceholder(tool)) {
        // This is an MCP tool placeholder, resolve it
        const mcpToolName = tool._mcpToolName;
        try {
          // Use new multi-server adapter with format: {server_id}__{tool_name}
          const mcpTool = await multiMCPAdapter.getAdaptedTool(mcpToolName);
          resolvedTools[toolName] = mcpTool;
          logger.info(`Resolved MCP tool: ${toolName} -> ${mcpToolName}`);
        } catch (error) {
          logger.warn(`Failed to resolve MCP tool '${mcpToolName}' for '${toolName}':`, error);
          // Keep the placeholder tool but mark it as unavailable
          resolvedTools[toolName] = {
            name: toolName,
            description: `MCP tool '${mcpToolName}' is not available`,
            inputSchema: z.object({}),
            execute: async () => {
              throw new Error(`MCP tool '${mcpToolName}' is not available: ${error}`);
            },
            renderToolDoing: () => null,
            renderToolResult: () => null,
            canConcurrent: false,
          } as ToolWithUI;
        }
      } else {
        // Regular tool, keep as is
        resolvedTools[toolName] = tool;
      }
    }

    return resolvedTools;
  }

  private isMCPToolPlaceholder(tool: unknown): tool is MCPToolPlaceholder {
    return (
      typeof tool === 'object' &&
      tool !== null &&
      '_isMCPTool' in tool &&
      (tool as { _isMCPTool: unknown })._isMCPTool === true &&
      '_mcpToolName' in tool &&
      typeof (tool as { _mcpToolName: unknown })._mcpToolName === 'string'
    );
  }

  /**
   * Apply tool overrides to an agent's tools
   * This applies temporary tool additions/removals from the tool override store
   */
  private async applyToolOverrides(
    agent: AgentDefinition,
    override: ToolOverride
  ): Promise<AgentDefinition> {
    const currentTools = agent.tools || {};
    const modifiedTools: AgentToolSet = { ...currentTools };

    // Remove tools that are in the removedTools set
    for (const toolId of override.removedTools) {
      if (toolId in modifiedTools) {
        delete modifiedTools[toolId];
        logger.debug(`Applied override: removed tool '${toolId}' from agent '${agent.id}'`);
      }
    }

    // Add tools that are in the addedTools set
    for (const toolId of override.addedTools) {
      if (!isToolAllowedForAgent(agent.id, toolId)) {
        logger.warn(
          `Cannot apply override: tool '${toolId}' is not allowed for agent '${agent.id}'`
        );
        continue;
      }

      // Get tool from new registry
      const tool = await getToolByName(toolId);
      if (tool) {
        modifiedTools[toolId] = tool as ToolWithUI;
        logger.debug(`Applied override: added tool '${toolId}' to agent '${agent.id}'`);
      } else {
        // Check if it's an MCP tool (format: server__toolname)
        if (toolId.includes('__')) {
          // Store as MCP tool placeholder - will be resolved later by resolveToolsWithMCP
          const placeholder: MCPToolPlaceholder = {
            _isMCPTool: true,
            _mcpToolName: toolId,
          };
          modifiedTools[toolId] = placeholder as unknown as ToolWithUI;
          logger.debug(`Applied override: added MCP tool '${toolId}' to agent '${agent.id}'`);
        } else {
          logger.warn(`Cannot apply override: tool '${toolId}' not found in registry`);
        }
      }
    }

    return {
      ...agent,
      tools: modifiedTools,
    };
  }

  /**
   * Get an agent definition with MCP tools resolved and tool overrides applied
   * This should be used when actually running an agent
   */
  async getWithResolvedTools(id: string): Promise<AgentDefinition | undefined> {
    // Auto-load agents if not yet loaded to prevent race conditions
    if (!this.loaded) {
      await this.loadAllAgents();
    }

    let agent = this.systemAgents.get(id) || this.persistentAgents.get(id);
    if (!agent) return undefined;

    // Step 1: Apply tool overrides from the tool override store
    const toolOverride = useToolOverrideStore.getState().getOverride(id);
    if (toolOverride) {
      agent = await this.applyToolOverrides(agent, toolOverride);
      logger.debug(`Applied tool overrides for agent '${id}'`);
    }

    // Enforce tool access rules (defense-in-depth)
    agent = this.enforceRestrictedTools(agent);

    // Step 2: Resolve model type to concrete model
    let resolvedModel: string;
    try {
      const { modelTypeService } = await import('@/providers/models/model-type-service');

      // Resolve the model type to a concrete model using settings
      resolvedModel = await modelTypeService.resolveModelType(agent.modelType);
      logger.debug(
        `Resolved model type '${agent.modelType}' to '${resolvedModel}' for agent '${id}'`
      );
    } catch (error) {
      logger.error(`Failed to resolve model type for agent '${id}':`, error);
      throw error; // Don't fall back, let the error propagate
    }

    // Step 3: Resolve MCP tools if agent has tools
    if (!agent.tools || Object.keys(agent.tools).length === 0) {
      return { ...agent, model: resolvedModel } as AgentDefinition;
    }

    try {
      const resolvedTools = await this.resolveToolsWithMCP(agent.tools);
      return {
        ...agent,
        tools: resolvedTools,
        model: resolvedModel,
      } as AgentDefinition;
    } catch (error) {
      logger.error(`Failed to resolve MCP tools for agent '${id}':`, error);
      return { ...agent, model: resolvedModel } as AgentDefinition; // Return agent with resolved model even if MCP resolution fails
    }
  }

  private async dbAgentToDefinition(dbAgent: Agent): Promise<AgentDefinition> {
    let tools: AgentToolSet = {};
    try {
      // Use the tool restoration function to properly convert stored tools back to AgentToolSet
      tools = await restoreToolsFromConfig(dbAgent.tools_config);
      // logger.info(
      //   `Restored tools for agent ${dbAgent.id}:`,
      //   Object.keys(tools)
      // );
    } catch (error) {
      logger.error(`Failed to restore tools for agent ${dbAgent.id}:`, error);
    }

    const filtered = filterToolSetForAgent(dbAgent.id, tools);
    if (filtered.removedToolIds.length > 0) {
      tools = filtered.tools as AgentToolSet;
      logger.warn(
        `dbAgentToDefinition: Removed restricted tools from agent '${dbAgent.id}':`,
        filtered.removedToolIds
      );
    }

    // Parse dynamic prompt config (safe defaults)
    let dynamicPrompt: DynamicPromptConfig | undefined;
    try {
      const enabled = dbAgent.dynamic_enabled ?? false;
      const providers = dbAgent.dynamic_providers ? JSON.parse(dbAgent.dynamic_providers) : [];
      const variables = dbAgent.dynamic_variables ? JSON.parse(dbAgent.dynamic_variables) : {};
      const providerSettings = this.parseDynamicProviderSettings(dbAgent);
      dynamicPrompt = {
        enabled: !!enabled,
        providers: Array.isArray(providers) ? providers : [],
        variables: variables && typeof variables === 'object' ? variables : {},
        providerSettings:
          providerSettings && typeof providerSettings === 'object' ? providerSettings : {},
      };
    } catch (_e) {
      dynamicPrompt = {
        enabled: false,
        providers: [],
        variables: {},
        providerSettings: {},
      };
    }

    // Parse default skills (safe defaults)
    let defaultSkills: string[] | undefined;
    try {
      if (dbAgent.default_skills) {
        const parsed = JSON.parse(dbAgent.default_skills);
        defaultSkills = Array.isArray(parsed) ? parsed : undefined;
      }
    } catch (e) {
      logger.error(`Failed to parse default_skills for agent ${dbAgent.id}:`, e);
      defaultSkills = undefined;
    }

    return {
      id: dbAgent.id,
      name: dbAgent.name,
      description: dbAgent.description || undefined,
      modelType: dbAgent.model_type as AgentDefinition['modelType'], // Convert string to ModelType
      systemPrompt: dbAgent.system_prompt,
      tools,
      hidden: dbAgent.is_hidden,
      rules: dbAgent.rules || undefined,
      outputFormat: dbAgent.output_format || undefined,
      isDefault: dbAgent.is_default,
      dynamicPrompt,
      defaultSkills,
    };
  }

  private async definitionToCreateData(agent: AgentDefinition): Promise<CreateAgentData> {
    let systemPrompt = '';
    if (typeof agent.systemPrompt === 'string') {
      systemPrompt = agent.systemPrompt;
    } else if (typeof agent.systemPrompt === 'function') {
      try {
        systemPrompt = await Promise.resolve(agent.systemPrompt());
      } catch (error) {
        logger.error(`Failed to resolve systemPrompt for agent ${agent.id}:`, error);
        systemPrompt = '';
      }
    }

    const createData: CreateAgentData = {
      id: agent.id,
      name: agent.name,
      description: agent.description,
      model_type: agent.modelType,
      system_prompt: systemPrompt,
      tools_config: JSON.stringify(agent.tools || {}),
      rules: agent.rules,
      output_format: agent.outputFormat,
      is_hidden: agent.hidden !== undefined ? agent.hidden : false,
      is_default: agent.isDefault !== undefined ? agent.isDefault : false,
      is_enabled: true,
      created_by: 'system',
      source_type: 'local',
    };

    if (agent.dynamicPrompt) {
      createData.dynamic_enabled = agent.dynamicPrompt.enabled;
      createData.dynamic_providers = JSON.stringify(agent.dynamicPrompt.providers || []);
      createData.dynamic_variables = JSON.stringify(agent.dynamicPrompt.variables || {});
      (createData as CreateAgentData).dynamic_provider_settings = JSON.stringify(
        agent.dynamicPrompt.providerSettings || {}
      );
    }

    if (agent.defaultSkills) {
      createData.default_skills = JSON.stringify(agent.defaultSkills);
    }

    return createData;
  }

  private async definitionToUpdateData(
    partial: Partial<AgentDefinition>
  ): Promise<UpdateAgentData> {
    const updateData: UpdateAgentData = {};

    if (partial.name !== undefined) updateData.name = partial.name;
    if (partial.description !== undefined) updateData.description = partial.description;
    if (partial.modelType !== undefined) updateData.model_type = partial.modelType;
    if (partial.systemPrompt !== undefined) {
      if (typeof partial.systemPrompt === 'string') {
        updateData.system_prompt = partial.systemPrompt;
      } else if (typeof partial.systemPrompt === 'function') {
        try {
          updateData.system_prompt = await Promise.resolve(partial.systemPrompt());
        } catch (error) {
          logger.error('Failed to resolve systemPrompt for update:', error);
          updateData.system_prompt = '';
        }
      }
    }
    if (partial.tools !== undefined) {
      updateData.tools_config = JSON.stringify(partial.tools);
    }
    if (partial.hidden !== undefined) updateData.is_hidden = partial.hidden;
    if (partial.rules !== undefined) updateData.rules = partial.rules;
    if (partial.outputFormat !== undefined) updateData.output_format = partial.outputFormat;
    if (partial.dynamicPrompt !== undefined) {
      updateData.dynamic_enabled = partial.dynamicPrompt.enabled;
      updateData.dynamic_providers = JSON.stringify(partial.dynamicPrompt.providers || []);
      updateData.dynamic_variables = JSON.stringify(partial.dynamicPrompt.variables || {});
      (updateData as UpdateAgentData).dynamic_provider_settings = JSON.stringify(
        partial.dynamicPrompt.providerSettings || {}
      );
    }
    if (partial.defaultSkills !== undefined) {
      updateData.default_skills = JSON.stringify(partial.defaultSkills);
    }

    // Handle marketplace metadata with proper type casting
    const marketplacePartial = partial as {
      sourceType?: UpdateAgentData['source_type'];
      marketplaceId?: string;
      marketplaceVersion?: string;
    };
    if (marketplacePartial.sourceType !== undefined) {
      updateData.source_type = marketplacePartial.sourceType;
    }
    if (marketplacePartial.marketplaceId !== undefined) {
      updateData.marketplace_id = undefined;
    }
    if (marketplacePartial.marketplaceVersion !== undefined) {
      updateData.marketplace_version = undefined;
    }

    return updateData;
  }

  private parseDynamicProviderSettings(dbAgent: Agent): Record<string, unknown> {
    const providerSettings = (dbAgent as Agent & { dynamic_provider_settings?: string })
      .dynamic_provider_settings;
    return providerSettings ? JSON.parse(providerSettings) : {};
  }

  /**
   * Refresh planner tools in system agents.
   * Called when MCP servers or custom tools change to rebuild the planner's base toolset.
   * Note: MCP tools are NOT merged here — they are resolved at runtime via resolveToolsWithMCP()
   * and must be explicitly enabled/selected by the user per-agent.
   */
  async refreshPlannerTools(): Promise<void> {
    logger.info('refreshPlannerTools: Refreshing planner tools in system agents...');

    try {
      // Rebuild planner tools
      const plannerTools = await this.buildPlannerTools();

      // Update PlannerAgent's tools
      const plannerAgent = this.systemAgents.get('planner');
      if (plannerAgent) {
        const convertedTools = convertToolsForAI(plannerTools);
        this.systemAgents.set('planner', {
          ...plannerAgent,
          tools: convertedTools as AgentToolSet,
        });
        logger.info('refreshPlannerTools: Updated PlannerAgent tools');
      }

      logger.info('refreshPlannerTools: Planner tools refreshed successfully');
    } catch (error) {
      logger.error('refreshPlannerTools: Failed to refresh planner tools:', error);
    }
  }

  /**
   * Refresh custom tools in system agents
   * Called when custom tools are refreshed to update tool references
   */
  async refreshCustomTools(): Promise<void> {
    logger.info('refreshCustomTools: Refreshing custom tools in system agents...');

    try {
      // Rebuild planner tools with fresh custom tool definitions
      await this.refreshPlannerTools();

      logger.info('refreshCustomTools: Custom tools refreshed successfully');
    } catch (error) {
      logger.error('refreshCustomTools: Failed to refresh custom tools:', error);
    }
  }
}

export const agentRegistry = new AgentRegistry();
