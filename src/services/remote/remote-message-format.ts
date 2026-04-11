// Remote message formatting utilities for Telegram HTML and plain text

import type { RemoteChannelId } from '@/types/remote-control';

export type MessageParseMode = 'HTML' | 'MarkdownV2' | 'plain';

interface FormatOptions {
  convertNewlines?: boolean;
  maxLength?: number;
}

const DEFAULT_OPTIONS: FormatOptions = {
  convertNewlines: true,
  maxLength: 4096,
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '&#039;');
}

function convertInlineMarkdown(text: string): string {
  let result = text;

  result = result.replace(
    /```(\w+)?\n([\s\S]*?)```/g,
    (_match, _lang, code) => `<pre><code>${code.trim()}</code></pre>`
  );
  result = result.replace(/`([^`]+)`/g, '<code>$1</code>');
  result = result.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, '<b>$1$2</b>');
  result = result.replace(/(?<!\*)\*([^*]+)\*(?!\*)|(?<!_)_([^_]+)_(?!_)/g, '<i>$1$2</i>');
  result = result.replace(/~~([^~]+)~~/g, '<s>$1</s>');
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  return result;
}

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

function convertHeadings(text: string): string {
  return text.replace(/^(#{1,6})\s+(.+)$/gm, (_, __, content) => {
    return `<b>${convertInlineMarkdown(content)}</b>`;
  });
}

export function formatForTelegramHtml(text: string, options?: FormatOptions): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  if (!text.trim()) {
    return '';
  }

  let result = text;
  result = escapeHtml(result);
  result = convertHeadings(result);
  result = convertLists(result);
  result = convertInlineMarkdown(result);

  if (opts.convertNewlines) {
    result = result.replace(/\r\n/g, '\n');
  }

  return result.trim();
}

function stripPlainMarkdown(text: string): string {
  let result = text;
  result = result.replace(/```(\w+)?\n/g, '');
  result = result.replace(/```/g, '');
  result = result.replace(/`([^`]+)`/g, '$1');
  result = result.replace(/\*\*([^*]+)\*\*/g, '$1');
  result = result.replace(/__([^_]+)__/g, '$1');
  result = result.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '$1');
  result = result.replace(/(?<!_)_([^_]+)_(?!_)/g, '$1');
  result = result.replace(/~~([^~]+)~~/g, '$1');
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');
  result = result.replace(/^#{1,6}\s+/gm, '');
  result = result.replace(/^>\s?/gm, '');
  result = result.replace(/^\|[\s:|-]+\|$/gm, '');
  result = result.replace(/^\|(.+)\|$/gm, (_, inner) =>
    inner
      .split('|')
      .map((cell: string) => cell.trim())
      .filter(Boolean)
      .join('  ')
  );
  return result.trim();
}

export function formatForPlainText(text: string): string {
  if (!text.trim()) {
    return '';
  }
  return stripPlainMarkdown(text);
}

export function formatForWechatPlainText(text: string): string {
  if (!text.trim()) {
    return '';
  }

  let result = stripPlainMarkdown(text);
  result = result.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  result = result.replace(/^[-*+]\s/gm, '• ');
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

  if (channelId === 'wechat') {
    return {
      format: formatForWechatPlainText,
      parseMode: 'plain',
    };
  }

  return {
    format: formatForPlainText,
    parseMode: 'plain',
  };
}

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
