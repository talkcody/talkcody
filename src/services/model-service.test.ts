import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelType } from '@/types/model-types';
import type { AgentDefinition } from '@/types/agent';
import { settingsManager } from '@/stores/settings-store';
import { agentRegistry } from '@/services/agents/agent-registry';
import { logger } from '@/lib/logger';

// Import the modelService from provider-store (new location)
const { modelService } = await import('@/providers/stores/provider-store');

// Mock dependencies
vi.mock('@/providers/config/model-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/providers/config/model-config')>();
  return {
    ...actual,
  };
});

vi.mock('@/providers/config/provider-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/providers/config/provider-config')>();
  return {
    ...actual,
  };
});

vi.mock('@/stores/settings-store', () => ({
  settingsManager: {
    getAgentId: vi.fn().mockResolvedValue('coding'),
    get: vi.fn(),
    getApiKeys: vi.fn().mockResolvedValue({}),
    getAutoApproveEditsGlobal: vi.fn(() => false),
    getAutoCodeReviewGlobal: vi.fn(() => false),
    setAutoApproveEditsGlobal: vi.fn(),
    setAutoCodeReviewGlobal: vi.fn(),
  },
}));

vi.mock('@/services/agents/agent-registry', () => ({
  agentRegistry: {
    getWithResolvedTools: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));


vi.mock('@/providers/models/model-sync-service', () => ({
  modelSyncService: {
    initialize: vi.fn().mockResolvedValue(undefined),
    manualRefresh: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/providers/models/model-type-service', () => ({
  modelTypeService: {
    resolveModelType: vi.fn(),
    getDefaultModelType: vi.fn().mockReturnValue('main'),
  },
}));

vi.mock('@/providers/core/provider-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/providers/core/provider-utils')>();
  return {
    ...actual,
    computeAvailableModels: vi.fn().mockReturnValue([]),
    buildProviderConfigs: vi.fn().mockReturnValue(new Map()),
  };
});

vi.mock('@/providers/custom/custom-provider-service', () => ({
  customProviderService: {
    getEnabledCustomProviders: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('@/providers/custom/custom-model-service', () => ({
  customModelService: {
    getCustomModels: vi.fn().mockResolvedValue({ models: {} }),
  },
}));

vi.mock('@/providers/oauth/claude-oauth-store', () => ({
  getClaudeOAuthAccessToken: vi.fn().mockResolvedValue(null),
  useClaudeOAuthStore: {
    getState: vi.fn().mockReturnValue({ accessToken: null }),
  },
}));

vi.mock('@/providers/oauth/openai-oauth-store', () => ({
  getOpenAIOAuthAccessToken: vi.fn().mockResolvedValue(null),
  useOpenAIOAuthStore: {
    getState: vi.fn().mockReturnValue({ accessToken: null, accountId: null }),
  },
}));

describe('ModelService (provider-store compat) - getCurrentModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should use modelTypeService.resolveModelType to get the model', async () => {
    const { modelTypeService } = await import('@/providers/models/model-type-service');

    const mockAgent: AgentDefinition = {
      id: 'coding',
      name: 'Coding Agent',
      modelType: ModelType.MAIN,
      systemPrompt: 'Test prompt',
      isDefault: true,
    };

    vi.mocked(settingsManager.getAgentId).mockResolvedValue('coding');
    vi.mocked(agentRegistry.getWithResolvedTools).mockResolvedValue(mockAgent);
    vi.mocked(modelTypeService.resolveModelType).mockResolvedValue('gpt-4@openai');

    const result = await modelService.getCurrentModel();

    expect(result).toBe('gpt-4@openai');
    expect(settingsManager.getAgentId).toHaveBeenCalled();
    expect(agentRegistry.getWithResolvedTools).toHaveBeenCalledWith('coding');
    expect(modelTypeService.resolveModelType).toHaveBeenCalledWith(ModelType.MAIN);
  });

  it('should fallback to planner agent if specified agent not found', async () => {
    const { modelTypeService } = await import('@/providers/models/model-type-service');

    const mockAgent: AgentDefinition = {
      id: 'planner',
      name: 'Planner Agent',
      modelType: ModelType.MAIN,
      systemPrompt: 'Test prompt',
      isDefault: true,
    };

    vi.mocked(settingsManager.getAgentId).mockResolvedValue('non-existent');
    vi.mocked(agentRegistry.getWithResolvedTools)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(mockAgent);
    vi.mocked(modelTypeService.resolveModelType).mockResolvedValue('claude-3@anthropic');

    const result = await modelService.getCurrentModel();

    expect(result).toBe('claude-3@anthropic');
    expect(logger.warn).toHaveBeenCalledWith(
      'Agent with ID "non-existent" not found, falling back to default \'planner\' agent',
    );
    expect(agentRegistry.getWithResolvedTools).toHaveBeenCalledWith('non-existent');
    expect(agentRegistry.getWithResolvedTools).toHaveBeenCalledWith('planner');
  });

  it('should return empty string if no agent found even after fallback', async () => {
    vi.mocked(settingsManager.getAgentId).mockResolvedValue('coding');
    vi.mocked(agentRegistry.getWithResolvedTools).mockResolvedValue(undefined);

    const result = await modelService.getCurrentModel();

    expect(result).toBe('');
    expect(logger.error).toHaveBeenCalledWith('Unable to resolve any agent');
  });

  it('should return empty string if agent has no modelType', async () => {
    const mockAgent = {
      id: 'coding',
      name: 'Coding Agent',
      systemPrompt: 'Test prompt',
      isDefault: true,
    } as AgentDefinition;

    vi.mocked(settingsManager.getAgentId).mockResolvedValue('coding');
    vi.mocked(agentRegistry.getWithResolvedTools).mockResolvedValue(mockAgent);

    const result = await modelService.getCurrentModel();

    expect(result).toBe('');
    expect(logger.warn).toHaveBeenCalledWith('Agent has no modelType defined');
  });

  it('should return default model when settings are empty (bug fix for new users)', async () => {
    const { modelTypeService } = await import('@/providers/models/model-type-service');

    const mockAgent: AgentDefinition = {
      id: 'coding',
      name: 'Coding Agent',
      modelType: ModelType.MAIN,
      systemPrompt: 'Test prompt',
      isDefault: true,
    };

    vi.mocked(settingsManager.getAgentId).mockResolvedValue('coding');
    vi.mocked(agentRegistry.getWithResolvedTools).mockResolvedValue(mockAgent);
    vi.mocked(modelTypeService.resolveModelType).mockResolvedValue('glm-4.6@aiGateway');

    const result = await modelService.getCurrentModel();

    expect(result).toBe('glm-4.6@aiGateway');
    expect(modelTypeService.resolveModelType).toHaveBeenCalledWith(ModelType.MAIN);
  });

  it('should use resolveModelType for different model types', async () => {
    const { modelTypeService } = await import('@/providers/models/model-type-service');

    const testCases = [
      { modelType: ModelType.MAIN, expectedModel: 'glm-4.6@aiGateway' },
      { modelType: ModelType.SMALL, expectedModel: 'glm-4.6@aiGateway' },
      { modelType: ModelType.IMAGE_GENERATOR, expectedModel: 'nano-banana@aiGateway' },
      { modelType: ModelType.TRANSCRIPTION, expectedModel: 'whisper-1@openai' },
    ];

    for (const testCase of testCases) {
      vi.clearAllMocks();

      const mockAgent: AgentDefinition = {
        id: 'test-agent',
        name: 'Test Agent',
        modelType: testCase.modelType,
        systemPrompt: 'Test prompt',
        isDefault: true,
      };

      vi.mocked(settingsManager.getAgentId).mockResolvedValue('test-agent');
      vi.mocked(agentRegistry.getWithResolvedTools).mockResolvedValue(mockAgent);
      vi.mocked(modelTypeService.resolveModelType).mockResolvedValue(testCase.expectedModel);

      const result = await modelService.getCurrentModel();

      expect(result).toBe(testCase.expectedModel);
      expect(modelTypeService.resolveModelType).toHaveBeenCalledWith(testCase.modelType);
    }
  });
});
