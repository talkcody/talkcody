import { logger } from '@/lib/logger';
import { modelTypeService } from '@/providers/models/model-type-service';
import { llmClient } from '@/services/llm/llm-client';
import type { GitMessageContext, GitMessageResult } from '@/services/llm/types';
import { ModelType } from '@/types/model-types';

class AIGitMessagesService {
  async generateCommitMessage(context: GitMessageContext): Promise<GitMessageResult | null> {
    try {
      logger.info('generateCommitMessage diffText length', context.diffText?.length ?? 0);

      if (!context.diffText || context.diffText.trim().length === 0) {
        logger.error('No diff text provided for commit message generation');
        return null;
      }

      const modelChain = await modelTypeService.resolveModelTypeChain(ModelType.SMALL);
      const [model, ...fallbackModels] = modelChain;

      const result = await llmClient.generateCommitMessage({
        ...context,
        model,
        fallbackModels,
      });

      if (result.message) {
        logger.info('AI Git Message result:', result.message);
        return result;
      }

      return null;
    } catch (error) {
      logger.error('AI git message generation error:', error);
      return null;
    }
  }
}

export const aiGitMessagesService = new AIGitMessagesService();
