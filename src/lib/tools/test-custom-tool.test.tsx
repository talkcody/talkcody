import React from 'react';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { z } from 'zod';
import type { CustomToolDefinition } from '@/types/custom-tool';
import { testCustomTool } from './test-custom-tool';
import { exists, readTextFile } from '@tauri-apps/plugin-fs';
import { dirname, normalize } from '@tauri-apps/api/path';
import {
  compileCustomTool,
  createCustomToolModuleUrl,
  registerCustomToolModuleResolver,
  resolveCustomToolDefinition,
} from '@/services/tools/custom-tool-compiler';

vi.mock('@/services/tools/custom-tool-compiler', () => ({
  compileCustomTool: vi.fn(async () => ({ code: '// compiled', sourceMap: 'map' })),
  createCustomToolModuleUrl: vi.fn(async () => 'module://custom-tool'),
  registerCustomToolModuleResolver: vi.fn(async () => {}),
  resolveCustomToolDefinition: vi.fn(async () => ({})),
}));

describe('test_custom_tool', () => {
  const context = { taskId: 'task-1', toolId: 'test_custom_tool' };
  const filePath = '/custom/tools/my-tool.tsx';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(exists).mockResolvedValue(true);
    vi.mocked(readTextFile).mockResolvedValue('export default {}');
    vi.mocked(normalize).mockResolvedValue(filePath);
    vi.mocked(dirname).mockResolvedValue('/custom/tools');
  });

  it('validates compile, execute, and render successfully', async () => {
    const executeMock = vi.fn(async () => ({ ok: true }));
    const renderDoingMock = vi.fn(() => <div>doing</div>);
    const renderResultMock = vi.fn(() => <div>done</div>);

    const definition: CustomToolDefinition = {
      name: 'my_custom_tool',
      description: 'Test tool',
      inputSchema: z.object({ message: z.string() }),
      execute: executeMock,
      renderToolDoing: renderDoingMock,
      renderToolResult: renderResultMock,
      canConcurrent: false,
    };

    vi.mocked(resolveCustomToolDefinition).mockResolvedValueOnce(definition);

    const result = await testCustomTool.execute(
      { file_path: filePath, params: { message: 'hello' } },
      context
    );

    expect(compileCustomTool).toHaveBeenCalledWith('export default {}', { filename: 'my-tool.tsx' });
    expect(registerCustomToolModuleResolver).toHaveBeenCalledWith('/custom/tools');
    expect(createCustomToolModuleUrl).toHaveBeenCalled();
    expect(resolveCustomToolDefinition).toHaveBeenCalled();
    expect(executeMock).toHaveBeenCalledWith({ message: 'hello' }, context);
    expect(renderDoingMock).toHaveBeenCalled();
    expect(renderResultMock).toHaveBeenCalledWith({ ok: true }, { message: 'hello' }, expect.any(Object));
    expect(result.success).toBe(true);
  });

  it('returns compile error when compiler throws', async () => {
    vi.mocked(compileCustomTool).mockRejectedValueOnce(new Error('compile failed'));

    const result = await testCustomTool.execute(
      { file_path: filePath, params: { message: 'hello' } },
      context
    );

    expect(result.success).toBe(false);
    expect(result.stage).toBe('compile');
    expect(result.error).toContain('compile failed');
  });

  it('returns execute error when execute throws', async () => {
    const definition: CustomToolDefinition = {
      name: 'my_custom_tool',
      description: 'Test tool',
      inputSchema: z.object({ message: z.string() }),
      execute: vi.fn(async () => {
        throw new Error('boom');
      }),
      renderToolDoing: vi.fn(() => <div>doing</div>),
      renderToolResult: vi.fn(() => <div>done</div>),
      canConcurrent: false,
    };

    vi.mocked(resolveCustomToolDefinition).mockResolvedValueOnce(definition);

    const result = await testCustomTool.execute(
      { file_path: filePath, params: { message: 'hello' } },
      context
    );

    expect(result.success).toBe(false);
    expect(result.stage).toBe('execute');
    expect(result.error).toContain('boom');
  });

  it('returns render_result error when renderer is invalid', async () => {
    const definition: CustomToolDefinition = {
      name: 'my_custom_tool',
      description: 'Test tool',
      inputSchema: z.object({ message: z.string() }),
      execute: vi.fn(async () => ({ ok: true })),
      renderToolDoing: vi.fn(() => <div>doing</div>),
      renderToolResult: vi.fn(() => ({ bad: true } as unknown as React.ReactElement)),
      canConcurrent: false,
    };

    vi.mocked(resolveCustomToolDefinition).mockResolvedValueOnce(definition);

    const result = await testCustomTool.execute(
      { file_path: filePath, params: { message: 'hello' } },
      context
    );

    expect(result.success).toBe(false);
    expect(result.stage).toBe('render_result');
    expect(result.error).toContain('renderToolResult returned invalid value');
  });

  it('returns error when custom tool file is missing', async () => {
    vi.mocked(exists).mockResolvedValueOnce(false);

    const result = await testCustomTool.execute(
      { file_path: filePath, params: { message: 'hello' } },
      context
    );

    expect(result.success).toBe(false);
    expect(result.stage).toBe('compile');
    expect(result.error).toContain('File not found');
  });
});
