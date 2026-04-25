// src/lib/message-convert.ts
// Message conversion functions for Anthropic API compliance

import { logger } from '@/lib/logger';
import type { ContentPart, Message as ModelMessage } from '@/services/llm/types';
import { type ValidationResult, validateAnthropicMessages } from './message-validate';

/**
 * Options for message conversion
 */
export interface ConvertOptions {
  /** Automatically fix issues found during conversion (default: true) */
  autoFix?: boolean;
  /** Trim trailing whitespace from last assistant message (default: true) */
  trimAssistantWhitespace?: boolean;
}

/**
 * Result of message conversion
 */
export interface ConvertResult {
  messages: ModelMessage[];
  modified: boolean;
  modifications: string[];
}

/**
 * Type guard for assistant content parts
 */
type AssistantContentPart = Extract<ContentPart, { type: 'text' | 'tool-call' }>;

/**
 * Normalizes message content to array format.
 * Converts string content to an array with a single text part.
 */
function normalizeContentToArray(content: string | unknown[]): ContentPart[] {
  if (typeof content === 'string') {
    return content.trim() ? [{ type: 'text' as const, text: content }] : [];
  }
  return content as ContentPart[];
}

function mergeProviderOptions(
  existing: ModelMessage['providerOptions'],
  incoming: ModelMessage['providerOptions']
): ModelMessage['providerOptions'] {
  if (!existing) {
    return incoming;
  }
  if (!incoming) {
    return existing;
  }

  const merged: Record<string, unknown> = { ...existing };

  for (const [key, incomingValue] of Object.entries(incoming)) {
    const existingValue = merged[key];
    if (
      typeof existingValue === 'object' &&
      existingValue !== null &&
      !Array.isArray(existingValue) &&
      typeof incomingValue === 'object' &&
      incomingValue !== null &&
      !Array.isArray(incomingValue)
    ) {
      merged[key] = {
        ...(existingValue as Record<string, unknown>),
        ...incomingValue,
      };
      continue;
    }
    merged[key] = incomingValue;
  }

  return merged;
}

/**
 * Merges consecutive assistant messages into a single message.
 * Anthropic API doesn't allow consecutive assistant messages, so they must be merged.
 */
export function mergeConsecutiveAssistantMessages(messages: ModelMessage[]): ModelMessage[] {
  const result: ModelMessage[] = [];

  for (const msg of messages) {
    const lastMsg = result[result.length - 1];

    if (msg.role === 'assistant' && lastMsg?.role === 'assistant') {
      // Merge consecutive assistant messages
      const lastContent = normalizeContentToArray(lastMsg.content);
      const currentContent = normalizeContentToArray(msg.content);

      // Filter out empty text parts and combine
      const combined = [...lastContent, ...currentContent].filter((part) => {
        if (part.type === 'text') {
          return part.text?.trim();
        }
        return true; // Keep tool-call parts
      });

      if (combined.length > 0) {
        result[result.length - 1] = {
          ...lastMsg,
          content: combined as AssistantContentPart[],
          providerOptions: mergeProviderOptions(lastMsg.providerOptions, msg.providerOptions),
        };
      }

      logger.debug('[mergeConsecutiveAssistantMessages] Merged assistant messages', {
        lastContentLength: lastContent.length,
        currentContentLength: currentContent.length,
        combinedLength: combined.length,
      });
    } else {
      result.push(msg);
    }
  }

  return result;
}

/**
 * Removes orphaned tool-calls and tool-results.
 * An orphaned tool-call has no matching tool-result, and vice versa.
 */
