import { describe, expect, it } from 'vitest';
import {
  formatForTelegramHtml,
  formatForPlainText,
  formatMessageForChannel,
  getMessageFormatter,
  type MessageParseMode,
} from '@/services/remote/remote-message-format';

describe('remote-message-format', () => {
  describe('formatForTelegramHtml', () => {
    it('converts bold text', () => {
      const input = 'This is **bold** text';
      const result = formatForTelegramHtml(input);
      expect(result).toBe('This is <b>bold</b> text');
    });

    it('converts italic text', () => {
      const input = 'This is *italic* text';
      const result = formatForTelegramHtml(input);
      expect(result).toBe('This is <i>italic</i> text');
    });

    it('converts strikethrough text', () => {
      const input = 'This is ~~strikethrough~~ text';
      const result = formatForTelegramHtml(input);
      expect(result).toBe('This is <s>strikethrough</s> text');
    });

    it('converts inline code', () => {
      const input = 'Use `console.log()` for debugging';
      const result = formatForTelegramHtml(input);
      expect(result).toBe('Use <code>console.log()</code> for debugging');
    });

    it('converts code blocks', () => {
      const input = '```javascript\nconst x = 1;\n```';
      const result = formatForTelegramHtml(input);
      expect(result).toBe('<pre><code>const x = 1;</code></pre>');
    });

    it('converts links', () => {
      const input = 'Check out [GitHub](https://github.com)';
      const result = formatForTelegramHtml(input);
      expect(result).toBe('Check out <a href="https://github.com">GitHub</a>');
    });

    it('converts headings to bold', () => {
      const input = '# Heading 1\n## Heading 2';
      const result = formatForTelegramHtml(input);
      expect(result).toContain('<b>Heading 1</b>');
      expect(result).toContain('<b>Heading 2</b>');
    });

    it('converts bullet lists', () => {
      const input = '- Item 1\n- Item 2\n- Item 3';
      const result = formatForTelegramHtml(input);
      expect(result).toContain('- Item 1');
      expect(result).toContain('- Item 2');
      expect(result).toContain('- Item 3');
      // Telegram does not support <br>, keep newlines as-is
      expect(result).toContain('\n');
    });

    it('keeps newlines as-is (Telegram does not support br tags)', () => {
      const input = 'Line 1\nLine 2\nLine 3';
      const result = formatForTelegramHtml(input);
      expect(result).toBe('Line 1\nLine 2\nLine 3');
    });

    it('escapes HTML special characters', () => {
      const input = 'Use <div> tags & "quotes" and \'apostrophes\'';
      const result = formatForTelegramHtml(input);
      expect(result).toContain('<');
      expect(result).toContain('>');
      expect(result).toContain('&');
      expect(result).toContain('"');
      expect(result).toContain('&#039;');
    });

    it('preserves newlines inside code blocks', () => {
      const input = '```\nline1\nline2\nline3\n```';
      const result = formatForTelegramHtml(input);
      // Code blocks should preserve their content
      expect(result).toContain('<pre><code>');
      expect(result).toContain('</code></pre>');
      expect(result).toContain('\n');
    });

    it('handles empty input', () => {
      expect(formatForTelegramHtml('')).toBe('');
      expect(formatForTelegramHtml('   ')).toBe('');
    });

    it('handles mixed formatting', () => {
      const input = '**Bold** and *italic* and `code`';
      const result = formatForTelegramHtml(input);
      expect(result).toContain('<b>Bold</b>');
      expect(result).toContain('<i>italic</i>');
      expect(result).toContain('<code>code</code>');
    });

    it('handles nested formatting priority', () => {
      // Bold should be processed before italic
      const input = '***bold and italic***';
      const result = formatForTelegramHtml(input);
      // The exact output depends on implementation, but it should be valid HTML
      expect(result).toContain('<b>');
      expect(result).toContain('</b>');
    });
  });

  describe('formatForPlainText', () => {
    it('strips bold markers', () => {
      const input = 'This is **bold** text';
      const result = formatForPlainText(input);
      expect(result).toBe('This is bold text');
    });

    it('strips italic markers', () => {
      const input = 'This is *italic* text';
      const result = formatForPlainText(input);
      expect(result).toBe('This is italic text');
    });

    it('strips strikethrough markers', () => {
      const input = 'This is ~~strikethrough~~ text';
      const result = formatForPlainText(input);
      expect(result).toBe('This is strikethrough text');
    });

    it('strips inline code markers', () => {
      const input = 'Use `console.log()` for debugging';
      const result = formatForPlainText(input);
      expect(result).toBe('Use console.log() for debugging');
    });

    it('removes code block markers but keeps content', () => {
      const input = '```javascript\nconst x = 1;\n```';
      const result = formatForPlainText(input);
      expect(result).toContain('const x = 1;');
      expect(result).not.toContain('```');
    });

    it('converts links to text with URL', () => {
      const input = 'Check out [GitHub](https://github.com)';
      const result = formatForPlainText(input);
      expect(result).toBe('Check out GitHub (https://github.com)');
    });

    it('removes heading markers', () => {
      const input = '# Heading 1\n## Heading 2';
      const result = formatForPlainText(input);
      expect(result).toBe('Heading 1\nHeading 2');
    });

    it('handles empty input', () => {
      expect(formatForPlainText('')).toBe('');
      expect(formatForPlainText('   ')).toBe('');
    });
  });

  describe('getMessageFormatter', () => {
    it('returns HTML formatter for telegram', () => {
      const formatter = getMessageFormatter('telegram');
      expect(formatter.parseMode).toBe('HTML');
      expect(formatter.format('**bold**')).toContain('<b>');
    });

    it('returns plain formatter for feishu', () => {
      const formatter = getMessageFormatter('feishu');
      expect(formatter.parseMode).toBe('plain');
      expect(formatter.format('**bold**')).toBe('bold');
    });
  });

  describe('formatMessageForChannel', () => {
    it('formats for telegram with HTML', () => {
      const input = '**Bold** text';
      const result = formatMessageForChannel(input, 'telegram');
      expect(result.parseMode).toBe('HTML');
      expect(result.text).toContain('<b>Bold</b>');
    });

    it('formats for feishu as plain text', () => {
      const input = '**Bold** text';
      const result = formatMessageForChannel(input, 'feishu');
      expect(result.parseMode).toBe('plain');
      expect(result.text).toBe('Bold text');
    });
  });
});
