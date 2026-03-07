import { describe, expect, it } from 'vitest';
import { getProjectMemoryTargetCandidates } from './memory-targets';

describe('getProjectMemoryTargetCandidates', () => {
  it('returns conservative project instruction file candidates for an absolute workspace root', () => {
    expect(getProjectMemoryTargetCandidates('/repo')).toEqual(
      expect.arrayContaining([
        'AGENTS.md',
        'CLAUDE.md',
        'GEMINI.md',
        '/repo/AGENTS.md',
        '/repo/CLAUDE.md',
        '/repo/GEMINI.md',
      ])
    );
  });

  it('returns both slash styles for windows workspace roots', () => {
    expect(getProjectMemoryTargetCandidates('C:\\repo')).toEqual(
      expect.arrayContaining([
        'AGENTS.md',
        'CLAUDE.md',
        'GEMINI.md',
        'C:\\repo\\AGENTS.md',
        'C:\\repo\\CLAUDE.md',
        'C:\\repo\\GEMINI.md',
        'C:\\repo/AGENTS.md',
        'C:\\repo/CLAUDE.md',
        'C:\\repo/GEMINI.md',
      ])
    );
  });

  it('falls back to root file names when workspace root is unavailable', () => {
    expect(getProjectMemoryTargetCandidates()).toEqual(['AGENTS.md', 'CLAUDE.md', 'GEMINI.md']);
  });
});
