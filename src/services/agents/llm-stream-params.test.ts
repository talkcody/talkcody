import { describe, expect, it } from 'vitest';
import { LLMStreamParams } from './llm-stream-params';

describe('LLMStreamParams', () => {
  describe('buildProviderOptions', () => {
    it('maps DeepSeek V4 high effort to DeepSeek-compatible openai reasoningEffort', () => {
      const providerOptions = LLMStreamParams.buildProviderOptions({
        modelIdentifier: 'deepseek-v4-pro@deepseek',
        reasoningEffort: 'high',
        enableReasoningOptions: true,
      }) as Record<string, unknown>;

      expect(providerOptions.openai).toEqual({ reasoningEffort: 'high' });
      expect(providerOptions).not.toHaveProperty('deepseek');
      expect(providerOptions).not.toHaveProperty('openaiCompatible');
    });

    it('maps DeepSeek V4 xhigh effort to max', () => {
      const providerOptions = LLMStreamParams.buildProviderOptions({
        modelIdentifier: 'deepseek-v4-flash@deepseek',
        reasoningEffort: 'xhigh',
        enableReasoningOptions: true,
      }) as Record<string, unknown>;

      expect(providerOptions.openai).toEqual({ reasoningEffort: 'max' });
    });

    it('maps DeepSeek V4 low and medium effort to high', () => {
      const lowProviderOptions = LLMStreamParams.buildProviderOptions({
        modelIdentifier: 'deepseek-v4-pro@deepseek',
        reasoningEffort: 'low',
        enableReasoningOptions: true,
      }) as Record<string, unknown>;
      const mediumProviderOptions = LLMStreamParams.buildProviderOptions({
        modelIdentifier: 'deepseek-v4-pro@deepseek',
        reasoningEffort: 'medium',
        enableReasoningOptions: true,
      }) as Record<string, unknown>;

      expect(lowProviderOptions.openai).toEqual({ reasoningEffort: 'high' });
      expect(mediumProviderOptions.openai).toEqual({ reasoningEffort: 'high' });
    });

    it('keeps OpenRouter reasoning effort unchanged for DeepSeek V4 on OpenRouter', () => {
      const providerOptions = LLMStreamParams.buildProviderOptions({
        modelIdentifier: 'deepseek-v4-pro@openRouter',
        reasoningEffort: 'xhigh',
        enableReasoningOptions: true,
      }) as Record<string, unknown>;

      expect(providerOptions.openrouter).toEqual({ effort: 'xhigh' });
      expect(providerOptions.openai).toBeUndefined();
    });

    it('returns undefined when reasoning options are disabled', () => {
      expect(
        LLMStreamParams.buildProviderOptions({
          modelIdentifier: 'deepseek-v4-pro@deepseek',
          reasoningEffort: 'high',
          enableReasoningOptions: false,
        })
      ).toBeUndefined();
    });
  });
});
