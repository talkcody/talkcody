// src/services/agents/llm-stream-params.ts

import { parseModelIdentifier } from '@/providers/core/provider-utils';
import type { ProviderOptions } from '@/services/llm/types';

type ReasoningEffort = string;

type StreamParamOptions = {
  modelIdentifier: string;
  reasoningEffort: ReasoningEffort;
  enableReasoningOptions: boolean;
};

type StreamParams = {
  providerOptions?: ProviderOptions;
  temperature?: number;
  topP?: number;
  topK?: number;
};

export class LLMStreamParams {
  static build(options: StreamParamOptions): StreamParams {
    const { modelIdentifier, reasoningEffort, enableReasoningOptions } = options;
    const providerOptions = LLMStreamParams.buildProviderOptions({
      modelIdentifier,
      reasoningEffort,
      enableReasoningOptions,
    });

    return {
      providerOptions,
      temperature: LLMStreamParams.temperature(modelIdentifier),
      topP: LLMStreamParams.topP(modelIdentifier),
      topK: LLMStreamParams.topK(modelIdentifier),
    };
  }

  static buildProviderOptions(options: StreamParamOptions): ProviderOptions | undefined {
    if (!options.enableReasoningOptions) {
      return undefined;
    }

    const normalizedReasoningEffort = LLMStreamParams.normalizeReasoningEffort(
      options.modelIdentifier,
      options.reasoningEffort
    );

    const { providerId } = parseModelIdentifier(options.modelIdentifier);
    const normalizedProviderId = providerId?.toLowerCase();
    const includeOpenAI = !normalizedProviderId || normalizedProviderId === 'openai';
    const includeOpenRouter = normalizedProviderId === 'openrouter';

    const providerOptionsMap: ProviderOptions = {
      google: {
        thinkingConfig: {
          thinkingBudget: 8192,
          includeThoughts: true,
        },
      },
      anthropic: {
        thinking: { type: 'enabled', budgetTokens: 12_000 },
      },
      moonshot: {
        thinking: { type: 'enabled' },
        temperature: 1.0,
      },
    };

    if (includeOpenAI) {
      providerOptionsMap.openai = {
        reasoningEffort: normalizedReasoningEffort,
      };
    }

    if (includeOpenRouter) {
      providerOptionsMap.openrouter = {
        effort: normalizedReasoningEffort,
      };
    }

    return Object.keys(providerOptionsMap).length > 0 ? providerOptionsMap : undefined;
  }

  static normalizeReasoningEffort(modelIdentifier: string, reasoningEffort: ReasoningEffort) {
    const { modelKey } = parseModelIdentifier(modelIdentifier);
    const supportsXhigh = modelKey === 'gpt-5.2-codex' || modelKey === 'gpt-5.1-codex-max';
    if (!supportsXhigh && reasoningEffort === 'xhigh') {
      return 'high';
    }
    return reasoningEffort;
  }

  static temperature(modelIdentifier: string): number | undefined {
    const id = modelIdentifier.toLowerCase();
    if (id.includes('qwen')) return 0.55;
    if (id.includes('claude')) return undefined;
    if (id.includes('gemini')) return 1.0;
    if (id.includes('glm-4.6')) return 1.0;
    if (id.includes('glm-4.7')) return 1.0;
    if (id.includes('minimax-m2')) return 1.0;
    if (id.includes('kimi-k2.5')) return 1.0;
    if (id.includes('kimi-k2')) {
      if (id.includes('thinking') || id.includes('k2.')) {
        return 1.0;
      }
      return 0.6;
    }
    return undefined;
  }

  static topP(modelIdentifier: string): number | undefined {
    const id = modelIdentifier.toLowerCase();
    if (id.includes('qwen')) return 1;
    if (id.includes('minimax-m2') || id.includes('kimi-k2.5') || id.includes('gemini')) {
      return 0.95;
    }
    return undefined;
  }

  static topK(modelIdentifier: string): number | undefined {
    const id = modelIdentifier.toLowerCase();
    if (id.includes('minimax-m2')) {
      if (id.includes('m2.1')) return 40;
      return 20;
    }
    if (id.includes('gemini')) return 64;
    return undefined;
  }
}
