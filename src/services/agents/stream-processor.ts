// src/services/agents/stream-processor.ts

import { formatReasoningText } from '@/lib/llm-utils';
import { logger } from '@/lib/logger';
import { decodeObjectHtmlEntities } from '@/lib/utils';
import { getLocale, type SupportedLocale } from '@/locales';
import type { ContentPart, ProviderOptions } from '@/services/llm/types';
import { useSettingsStore } from '@/stores/settings-store';
import type { ToolCallInfo } from './tool-executor';

function getTranslations() {
  const language = (useSettingsStore.getState().language || 'en') as SupportedLocale;
  return getLocale(language);
}

export interface StreamProcessorCallbacks {
  onChunk: (chunk: string) => void;
  onStatus?: (status: string) => void;
  onAssistantMessageStart?: () => void;
}

export interface StreamProcessorContext {
  suppressReasoning: boolean;
}

export interface ReasoningBlock {
  id: string;
  text: string;
  providerMetadata?: ProviderOptions; // For storing signature/redactedData from Claude API
}

export interface StreamProcessorState {
  isAnswering: boolean;
  isFirstReasoning: boolean;
  toolCalls: ToolCallInfo[];
  currentStepText: string;
  fullText: string;
  hasError: boolean;
  consecutiveToolErrors: number;
  // Structured content tracking
  currentReasoningId: string | null;
  reasoningBlocks: ReasoningBlock[];
  textParts: string[];
  contentOrder: Array<{ type: 'reasoning' | 'text'; index: number }>;
  // Track whether actual text content was received (not just TextStart event)
  // This helps distinguish between "assistant message created by reasoning" vs "assistant message with text"
  hasReceivedText: boolean;
}

/**
 * StreamProcessor handles processing of streamText delta events
 */
export class StreamProcessor {
  private state: StreamProcessorState = {
    isAnswering: false,
    isFirstReasoning: true,
    toolCalls: [],
    currentStepText: '',
    fullText: '',
    hasError: false,
    consecutiveToolErrors: 0,
    currentReasoningId: null,
    reasoningBlocks: [],
    textParts: [],
    contentOrder: [],
    hasReceivedText: false,
  };

  constructor() {
    this.resetState();
  }

  /**
   * Check if an assistant message needs to be created.
   * Returns true if no assistant message has been created yet (neither text nor reasoning).
   */
  private needsAssistantMessage(): boolean {
    return !this.state.isAnswering;
  }

  /**
   * Completely reset all processor state for a new conversation/agent loop
   * This should be called at the start of a new agent loop to ensure clean state
   */
  fullReset(): void {
    this.state = {
      isAnswering: false,
      isFirstReasoning: true,
      toolCalls: [],
      currentStepText: '',
      fullText: '',
      hasError: false,
      consecutiveToolErrors: 0,
      currentReasoningId: null,
      reasoningBlocks: [],
      textParts: [],
      contentOrder: [],
      hasReceivedText: false,
    };
  }

  /**
   * Reset processor state for a new iteration within the same agent loop
   * Preserves fullText and isFirstReasoning across iterations to maintain
   * accumulated content (including reasoning) throughout the agent loop
   * This should be called at the start of each iteration, not between conversations
   */
  resetState(): void {
    // Preserve fullText and isFirstReasoning across iterations (if state exists)
    const preservedFullText = this.state?.fullText || '';
    const preservedIsFirstReasoning = this.state?.isFirstReasoning ?? true;
    const preservedConsecutiveToolErrors = this.state?.consecutiveToolErrors || 0;

    this.state = {
      isAnswering: false,
      isFirstReasoning: preservedIsFirstReasoning,
      toolCalls: [],
      currentStepText: '',
      fullText: preservedFullText,
      hasError: false,
      consecutiveToolErrors: preservedConsecutiveToolErrors,
      currentReasoningId: null,
      reasoningBlocks: [],
      textParts: [],
      contentOrder: [],
      hasReceivedText: false,
    };
  }

