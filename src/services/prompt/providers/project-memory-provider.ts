import { createMemoryPromptProvider } from './create-memory-prompt-provider';

export type ProjectMemorySettings = Record<string, never>;

export function ProjectMemoryProvider(_settings?: ProjectMemorySettings) {
  return createMemoryPromptProvider('project');
}
