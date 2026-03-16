import { describe, expect, it } from 'vitest';
import {
  buildMemoryWorkspaceAudit,
  extractIndexedTopicFiles,
  getInjectedIndexSlice,
  MEMORY_INDEX_INJECTION_LINE_LIMIT,
  parseMemoryIndex,
} from './memory-index-parser';

describe('memory-index-parser', () => {
  it('extracts indexed topic files using a loose markdown-first parser', () => {
    const content = [
      '# Memory Index',
      '- architecture.md: read for system design',
      '- commands.md',
      'See also preferences.md when discussing workflow preferences.',
      '- MEMORY.md should not be treated as a topic file',
    ].join('\n');

    expect(extractIndexedTopicFiles(content)).toEqual([
      'architecture.md',
      'commands.md',
      'preferences.md',
    ]);

    const parsed = parseMemoryIndex(content);
    expect(parsed.routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fileName: 'architecture.md',
          lineNumber: 2,
        }),
        expect.objectContaining({
          fileName: 'preferences.md',
          lineNumber: 4,
        }),
      ])
    );
  });

  it('limits injected index content to the first configured lines', () => {
    const content = Array.from({ length: MEMORY_INDEX_INJECTION_LINE_LIMIT + 5 }, (_, index) =>
      `- line ${index + 1}`
    ).join('\n');

    const injected = getInjectedIndexSlice(content);

    expect(injected.split('\n')).toHaveLength(MEMORY_INDEX_INJECTION_LINE_LIMIT);
    expect(injected).toContain('- line 200');
    expect(injected).not.toContain('- line 201');
  });

  it('builds audit signals for missing and unindexed topics', () => {
    const audit = buildMemoryWorkspaceAudit(
      '# Memory Index\n- architecture.md\n- missing.md',
      ['architecture.md', 'extra.md']
    );

    expect(audit.indexedTopicFiles).toEqual(['architecture.md', 'missing.md']);
    expect(audit.unindexedTopicFiles).toEqual(['extra.md']);
    expect(audit.missingTopicFiles).toEqual(['missing.md']);
  });
});
