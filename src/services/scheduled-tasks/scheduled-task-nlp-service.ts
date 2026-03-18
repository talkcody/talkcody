import { logger } from '@/lib/logger';
import { llmClient } from '@/services/llm/llm-client';
import type { ScheduledTaskScheduleDraft } from '@/types/scheduled-task';

class ScheduledTaskNlpService {
  async parse(input: string): Promise<ScheduledTaskScheduleDraft> {
    const prompt = [
      'Convert the following natural-language schedule into strict JSON.',
      'Return JSON only with keys: kind, at, everyMs, expr, tz, explanation, warnings.',
      'Allowed kind values: at, every, cron.',
      'For at: use ISO8601 UTC in at.',
      'For every: use everyMs.',
      'For cron: use 5-field expr and optional IANA tz.',
      '',
      `Input: ${input}`,
    ].join('\n');

    const result = await llmClient.enhancePrompt({
      originalPrompt: prompt,
      enableContextExtraction: false,
      projectPath: null,
      conversationHistory: null,
      model: null,
    });

    const text = result.enhancedPrompt.trim();
    const jsonStart = text.indexOf('{');
    const jsonEnd = text.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
      throw new Error('Failed to parse schedule JSON from model output');
    }

    try {
      const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1)) as ScheduledTaskScheduleDraft;
      return parsed;
    } catch (error) {
      logger.error('[ScheduledTaskNlpService] Parse failure', { text, error });
      throw new Error('Failed to parse natural-language schedule');
    }
  }
}

export const scheduledTaskNlpService = new ScheduledTaskNlpService();
