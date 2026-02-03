import { logger } from '@/lib/logger';
import { MODEL_CONFIGS } from '@/providers/config/model-config';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  cacheCreationInputTokens?: number;
}

class AIPricingService {
  private getModel(modelId: string) {
    if (MODEL_CONFIGS[modelId]) {
      return MODEL_CONFIGS[modelId];
    }

    // Try without @provider suffix (e.g., "claude-sonnet-4.5@openRouter" -> "claude-sonnet-4.5")
    const baseModelId = modelId.includes('@') ? modelId.split('@')[0] : modelId;
    if (baseModelId && MODEL_CONFIGS[baseModelId]) {
      return MODEL_CONFIGS[baseModelId];
    }

    return undefined;
  }

  calculateCost(modelId: string, usage: TokenUsage): number {
    const model = this.getModel(modelId);
    if (!model?.pricing) {
      logger.error(`Pricing information not available for model: ${modelId}`);
      return 0;
    }

    const parseRate = (value: string | undefined, fallback: number): number => {
      const parsed = Number.parseFloat(value ?? '');
      return Number.isFinite(parsed) ? parsed : fallback;
    };

    const inputRate = parseRate(model.pricing.input, 0);
    const outputRate = parseRate(model.pricing.output, 0);
    const cachedInputRate = parseRate(model.pricing.cachedInput, inputRate);
    const cacheCreationRate = parseRate(model.pricing.cacheCreation, inputRate);

    const cachedInputTokens = usage.cachedInputTokens ?? 0;
    const cacheCreationInputTokens = usage.cacheCreationInputTokens ?? 0;
    const nonCachedInputTokens = Math.max(
      0,
      usage.inputTokens - cachedInputTokens - cacheCreationInputTokens
    );

    let cost = 0;
    cost += nonCachedInputTokens * inputRate;
    cost += cachedInputTokens * cachedInputRate;
    cost += cacheCreationInputTokens * cacheCreationRate;
    cost += usage.outputTokens * outputRate;

    return cost;
  }
}

export const aiPricingService = new AIPricingService();
