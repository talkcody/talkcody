import { describe, expect, it } from 'vitest';
import { getProjectMemoryTargetCandidates } from './memory-targets';

describe('getProjectMemoryTargetCandidates', () => {
  it('returns project MEMORY.md candidates for an absolute workspace root', () => {
    expect(getProjectMemoryTargetCandidates('/repo')).toEqual(
      expect.arrayContaining([
        'MEMORY.md',
        '/repo/MEMORY.md',
      ])
    );
  });

  it('returns both slash styles for windows workspace roots', () => {
    expect(getProjectMemoryTargetCandidates('C:\\repo')).toEqual(
      expect.arrayContaining([
        'MEMORY.md',
        'C:\\repo\\MEMORY.md',
        'C:\\repo/MEMORY.md',
      ])
    );
  });

  it('falls back to MEMORY.md when workspace root is unavailable', () => {
    expect(getProjectMemoryTargetCandidates()).toEqual(['MEMORY.md']);
  });

  it('can target a specific topic file inside the project memory workspace', () => {
    expect(getProjectMemoryTargetCandidates('/repo', 'architecture.md')).toEqual(
      expect.arrayContaining(['architecture.md', '/repo/architecture.md'])
    );
  });
});
