import type { ContentPart, Message as ModelMessage, ProviderOptions } from '@/services/llm/types';

type ReasoningProviderOptions = {
  openaiCompatible: {
    reasoning_content: string;
  };
};

export namespace MessageTransform {
  function shouldApplyCaching(providerId: string, modelId: string): boolean {
    const lowerProviderId = providerId.toLowerCase();
    const lowerModelId = modelId.toLowerCase();

    return (
      lowerProviderId.includes('anthropic') ||
      lowerProviderId.includes('claude') ||
      lowerModelId.includes('anthropic') ||
      lowerModelId.includes('claude') ||
      lowerModelId.includes('minimax')
    );
  }

  function resolveReasoningProviders(
    modelId: string,
    providerId?: string
  ): { usesDeepseek: boolean; usesMoonshot: boolean } {
    const normalizedProviderId = providerId?.toLowerCase();
    const normalizedModelId = modelId.toLowerCase();
    const usesDeepseek =
      normalizedProviderId === 'deepseek' || normalizedModelId.includes('deepseek');
    const usesMoonshot =
      !usesDeepseek &&
      (normalizedProviderId === 'moonshot' ||
        normalizedProviderId === 'kimi_coding' ||
        normalizedModelId.includes('kimi-k2'));

    return { usesDeepseek, usesMoonshot };
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  function mergeProviderOptions(
    existing?: ProviderOptions,
    incoming?: ProviderOptions
  ): ProviderOptions | undefined {
    if (!existing) {
      return incoming ?? undefined;
    }
    if (!incoming) {
      return existing;
    }

    const merged: Record<string, unknown> = { ...existing };

    for (const [key, incomingValue] of Object.entries(incoming)) {
      const existingValue = merged[key];
      if (isRecord(existingValue) && isRecord(incomingValue)) {
        merged[key] = { ...existingValue, ...incomingValue };
        continue;
      }
      merged[key] = incomingValue;
    }

    return merged;
  }

  function getHasToolCall(content?: ContentPart[]): boolean {
    return content?.some((part) => part.type === 'tool-call') ?? false;
  }

  function getExistingReasoningContent(msg: ModelMessage): string | undefined {
    if (!msg.providerOptions || !isRecord(msg.providerOptions)) {
      return undefined;
    }

    const openaiCompatible = msg.providerOptions.openaiCompatible;
    if (!isRecord(openaiCompatible)) {
      return undefined;
    }

    const reasoningContent = openaiCompatible.reasoning_content;
    return typeof reasoningContent === 'string' ? reasoningContent : undefined;
  }

  function createReasoningProviderOptions(reasoningContent: string): ReasoningProviderOptions {
    return {
      openaiCompatible: {
        reasoning_content: reasoningContent,
      },
    };
  }

  function resolveReasoningContent(
    existingReasoningContent: string | undefined,
    reasoningText: string,
    includesToolCall: boolean,
    usesDeepseek: boolean,
    usesMoonshot: boolean
  ): string {
    if (existingReasoningContent !== undefined) {
      return existingReasoningContent;
    }

    if (reasoningText.length > 0) {
      return reasoningText;
    }

    if (includesToolCall && (usesDeepseek || usesMoonshot)) {
      return ' ';
    }

    return reasoningText;
  }

  function applyCacheToMessage(msg: ModelMessage, providerId: string): void {
    const normalized = providerId.toLowerCase();
    const providerOptions =
      normalized.includes('anthropic') || normalized.includes('claude')
        ? { anthropic: { cacheControl: { type: 'ephemeral' } } }
        : normalized.includes('openrouter')
          ? { openrouter: { cache_control: { type: 'ephemeral' } } }
          : { openaiCompatible: { cache_control: { type: 'ephemeral' } } };

    const msgWithOptions = msg as unknown as { providerOptions?: object };
    msgWithOptions.providerOptions = {
      ...(msgWithOptions.providerOptions ?? {}),
      ...providerOptions,
    };
  }

  function applyCaching(msgs: ModelMessage[], providerId: string): void {
    const finalMsgs = msgs.filter((msg) => msg.role !== 'system').slice(-2);
    for (const msg of finalMsgs) {
      applyCacheToMessage(msg, providerId);
    }
  }

  function extractReasoning(content: ContentPart[]): {
    content: ContentPart[];
    reasoningText: string;
  } {
    const reasoningParts = content.filter((part) => part.type === 'reasoning');
    const reasoningText = reasoningParts.map((part) => part.text).join('');
    const filteredContent = content.filter((part) => part.type !== 'reasoning');

    return { content: filteredContent, reasoningText };
  }

  function normalizeHistoricalAssistantMessage(
    msg: ModelMessage,
    usesDeepseek: boolean,
    usesMoonshot: boolean
  ): ModelMessage {
    if (msg.role !== 'assistant' || !Array.isArray(msg.content)) {
      return msg;
    }

    const content = msg.content as ContentPart[];
    const extracted = extractReasoning(content);
    const includesToolCall = getHasToolCall(extracted.content);
    const existingReasoningContent = getExistingReasoningContent(msg);
    const shouldIncludeReasoningContent =
      usesDeepseek || extracted.reasoningText.length > 0 || (usesMoonshot && includesToolCall);

    if (!shouldIncludeReasoningContent && extracted.reasoningText.length === 0) {
      return msg;
    }

    const reasoningContent = resolveReasoningContent(
      existingReasoningContent,
      extracted.reasoningText,
      includesToolCall,
      usesDeepseek,
      usesMoonshot
    );

    const providerOptions = shouldIncludeReasoningContent
      ? mergeProviderOptions(msg.providerOptions, createReasoningProviderOptions(reasoningContent))
      : msg.providerOptions;
    const nextContent = extracted.reasoningText.length > 0 ? extracted.content : content;
    const contentChanged = nextContent !== content;
    const providerOptionsChanged = providerOptions !== msg.providerOptions;

    if (!contentChanged && !providerOptionsChanged) {
      return msg;
    }

    return {
      ...msg,
      content: nextContent,
      ...(providerOptions !== undefined ? { providerOptions } : {}),
    };
  }

  function normalizeHistoricalMessages(
    msgs: ModelMessage[],
    usesDeepseek: boolean,
    usesMoonshot: boolean
  ): ModelMessage[] {
    if (!usesDeepseek && !usesMoonshot) {
      return msgs;
    }

    let changed = false;
    const normalizedMessages = msgs.map((msg) => {
      const nextMsg = normalizeHistoricalAssistantMessage(msg, usesDeepseek, usesMoonshot);
      if (nextMsg !== msg) {
        changed = true;
      }
      return nextMsg;
    });

    return changed ? normalizedMessages : msgs;
  }

  export function transform(
    msgs: ModelMessage[],
    modelId: string,
    providerId?: string,
    assistantContent?: ContentPart[]
  ): {
    messages: ModelMessage[];
    transformedContent?: {
      content: ContentPart[];
      providerOptions?: ReasoningProviderOptions;
    };
  } {
    const { usesDeepseek, usesMoonshot } = resolveReasoningProviders(modelId, providerId);
    const messages = normalizeHistoricalMessages(msgs, usesDeepseek, usesMoonshot);

    // Apply prompt caching for supported providers
    if (providerId && shouldApplyCaching(providerId, modelId)) {
      applyCaching(messages, providerId);
    }

    if (!assistantContent) {
      return { messages };
    }

    const extracted = extractReasoning(assistantContent);
    const includesToolCall = getHasToolCall(extracted.content);
    const shouldIncludeReasoningContent =
      usesDeepseek || extracted.reasoningText.length > 0 || (usesMoonshot && includesToolCall);

    // Transform assistant content for providers that require reasoning_content
    if (usesDeepseek || usesMoonshot || shouldIncludeReasoningContent) {
      const reasoningContent = resolveReasoningContent(
        undefined,
        extracted.reasoningText,
        includesToolCall,
        usesDeepseek,
        usesMoonshot
      );
      const transformedContent = {
        content: extracted.content,
        providerOptions: shouldIncludeReasoningContent
          ? createReasoningProviderOptions(reasoningContent)
          : undefined,
      };

      return { messages, transformedContent };
    }

    return {
      messages,
      transformedContent: {
        content: assistantContent,
      },
    };
  }
}