  /**
   * Get current state
   */
  getState(): StreamProcessorState {
    return { ...this.state };
  }

  getFullText(): string {
    return this.state.fullText;
  }

  getCurrentStepText(): string {
    return this.state.currentStepText;
  }

  /**
   * Get collected tool calls
   */
  getToolCalls(): ToolCallInfo[] {
    return [...this.state.toolCalls];
  }

  /**
   * Check if there was an error
   */
  hasError(): boolean {
    return this.state.hasError;
  }

  /**
   * Get consecutive tool error count
   */
  getConsecutiveToolErrors(): number {
    return this.state.consecutiveToolErrors;
  }

  /**
   * Reset consecutive tool error count (called on successful text generation)
   */
  resetConsecutiveToolErrors(): void {
    this.state.consecutiveToolErrors = 0;
  }

  /**
   * Increment consecutive tool error count
   */
  incrementConsecutiveToolErrors(): void {
    this.state.consecutiveToolErrors++;
  }

  /**
   * Deep merge providerMetadata objects
   * This is needed because signature arrives in a separate delta event
   * and we need to merge it with existing metadata (e.g., redactedData)
   */
  private deepMergeMetadata(
    existing: ProviderOptions | undefined,
    incoming: ProviderOptions
  ): ProviderOptions {
    if (!existing) return incoming;
    if (!incoming) return existing;

    const result: Record<string, unknown> = { ...existing };
    for (const key of Object.keys(incoming)) {
      const existingValue = existing[key];
      const incomingValue = incoming[key];

      // Deep merge objects, replace primitives
      if (
        typeof existingValue === 'object' &&
        existingValue !== null &&
        typeof incomingValue === 'object' &&
        incomingValue !== null &&
        !Array.isArray(existingValue) &&
        !Array.isArray(incomingValue)
      ) {
        result[key] = this.deepMergeMetadata(
          existingValue as ProviderOptions,
          incomingValue as ProviderOptions
        );
      } else {
        result[key] = incomingValue;
      }
    }
    return result;
  }

  /**
   * Reset current step text (should be called at the start of each iteration)
   */
  resetCurrentStepText(): void {
    this.state.currentStepText = '';
  }

  /**
   * Process text-start delta
   */
  processTextStart(callbacks: StreamProcessorCallbacks): void {
    const t = getTranslations();
    callbacks.onStatus?.(t.StreamProcessor.status.answering);
    // Only call onAssistantMessageStart if no assistant message exists yet
    // This prevents duplicate message creation when reasoning comes before text-start
    if (this.needsAssistantMessage()) {
      this.state.isAnswering = true;
      callbacks.onAssistantMessageStart?.();
    }
  }

  /**
   * Process text-delta
   */
  processTextDelta(text: string, callbacks: StreamProcessorCallbacks): void {
    const t = getTranslations();
    // Create assistant message if needed (no text or reasoning received yet)
    if (this.needsAssistantMessage()) {
      callbacks.onStatus?.(t.StreamProcessor.status.answering);
      this.state.isAnswering = true;
      callbacks.onAssistantMessageStart?.();
    }

    if (text) {
      this.state.hasReceivedText = true;
      this.state.currentStepText += text;
      this.state.fullText += text;
      callbacks.onChunk(text);
      // Reset error counter on successful text output
      this.state.consecutiveToolErrors = 0;

      // Track in structured content
      const lastOrder = this.state.contentOrder[this.state.contentOrder.length - 1];
      if (!lastOrder || lastOrder.type !== 'text') {
        // Start a new text part
        this.state.textParts.push(text);
        this.state.contentOrder.push({ type: 'text', index: this.state.textParts.length - 1 });
      } else {
        // Append to existing text part
        this.state.textParts[lastOrder.index] += text;
      }
    }
  }

