import type { ContentPart, Message as ModelMessage } from '@/services/llm/types';

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
      (normalizedProviderId === 'moonshot' || normalizedModelId.includes('kimi-k2'));

    return { usesDeepseek, usesMoonshot };
  }

  function getReasoningText(content: ContentPart[]): string {
    return content
      .filter((part) => part.type === 'reasoning')
      .map((part) => part.text)
      .join('');
  }

  function getHasToolCall(content?: ContentPart[]): boolean {
    return content?.some((part) => part.type === 'tool-call') ?? false;
  }

  function getLatestAssistantContent(msgs: ModelMessage[]): ContentPart[] | undefined {
    for (let i = msgs.length - 1; i >= 0; i -= 1) {
      const msg = msgs[i];
      if (!msg || msg.role !== 'assistant') {
        continue;
      }
      if (Array.isArray(msg.content)) {
        return msg.content as ContentPart[];
      }
      return undefined;
    }

    return undefined;
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

  export function transform(
    msgs: ModelMessage[],
    modelId: string,
    providerId?: string,
    assistantContent?: ContentPart[]
  ): {
    messages: ModelMessage[];
    transformedContent?: {
      content: ContentPart[];
      providerOptions?: { openaiCompatible: { reasoning_content: string } };
    };
  } {
    // Apply prompt caching for supported providers
    if (providerId && shouldApplyCaching(providerId, modelId)) {
      applyCaching(msgs, providerId);
    }

    const { usesDeepseek, usesMoonshot } = resolveReasoningProviders(modelId, providerId);
    const latestAssistantContent = getLatestAssistantContent(msgs);
    const includesToolCall =
      getHasToolCall(assistantContent) ||
      (assistantContent ? false : getHasToolCall(latestAssistantContent));
    const reasoningText = assistantContent ? getReasoningText(assistantContent) : '';
    const shouldIncludeReasoningContent =
      usesDeepseek || reasoningText.length > 0 || (usesMoonshot && includesToolCall);

    // Transform assistant content for providers that require reasoning_content
    if (assistantContent && (usesDeepseek || usesMoonshot || shouldIncludeReasoningContent)) {
      const extracted = extractReasoning(assistantContent);
      const reasoningContent =
        usesMoonshot && shouldIncludeReasoningContent && extracted.reasoningText.length === 0
          ? ' '
          : extracted.reasoningText;
      const transformedContent = {
        content: extracted.content,
        providerOptions: shouldIncludeReasoningContent
          ? {
              openaiCompatible: {
                reasoning_content: reasoningContent,
              },
            }
          : undefined,
      };

      return { messages: msgs, transformedContent };
    }

    if (shouldIncludeReasoningContent) {
      return {
        messages: msgs,
        transformedContent: {
          content: assistantContent ?? [],
          providerOptions: {
            openaiCompatible: {
              reasoning_content: reasoningText,
            },
          },
        },
      };
    }

    // Default passthrough
    const transformedContent = assistantContent ? { content: assistantContent } : undefined;

    return { messages: msgs, transformedContent };
  }
}
