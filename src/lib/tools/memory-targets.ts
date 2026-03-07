const PROJECT_MEMORY_TARGET_FILES = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md'] as const;

function normalizeRoot(rootPath: string): string {
  return rootPath.replace(/[\\/]+$/, '');
}

function buildAbsoluteCandidates(rootPath: string, fileName: string): string[] {
  const normalizedRoot = normalizeRoot(rootPath);
  if (!normalizedRoot) {
    return [];
  }

  const candidates = new Set<string>();
  candidates.add(`${normalizedRoot}/${fileName}`);

  if (normalizedRoot.includes('\\')) {
    candidates.add(`${normalizedRoot}\\${fileName}`);
  }

  return Array.from(candidates);
}

export function getProjectMemoryTargetCandidates(workspaceRoot?: string | null): string[] {
  const candidates = new Set<string>();

  for (const fileName of PROJECT_MEMORY_TARGET_FILES) {
    candidates.add(fileName);

    if (workspaceRoot) {
      for (const absoluteCandidate of buildAbsoluteCandidates(workspaceRoot, fileName)) {
        candidates.add(absoluteCandidate);
      }
    }
  }

  return Array.from(candidates);
}
