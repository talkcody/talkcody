import { logger } from '@/lib/logger';
import {
  mergeConsecutiveAssistantMessages,
  removeOrphanedToolMessages,
} from '@/lib/message-convert';
import { validateAnthropicMessages } from '@/lib/message-validate';
import { timedMethod } from '@/lib/timer';
import { getContextLength } from '@/providers/config/model-config';
import type { Message as ModelMessage } from '@/services/llm/types';
import type {
  CompressionConfig,
  CompressionResult,
  CompressionSection,
  MessageCompactionOptions,
} from '@/types/agent';
import { aiContextCompactionService } from '../ai/ai-context-compaction';
import { estimateTokens } from '../code-navigation-service';
import { ContextFilter } from './context-filter';
import { ContextRewriter } from './context-rewriter';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  fixedMessages?: ModelMessage[];
}

export interface SelectMessagesToCompressResult {
  /** Messages to be compressed (after filtering) */
  messagesToCompress: ModelMessage[];
  /** Messages to preserve (includes system message, critical tool calls, recent messages) */
  preservedMessages: ModelMessage[];
  /** Original system message if present */
  originalSystemMessage: ModelMessage | null;
}

export class ContextCompactor {
  private readonly MAX_SUMMARY_LENGTH = 8000; // Max chars for condensed summary
  private readonly PRESERVE_TOOL_NAMES = ['exitPlanMode', 'todoWrite'];
  private messageFilter: ContextFilter;
  private messageRewriter: ContextRewriter;
  private compressionStats = {
    totalCompressions: 0,
    totalTimeSaved: 0,
    averageCompressionRatio: 0,
  };

  constructor() {
    this.messageFilter = new ContextFilter();
    this.messageRewriter = new ContextRewriter();
  }

  /**
   * Adjusts the preserve boundary to avoid cutting tool-call/tool-result pairs.
   * Scans backwards from the cut point to include any tool-calls that have
   * matching tool-results in the preserved section.
   */
  private adjustPreserveBoundary(messages: ModelMessage[], preserveCount: number): number {
    const cutIndex = messages.length - preserveCount;

    if (cutIndex <= 0) return preserveCount;

    // Collect tool-result IDs from preserved messages
    const preservedToolResultIds = new Set<string>();
    for (let i = cutIndex; i < messages.length; i++) {
      const msg = messages[i];
      if (!msg) continue;
      if (msg.role === 'tool' && Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (
            typeof part === 'object' &&
            part !== null &&
            'type' in part &&
            part.type === 'tool-result' &&
            'toolCallId' in part
          ) {
            preservedToolResultIds.add(part.toolCallId as string);
          }
        }
      }
    }

    if (preservedToolResultIds.size === 0) {
      return preserveCount; // No tool results in preserved section
    }

    // Scan backwards to find tool-calls that match preserved tool-results
    let adjustedCutIndex = cutIndex;
    for (let i = cutIndex - 1; i >= 0; i--) {
      const msg = messages[i];
      if (!msg) continue;
      if (msg.role === 'assistant' && Array.isArray(msg.content)) {
        let hasMatchingToolCall = false;
        for (const part of msg.content) {
          if (
            typeof part === 'object' &&
            part !== null &&
            'type' in part &&
            part.type === 'tool-call' &&
            'toolCallId' in part &&
            preservedToolResultIds.has(part.toolCallId as string)
          ) {
            hasMatchingToolCall = true;
            break;
          }
        }
        if (hasMatchingToolCall) {
          adjustedCutIndex = i;
          // Continue scanning - there might be more matching calls earlier
        }
      }
    }

    const adjustedPreserveCount = messages.length - adjustedCutIndex;

    if (adjustedPreserveCount !== preserveCount) {
      logger.info('Adjusted preserve boundary to avoid orphaned tool messages', {
        originalPreserveCount: preserveCount,
        adjustedPreserveCount,
        reason: 'tool-call/tool-result pairing',
      });
    }

