import type { ReasoningPart, TextPart } from '@ai-sdk/provider-utils';

/**
 * Provider-specific message transformation utilities
 * Similar to OpenCode's transform.ts pattern
 *
 * @see https://github.com/sst/opencode/pull/4975
 */
export namespace MessageTransform {
  /**
   * Check if the model is a DeepSeek model
   */
  export function isDeepSeekModel(modelId: string, providerId?: string): boolean {
    return providerId === 'deepseek' || modelId.toLowerCase().includes('deepseek');
  }

  /**
   * Transform assistant content before building message with tool calls.
   * Only called when there are tool calls - final answers don't need transformation.
   *
   * For DeepSeek:
   * - Removes reasoning parts from content array
   * - Moves reasoning text to providerOptions.openaiCompatible.reasoning_content
   * - This allows DeepSeek to continue reasoning after tool execution
   *
   * @see https://api-docs.deepseek.com/guides/thinking_mode
   */
  export function transformAssistantContent(
    content: Array<TextPart | ReasoningPart>,
    modelId: string,
    providerId?: string
  ): {
    content: Array<TextPart | ReasoningPart>;
    providerOptions?: { openaiCompatible: { reasoning_content: string } };
  } {
    if (!isDeepSeekModel(modelId, providerId)) {
      return { content };
    }

    const reasoningParts = content.filter((part) => part.type === 'reasoning');
    const nonReasoningContent = content.filter((part) => part.type !== 'reasoning');
    const reasoningText = reasoningParts.map((part) => part.text).join('');

    if (reasoningText) {
      return {
        content: nonReasoningContent,
        providerOptions: {
          openaiCompatible: {
            reasoning_content: reasoningText,
          },
        },
      };
    }

    return { content: nonReasoningContent };
  }
}