  processToolCall(
    toolCall: {
      toolCallId: string;
      toolName: string;
      input: unknown;
      providerMetadata?: Record<string, unknown>;
    },
    callbacks: StreamProcessorCallbacks
  ): void {
    // logger.info('Processing tool call:', {
    //   toolCallId: toolCall.toolCallId,
    //   toolName: toolCall.toolName,
    //   inputType: typeof toolCall.input,
    //   inputSize: (() => {
    //     const json = JSON.stringify(toolCall.input);
    //     return typeof json === 'string' ? json.length : 0;
    //   })(),
    // });

    if (!toolCall.toolName) {
      logger.warn('Skipping tool call without tool name', {
        toolCallId: toolCall.toolCallId,
      });
      return;
    }

    // Decode HTML entities in tool call input
    let decodedInput = decodeObjectHtmlEntities(toolCall.input);

    // Parse JSON string input to object (some providers like MiniMax return input as JSON string)
    if (typeof decodedInput === 'string') {
      try {
        decodedInput = JSON.parse(decodedInput);
      } catch {
        // If parsing fails, keep as string (might be intentional string parameter)
        logger.debug('Tool call input is not valid JSON, keeping as string', {
          toolName: toolCall.toolName,
        });
      }
    }

    const decodedToolCall = {
      ...toolCall,
      input: decodedInput,
    };

    // Check for duplicate tool calls
    const isDuplicate = this.state.toolCalls.some(
      (existingCall) =>
        existingCall.toolCallId === decodedToolCall.toolCallId &&
        existingCall.toolName === decodedToolCall.toolName &&
        JSON.stringify(existingCall.input) === JSON.stringify(decodedToolCall.input)
    );

    if (isDuplicate) {
      logger.info('Skipping duplicate tool call:', {
        toolCallId: decodedToolCall.toolCallId,
        toolName: decodedToolCall.toolName,
      });
      return;
    }

    this.state.toolCalls.push(decodedToolCall);
    const t = getTranslations();
    callbacks.onStatus?.(t.StreamProcessor.status.callingTool(decodedToolCall.toolName));
  }

