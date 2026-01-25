// src/components/chat/output-format-button.test.tsx

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OutputFormatButton } from './output-format-button';

const mockSetOutputFormat = vi.fn();

vi.mock('@/stores/output-format-store', () => ({
  useOutputFormatStore: (
    selector: (state: { outputFormat: string; setOutputFormat: (format: string) => void }) => unknown
  ) =>
    selector({
      outputFormat: 'markdown',
      setOutputFormat: mockSetOutputFormat,
    }),
}));

vi.mock('@/hooks/use-locale', () => ({
  useLocale: () => ({
    t: {
      Chat: {
        outputFormat: {
          title: 'Output Format',
          description: 'Select how the assistant should format its response.',
          currentFormat: 'Current format',
          switchSuccess: 'Output format updated',
          markdown: 'Markdown',
          mermaid: 'Mermaid',
          web: 'Web',
          markdownDescription: 'Standard markdown rendering with code blocks and tables.',
          mermaidDescription: 'Render diagrams using Mermaid syntax.',
          webDescription: 'Render as HTML/web content.',
          viewSource: 'View Source',
          viewRendered: 'View Rendered',
        },
      },
    },
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
  },
}));

describe('OutputFormatButton', () => {
  beforeEach(() => {
    mockSetOutputFormat.mockClear();
  });

  it('shows output format options', () => {
    render(<OutputFormatButton />);

    fireEvent.click(screen.getByRole('button'));

    expect(screen.getAllByText('Markdown').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Mermaid').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Web').length).toBeGreaterThan(0);
  });

  it('updates output format on selection', () => {
    render(<OutputFormatButton />);

    fireEvent.click(screen.getByRole('button'));
    const [firstMermaid] = screen.getAllByText('Mermaid');
    if (!firstMermaid) {
      throw new Error('Mermaid option not found');
    }

    fireEvent.click(firstMermaid);

    expect(mockSetOutputFormat).toHaveBeenCalledWith('mermaid');
  });
});
