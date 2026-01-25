import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { parseToolInputSchema } from './custom-tool-schema-parser';

const fsState = {
  files: new Map<string, string>(),
};

vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: vi.fn(async (path: string) => fsState.files.get(path) ?? ''),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: vi.fn(),
  },
}));

describe('custom-tool-schema-parser', () => {
  it('parses a mysql-query style inputSchema', async () => {
    const entryPath = '/tools/mysql-query/tool.tsx';
    fsState.files.set(
      entryPath,
      `import { z } from 'zod';\n\nconst inputSchema = z.object({\n  sql: z.string().min(1, 'SQL is required'),\n  url: z.string().min(1).optional(),\n  host: z.string().default('127.0.0.1'),\n  port: z.number().int().positive().default(9030),\n  user: z.string().default('root'),\n  password: z.string().optional(),\n  database: z.string().optional(),\n  language: z.enum(['en', 'zh']).default('zh'),\n  debug: z.boolean().default(false),\n});\n`
    );

    const schema = await parseToolInputSchema(entryPath);
    expect(schema).not.toBeNull();
    if (!schema) return;

    const parsed = schema.safeParse({ sql: 'select 1' });
    expect(parsed.success).toBe(true);

    const defaults = schema.safeParse({ sql: 'select 1' }).data as Record<string, unknown>;
    expect(defaults.host).toBe('127.0.0.1');
    expect(defaults.port).toBe(9030);
    expect(defaults.user).toBe('root');
    expect(defaults.language).toBe('zh');
    expect(defaults.debug).toBe(false);
  });

  it('returns null when no inputSchema is found', async () => {
    const entryPath = '/tools/empty/tool.tsx';
    fsState.files.set(entryPath, 'export default {}');

    const schema = await parseToolInputSchema(entryPath);
    expect(schema).toBeNull();
  });

  it('handles optional and enum parsing', async () => {
    const entryPath = '/tools/optional/tool.tsx';
    fsState.files.set(
      entryPath,
      `import { z } from 'zod';\nexport const inputSchema = z.strictObject({\n  mode: z.enum(['a', 'b']).default('a'),\n  note: z.string().optional(),\n});\n`
    );

    const schema = await parseToolInputSchema(entryPath);
    expect(schema).not.toBeNull();
    if (!schema) return;

    const parsed = schema.safeParse({});
    expect(parsed.success).toBe(true);
    expect((parsed.data as Record<string, unknown>).mode).toBe('a');
  });
});