  /**
   * Check if text is significant (not just whitespace or single punctuation)
   */
  private isSignificantText(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed) return false;
    // Filter out single punctuation characters (including Chinese and English punctuation)
    if (trimmed.length === 1 && /^[\p{P}\p{S}]$/u.test(trimmed)) {
      return false;
    }
    return true;
  }

  /**
   * Process reasoning-start event
   */
  processReasoningStart(
    id: string,
    providerMetadata: ProviderOptions | undefined,
    callbacks: StreamProcessorCallbacks
  ): void {
    // logger.info('Processing reasoning start:', { id });

    // Create a new reasoning block
    this.state.currentReasoningId = id;
    const newBlock: ReasoningBlock = { id, text: '', providerMetadata };
    this.state.reasoningBlocks.push(newBlock);
    this.state.contentOrder.push({
      type: 'reasoning',
      index: this.state.reasoningBlocks.length - 1,
    });

    const t = getTranslations();
    callbacks.onStatus?.(t.StreamProcessor.status.thinking);
  }

  /**
   * Process reasoning-delta
   */
  processReasoningDelta(
    id: string,
    text: string,
    providerMetadata: ProviderOptions | undefined,
    context: StreamProcessorContext,
    callbacks: StreamProcessorCallbacks
  ): void {
    // logger.info('Processing reasoning delta:', { id, text, context });
    const t = getTranslations();

    // Call onAssistantMessageStart on first reasoning (similar to processTextDelta)
    // This ensures assistant message is created even when only reasoning is returned
    // Use needsAssistantMessage() to handle cases where TextStart was emitted but no text received
    if (this.needsAssistantMessage() && !context.suppressReasoning && text && text.trim()) {
      this.state.isAnswering = true;
      callbacks.onAssistantMessageStart?.();
    }

    // Find or create the reasoning block for this ID
    let blockIndex = this.state.reasoningBlocks.findIndex((b) => b.id === id);

    if (blockIndex === -1) {
      // If no reasoning-start was received, create the block now (backward compatibility)
      const newBlock: ReasoningBlock = { id, text: '', providerMetadata };
      this.state.reasoningBlocks.push(newBlock);
      blockIndex = this.state.reasoningBlocks.length - 1;

      // Only add to contentOrder if this is a new block
      const lastOrder = this.state.contentOrder[this.state.contentOrder.length - 1];
      if (!lastOrder || lastOrder.type !== 'reasoning' || lastOrder.index !== blockIndex) {
        this.state.contentOrder.push({ type: 'reasoning', index: blockIndex });
      }
    }

    // Update providerMetadata if provided (this is how signature is delivered)
    // Deep merge to preserve existing metadata while adding new fields (e.g., signature)
    const block = this.state.reasoningBlocks[blockIndex];
    if (block && providerMetadata) {
      block.providerMetadata = this.deepMergeMetadata(block.providerMetadata, providerMetadata);
    }

    // Always append text to the reasoning block, even if suppressReasoning is true
    // This is critical for Claude API thinking mode compliance:
    // When thinking is enabled, assistant messages must include thinking blocks
    // Suppressing UI display doesn't mean we should drop the thinking content from API messages
    if (block && text) {
      block.text += text;
    }

    // Skip UI updates for empty or whitespace-only reasoning
    if (!text || !text.trim()) {
      callbacks.onStatus?.(t.StreamProcessor.status.thinking);
      return;
    }

    if (!context.suppressReasoning) {
      // Format for UI display
      const formattedText = formatReasoningText(text, this.state.isFirstReasoning);
      this.state.currentStepText += formattedText;
      this.state.fullText += formattedText;
      callbacks.onChunk(formattedText);
      this.state.isFirstReasoning = false;
    }

    callbacks.onStatus?.(t.StreamProcessor.status.thinking);
  }

  /**
   * Process reasoning-end event
   */
  processReasoningEnd(id: string, callbacks: StreamProcessorCallbacks): void {
    // logger.info('Processing reasoning end:', { id });

    // Clear current reasoning ID
    if (this.state.currentReasoningId === id) {
      this.state.currentReasoningId = null;
    }

    const t = getTranslations();
    callbacks.onStatus?.(t.StreamProcessor.status.thinking);
  }

  /**
   * Get structured assistant content as an array of content parts.
   * Reasoning parts include providerOptions for Claude API extended thinking.
   *
   * CRITICAL: When thinking mode is enabled, Claude API requires:
   * "a final assistant message must start with a thinking block (preceeding the lastmost set of tool_use and tool_result blocks)"
   * Therefore, we MUST return reasoning parts BEFORE text parts, regardless of arrival order.
   */
  getAssistantContent(): Array<ContentPart> {
    const reasoningParts: Array<ContentPart> = [];
    const textParts: Array<ContentPart> = [];

    for (const order of this.state.contentOrder) {
      if (order.type === 'text') {
        const text = this.state.textParts[order.index];
        if (text?.trim()) {
          textParts.push({ type: 'text', text: text.trim() });
        }
      } else if (order.type === 'reasoning') {
        const block = this.state.reasoningBlocks[order.index];
        if (block?.text && this.isSignificantText(block.text)) {
          const reasoningPart: ContentPart = {
            type: 'reasoning',
            text: block.text.trim(),
          };
          if (block.providerMetadata) {
            reasoningPart.providerOptions = block.providerMetadata;
          }
          reasoningParts.push(reasoningPart);
        }
      }
    }

    // CRITICAL: Return reasoning parts FIRST, then text parts
    // This ensures compliance with Claude API thinking mode requirement
    return [...reasoningParts, ...textParts];
  }

  /**
   * Mark that an error occurred
   */
  markError(): void {
    this.state.hasError = true;
    this.state.consecutiveToolErrors++;
  }
}
