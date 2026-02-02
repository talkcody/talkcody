import { z } from 'zod';
import { logger } from '@/lib/logger';
import { parseModelIdentifier } from '@/providers/core/provider-utils';
import type { Message as ModelMessage, ProviderOptions } from '@/services/llm/types';
import type { ConvertMessagesOptions, ToolMessageContent, UIMessage } from '@/types/agent';

const MAX_LINES = 2000;

// Schema for validating ModelMessage array
const textPartSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
});

const imagePartSchema = z.object({
  type: z.literal('image'),
  image: z.string(),
});

const toolCallPartSchema = z.object({
  type: z.literal('tool-call'),
  toolCallId: z.string(),
  toolName: z.string(),
  input: z.unknown(),
});

const toolResultPartSchema = z.object({
  type: z.literal('tool-result'),
  toolCallId: z.string(),
  toolName: z.string(),
  output: z.unknown(),
});

const systemMessageSchema = z.object({
  role: z.literal('system'),
  content: z.string(),
  providerOptions: z.unknown().optional(),
});

const userMessageSchema = z.object({
  role: z.literal('user'),
  content: z.union([z.string(), z.array(z.union([textPartSchema, imagePartSchema]))]),
  providerOptions: z.unknown().optional(),
});

const assistantMessageSchema = z.object({
  role: z.literal('assistant'),
  content: z.union([z.string(), z.array(z.union([textPartSchema, toolCallPartSchema]))]),
  providerOptions: z.unknown().optional(),
});

const toolMessageSchema = z.object({
  role: z.literal('tool'),
  content: z.array(toolResultPartSchema),
  providerOptions: z.unknown().optional(),
});

const modelMessageSchema = z.union([
  systemMessageSchema,
  userMessageSchema,
  assistantMessageSchema,
  toolMessageSchema,
]);

// Schema with semantic validation for tool-call/tool-result pairing and consecutive message checks
export const modelMessagesSchema = z.array(modelMessageSchema).superRefine((messages, ctx) => {
  // Collect all tool-call and tool-result toolCallIds
  const toolCallIds = new Set<string>();
  const toolResultIds = new Set<string>();

  let prevRole: string | null = null;
  let prevIndex = -1;

  for (const [i, msg] of messages.entries()) {
    // Check for consecutive assistant messages (not allowed by OpenRouter/Claude API)
    if (msg.role === 'assistant' && prevRole === 'assistant') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Consecutive assistant messages at index ${prevIndex} and ${i}. OpenRouter/Claude API doesn't allow consecutive assistant messages.`,
        path: [i],
      });
    }
    prevRole = msg.role;
    prevIndex = i;

    // Check assistant messages for tool-calls
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (typeof part === 'object' && 'type' in part && part.type === 'tool-call') {
          toolCallIds.add((part as { toolCallId: string }).toolCallId);
        }
      }
    }

    // Check tool messages for tool-results
    if (msg.role === 'tool' && Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (typeof part === 'object' && 'type' in part && part.type === 'tool-result') {
          toolResultIds.add((part as { toolCallId: string }).toolCallId);
        }
      }
    }
  }

  // Check for orphaned tool-calls (tool-call without tool-result)
  for (const toolCallId of toolCallIds) {
    if (!toolResultIds.has(toolCallId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Orphaned tool-call: toolCallId "${toolCallId}" has no corresponding tool-result`,
      });
    }
  }

  // Check for orphaned tool-results (tool-result without tool-call)
  for (const toolResultId of toolResultIds) {
    if (!toolCallIds.has(toolResultId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Orphaned tool-result: toolCallId "${toolResultId}" has no corresponding tool-call`,
      });
    }
  }
});

function isContentTooLong(content: string | undefined): { tooLong: boolean; lineCount: number } {
  const lineCount = content?.split('\n').length ?? 0;
  return { tooLong: lineCount > MAX_LINES, lineCount };
}

export function formatReasoningText(text: string, isFirstReasoning: boolean): string {
  let lines = '';
  if (isFirstReasoning) {
    lines = '> Reasoning:\n> \n';
    lines += '> ';
  }
  lines += text.replace(/\n/g, '\n> ');
  return lines;
}

