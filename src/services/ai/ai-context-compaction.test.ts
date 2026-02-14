import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/llm/llm-client', () => ({
  llmClient: {
    compactContext: vi.fn(),
  },
}));

vi.mock('@/providers/models/model-type-service', () => ({
  modelTypeService: {
    resolveModelType: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { aiContextCompactionService } from './ai-context-compaction';
import { llmClient } from '@/services/llm/llm-client';
import { modelTypeService } from '@/providers/models/model-type-service';
import { logger } from '@/lib/logger';
import { ModelType } from '@/types/model-types';

describe('AIContextCompactionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (modelTypeService.resolveModelType as ReturnType<typeof vi.fn>).mockResolvedValue(
      'test-model'
    );
  });

  it('uses resolved model and returns compressed summary', async () => {
    (llmClient.compactContext as ReturnType<typeof vi.fn>).mockResolvedValue({
      compressedSummary: 'Summary text',
    });

    const result = await aiContextCompactionService.compactContext('User: hello');

    expect(modelTypeService.resolveModelType).toHaveBeenCalledWith(
      ModelType.MESSAGE_COMPACTION
    );
    expect(llmClient.compactContext).toHaveBeenCalledWith({
      conversationHistory: 'User: hello',
      model: 'test-model',
    });
    expect(result).toBe('Summary text');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('returns empty string and warns when summary is undefined', async () => {
    (llmClient.compactContext as ReturnType<typeof vi.fn>).mockResolvedValue({
      compressedSummary: undefined,
    } as { compressedSummary?: string });

    const result = await aiContextCompactionService.compactContext('User: hello');

    expect(result).toBe('');
    expect(logger.warn).toHaveBeenCalledWith(
      'AI context compaction returned no summary; defaulting to empty string'
    );
  });

  it('throws when conversation history is empty', async () => {
    await expect(aiContextCompactionService.compactContext('   ')).rejects.toThrow(
      'Conversation history is required for compaction'
    );
  });
});
