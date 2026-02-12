import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock the llm-client module
vi.mock('@/services/llm/llm-client', () => ({
  llmClient: {
    enhancePrompt: vi.fn(),
  },
}));

// Mock logger
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

import { aiPromptEnhancementService } from './ai-prompt-enhancement-service';
import { llmClient } from '@/services/llm/llm-client';

describe('AIPromptEnhancementService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('enhancePrompt', () => {
    it('calls llmClient.enhancePrompt with correct parameters', async () => {
      const mockResult = {
        enhancedPrompt: 'Enhanced prompt text',
        extractedKeywords: ['React'],
        generatedQueries: ['React patterns'],
        contextSnippetCount: 2,
      };
      (llmClient.enhancePrompt as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult);

      const result = await aiPromptEnhancementService.enhancePrompt({
        originalPrompt: 'Help me with React',
        projectPath: '/project',
        conversationMessages: [
          { role: 'user', content: 'previous question' },
          { role: 'assistant', content: 'previous answer' },
        ],
        enableContextExtraction: true,
        model: 'gpt-4@openai',
      });

      expect(llmClient.enhancePrompt).toHaveBeenCalledWith({
        originalPrompt: 'Help me with React',
        projectPath: '/project',
        conversationHistory: 'User: previous question\nAssistant: previous answer\n',
        enableContextExtraction: true,
        model: 'gpt-4@openai',
      });
      expect(result.enhancedPrompt).toBe('Enhanced prompt text');
    });

    it('throws error for empty prompt', async () => {
      await expect(
        aiPromptEnhancementService.enhancePrompt({
          originalPrompt: '',
          enableContextExtraction: false,
        })
      ).rejects.toThrow('No prompt provided for enhancement');
    });

    it('throws error for whitespace-only prompt', async () => {
      await expect(
        aiPromptEnhancementService.enhancePrompt({
          originalPrompt: '   ',
          enableContextExtraction: false,
        })
      ).rejects.toThrow('No prompt provided for enhancement');
    });

    it('throws error when enhanced result is empty', async () => {
      (llmClient.enhancePrompt as ReturnType<typeof vi.fn>).mockResolvedValue({
        enhancedPrompt: '',
        extractedKeywords: [],
        generatedQueries: [],
        contextSnippetCount: 0,
      });

      await expect(
        aiPromptEnhancementService.enhancePrompt({
          originalPrompt: 'Help me',
          enableContextExtraction: false,
        })
      ).rejects.toThrow('Empty enhancement result received');
    });

    it('handles missing conversationMessages', async () => {
      const mockResult = {
        enhancedPrompt: 'Enhanced',
        extractedKeywords: [],
        generatedQueries: [],
        contextSnippetCount: 0,
      };
      (llmClient.enhancePrompt as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult);

      await aiPromptEnhancementService.enhancePrompt({
        originalPrompt: 'Help me',
        enableContextExtraction: false,
      });

      expect(llmClient.enhancePrompt).toHaveBeenCalledWith({
        originalPrompt: 'Help me',
        projectPath: null,
        conversationHistory: null,
        enableContextExtraction: false,
        model: null,
      });
    });

    it('handles null model by passing null', async () => {
      const mockResult = {
        enhancedPrompt: 'Enhanced',
        extractedKeywords: [],
        generatedQueries: [],
        contextSnippetCount: 0,
      };
      (llmClient.enhancePrompt as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult);

      await aiPromptEnhancementService.enhancePrompt({
        originalPrompt: 'Help me',
        enableContextExtraction: true,
        model: undefined,
      });

      expect(llmClient.enhancePrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          model: null,
        })
      );
    });
  });

  describe('serializeHistory', () => {
    it('returns undefined for empty array', () => {
      const result = aiPromptEnhancementService.serializeHistory([]);
      expect(result).toBeUndefined();
    });

    it('returns undefined for undefined input', () => {
      const result = aiPromptEnhancementService.serializeHistory(undefined);
      expect(result).toBeUndefined();
    });

    it('serializes messages with role prefix', () => {
      const messages = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ];
      const result = aiPromptEnhancementService.serializeHistory(messages);
      expect(result).toBe('User: Hello\nAssistant: Hi there\n');
    });

    it('limits to most recent messages', () => {
      const messages = Array.from({ length: 30 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i}`,
      }));
      const result = aiPromptEnhancementService.serializeHistory(messages);
      // Should only contain messages from the last 20
      expect(result).toContain('Message 10');
      expect(result).not.toContain('Message 0');
    });

    it('truncates when exceeding character limit', () => {
      const messages = [
        { role: 'user', content: 'A'.repeat(3000) },
        { role: 'assistant', content: 'B'.repeat(3000) },
      ];
      const result = aiPromptEnhancementService.serializeHistory(messages);
      // Should contain first message but may truncate
      expect(result).toBeDefined();
      if (result) {
        expect(result.length).toBeLessThanOrEqual(4100); // ~4000 limit + some prefix
      }
    });
  });
});
