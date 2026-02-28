import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createTool } from '@/lib/create-tool';
import { getToolUIRenderers } from '@/lib/tool-adapter';
import { useToolOverrideStore } from '@/stores/tool-override-store';
import type { AgentDefinition } from '@/types/agent';
import { agentRegistry } from './agent-registry';

// Mock the database services
vi.mock('../database/agent-service', () => ({
  agentService: {
    agentExists: vi.fn().mockResolvedValue(false),
    createAgent: vi.fn().mockResolvedValue(undefined),
    updateAgent: vi.fn().mockResolvedValue(undefined),
    incrementUsageCount: vi.fn().mockResolvedValue(undefined),
    listAgents: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../agent-database-service', () => ({
  agentDatabaseService: {
    initialize: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/stores/settings-store', () => ({
  settingsManager: {
    get: vi.fn().mockResolvedValue('gpt-4@openai'),
    getAutoApproveEditsGlobal: vi.fn(() => false),
    setAutoApproveEditsGlobal: vi.fn(),
  },
}));

vi.mock('@/providers/models/model-type-service', () => ({
  modelTypeService: {
    resolveModelType: vi.fn().mockResolvedValue('gpt-4@openai'),
  },
}));

describe('Agent Registry - Tool UI Renderer Registration', () => {
  beforeEach(() => {
    // Reset the registry before each test
    agentRegistry.reset();
    useToolOverrideStore.getState().clearAll();
  });

  it('should register UI renderers for tools when agent is registered', async () => {
    // Create a test tool with UI renderers
    const testTool = createTool({
      name: 'testTool',
      description: 'A test tool',
      inputSchema: z.object({
        input: z.string(),
      }),
      canConcurrent: true,
      execute: async ({ input }) => {
        return { result: input };
      },
      renderToolDoing: ({ input }) => ({ type: 'doing', input }) as any,
      renderToolResult: (result) => ({ type: 'result', result }) as any,
    });

    // Create a test agent with the tool
    const testAgent: AgentDefinition = {
      id: 'test-agent',
      name: 'Test Agent',
      description: 'Agent for testing tool UI renderer registration',
      modelType: 'main_model' as any,
      systemPrompt: 'Test prompt',
      hidden: false,
      isDefault: false,
      tools: {
        testTool,
      },
    };

    // Before registration, the UI renderers should not be registered
    const renderersBefore = getToolUIRenderers('testTool');
    expect(renderersBefore).toBeUndefined();

    // Register the agent
    await agentRegistry.register(testAgent);

    // After registration, the UI renderers should be registered
    const renderersAfter = getToolUIRenderers('testTool');
    expect(renderersAfter).toBeDefined();
    expect(renderersAfter?.renderToolDoing).toBeDefined();
    expect(renderersAfter?.renderToolResult).toBeDefined();

    // Verify the agent is stored in memory with converted tools
    const storedAgent = await agentRegistry.get('test-agent');
    expect(storedAgent).toBeDefined();
    expect(storedAgent?.tools).toBeDefined();
    expect(Object.keys(storedAgent?.tools || {})).toContain('testTool');
  });

  it('should register UI renderers when using setAgent method', async () => {
    // Create a test tool with UI renderers
    const anotherTool = createTool({
      name: 'anotherTool',
      description: 'Another test tool',
      inputSchema: z.object({
        data: z.string(),
      }),
      canConcurrent: true,
      execute: async ({ data }) => {
        return { output: data };
      },
      renderToolDoing: ({ data }) => ({ type: 'doing', data }) as any,
      renderToolResult: (result) => ({ type: 'result', result }) as any,
    });

    const testAgent: AgentDefinition = {
      id: 'another-agent',
      name: 'Another Agent',
      description: 'Another agent for testing',
      modelType: 'main_model' as any,
      systemPrompt: 'Test prompt',
      hidden: false,
      isDefault: false,
      tools: {
        anotherTool,
      },
    };

    // Before setAgent, UI renderers should not be registered
    const renderersBefore = getToolUIRenderers('anotherTool');
    expect(renderersBefore).toBeUndefined();

    // Use setAgent method
    agentRegistry.setAgent('another-agent', testAgent);

    // After setAgent, UI renderers should be registered
    const renderersAfter = getToolUIRenderers('anotherTool');
    expect(renderersAfter).toBeDefined();
    expect(renderersAfter?.renderToolDoing).toBeDefined();
    expect(renderersAfter?.renderToolResult).toBeDefined();
  });

  it('should handle agents with no tools gracefully', async () => {
    const agentWithoutTools: AgentDefinition = {
      id: 'no-tools-agent',
      name: 'Agent Without Tools',
      description: 'Agent with no tools',
      modelType: 'main_model' as any,
      systemPrompt: 'Test prompt',
      hidden: false,
      isDefault: false,
      tools: {},
    };

    // Should not throw error
    await expect(agentRegistry.register(agentWithoutTools)).resolves.not.toThrow();

    // Agent should be stored
    const storedAgent = await agentRegistry.get('no-tools-agent');
    expect(storedAgent).toBeDefined();
  });

  it('should register UI renderers for callAgent tool specifically', async () => {
    // Import the actual callAgent tool
    const { callAgent } = await import('@/lib/tools/call-agent-tool');

    const agentWithCallAgent: AgentDefinition = {
      id: 'agent-with-call-agent',
      name: 'Agent With CallAgent',
      description: 'Agent that can call other agents',
      modelType: 'main_model' as any,
      systemPrompt: 'Test prompt',
      hidden: false,
      isDefault: false,
      tools: {
        callAgent,
      },
    };

    // Register the agent
    await agentRegistry.register(agentWithCallAgent);

    // After registration, callAgent UI renderers should be available
    const renderersAfter = getToolUIRenderers('callAgent');
    expect(renderersAfter).toBeDefined();
    expect(renderersAfter?.renderToolDoing).toBeDefined();
    expect(renderersAfter?.renderToolResult).toBeDefined();

    // Verify that the renderToolDoing function is the one from CallAgentToolDoing
    const doingResult = renderersAfter?.renderToolDoing({
      agentId: 'test-agent',
      task: 'test task',
      _toolCallId: 'test-id',
      nestedTools: [],
    });
    expect(doingResult).toBeDefined();
  });
});

describe('Agent Registry - Auto-load Behavior', () => {
  beforeEach(() => {
    // Reset the registry before each test to simulate uninitialized state
    agentRegistry.reset();
    useToolOverrideStore.getState().clearAll();
  });

  it('should persist file-based agents when loaded', async () => {
    const { FileAgentImporter } = await import('./file-agent-importer');
    const { agentService } = await import('../database/agent-service');

    vi.spyOn(FileAgentImporter, 'importAgentsFromDirectories').mockResolvedValue({
      agents: [
        {
          id: 'file-agent',
          name: 'File Agent',
          description: 'From file',
          modelType: 'main_model',
          systemPrompt: 'File prompt',
          tools: {},
          repository: 'local-project',
          githubPath: '/mock/.talkcody/agents/file-agent.md',
          category: 'local',
        },
      ],
      errors: [],
    });

    await agentRegistry.loadAllAgents();

    const createCalls = vi.mocked(agentService.createAgent).mock.calls;
    const fileAgentCall = createCalls.find((call) => call[0]?.id === 'file-agent');
    expect(fileAgentCall).toBeDefined();
    expect(fileAgentCall?.[0]).toEqual(
      expect.objectContaining({
        id: 'file-agent',
        name: 'File Agent',
        source_type: 'local',
      })
    );
  });

  it('should auto-load agents when get() is called before loadAllAgents()', async () => {
    // Don't call loadAllAgents() explicitly
    // The registry should auto-load when we call get()
    const agent = await agentRegistry.get('planner');

    // Should find the planner agent (system agent loaded from code)
    expect(agent).toBeDefined();
    expect(agent?.id).toBe('planner');
    expect(agent?.name).toBe('Code Planner');
  });

  it('should auto-load create-tool agent', async () => {
    const agent = await agentRegistry.get('create-tool');

    expect(agent).toBeDefined();
    expect(agent?.id).toBe('create-tool');
    expect(agent?.hidden).toBe(true);
  });

  it('should auto-load create-agent agent', async () => {
    const agent = await agentRegistry.get('create-agent');

    expect(agent).toBeDefined();
    expect(agent?.id).toBe('create-agent');
    expect(agent?.hidden).toBe(true);
  });

  it('should auto-load orchestrator agent', async () => {
    const agent = await agentRegistry.get('orchestrator');

    expect(agent).toBeDefined();
    expect(agent?.id).toBe('orchestrator');
    expect(agent?.name).toBe('Orchestrator');
    expect(agent?.canBeSubagent).toBe(false);
    expect(Object.keys(agent?.tools || {})).toEqual(
      expect.arrayContaining(['callAgent', 'todoWrite', 'askUserQuestions'])
    );
  });

  it('should enforce orchestrator tool allowlist', async () => {
    const agent = await agentRegistry.getWithResolvedTools('orchestrator');

    expect(agent).toBeDefined();
    expect(Object.keys(agent?.tools || {})).toEqual(
      expect.arrayContaining(['callAgent', 'todoWrite', 'askUserQuestions'])
    );
    expect(Object.keys(agent?.tools || {})).not.toContain('readFile');
    expect(Object.keys(agent?.tools || {})).not.toContain('writeFile');
    expect(Object.keys(agent?.tools || {})).not.toContain('editFile');
    expect(Object.keys(agent?.tools || {})).not.toContain('bash');
  });

  it('should auto-load agents when getWithResolvedTools() is called before loadAllAgents()', async () => {
    // Don't call loadAllAgents() explicitly
    // The registry should auto-load when we call getWithResolvedTools()
    const agent = await agentRegistry.getWithResolvedTools('planner');

    // Should find the planner agent with resolved tools
    expect(agent).toBeDefined();
    expect(agent?.id).toBe('planner');
    expect(agent?.name).toBe('Code Planner');
    expect(agent?.tools).toBeDefined();
  });

  it('should not reload agents if already loaded', async () => {
    // Load agents once
    await agentRegistry.loadAllAgents();
    const firstAgent = await agentRegistry.get('planner');

    // Call get() again - should not reload
    const secondAgent = await agentRegistry.get('planner');

    // Should return the same agent (from cache)
    expect(firstAgent).toBeDefined();
    expect(secondAgent).toBeDefined();
    expect(firstAgent?.id).toBe(secondAgent?.id);
  });

  it('should handle concurrent get() calls gracefully', async () => {
    // Make multiple concurrent calls to get() before agents are loaded
    // All should trigger auto-load, but loadAllAgents() should only run once
    const promises = [
      agentRegistry.get('planner'),
      agentRegistry.get('general'),
      agentRegistry.get('planner'),
    ];

    const results = await Promise.all(promises);

    // All should succeed
    expect(results[0]).toBeDefined();
    expect(results[1]).toBeDefined();
    expect(results[2]).toBeDefined();

    expect(results[0]?.id).toBe('planner');
    expect(results[1]?.id).toBe('general');
    expect(results[2]?.id).toBe('planner');
  });

  it('should refresh file-based agents when file content changes', async () => {
    const { FileAgentImporter } = await import('./file-agent-importer');
    const { agentService } = await import('../database/agent-service');

    // First load: agent with initial system prompt
    vi.spyOn(FileAgentImporter, 'importAgentsFromDirectories')
      .mockResolvedValueOnce({
        agents: [
          {
            id: 'byoc-debug',
            name: 'BYOC Debug',
            description: 'Debug agent',
            modelType: 'main_model',
            systemPrompt: 'Initial prompt',
            tools: {},
            repository: 'local-project',
            githubPath: '/mock/.talkcody/agents/Byoc-debug.md',
            category: 'local',
          },
        ],
        errors: [],
      })
      // Second load: agent with updated system prompt (simulating file edit)
      .mockResolvedValueOnce({
        agents: [
          {
            id: 'byoc-debug',
            name: 'BYOC Debug',
            description: 'Debug agent - updated',
            modelType: 'main_model',
            systemPrompt: 'Updated prompt after file edit',
            tools: {},
            repository: 'local-project',
            githubPath: '/mock/.talkcody/agents/Byoc-debug.md',
            category: 'local',
          },
        ],
        errors: [],
      });

    // First load - agent does not exist in DB yet
    vi.mocked(agentService.agentExists).mockResolvedValue(false);

    agentRegistry.reset();
    await agentRegistry.loadAllAgents();

    const firstAgent = await agentRegistry.get('byoc-debug');
    expect(firstAgent).toBeDefined();
    expect(firstAgent?.systemPrompt).toBe('Initial prompt');
    expect(firstAgent?.description).toBe('Debug agent');

    // Simulate refresh (user clicks refresh button)
    // After first load, the agent is saved to DB with old content
    // This simulates the real scenario where file agent content was persisted to DB
    vi.mocked(agentService.listAgents).mockResolvedValue([
      {
        id: 'byoc-debug',
        name: 'BYOC Debug',
        description: 'Debug agent',
        model_type: 'main_model',
        system_prompt: 'Initial prompt', // Old content from DB
        tools_config: '{}',
        rules: '',
        output_format: '',
        is_hidden: false,
        is_default: false,
        is_enabled: true,
        source_type: 'local',
        is_shared: false,
        created_at: Date.now(),
        updated_at: Date.now(),
        created_by: 'system',
        usage_count: 0,
        categories: '[]',
        tags: '[]',
      },
    ]);

    agentRegistry.reset();
    await agentRegistry.loadAllAgents();

    // After refresh, agent should have updated content from file, not from DB
    const refreshedAgent = await agentRegistry.get('byoc-debug');
    expect(refreshedAgent).toBeDefined();
    expect(refreshedAgent?.systemPrompt).toBe('Updated prompt after file edit');
    expect(refreshedAgent?.description).toBe('Debug agent - updated');
  });
});