    return adjustedPreserveCount;
  }

  /**
   * Extracts the last occurrence of specified tool calls from messages.
   * Returns remaining messages and extracted messages (with their tool-results).
   */
  private extractLastToolCalls(
    messages: ModelMessage[],
    toolNames: string[]
  ): { remaining: ModelMessage[]; extracted: ModelMessage[] } {
    const toolNamesToFind = new Set(toolNames);
    const foundToolCallIds = new Map<string, string>(); // toolName -> toolCallId

    // Scan backwards to find the last occurrence of each tool
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (!msg || msg.role !== 'assistant' || !Array.isArray(msg.content)) continue;

      for (const part of msg.content) {
        if (
          typeof part === 'object' &&
          part !== null &&
          'type' in part &&
          part.type === 'tool-call' &&
          'toolName' in part &&
          'toolCallId' in part
        ) {
          const toolName = part.toolName as string;
          if (toolNamesToFind.has(toolName) && !foundToolCallIds.has(toolName)) {
            foundToolCallIds.set(toolName, part.toolCallId as string);
          }
        }
      }

      // Stop early if we found all tools
      if (foundToolCallIds.size === toolNamesToFind.size) break;
    }

    if (foundToolCallIds.size === 0) {
      return { remaining: messages, extracted: [] };
    }

    const toolCallIdsToExtract = new Set(foundToolCallIds.values());
    const extracted: ModelMessage[] = [];
    const remaining: ModelMessage[] = [];

    for (const msg of messages) {
      if (msg.role === 'assistant' && Array.isArray(msg.content)) {
        const extractedParts: typeof msg.content = [];
        const remainingParts: typeof msg.content = [];

        for (const part of msg.content) {
          if (
            typeof part === 'object' &&
            part !== null &&
            'type' in part &&
            part.type === 'tool-call' &&
            'toolCallId' in part &&
            toolCallIdsToExtract.has(part.toolCallId as string)
          ) {
            extractedParts.push(part);
          } else {
            remainingParts.push(part);
          }
        }

        if (extractedParts.length > 0) {
          extracted.push({ ...msg, content: extractedParts });
        }
        if (remainingParts.length > 0) {
          remaining.push({ ...msg, content: remainingParts });
        }
      } else if (msg.role === 'tool' && Array.isArray(msg.content)) {
        const extractedParts: typeof msg.content = [];
        const remainingParts: typeof msg.content = [];

        for (const part of msg.content) {
          if (
            typeof part === 'object' &&
            part !== null &&
            'type' in part &&
            part.type === 'tool-result' &&
            'toolCallId' in part &&
            toolCallIdsToExtract.has(part.toolCallId as string)
          ) {
            extractedParts.push(part);
          } else {
            remainingParts.push(part);
          }
        }

        if (extractedParts.length > 0) {
          extracted.push({ ...msg, content: extractedParts });
        }
        if (remainingParts.length > 0) {
          remaining.push({ ...msg, content: remainingParts });
        }
      } else {
        remaining.push(msg);
      }
    }

    if (extracted.length > 0) {
      logger.info('Extracted critical tool calls for preservation', {
        toolNames: [...foundToolCallIds.keys()],
        extractedMessageCount: extracted.length,
      });
    }

    return { remaining, extracted };
  }

  /**
   * Selects which messages should be compressed and which should be preserved.
   * This method handles:
   * 1. Extracting and preserving the system message
   * 2. Adjusting preserve boundary to avoid cutting tool-call/tool-result pairs
   * 3. Extracting critical tool calls (exitPlanMode, todoWrite) for preservation
   * 4. Applying message filter to remove duplicate file reads and outdated exploratory tools
   */
  public selectMessagesToCompress(
    messages: ModelMessage[],
    preserveRecentMessages: number
  ): SelectMessagesToCompressResult {
    // Step 1: Extract and preserve the original system message (systemPrompt)
    // The first message is typically the system prompt, which should never be compressed
    let originalSystemMessage: ModelMessage | null = null;
    let messagesToProcess = messages;

    if (messages[0]?.role === 'system') {
      originalSystemMessage = messages[0];
      messagesToProcess = messages.slice(1);
    }

    // Determine which messages to compress and which to preserve
    // Use adjusted boundary to avoid cutting tool-call/tool-result pairs
    const initialPreserveCount = Math.min(preserveRecentMessages, messagesToProcess.length);
    const preserveCount = this.adjustPreserveBoundary(messagesToProcess, initialPreserveCount);
    const recentPreservedMessages = messagesToProcess.slice(-preserveCount);
    let messagesToCompress = messagesToProcess.slice(0, messagesToProcess.length - preserveCount);

    // Extract critical tool calls (exitPlanMode, todoWrite) for preservation
    const { remaining: afterExtraction, extracted: criticalToolMessages } =
      this.extractLastToolCalls(messagesToCompress, this.PRESERVE_TOOL_NAMES);
    messagesToCompress = afterExtraction;

    // Apply message filter to remove duplicate file reads and outdated exploratory tools
    messagesToCompress = this.messageFilter.filterMessages(messagesToCompress);

    // Combine extracted critical tool messages with recent preserved messages
    let preservedMessages = [...criticalToolMessages, ...recentPreservedMessages];

    // Prepend the original system message to preserved messages
    if (originalSystemMessage) {
      preservedMessages = [originalSystemMessage, ...preservedMessages];
    }

    return {
      messagesToCompress,
      preservedMessages,
      originalSystemMessage,
    };
  }

  @timedMethod('MessageCompactor.compactMessages')
  public async compactMessages(
    options: MessageCompactionOptions,
    lastTokenCount: number, // Original token count for early-exit check
    abortController?: AbortController
  ): Promise<CompressionResult> {
    const { messages, config } = options;

    logger.info('Starting message compaction', {
      originalMessageCount: messages.length,
      preserveRecentMessages: config.preserveRecentMessages,
    });

    // Use selectMessagesToCompress to determine which messages to compress and preserve
    let { messagesToCompress, preservedMessages } = this.selectMessagesToCompress(
      messages,
      config.preserveRecentMessages
    );

    // Apply tree-sitter based code summarization to reduce token usage
    // This rewrites large file contents (>100 lines) to only include signatures and key definitions
    try {
      messagesToCompress = await this.messageRewriter.rewriteMessages(messagesToCompress);
      logger.info('Applied message rewriting for code summarization');
    } catch (error) {
      logger.error('Failed to apply message rewriting, continuing with original messages:', error);
    }

    if (messagesToCompress.length === 0) {
      logger.info('No messages to compress, returning original/preserved messages');
      return {
        compressedSummary: '',
        sections: [],
        preservedMessages: preservedMessages.length > 0 ? preservedMessages : messages,
        originalMessageCount: messages.length,
        compressedMessageCount:
          preservedMessages.length > 0 ? preservedMessages.length : messages.length,
        compressionRatio:
          preservedMessages.length > 0 ? preservedMessages.length / messages.length : 1.0,
      };
    }

    // Convert messages to text for compression
    const conversationHistory = this.messagesToText(messagesToCompress);

    // Estimate tokens if needed (used for early-exit optimization and compression ratio calculation)
    let estimatedTokens: number | undefined;

    // Check if tree-sitter rewriting has reduced tokens enough to skip AI compression
    // If reduction >= 75%, we can skip the expensive AI compression step
    // Only estimate tokens if we have a lastTokenCount to compare against
    if (lastTokenCount && lastTokenCount > 0) {
      try {
        estimatedTokens = await estimateTokens(conversationHistory);
      } catch (error) {
        logger.warn('Failed to estimate tokens:', error);
      }

      if (estimatedTokens !== undefined) {
        const reductionRatio = 1 - estimatedTokens / lastTokenCount;

        if (reductionRatio >= 0.75) {
          logger.info(
            `Token reduction ${(reductionRatio * 100).toFixed(1)}% >= 75%, skipping AI compression`,
            {
              originalTokens: lastTokenCount,
              estimatedTokens,
              reductionRatio,
            }
          );

          // Return early without AI compression
          return {
            compressedSummary: '',
            sections: [],
            preservedMessages: [...messagesToCompress, ...preservedMessages],
            originalMessageCount: messages.length,
            compressedMessageCount: messagesToCompress.length + preservedMessages.length,
            compressionRatio: estimatedTokens / lastTokenCount,
          };
        }

        logger.info(
          `Token reduction ${(reductionRatio * 100).toFixed(1)}% < 75%, proceeding with AI compression`,
          {
            originalTokens: lastTokenCount,
            estimatedTokens,
            reductionRatio,
          }
        );
      }
    }

    // Perform compression using the configured model
    let compressedSummary = '';
    try {
      compressedSummary = await aiContextCompactionService.compactContext(
        conversationHistory,
        config.compressionModel,
        config.compressionFallbackModels
      );
    } catch (error) {
      logger.warn('AI compression failed, falling back to tree-sitter rewriting:', error);
      return {
        compressedSummary: '',
        sections: [],
        preservedMessages: [...messagesToCompress, ...preservedMessages],
        originalMessageCount: messages.length,
        compressedMessageCount: messagesToCompress.length + preservedMessages.length,
        compressionRatio:
          estimatedTokens && lastTokenCount ? estimatedTokens / lastTokenCount : 1.0,
      };
    }

    // Parse sections from the compressed summary
    const sections = this.parseSections(compressedSummary);

    // Create the final result
    const result: CompressionResult = {
      compressedSummary,
      sections,
      preservedMessages,
      originalMessageCount: messages.length,
      compressedMessageCount: 1 + preservedMessages.length, // 1 for summary + preserved
      compressionRatio: (1 + preservedMessages.length) / messages.length,
    };

    // Update statistics
    this.updateStats(result);

    logger.info('Message compaction completed', {
      originalCount: result.originalMessageCount,
      compressedCount: result.compressedMessageCount,
      ratio: result.compressionRatio,
    });

    return result;
  }

  private messagesToText(messages: ModelMessage[]): string {
    return messages
      .map((msg) => {
        const role = msg.role.toUpperCase();
        let content = '';

        if (typeof msg.content === 'string') {
          content = msg.content;
        } else if (Array.isArray(msg.content)) {
          content = msg.content
            .map(
              (part: {
                type: string;
                text?: string;
                value?: string;
                toolName?: string;
                input?: unknown;
                output?: unknown;
              }) => {
                if (part.type === 'text') {
                  return part.text || part.value || '';
                } else if (part.type === 'tool-call') {
                  return `[TOOL CALL: ${part.toolName}(${JSON.stringify(part.input)})]`;
                } else if (part.type === 'tool-result') {
                  return `[TOOL RESULT: ${part.toolName} -> ${JSON.stringify(part.output)}]`;
                }
                return '';
              }
            )
            .join('\n');
        }

        return `${role}: ${content}`;
      })
      .join('\n\n');
  }

  private parseSections(compressedSummary: string): CompressionSection[] {
    const sections: CompressionSection[] = [];

    try {
      // Try to extract analysis section first
      const analysisMatch = compressedSummary.match(/<analysis>([\s\S]*?)<\/analysis>/);
      if (analysisMatch?.[1]) {
        sections.push({
          title: 'Analysis',
          content: analysisMatch[1].trim(),
        });
      }

      // Extract numbered sections with more robust pattern matching
      // Support various formats: "1. Title:", "1) Title:", "1 - Title:", etc.
      const sectionPatterns = [
        /(\d+)\.\s+([^:\n]+):([\s\S]*?)(?=\n\d+\.|$)/g, // "1. Title: content"
        /(\d+)\)\s+([^:\n]+):([\s\S]*?)(?=\n\d+\)|$)/g, // "1) Title: content"
        /(\d+)\s+-\s+([^:\n]+):([\s\S]*?)(?=\n\d+\s+-|$)/g, // "1 - Title: content"
        /(\d+)\.\s+([^\n]+)\n([\s\S]*?)(?=\n\d+\.|$)/g, // "1. Title\ncontent"
      ];

      let matched = false;
      for (const pattern of sectionPatterns) {
        pattern.lastIndex = 0; // Reset regex state
        const matches = [...compressedSummary.matchAll(pattern)];

        if (matches.length > 0) {
          for (const match of matches) {
            const sectionNumber = match[1];
            const title = match[2];
            const content = match[3];
            if (!sectionNumber || !title) continue;

            sections.push({
              title: `${sectionNumber}. ${title.trim()}`,
              content: (content || '').trim() || 'No content provided',
            });
          }
          matched = true;
          break; // Use first pattern that matches
        }
      }

      // Fallback: if no structured sections found, treat entire summary as one section
      if (!matched && compressedSummary.trim()) {
        logger.warn('Could not parse structured sections, using full summary');
        sections.push({
          title: 'Summary',
          content: compressedSummary.replace(/<analysis>[\s\S]*?<\/analysis>/, '').trim(),
        });
      }
    } catch (error) {
      logger.error('Error parsing compression sections', error);
      // Return the full summary as a fallback
      sections.push({
        title: 'Summary',
        content: compressedSummary,
      });
    }

    return sections;
  }

  public shouldCompress(
    _messages: ModelMessage[],
    config: CompressionConfig,
    lastTokenCount: number,
    currentModel: string
  ): boolean {
    if (!config.enabled) {
      return false;
    }

    // Use actual token count from last AI request if available
    if (!lastTokenCount) {
      // logger.info('No token count available, skipping compression check');
      return false;
    }

    // logger.info('Actual token count for messages', { lastTokenCount });
    const maxContextTokens = currentModel ? getContextLength(currentModel) : 200000;
    // logger.info('Max context tokens for model', { currentModel, maxContextTokens });
    const thresholdTokens = maxContextTokens * config.compressionThreshold;

    if (lastTokenCount > thresholdTokens) {
      logger.info('Compression triggered by token count', {
        actualTokens: lastTokenCount,
        threshold: thresholdTokens,
        model: currentModel,
        maxContextTokens,
        ratio: lastTokenCount / maxContextTokens,
      });
      return true;
    }

    return false;
  }

  /**
   * Validates compressed messages to ensure no orphaned tool-calls or tool-results.
   * Returns validation result with optional auto-fixed messages.
   * Delegates to message-validate module for validation.
   */
  public validateCompressedMessages(messages: ModelMessage[]): ValidationResult {
    // Use the new validation module
    const anthropicValidation = validateAnthropicMessages(messages);

    if (anthropicValidation.valid) {
      return { valid: true, errors: [] };
    }

    // Convert validation issues to error strings for backward compatibility
    const errors = anthropicValidation.issues.map((issue) => issue.message);

    // Try to fix using the new conversion module
    const fixedMessages = this.fixOrphanedMessages(messages);

    logger.warn('Compressed messages validation failed', { errors });

    return { valid: false, errors, fixedMessages };
  }

  /**
   * Removes orphaned tool messages and fixes consecutive assistant messages.
   * Delegates to message-convert module for fixing.
   */
  private fixOrphanedMessages(messages: ModelMessage[]): ModelMessage[] {
    // Step 1: Remove orphaned tool messages
    let result = removeOrphanedToolMessages(messages);

    // Step 2: Merge consecutive assistant messages
    result = mergeConsecutiveAssistantMessages(result);

    return result;
  }

  /**
   * Condenses a previous summary to avoid unbounded growth.
   * Extracts key sections and limits total length.
   */
  private condensePreviousSummary(summary: string): string {
    if (summary.length <= this.MAX_SUMMARY_LENGTH) {
      return summary;
    }

    // Try to extract key sections
    const importantSections = ['Pending Tasks', 'Current Work', 'Errors and fixes'];
    let condensed = '';

    for (const section of importantSections) {
      const pattern = new RegExp(`\\d+\\.\\s*${section}[:\\s]([\\s\\S]*?)(?=\\n\\d+\\.|$)`, 'i');
      const match = summary.match(pattern);
      if (match?.[1]) {
        const sectionContent = match[1].trim().slice(0, 500);
        condensed += `${section}: ${sectionContent}\n\n`;
      }
    }

    if (condensed.length > 0) {
      logger.info('Condensed previous summary', {
        originalLength: summary.length,
        condensedLength: condensed.length,
      });
      return condensed;
    }

    // Fallback: truncate with ellipsis
    return `${summary.slice(0, this.MAX_SUMMARY_LENGTH)}...`;
  }

  public createCompressedMessages(result: CompressionResult): ModelMessage[] {
    const compressedMessages: ModelMessage[] = [];
    let startIndex = 0;

    // Step 1: Preserve the original system message (systemPrompt) if it exists
    const firstPreserved = result.preservedMessages[0];
    if (firstPreserved?.role === 'system') {
      // Check if this is the original systemPrompt (not a previous summary)
      const isOriginalSystemPrompt =
        typeof firstPreserved.content === 'string' &&
        !firstPreserved.content.includes('[Previous conversation summary]');

      if (isOriginalSystemPrompt) {
        compressedMessages.push(firstPreserved);
        startIndex = 1;
      }
    }

    // Step 2: If we have a compressed summary, add it as a user message
    if (result.compressedSummary) {
      // Check if there's an old summary (from previous compression) that needs condensing
      let summaryContent = result.compressedSummary;

      // Look for any old system summary messages that should be condensed
      for (let i = startIndex; i < result.preservedMessages.length; i++) {
        const msg = result.preservedMessages[i];
        if (
          msg?.role === 'system' &&
          typeof msg.content === 'string' &&
          msg.content.includes('[Previous conversation summary]')
        ) {
          // Condense the old summary and include it
          const condensedPrevious = this.condensePreviousSummary(msg.content);
          summaryContent = `${result.compressedSummary}\n\n---\nEarlier context (condensed):\n${condensedPrevious}`;
          break;
        }
      }

      // Add summary as user message (critical for LLM APIs that require user messages)
      compressedMessages.push({
        role: 'user',
        content: `[Previous conversation summary]\n\n${summaryContent}\n\nPlease continue from where we left off.`,
      });

      // Add assistant acknowledgment to maintain message alternation
      compressedMessages.push({
        role: 'assistant',
        content: 'I understand the previous context. Continuing with the task.',
      });
    }

    // Step 3: Add remaining preserved messages (skip system messages that are summaries)
    for (let i = startIndex; i < result.preservedMessages.length; i++) {
      const msg = result.preservedMessages[i];
      if (!msg) continue;

      // Skip old system summaries (they've been condensed above)
      if (
        msg.role === 'system' &&
        typeof msg.content === 'string' &&
        msg.content.includes('[Previous conversation summary]')
      ) {
        continue;
      }

      compressedMessages.push(msg);
    }

    logger.info('Created compressed messages', {
      totalMessages: compressedMessages.length,
      hasSystemPrompt: startIndex === 1,
      hasSummary: !!result.compressedSummary,
    });

    return compressedMessages;
  }

  public getCompressionStats() {
    return { ...this.compressionStats };
  }

  /**
   * Performs full compression workflow: check, compress, validate, and convert.
   * Returns the compressed messages or null if compression is not needed or fails.
   */
  public async performCompressionIfNeeded(
    messages: ModelMessage[],
    config: CompressionConfig,
    lastTokenCount: number,
    currentModel: string,
    systemPrompt: string,
    abortController?: AbortController,
    onStatus?: (status: string) => void
  ): Promise<{ messages: ModelMessage[]; result: CompressionResult } | null> {
    // Check if compression is needed
    if (!this.shouldCompress(messages, config, lastTokenCount, currentModel)) {
      return null;
    }

    logger.info('Starting message compression', {
      messageCount: messages.length,
      config,
    });

    onStatus?.('Compacting messages...');

    const compressionResult = await this.compactMessages(
      {
        messages,
        config,
        systemPrompt,
      },
      lastTokenCount, // Pass for early-exit token check
      abortController
    );

    // Create compressed messages
    const compressedMessages = this.createCompressedMessages(compressionResult);

    // Validate compressed messages to catch orphaned tool-calls/results
    const validation = this.validateCompressedMessages(compressedMessages);

    let finalMessages: ModelMessage[];

    if (!validation.valid) {
      logger.warn('Compressed messages validation failed', {
        errors: validation.errors,
      });

      if (validation.fixedMessages) {
        finalMessages = validation.fixedMessages;
        logger.info('Applied auto-fix for compressed messages', {
          originalCount: compressedMessages.length,
          fixedCount: finalMessages.length,
        });
      } else {
        finalMessages = compressedMessages;
        logger.warn('No auto-fix available, using compressed messages as-is');
      }
    } else {
      finalMessages = compressedMessages;
    }

    logger.info('Message compression completed', {
      originalCount: compressionResult.originalMessageCount,
      compressedCount: compressionResult.compressedMessageCount,
      ratio: compressionResult.compressionRatio,
      validationPassed: validation.valid,
    });

    return { messages: finalMessages, result: compressionResult };
  }

  private updateStats(result: CompressionResult): void {
    this.compressionStats.totalCompressions++;

    // Update average compression ratio
    const currentAvg = this.compressionStats.averageCompressionRatio;
    const newRatio = result.compressionRatio;
    this.compressionStats.averageCompressionRatio =
      (currentAvg * (this.compressionStats.totalCompressions - 1) + newRatio) /
      this.compressionStats.totalCompressions;
  }
}
