const PROJECT_MEMORY_TARGET_FILES = ['MEMORY.md'] as const;

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

export function getProjectMemoryTargetCandidates(
  workspaceRoot?: string | null,
  fileName = 'MEMORY.md'
): string[] {
  const candidates = new Set<string>();

  for (const targetFileName of PROJECT_MEMORY_TARGET_FILES) {
    const effectiveFileName = fileName || targetFileName;
    candidates.add(effectiveFileName);

    if (workspaceRoot) {
      for (const absoluteCandidate of buildAbsoluteCandidates(workspaceRoot, effectiveFileName)) {
        candidates.add(absoluteCandidate);
      }
    }
  }

  return Array.from(candidates);
}
