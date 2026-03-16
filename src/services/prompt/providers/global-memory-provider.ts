import { createMemoryPromptProvider } from './create-memory-prompt-provider';

export type GlobalMemorySettings = Record<string, never>;

export function GlobalMemoryProvider(_settings?: GlobalMemorySettings) {
  return createMemoryPromptProvider('global');
}