export async function convertMessages(
  messages: UIMessage[],
  options: ConvertMessagesOptions
): Promise<ModelMessage[]> {
  const convertedMessages: ModelMessage[] = [];

  // Pre-scan to collect all tool-result toolCallIds for orphan detection
  // This is used to skip orphaned tool-calls (those without corresponding tool-results)
  // which can happen when tool execution is interrupted
  const toolResultIds = new Set<string>();
  for (const msg of messages) {
    if (msg.role === 'tool') {
      const toolContent = Array.isArray(msg.content) ? msg.content[0] : null;
      if (toolContent?.type === 'tool-result' && toolContent.toolCallId) {
        toolResultIds.add(toolContent.toolCallId);
      }
    }
  }

  // Only add system message if systemPrompt is provided
  if (options.systemPrompt) {
    // Add Claude Code identity prefix for Anthropic provider
    if (options.providerId === 'anthropic') {
      convertedMessages.push({
        role: 'system' as const,
        content: `You are Claude Code, Anthropic's official CLI for Claude.`,
      });
    }

    convertedMessages.push({
      role: 'system' as const,
      content: options.systemPrompt,
      providerOptions: {
        anthropic: { cacheControl: { type: 'ephemeral' } },
      },
    });
  }

  for (const msg of messages) {
    // Handle tool messages
    if (msg.role === 'tool') {
      const toolContent =
        Array.isArray(msg.content) && msg.content.length > 0
          ? (msg.content[0] as ToolMessageContent)
          : null;

      if (!toolContent) {
        continue;
      }

      const toolName = toolContent.toolName || msg.toolName;
      if (toolContent.type === 'tool-call') {
        // Skip orphaned tool-calls (no corresponding tool-result)
        // This happens when tool execution was interrupted
        if (!toolResultIds.has(toolContent.toolCallId)) {
          logger.warn(
            `[convertMessages] Skipping orphaned tool-call: ${toolContent.toolName} (${toolContent.toolCallId})`
          );
          continue;
        }

        // tool-call should be in assistant message format
        const toolCallPart: {
          type: 'tool-call';
          toolCallId: string;
          toolName: string;
          input: unknown;
          providerMetadata?: ProviderOptions;
        } = {
          type: 'tool-call' as const,
          toolCallId: toolContent.toolCallId,
          toolName: toolContent.toolName,
          input: toolContent.input || {},
        };
        // Include providerMetadata if present (for Gemini 3 models with thoughtSignature)
        if (toolContent.providerMetadata) {
          toolCallPart.providerMetadata = toolContent.providerMetadata;
        }
        convertedMessages.push({
          role: 'assistant' as const,
          content: [toolCallPart],
        });
      } else if (toolContent.type === 'tool-result') {
        // Handle undefined or null output
        let outputValue: string;
        if (toolContent.output === undefined || toolContent.output === null) {
          outputValue = '';
        } else if (typeof toolContent.output === 'string') {
          outputValue = toolContent.output;
        } else {
          outputValue = JSON.stringify(toolContent.output);
        }

        // Add the tool-result
        convertedMessages.push({
          role: 'tool' as const,
          content: [
            {
              type: 'tool-result',
              toolCallId: toolContent.toolCallId,
              toolName: toolContent.toolName || toolName || 'unknown',
              output: {
                type: 'text' as const,
                value: outputValue,
              },
            },
          ],
        });
      }
      continue;
    }

    // Handle user and assistant messages with string content
    const contentStr = typeof msg.content === 'string' ? msg.content : '';

    if (msg.attachments && msg.attachments.length > 0) {
      const content: Array<{ type: 'text'; text: string } | { type: 'image'; image: string }> = [];

      if (contentStr.trim()) {
        content.push({
          type: 'text' as const,
          text: contentStr,
        });
      }

      const modelKey = options.model ? parseModelIdentifier(options.model).modelKey : undefined;
      logger.info('[convertMessages] Processing attachments for model:', { modelKey });

      for (const attachment of msg.attachments) {
        if (attachment.type === 'image' && attachment.content) {
          if (modelKey === 'glm-4.6' || modelKey === 'glm-4.7') {
            const filePath = attachment.filePath ?? attachment.filename;
            content.push({
              type: 'text' as const,
              text: `The image file path is ${filePath}`,
            });
          } else {
            content.push({
              type: 'image' as const,
              image: attachment.content,
            });
          }
        } else if (attachment.type === 'file' || attachment.type === 'code') {
          const { tooLong, lineCount } = isContentTooLong(attachment.content);
          const filePath = attachment.filePath ?? attachment.filename;

          if (tooLong) {
            content.push({
              type: 'text' as const,
              text: `The file path is ${filePath}.\nThe file name is ${attachment.filename}.\nThis file is too long (${lineCount} lines), please use the code search tool and read file tool to read the file content you really need.`,
            });
          } else {
            content.push({
              type: 'text' as const,
              text: `The file path is ${filePath}.\nThe file name is ${attachment.filename}.\nThe content in ${attachment.filename} is:\n<code>\n${attachment.content}\n</code>`,
            });
          }
        }
      }

      // Only user messages should have attachments with mixed content
      convertedMessages.push({
        role: 'user' as const,
        content,
      });
    } else {
      // For messages without attachments, use string content
      if (msg.role === 'user' || msg.role === 'assistant') {
        // Skip assistant messages with empty or whitespace-only content
        if (msg.role === 'assistant' && !contentStr.trim()) {
          continue;
        }
        convertedMessages.push({
          role: msg.role,
          content: contentStr,
        });
      }
    }
  }

  // Merge consecutive assistant messages (OpenRouter/Claude API doesn't allow consecutive assistant messages)
  const mergedMessages: ModelMessage[] = [];
  for (const msg of convertedMessages) {
    const lastMsg = mergedMessages[mergedMessages.length - 1];

    // Check if we need to merge with previous assistant message
    if (msg.role === 'assistant' && lastMsg?.role === 'assistant') {
      // Merge content arrays
      const lastContent = Array.isArray(lastMsg.content)
        ? lastMsg.content
        : lastMsg.content
          ? [{ type: 'text' as const, text: lastMsg.content }]
          : [];
      const currentContent = Array.isArray(msg.content)
        ? msg.content
        : msg.content
          ? [{ type: 'text' as const, text: msg.content }]
          : [];

      // Combine content - filter out empty text parts
      const combinedContent = [...lastContent, ...currentContent].filter(
        (part) => !(part.type === 'text' && !part.text?.trim())
      );

      if (combinedContent.length > 0) {
        lastMsg.content = combinedContent;
      }

      logger.info('[convertMessages] Merged consecutive assistant messages', {
        lastContentLength: lastContent.length,
        currentContentLength: currentContent.length,
        combinedLength: combinedContent.length,
      });
    } else {
      mergedMessages.push(msg);
    }
  }

  // Validate converted messages (includes semantic validation for tool-call/tool-result pairing)
  const validationResult = modelMessagesSchema.safeParse(mergedMessages);

  if (!validationResult.success) {
    logger.error('[convertMessages] Validation failed:', validationResult.error);
    throw new Error(`Invalid messages format: ${validationResult.error.message}`);
  }

  return mergedMessages;
}