export function removeOrphanedToolMessages(messages: ModelMessage[]): ModelMessage[] {
  // First, collect all valid tool-call IDs (those with matching results)
  const toolCallIds = new Set<string>();
  const toolResultIds = new Set<string>();

  // Collect all IDs
  for (const msg of messages) {
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      for (const part of msg.content as AssistantContentPart[]) {
        if (part.type === 'tool-call' && part.toolCallId) {
          toolCallIds.add(part.toolCallId);
        }
      }
    }
    if (msg.role === 'tool' && Array.isArray(msg.content)) {
      for (const part of msg.content as ContentPart[]) {
        if (part.type === 'tool-result' && part.toolCallId) {
          toolResultIds.add(part.toolCallId);
        }
      }
    }
  }

  // Find valid pairs (IDs that exist in both sets)
  const validPairIds = new Set<string>();
  for (const id of toolCallIds) {
    if (toolResultIds.has(id)) {
      validPairIds.add(id);
    }
  }

  // Filter messages
  const result: ModelMessage[] = [];

  for (const msg of messages) {
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      // Filter out orphaned tool-calls
      const filteredContent = (msg.content as AssistantContentPart[]).filter((part) => {
        if (part.type === 'tool-call' && part.toolCallId) {
          const keep = validPairIds.has(part.toolCallId);
          if (!keep) {
            logger.debug('[removeOrphanedToolMessages] Removing orphaned tool-call', {
              toolCallId: part.toolCallId,
              toolName: part.toolName,
            });
          }
          return keep;
        }
        return true; // Keep text parts
      });

      // Only add message if it has content remaining
      if (filteredContent.length > 0) {
        result.push({ ...msg, content: filteredContent });
      } else {
        logger.debug(
          '[removeOrphanedToolMessages] Skipping empty assistant message after filtering'
        );
      }
    } else if (msg.role === 'tool' && Array.isArray(msg.content)) {
      // Filter out orphaned tool-results
      const filteredContent = (msg.content as ContentPart[]).filter((part) => {
        if (part.type === 'tool-result' && part.toolCallId) {
          const keep = validPairIds.has(part.toolCallId);
          if (!keep) {
            logger.debug('[removeOrphanedToolMessages] Removing orphaned tool-result', {
              toolCallId: part.toolCallId,
              toolName: part.toolName,
            });
          }
          return keep;
        }
        return true;
      });

      // Only add message if it has content remaining
      if (filteredContent.length > 0) {
        result.push({ ...msg, content: filteredContent });
      } else {
        logger.debug('[removeOrphanedToolMessages] Skipping empty tool message after filtering');
      }
    } else {
      // Keep system and user messages as-is
      result.push(msg);
    }
  }

  return result;
}

/**
 * Trims trailing whitespace from the last assistant message's final text part.
 * Anthropic API requirement: Pre-filled assistant responses must not end with whitespace.
 */
export function trimAssistantTrailingWhitespace(messages: ModelMessage[]): ModelMessage[] {
  if (messages.length === 0) return messages;

  const result = [...messages];

  // Find and process the last assistant message
  for (let i = result.length - 1; i >= 0; i--) {
    const msg = result[i];
    if (!msg || msg.role !== 'assistant') continue;

    if (typeof msg.content === 'string') {
      const trimmed = msg.content.trimEnd();
      if (trimmed !== msg.content) {
        result[i] = { ...msg, content: trimmed };
        logger.debug('[trimAssistantTrailingWhitespace] Trimmed string content');
      }
    } else if (Array.isArray(msg.content)) {
      // Find the last text part and trim it
      const newContent = [...(msg.content as AssistantContentPart[])];
      for (let j = newContent.length - 1; j >= 0; j--) {
        const part = newContent[j];
        if (part?.type === 'text' && part.text) {
          const trimmed = part.text.trimEnd();
          if (trimmed !== part.text) {
            newContent[j] = { ...part, text: trimmed };
            result[i] = { ...msg, content: newContent };
            logger.debug('[trimAssistantTrailingWhitespace] Trimmed text part');
          }
          break;
        }
      }
    }
    break; // Only process the last assistant message
  }

  return result;
}

/**
 * Removes empty assistant messages (messages with no content or only whitespace).
 */
export function removeEmptyAssistantMessages(messages: ModelMessage[]): ModelMessage[] {
  return messages.filter((msg) => {
    if (msg.role !== 'assistant') return true;

    if (typeof msg.content === 'string') {
      return msg.content.trim().length > 0;
    }

    if (Array.isArray(msg.content)) {
      // Check if there's any meaningful content
      for (const part of msg.content as AssistantContentPart[]) {
        if (part.type === 'tool-call') return true;
        if (part.type === 'text' && part.text?.trim()) return true;
      }
      return false;
    }

    return true;
  });
}

