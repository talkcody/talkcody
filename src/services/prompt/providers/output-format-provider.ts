// src/services/prompt/providers/output-format-provider.ts

import { useOutputFormatStore } from '@/stores/output-format-store';
import type { OutputFormatType } from '@/types/output-format';
import type { PromptContextProvider } from '@/types/prompt';

const FORMAT_INSTRUCTIONS: Record<OutputFormatType, string> = {
  markdown: 'Output the response in standard Markdown with headings, lists, and code blocks.',
  mermaid:
    'Output only Mermaid diagram code. Wrap it in a ```mermaid ... ``` code block with no extra text.',
  web: 'Output only HTML for a web page. Wrap it in a ```html ... ``` code block with no extra text.',
};

export const OutputFormatProvider: PromptContextProvider = {
  id: 'output_format',
  label: 'Output Format',
  description: 'Injects output format instructions based on user selection.',
  badges: ['Auto', 'Session'],

  providedTokens() {
    return ['output_format_instruction'];
  },

  canResolve(token: string) {
    return token === 'output_format_instruction';
  },

  async resolve(token: string): Promise<string | undefined> {
    if (token !== 'output_format_instruction') return undefined;
    const outputFormat = useOutputFormatStore.getState().outputFormat;
    return FORMAT_INSTRUCTIONS[outputFormat];
  },

  injection: {
    enabledByDefault: true,
    placement: 'append',
    sectionTitle: 'Output Format',
    sectionTemplate(values: Record<string, string>) {
      const instruction = values.output_format_instruction || '';
      if (!instruction.trim()) return '';
      return `OUTPUT FORMAT INSTRUCTIONS:\n${instruction}`;
    },
  },
};
