import { render, screen } from '@testing-library/react';
import React from 'react';
import ParameterPanel from './parameter-panel';
import { vi, type Mock } from 'vitest';
import { useTranslation } from '@/hooks/use-locale';
import type { CustomToolDefinition } from '@/types/custom-tool';
import { z } from 'zod';

vi.mock('@/hooks/use-locale', () => ({
  useTranslation: vi.fn(),
}));

const tMock = {
  playground: {
    optional: 'optional',
    parameters: 'Parameters',
    noParameters: 'No parameters',
    executing: 'Executing',
    execute: 'Execute',
    error: { validationFailed: 'Validation failed', executionFailed: 'Execution failed' },
    presetNamePrompt: 'Name?',
    presetSaved: 'Saved',
    presetLoaded: 'Loaded',
    presetDeleted: 'Deleted',
    confirmDeletePreset: 'Confirm',
    savePreset: 'Save preset',
    load: 'Load',
    delete: 'Delete',
    parameterPresets: 'Presets',
    selectPreset: 'Select preset',
  },
  Common: {
    default: 'default',
  },
};

function renderPanel(tool: CustomToolDefinition) {
  (useTranslation as unknown as Mock).mockReturnValue(tMock);
  return render(<ParameterPanel tool={tool} onExecute={vi.fn()} isExecuting={false} />);
}

describe('ParameterPanel optional/default badges', () => {
  it('shows optional badges and default badges (including falsy defaults) and prefills inputs', () => {
    const inputSchema = z.object({
      // optional only
      a: z.string().optional(),
      // default only (implied optional)
      b: z.string().default('hello'),
      // optional wrapping default
      c: z.number().default(0).optional(),
      // default wrapping optional
      d: z.boolean().optional().default(false),
    });

    const tool: CustomToolDefinition = {
      name: 'test_tool',
      description: 'desc',
      inputSchema: inputSchema,
      async execute() {
        return {};
      },
      renderToolDoing: () => null,
      renderToolResult: () => null,
      canConcurrent: false,
    };

    renderPanel(tool);

    expect(screen.getAllByText(tMock.playground.optional)).toHaveLength(4);

    expect(screen.getByText(`${tMock.Common.default}: hello`)).toBeInTheDocument();
    expect(screen.getByText(`${tMock.Common.default}: 0`)).toBeInTheDocument();
    expect(screen.getByText(`${tMock.Common.default}: false`)).toBeInTheDocument();

    expect(screen.getByDisplayValue('hello')).toBeInTheDocument();
    expect(screen.getByDisplayValue('0')).toBeInTheDocument();
  });
});
