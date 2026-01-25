import { describe, expect, it, vi, beforeEach } from 'vitest';

const defaultMock = vi.fn();
const transformMock = vi.fn(async () => ({ code: '// transformed', map: 'map' }));

vi.mock('@swc/wasm-web', () => ({
  default: defaultMock,
  transform: transformMock,
}));

vi.mock('@swc/wasm-web/wasm_bg.wasm?url', () => ({
  default: 'mock-wasm-url',
}));

describe('custom-tool-compiler', () => {
  let capturedBlobParts: unknown[] | null = null;

  beforeEach(() => {
    capturedBlobParts = null;
    class MockBlob {
      constructor(parts: unknown[]) {
        capturedBlobParts = parts;
      }
    }
    (globalThis as { Blob?: unknown }).Blob = MockBlob as unknown as typeof Blob;
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock');
  });

  it('initializes swc with wasm url and transforms typescript', async () => {
    const { compileCustomTool } = await import('./custom-tool-compiler');

    const result = await compileCustomTool('export default {}', { filename: 'tool.ts' });

    expect(defaultMock).toHaveBeenCalledWith({ module_or_path: 'mock-wasm-url' });
    expect(transformMock).toHaveBeenCalledWith(
      'export default {}',
      expect.objectContaining({
        filename: 'tool.ts',
        jsc: expect.objectContaining({
          parser: expect.objectContaining({
            syntax: 'typescript',
            tsx: false,
          }),
        }),
      })
    );
    expect(result.code).toBe('// transformed');
    expect(result.sourceMap).toBe('map');
  });

  it('marks tsx files for tsx parsing', async () => {
    const { compileCustomTool } = await import('./custom-tool-compiler');

    await compileCustomTool('export default {}', { filename: 'tool.tsx' });

    expect(transformMock).toHaveBeenCalledWith(
      'export default {}',
      expect.objectContaining({
        jsc: expect.objectContaining({
          parser: expect.objectContaining({
            syntax: 'typescript',
            tsx: true,
          }),
        }),
      })
    );
  });

  it('preloads require specifiers and keeps sync require in module body', async () => {
    transformMock.mockResolvedValueOnce({
      code: "const foo = require('foo'); const bar = require(\"bar\");",
      map: 'map',
    });
    const { compileCustomTool, createCustomToolModuleUrl } = await import('./custom-tool-compiler');
    const compiled = await compileCustomTool('export default {}', { filename: 'tool.ts' });

    await createCustomToolModuleUrl(compiled, 'tool.ts', '/base');

    const source = String(capturedBlobParts?.[0] ?? '');
    expect(source).toContain('const __preload = async () =>');
    expect(source).toContain('["foo","bar"]');
    expect(source).toContain('try {');
    expect(source).toContain('await __require(specifier);');
    expect(source).toContain('const require = __requireSync;');
    expect(source).toContain("const foo = require('foo');");
  });
});
