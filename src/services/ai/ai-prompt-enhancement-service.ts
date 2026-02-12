import { logger } from '@/lib/logger';
import { llmClient } from '@/services/llm/llm-client';
import type { PromptEnhancementResult } from '@/services/llm/types';

const MAX_HISTORY_MESSAGES = 20;
const MAX_HISTORY_CHARS = 4000;

export interface EnhancePromptParams {
  originalPrompt: string;
  projectPath?: string;
  conversationMessages?: Array<{ role: string; content: string }>;
  enableContextExtraction: boolean;
  model?: string;
}

class AIPromptEnhancementService {
  async enhancePrompt(params: EnhancePromptParams): Promise<PromptEnhancementResult> {
    const { originalPrompt, projectPath, conversationMessages, enableContextExtraction, model } =
      params;

    if (!originalPrompt || originalPrompt.trim().length === 0) {
      throw new Error('No prompt provided for enhancement');
    }

    const conversationHistory = this.serializeHistory(conversationMessages);

    logger.info('[PromptEnhancement] Enhancing prompt', {
      promptLength: originalPrompt.length,
      hasProjectPath: !!projectPath,
      historyLength: conversationHistory?.length ?? 0,
      enableContextExtraction,
      model: model ?? 'default',
    });

    const result = await llmClient.enhancePrompt({
      originalPrompt,
      projectPath: projectPath ?? null,
      conversationHistory: conversationHistory ?? null,
      enableContextExtraction,
      model: model ?? null,
    });

    if (!result.enhancedPrompt || result.enhancedPrompt.trim().length === 0) {
      throw new Error('Empty enhancement result received');
    }

    logger.info('[PromptEnhancement] Enhancement complete', {
      enhancedLength: result.enhancedPrompt.length,
      keywordsCount: result.extractedKeywords.length,
      queriesCount: result.generatedQueries.length,
      snippetCount: result.contextSnippetCount,
    });

    return result;
  }

  serializeHistory(messages?: Array<{ role: string; content: string }>): string | undefined {
    if (!messages || messages.length === 0) {
      return undefined;
    }

    // Take the most recent messages up to the limit
    const recentMessages = messages.slice(-MAX_HISTORY_MESSAGES);

    let result = '';
    for (const msg of recentMessages) {
      const prefix = msg.role === 'user' ? 'User' : 'Assistant';
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      const line = `${prefix}: ${content}\n`;

      if (result.length + line.length > MAX_HISTORY_CHARS) {
        break;
      }
      result += line;
    }

    return result.length > 0 ? result : undefined;
  }
}

export const aiPromptEnhancementService = new AIPromptEnhancementService();
