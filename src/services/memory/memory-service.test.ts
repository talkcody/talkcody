import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fileState } = vi.hoisted(() => ({
  fileState: new Map<string, string>(),
}));

const { unreadablePaths } = vi.hoisted(() => ({
  unreadablePaths: new Set<string>(),
}));

vi.mock('@tauri-apps/api/path', () => ({
  appDataDir: vi.fn().mockResolvedValue('/test/app-data'),
  join: vi.fn().mockImplementation(async (...paths: string[]) => paths.join('/')),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn(async (filePath: string) => unreadablePaths.has(filePath) || fileState.has(filePath)),
  mkdir: vi.fn().mockResolvedValue(undefined),
  readTextFile: vi.fn(async (filePath: string) => {
    if (unreadablePaths.has(filePath)) {
      throw new Error(`Unreadable file: ${filePath}`);
    }
    const value = fileState.get(filePath);
    if (value === undefined) {
      throw new Error(`Missing file: ${filePath}`);
    }
    return value;
  }),
  writeTextFile: vi.fn(async (filePath: string, value: string) => {
    fileState.set(filePath, value);
  }),
}));

import {
  appendToLongTermMemorySection,
  extractLongTermMemorySection,
  memoryService,
  removeLongTermMemorySection,
  upsertLongTermMemorySection,
} from './memory-service';

describe('memoryService', () => {
  beforeEach(() => {
    fileState.clear();
    unreadablePaths.clear();
    vi.clearAllMocks();
  });

  it('extracts and upserts the project Long-Term Memory section', () => {
    const source = [
      '# Project Guide',
      '',
      '## Long-Term Memory',
      '',
      '- Keep logs concise',
      '',
      '## Commands',
      '',
      '- bun run test',
    ].join('\n');

    expect(extractLongTermMemorySection(source)).toBe('- Keep logs concise');

    const updated = upsertLongTermMemorySection(source, '- Prefer bun\n- Keep logs concise');
    expect(updated).toContain('## Long-Term Memory');
    expect(updated).toContain('- Prefer bun');
    expect(updated).toContain('## Commands');
  });

  it('keeps nested headings inside project Long-Term Memory and stops at higher-level headings', () => {
    const source = [
      '# Project Guide',
      '',
      '## Long-Term Memory',
      '',
      '- Keep logs concise',
      '',
      '### Commands to remember',
      '',
      '- bun run test',
      '',
      '# Release Notes',
      '',
      '- Version 1.0.0',
    ].join('\n');

    expect(extractLongTermMemorySection(source)).toBe(
      ['- Keep logs concise', '', '### Commands to remember', '', '- bun run test'].join('\n')
    );
    expect(extractLongTermMemorySection(source)).not.toContain('# Release Notes');

    const updated = removeLongTermMemorySection(source);

    expect(updated).not.toContain('## Long-Term Memory');
    expect(updated).not.toContain('### Commands to remember');
    expect(updated).toContain('# Release Notes');
  });

  it('appends plain text to the project Long-Term Memory section as a bullet', () => {
    const updated = appendToLongTermMemorySection('# Project Guide\n', 'Remember the build uses bun');

    expect(updated).toContain('## Long-Term Memory');
    expect(updated).toContain('- Remember the build uses bun');
  });

  it('removes the project Long-Term Memory section without deleting other instructions', () => {
    const source = [
      '# Project Guide',
      '',
      '## Long-Term Memory',
      '',
      '- Keep logs concise',
      '',
      '## Commands',
      '',
      '- bun run test',
    ].join('\n');

    const updated = removeLongTermMemorySection(source);

    expect(updated).not.toContain('## Long-Term Memory');
    expect(updated).not.toContain('- Keep logs concise');
    expect(updated).toContain('## Commands');
  });

  it('writes global memory to app data memory.md', async () => {
    const document = await memoryService.writeGlobal('User prefers concise answers');

    expect(document.path).toBe('/test/app-data/memory/memory.md');
    expect(document.content).toBe('User prefers concise answers');
    expect(fileState.get('/test/app-data/memory/memory.md')).toBe('User prefers concise answers\n');
  });

  it('writes only the Long-Term Memory section inside project AGENTS.md', async () => {
    fileState.set(
      '/repo/AGENTS.md',
      ['# Project Guide', '', '## Commands', '', '- bun run test'].join('\n')
    );

    const document = await memoryService.writeProjectSection(
      '/repo',
      '- Prefer bun\n- Use AGENTS.md for project memory'
    );

    expect(document.path).toBe('/repo/AGENTS.md');
    expect(document.content).toContain('- Prefer bun');

    const saved = fileState.get('/repo/AGENTS.md') ?? '';
    expect(saved).toContain('## Long-Term Memory');
    expect(saved).toContain('- Prefer bun');
    expect(saved).toContain('## Commands');
  });

  it('reuses an existing root CLAUDE.md file for project memory', async () => {
    fileState.set(
      '/repo/CLAUDE.md',
      ['# Claude Instructions', '', '## Commands', '', '- bun run test'].join('\n')
    );

    const document = await memoryService.writeProjectSection('/repo', '- Prefer CLAUDE root instructions');

    expect(document.path).toBe('/repo/CLAUDE.md');

    const saved = fileState.get('/repo/CLAUDE.md') ?? '';
    expect(saved).toContain('# Claude Instructions');
    expect(saved).toContain('## Long-Term Memory');
    expect(saved).toContain('- Prefer CLAUDE root instructions');
    expect(fileState.has('/repo/AGENTS.md')).toBe(false);
  });

  it('fails project section replacement when an existing AGENTS.md cannot be read', async () => {
    unreadablePaths.add('/repo/AGENTS.md');

    await expect(memoryService.writeProjectSection('/repo', '- Prefer bun')).rejects.toThrow(
      'Failed to read existing memory file: /repo/AGENTS.md'
    );

    expect(fileState.has('/repo/AGENTS.md')).toBe(false);
  });

  it('fails project section append when an existing AGENTS.md cannot be read', async () => {
    unreadablePaths.add('/repo/AGENTS.md');

    await expect(memoryService.appendProjectSection('/repo', 'Prefer bun')).rejects.toThrow(
      'Failed to read existing memory file: /repo/AGENTS.md'
    );

    expect(fileState.has('/repo/AGENTS.md')).toBe(false);
  });

  it('searches across global and project long-term memory', async () => {
    fileState.set(
      '/test/app-data/memory/memory.md',
      ['# Preferences', '', '- Use bun for JavaScript tasks'].join('\n')
    );
    fileState.set(
      '/repo/AGENTS.md',
      ['# Project Guide', '', '## Long-Term Memory', '', '- Build with bun run build'].join('\n')
    );

    const results = await memoryService.search('bun', {
      workspaceRoot: '/repo',
      maxResults: 5,
    });

    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results.some((result) => result.scope === 'global')).toBe(true);
    expect(results.some((result) => result.scope === 'project')).toBe(true);
  });
});