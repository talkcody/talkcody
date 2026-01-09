import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ToolPlaygroundService } from './tool-playground-service';
import type { CustomToolDefinition } from '@/types/custom-tool';

const definition: CustomToolDefinition = {
  name: 'mock-tool',
  description: 'mock tool',
  inputSchema: z.object({
    period: z.enum(['101', '102']).default('101'),
  }),
  execute: vi.fn(async () => 'ok'),
  renderToolDoing: vi.fn(() => null as any),
  renderToolResult: vi.fn(() => null as any),
  canConcurrent: false,
};

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('./custom-tool-compiler', () => ({
  compileCustomTool: vi.fn(async (_source: string, _options: { filename: string }) => ({
    code: '// compiled',
    sourceMap: 'map',
  })),
  createCustomToolModuleUrl: vi.fn(async (_compiled: unknown, filename: string) => {
    return `module://${filename}`;
  }),
  resolveCustomToolDefinition: vi.fn(async () => definition),
}));

vi.mock('@/lib/custom-tool-sdk/import-map', () => ({
  clearPlaygroundCache: vi.fn(),
  createPlaygroundModuleResolver: vi.fn(),
  registerCustomToolModule: vi.fn(),
}));

describe('ToolPlaygroundService', () => {
  it('compiles playground tools as tsx to support JSX', async () => {
    const { compileCustomTool, createCustomToolModuleUrl } = await import('./custom-tool-compiler');
    const service = new ToolPlaygroundService();
    service.initialize('export default {}', 'Basic Tool');

    await service.compileTool();

    expect(compileCustomTool).toHaveBeenCalledWith(
      'export default {}',
      expect.objectContaining({ filename: 'Basic Tool.tsx' })
    );
    expect(createCustomToolModuleUrl).toHaveBeenCalledWith(
      expect.any(Object),
      'Basic Tool.tsx'
    );
  });

  it('applies schema defaults before execution', async () => {
    const { resolveCustomToolDefinition } = await import('./custom-tool-compiler');
    const service = new ToolPlaygroundService();
    service.initialize('export default {}', 'Basic Tool');

    await service.compileTool();
    await service.executeTool({});

    expect(definition.execute).toHaveBeenCalledWith(
      { period: '101' },
      expect.objectContaining({ toolId: 'playground_tool' })
    );

    const history = service.getExecutionHistory();
    expect(history[0]?.params).toEqual({ period: '101' });
  });
});
