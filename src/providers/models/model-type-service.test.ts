import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGet = vi.hoisted(() => vi.fn());
const mockGetSync = vi.hoisted(() => vi.fn());
const mockGetAvailableModels = vi.hoisted(() => vi.fn());
const mockIsModelAvailable = vi.hoisted(() => vi.fn());
const syncStoreState = vi.hoisted(() => ({
  availableModels: [] as Array<{
    key: string;
    name: string;
    provider: string;
    providerName: string;
    imageInput: boolean;
    imageOutput: boolean;
    audioInput: boolean;
    videoInput: boolean;
  }>,
  isModelAvailable: vi.fn(),
}));

vi.mock('@/stores/settings-store', () => ({
  settingsManager: {
    get: mockGet,
    getSync: mockGetSync,
    set: vi.fn(),
  },
}));

vi.mock('@/providers/stores/provider-store', () => ({
  modelService: {
    getAvailableModels: mockGetAvailableModels,
    isModelAvailable: mockIsModelAvailable,
  },
  useProviderStore: {
    getState: () => syncStoreState,
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { modelTypeService } from './model-type-service';
import {
  ModelType,
  parseStoredModelTypeValue,
  serializeStoredModelTypeValue,
} from '@/types/model-types';

function createAvailableModel(modelKey: string, provider: string) {
  return {
    key: modelKey,
    name: `${modelKey}-${provider}`,
    provider,
    providerName: provider,
    imageInput: false,
    imageOutput: false,
    audioInput: false,
    videoInput: false,
  };
}

describe('modelTypeService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    syncStoreState.availableModels = [];
    syncStoreState.isModelAvailable.mockReturnValue(false);
    mockIsModelAvailable.mockResolvedValue(false);
  });

  it('resolves ordered model chains from stored JSON arrays', async () => {
    mockGet.mockResolvedValue(
      JSON.stringify(['small-primary@openrouter', 'small-backup', 'small-primary@openrouter'])
    );
    mockGetAvailableModels.mockResolvedValue([
      createAvailableModel('small-primary', 'openrouter'),
      createAvailableModel('small-backup', 'openai'),
    ]);

    const result = await modelTypeService.resolveModelTypeChain(ModelType.SMALL);

    expect(result).toEqual(['small-primary@openrouter', 'small-backup@openai']);
  });

  it('reads legacy single-string settings without migration', async () => {
    mockGet.mockResolvedValue('legacy-small-model');
    mockGetAvailableModels.mockResolvedValue([createAvailableModel('legacy-small-model', 'google')]);

    const result = await modelTypeService.resolveModelTypeChain(ModelType.SMALL);

    expect(result).toEqual(['legacy-small-model@google']);
  });

  it('resolves sync chains from cached settings and available models', () => {
    mockGetSync.mockReturnValue(
      JSON.stringify(['compact-primary@openrouter', 'compact-backup'])
    );
    syncStoreState.availableModels = [
      createAvailableModel('compact-primary', 'openrouter'),
      createAvailableModel('compact-backup', 'google'),
    ];

    const result = modelTypeService.resolveModelTypeChainSync(ModelType.MESSAGE_COMPACTION);

    expect(result).toEqual(['compact-primary@openrouter', 'compact-backup@google']);
  });

  it('falls back to the default model chain when no custom value is stored', () => {
    mockGetSync.mockReturnValue('');
    syncStoreState.availableModels = [createAvailableModel('gemini-2.5-flash-lite', 'google')];

    const result = modelTypeService.resolveModelTypeChainSync(ModelType.MESSAGE_COMPACTION);

    expect(result).toEqual(['gemini-2.5-flash-lite@google']);
  });
});

describe('model type storage helpers', () => {
  it('parses legacy single values for ordered model types', () => {
    expect(parseStoredModelTypeValue('small-model@openrouter', ModelType.SMALL)).toEqual([
      'small-model@openrouter',
    ]);
  });

  it('serializes ordered model chains as JSON arrays', () => {
    expect(
      serializeStoredModelTypeValue(ModelType.SMALL, ['a@one', 'b@two', 'a@one'])
    ).toBe('["a@one","b@two"]');
  });
});
