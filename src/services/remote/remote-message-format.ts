// Remote message formatting utilities for Telegram HTML and plain text

import type { RemoteChannelId } from '@/types/remote-control';

export type MessageParseMode = 'HTML' | 'MarkdownV2' | 'plain';

interface FormatOptions {
  // Whether to normalize newlines for Telegram HTML mode (Telegram does not support <br> tags)
  convertNewlines?: boolean;
  // Maximum length for a single message (for chunking consideration)
  maxLength?: number;
}

const DEFAULT_OPTIONS: FormatOptions = {
  convertNewlines: true,
  maxLength: 4096,
};

/**
 * Escapes HTML special characters to prevent injection.
 * Note: Must be called before inserting Telegram HTML tags.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '&#039;');
}

/**
 * Converts inline markdown to HTML
 * Supports: **bold**, *italic*, `code`, [links](url)
 */
function convertInlineMarkdown(text: string): string {
  let result = text;

  // Code blocks (must be done before inline code to avoid conflicts)
  // ```language\ncode\n```
  result = result.replace(
    /```(\w+)?\n([\s\S]*?)```/g,
    (_match, _lang, code) => `<pre><code>${code.trim()}</code></pre>`
  );

  // Inline code: `code`
  result = result.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold: **text** or __text__
  result = result.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, '<b>$1$2</b>');

  // Italic: *text* or _text_ (but not ** or __)
  // Use negative lookbehind/lookahead to avoid matching ** and __
  result = result.replace(/(?<!\*)\*([^*]+)\*(?!\*)|(?<!_)_([^_]+)_(?!_)/g, '<i>$1$2</i>');

  // Strikethrough: ~~text~~
  result = result.replace(/~~([^~]+)~~/g, '<s>$1</s>');

  // Underline: __text__ (double underscore without surrounding spaces)
  // Note: This conflicts with bold, so we skip it or use a different pattern

  // Links: [text](url)
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  return result;
}

/**
 * Converts markdown lists to HTML
 * Simple implementation for bullet lists
 */
function convertLists(text: string): string {
  const lines = text.split('\n');
  return lines
    .map((line) => {
      const bulletMatch = line.match(/^\s*[-*]\s+(.+)$/);
      if (!bulletMatch?.[1]) {
        return line;
      }
      return `- ${bulletMatch[1]}`;
    })
    .join('\n');
}

/**
 * Converts headings to bold text (Telegram doesn't support h1-h6)
 * # Heading -> <b>Heading</b>
 * ## Heading -> <b>Heading</b>
 */
function convertHeadings(text: string): string {
  return text.replace(/^(#{1,6})\s+(.+)$/gm, (_, __, content) => {
    return `<b>${convertInlineMarkdown(content)}</b>`;
  });
}

/**
 * Formats text for Telegram HTML parse mode
 * Converts markdown-like syntax to Telegram-supported HTML tags
 *
 * Supported Telegram HTML tags:
 * - <b>, <strong> - bold
 * - <i>, <em> - italic
 * - <u> - underline (we don't use this to avoid conflicts)
 * - <s>, <strike>, <del> - strikethrough
 * - <code> - inline code
 * - <pre> - preformatted code block
 * - <a href="..."> - links
 */
export function formatForTelegramHtml(text: string, options?: FormatOptions): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  if (!text.trim()) {
    return '';
  }

  let result = text;

  // Escape user-provided content before applying markdown conversions
  result = escapeHtml(result);

  // Convert headings first (before inline markdown)
  result = convertHeadings(result);

  // Convert lists
  result = convertLists(result);

  // Convert inline markdown (bold, italic, code, links)
  result = convertInlineMarkdown(result);

  // Keep newlines as-is for Telegram HTML mode (Telegram does not support <br> tags).
  if (opts.convertNewlines) {
    result = result.replace(/\r\n/g, '\n');
  }

  return result.trim();
}

/**
 * Formats text for plain text mode (Feishu)
 * Strips markdown syntax for clean display
 */
export function formatForPlainText(text: string): string {
  if (!text.trim()) {
    return '';
  }

  let result = text;

  // Remove code block markers but keep content
  result = result.replace(/```(\w+)?\n/g, '');
  result = result.replace(/```/g, '');

  // Remove inline code markers
  result = result.replace(/`([^`]+)`/g, '$1');

  // Remove bold markers
  result = result.replace(/\*\*([^*]+)\*\*/g, '$1');
  result = result.replace(/__([^_]+)__/g, '$1');

  // Remove italic markers
  result = result.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '$1');
  result = result.replace(/(?<!_)_([^_]+)_(?!_)/g, '$1');

  // Remove strikethrough markers
  result = result.replace(/~~([^~]+)~~/g, '$1');

  // Convert links to text (url)
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');

  // Remove heading markers
  result = result.replace(/^#{1,6}\s+/gm, '');

  return result.trim();
}

export function getMessageFormatter(channelId: RemoteChannelId): {
  format: (text: string) => string;
  parseMode: MessageParseMode;
} {
  if (channelId === 'telegram') {
    return {
      format: formatForTelegramHtml,
      parseMode: 'HTML',
    };
  }

  // Feishu and other channels - plain text
  return {
    format: formatForPlainText,
    parseMode: 'plain',
  };
}

/**
 * Formats text based on the channel
 */
export function formatMessageForChannel(
  text: string,
  channelId: RemoteChannelId
): { text: string; parseMode: MessageParseMode } {
  const formatter = getMessageFormatter(channelId);
  return {
    text: formatter.format(text),
    parseMode: formatter.parseMode,
  };
}
