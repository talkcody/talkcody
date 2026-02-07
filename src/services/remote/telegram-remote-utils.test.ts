import { describe, expect, it } from 'vitest';
import {
  isDuplicateTelegramMessage,
  normalizeTelegramCommand,
  splitTelegramText,
} from '@/services/remote/telegram-remote-utils';

describe('telegram-remote-utils', () => {
  it('normalizes commands with bot suffix', () => {
    expect(normalizeTelegramCommand('/status@TalkCodyBot')).toBe('/status');
    expect(normalizeTelegramCommand('/new@TalkCodyBot hello')).toBe('/new hello');
  });

  it('passes through non-commands', () => {
    expect(normalizeTelegramCommand('hello')).toBe('hello');
  });

  it('deduplicates by chat and message id', () => {
    expect(isDuplicateTelegramMessage(1, 10, 1000)).toBe(false);
    expect(isDuplicateTelegramMessage(1, 10, 1000)).toBe(true);
    expect(isDuplicateTelegramMessage(1, 11, 1000)).toBe(false);
  });

  it('splits long text into chunks', () => {
    const text = 'a'.repeat(5000);
    const chunks = splitTelegramText(text, 4096);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toBe(text);
  });
});
