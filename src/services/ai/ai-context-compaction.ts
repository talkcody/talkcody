import { logger } from '@/lib/logger';
import { modelTypeService } from '@/providers/models/model-type-service';
import { llmClient } from '@/services/llm/llm-client';
import type { ContextCompactionResult } from '@/services/llm/types';
import { ModelType } from '@/types/model-types';

class AIContextCompactionService {
  /**
   * Compresses conversation history using AI.
   *
   * @param conversationHistory - The conversation history to compress (text format)
   * @param model - Optional model identifier to use for compression
   * @param fallbackModels - Optional ordered fallback models used if the primary request fails
   * @returns Promise that resolves to the compressed summary text
   */
  async compactContext(
    conversationHistory: string,
    model?: string,
    fallbackModels: string[] = []
  ): Promise<string> {
    try {
      logger.info('Starting AI context compaction');

      if (!conversationHistory || conversationHistory.trim().length === 0) {
        logger.error('No conversation history provided for compaction');
        throw new Error('Conversation history is required for compaction');
      }

      const [primaryModel, ...resolvedFallbackModels] = model
        ? [model, ...fallbackModels]
        : await modelTypeService.resolveModelTypeChain(ModelType.MESSAGE_COMPACTION);

      const result = await llmClient.compactContext({
        conversationHistory,
        model: primaryModel,
        fallbackModels: resolvedFallbackModels,
      });

      const compressedSummaryValue = result?.compressedSummary;
      const compressedSummary =
        typeof compressedSummaryValue === 'string' ? compressedSummaryValue : '';

      if (compressedSummaryValue == null) {
        logger.warn('AI context compaction returned no summary; defaulting to empty string');
      }

      logger.info(
        `Compressed summary length: ${compressedSummary.length} characters (from ${conversationHistory.length})`
      );

      return compressedSummary;
    } catch (error) {
      logger.error('AI context compaction error:', error);
      throw error;
    }
  }
}

export const aiContextCompactionService = new AIContextCompactionService();
