// src/services/agents/stream-processor.ts

import type { ReasoningPart, TextPart } from '@ai-sdk/provider-utils';
import { formatReasoningText } from '@/lib/llm-utils';
import { logger } from '@/lib/logger';
import { decodeObjectHtmlEntities } from '@/lib/utils';
import { getLocale, type SupportedLocale } from '@/locales';
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
  };

  constructor() {
    this.resetState();
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
    };
  }

  /**
   * Get current state
   */
  getState(): StreamProcessorState {
    return { ...this.state };
  }

  /**
   * Get full text accumulated so far
   */
  getFullText(): string {
    return this.state.fullText;
  }

  /**
   * Get current step text
   */
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
    // Only call onAssistantMessageStart if not already answering
    // This prevents duplicate message creation when reasoning comes before text-start
    if (!this.state.isAnswering) {
      this.state.isAnswering = true;
      callbacks.onAssistantMessageStart?.();
    }
  }

  /**
   * Process text-delta
   */
  processTextDelta(text: string, callbacks: StreamProcessorCallbacks): void {
    const t = getTranslations();
    if (!this.state.isAnswering) {
      callbacks.onStatus?.(t.StreamProcessor.status.answering);
      this.state.isAnswering = true;
      callbacks.onAssistantMessageStart?.();
    }

    if (text) {
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
    toolCall: { toolCallId: string; toolName: string; input: unknown },
    callbacks: StreamProcessorCallbacks
  ): void {
    logger.info('Processing tool call:', {
      toolCallId: toolCall.toolCallId,
      toolName: toolCall.toolName,
      inputType: typeof toolCall.input,
      inputSize: (() => {
        const json = JSON.stringify(toolCall.input);
        return typeof json === 'string' ? json.length : 0;
      })(),
    });

    // Decode HTML entities in tool call input
    const decodedToolCall = {
      ...toolCall,
      input: decodeObjectHtmlEntities(toolCall.input),
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
  processReasoningStart(id: string, callbacks: StreamProcessorCallbacks): void {
    // logger.info('Processing reasoning start:', { id });

    // Create a new reasoning block
    this.state.currentReasoningId = id;
    const newBlock: ReasoningBlock = { id, text: '' };
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
    context: StreamProcessorContext,
    callbacks: StreamProcessorCallbacks
  ): void {
    // logger.info('Processing reasoning delta:', { id, text, context });
    const t = getTranslations();

    // Call onAssistantMessageStart on first reasoning (similar to processTextDelta)
    // This ensures assistant message is created even when only reasoning is returned
    if (!this.state.isAnswering && !context.suppressReasoning && text && text.trim()) {
      this.state.isAnswering = true;
      callbacks.onAssistantMessageStart?.();
    }

    // Skip empty or whitespace-only reasoning
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

      // Track in structured content
      // Find or create the reasoning block for this ID
      let blockIndex = this.state.reasoningBlocks.findIndex((b) => b.id === id);

      if (blockIndex === -1) {
        // If no reasoning-start was received, create the block now (backward compatibility)
        const newBlock: ReasoningBlock = { id, text: '' };
        this.state.reasoningBlocks.push(newBlock);
        blockIndex = this.state.reasoningBlocks.length - 1;

        // Only add to contentOrder if this is a new block
        const lastOrder = this.state.contentOrder[this.state.contentOrder.length - 1];
        if (!lastOrder || lastOrder.type !== 'reasoning' || lastOrder.index !== blockIndex) {
          this.state.contentOrder.push({ type: 'reasoning', index: blockIndex });
        }
      }

      // Append text to the reasoning block
      const block = this.state.reasoningBlocks[blockIndex];
      if (block) {
        block.text += text;
      }
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
   * Get structured assistant content as an array of TextPart and ReasoningPart
   * This builds the proper AssistantContent format for Vercel AI SDK
   */
  getAssistantContent(): Array<TextPart | ReasoningPart> {
    const content: Array<TextPart | ReasoningPart> = [];

    for (const order of this.state.contentOrder) {
      if (order.type === 'text') {
        const text = this.state.textParts[order.index];
        if (text?.trim()) {
          content.push({ type: 'text', text: text.trim() });
        }
      } else if (order.type === 'reasoning') {
        const block = this.state.reasoningBlocks[order.index];
        if (block?.text && this.isSignificantText(block.text)) {
          content.push({ type: 'reasoning', text: block.text.trim() });
        }
      }
    }

    return content;
  }

  /**
   * Mark that an error occurred
   */
  markError(): void {
    this.state.hasError = true;
    this.state.consecutiveToolErrors++;
  }
}