/**
 * Ensures the first non-system message is from the user.
 * Some LLM APIs require conversations to start with a user message after system messages.
 */
export function ensureUserFirst(messages: ModelMessage[]): ModelMessage[] {
  // Find the first non-system message index
  let firstNonSystemIndex = 0;
  while (
    firstNonSystemIndex < messages.length &&
    messages[firstNonSystemIndex]?.role === 'system'
  ) {
    firstNonSystemIndex++;
  }

  // If there are no non-system messages or first non-system is already user, return as-is
  if (firstNonSystemIndex >= messages.length) return messages;

  const firstNonSystem = messages[firstNonSystemIndex];
  if (firstNonSystem?.role === 'user' || firstNonSystem?.role === 'tool') {
    // tool is effectively user in AI SDK
    return messages;
  }

  // First non-system message is assistant, need to add a placeholder user message
  logger.warn(
    '[ensureUserFirst] First non-system message is not user, adding placeholder user message'
  );

  const result = [...messages];
  result.splice(firstNonSystemIndex, 0, {
    role: 'user',
    content: 'Continue.',
  });

  return result;
}

/**
 * Main conversion entry point - converts and fixes messages for Anthropic API compliance.
 * Applies a series of transformations to ensure messages meet Anthropic's requirements.
 */
export function convertToAnthropicFormat(
  messages: ModelMessage[],
  options: ConvertOptions = {}
): ModelMessage[] {
  const { autoFix = true, trimAssistantWhitespace = true } = options;

  let result = [...messages];
  const modifications: string[] = [];

  if (autoFix) {
    // Step 1: Remove orphaned tool messages
    const beforeOrphan = result.length;
    result = removeOrphanedToolMessages(result);
    if (result.length !== beforeOrphan) {
      modifications.push('Removed orphaned tool messages');
    }

    // Step 2: Remove empty assistant messages
    const beforeEmpty = result.length;
    result = removeEmptyAssistantMessages(result);
    if (result.length !== beforeEmpty) {
      modifications.push('Removed empty assistant messages');
    }

    // Step 3: Merge consecutive assistant messages
    const beforeMerge = result.length;
    result = mergeConsecutiveAssistantMessages(result);
    if (result.length !== beforeMerge) {
      modifications.push('Merged consecutive assistant messages');
    }

    // Step 4: Ensure first non-system message is from user
    const beforeUserFirst = result.length;
    result = ensureUserFirst(result);
    if (result.length !== beforeUserFirst) {
      modifications.push('Added placeholder user message');
    }
  }

  // Step 5: Trim assistant trailing whitespace (always do this if enabled)
  if (trimAssistantWhitespace) {
    result = trimAssistantTrailingWhitespace(result);
  }

  if (modifications.length > 0) {
    logger.info('[convertToAnthropicFormat] Applied modifications:', {
      modifications,
      originalCount: messages.length,
      resultCount: result.length,
    });
  }

  return result;
}

/**
 * Validates and converts messages in a single operation.
 * Returns both the converted messages and the validation result.
 */
export function validateAndConvert(
  messages: ModelMessage[],
  options: ConvertOptions = {}
): { messages: ModelMessage[]; validation: ValidationResult } {
  // First validate the original messages
  const preValidation = validateAnthropicMessages(messages);

  // Then convert
  const converted = convertToAnthropicFormat(messages, options);

  // Validate the converted messages
  const postValidation = validateAnthropicMessages(converted);

  if (!preValidation.valid && postValidation.valid) {
    logger.info('[validateAndConvert] Conversion fixed validation issues', {
      originalIssues: preValidation.issues.length,
      fixedIssues: preValidation.issues.length - postValidation.issues.length,
    });
  }

  return {
    messages: converted,
    validation: postValidation,
  };
}
