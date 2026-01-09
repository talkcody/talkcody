import { render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { CustomToolDefinition } from '@/types/custom-tool';
import type { ExecutionResult } from '@/types/playground';
import ResultPanel from './result-panel';

// Mock Tabs to force render all tab content for testing
vi.mock('@/components/ui/tabs', () => ({
  Tabs: ({ children, defaultValue }: { children: ReactNode; defaultValue?: string }) => (
    <div data-testid="tabs" data-default-value={defaultValue}>
      {children}
    </div>
  ),
  TabsList: ({ children }: { children: ReactNode }) => <div data-testid="tabs-list">{children}</div>,
  TabsTrigger: ({ children, value, ...props }: { children: ReactNode; value: string }) => (
    <button role="tab" data-value={value} {...props}>
      {children}
    </button>
  ),
  TabsContent: ({ children }: { children: ReactNode }) => <div data-testid="tabs-content">{children}</div>,
}));

vi.mock('@/hooks/use-locale', () => ({
  useTranslation: () => ({
    Common: { error: 'Error' },
    playground: {
      executionSuccess: 'Execution successful',
      executionFailed: 'Execution failed',
      logs: 'Logs',
      output: 'Output',
      rendered: 'Rendered',
      noLogs: 'No logs',
      noRenderer: 'No renderer available',
      outputCopied: 'Output copied',
      outputDownloaded: 'Output downloaded',
      renderFailed: 'Tool renderer failed',
      renderInvalidResult: 'Renderer returned an unsupported value.',
      error: 'Error',
    },
  }),
}));

vi.mock('@/components/tools/tool-error-boundary', () => ({
  ToolErrorBoundary: ({ children }: { children: ReactElement }) => <>{children}</>,
}));

describe('ResultPanel', () => {
  const baseResult: ExecutionResult = {
    status: 'success',
    output: { message: 'ok' },
    duration: 12,
    logs: [],
  };

  it('renders error tab label from Common.error to avoid object rendering', () => {
    const errorResult: ExecutionResult = {
      status: 'error',
      error: 'boom',
      duration: 5,
      logs: [],
    };

    render(<ResultPanel result={errorResult} onClear={vi.fn()} />);

    expect(screen.getByText('Error')).toBeInTheDocument();
  });

  it('falls back when renderToolResult returns an unsupported object', () => {
    const tool: CustomToolDefinition = {
      name: 'bad-tool',
      description: 'bad tool',
      inputSchema: undefined as never,
      execute: async () => ({ success: true }),
      renderToolDoing: () => <div>doing</div>,
      renderToolResult: () => ({ bad: true } as unknown as ReactElement),
      canConcurrent: false,
    };

    render(<ResultPanel result={baseResult} tool={tool} onClear={vi.fn()} />);

    // Mock Tabs renders all content, so we can directly check for the error message
    const element = screen.getByText('Renderer returned an unsupported value.');
    expect(element).toBeInTheDocument();
  });

  it('renders fallback error when renderToolResult throws', () => {
    const tool: CustomToolDefinition = {
      name: 'throw-tool',
      description: 'throw tool',
      inputSchema: undefined as never,
      execute: async () => ({ success: true }),
      renderToolDoing: () => <div>doing</div>,
      renderToolResult: () => {
        throw new Error('render failed');
      },
      canConcurrent: false,
    };

    render(<ResultPanel result={baseResult} tool={tool} onClear={vi.fn()} />);

    // Mock Tabs renders all content, so we can directly check for the error message
    const element = screen.getByText('Tool renderer failed');
    expect(element).toBeInTheDocument();
  });
});
