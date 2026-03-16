import type { MemoryDocumentKind, MemoryDocumentSourceType, MemoryScope } from './memory-types';

export const MEMORY_WORKSPACE_INDEX_FILE_NAME = 'MEMORY.md';
export const MEMORY_WORKSPACE_DIRECTORY_NAME = 'memory';
export const GLOBAL_MEMORY_WORKSPACE_NAME = 'global';
export const PROJECT_MEMORY_WORKSPACE_NAME = 'projects';

export type MemoryScopeConfig = {
  scope: MemoryScope;
  displayLabel: string;
  requiresWorkspaceRoot: boolean;
  workspaceDirectoryName: string;
  indexFileName: string;
};

const MEMORY_SCOPE_CONFIGS: Record<MemoryScope, MemoryScopeConfig> = {
  global: {
    scope: 'global',
    displayLabel: 'Global Memory',
    requiresWorkspaceRoot: false,
    workspaceDirectoryName: GLOBAL_MEMORY_WORKSPACE_NAME,
    indexFileName: MEMORY_WORKSPACE_INDEX_FILE_NAME,
  },
  project: {
    scope: 'project',
    displayLabel: 'Project Memory',
    requiresWorkspaceRoot: true,
    workspaceDirectoryName: PROJECT_MEMORY_WORKSPACE_NAME,
    indexFileName: MEMORY_WORKSPACE_INDEX_FILE_NAME,
  },
};

export function getMemoryScopeConfig(scope: MemoryScope): MemoryScopeConfig {
  return MEMORY_SCOPE_CONFIGS[scope];
}

export function getMemoryDocumentSourceType(
  scope: MemoryScope,
  kind: MemoryDocumentKind
): MemoryDocumentSourceType {
  if (kind === 'topic') {
    return 'topic_file';
  }

  return scope === 'global' ? 'global_index' : 'project_index';
}
