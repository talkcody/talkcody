export type MemoryScope = 'global' | 'project';
export type MemoryDocumentKind = 'index' | 'topic';
export type MemoryWorkspaceIdentityKind = 'git' | 'path';
export type MemoryDocumentSourceType = 'global_index' | 'project_index' | 'topic_file';
export type MemoryQueryBackend = 'text' | 'projection';

export type MemoryContext = {
  scope: MemoryScope;
  workspaceRoot?: string;
};

export type MemoryTarget = { kind: 'index' } | { kind: 'topic'; fileName: string };

export interface MemoryWorkspaceIdentity {
  kind: MemoryWorkspaceIdentityKind;
  key: string;
  sourcePath: string;
}

export interface MemoryWorkspace {
  scope: MemoryScope;
  path: string | null;
  indexPath: string | null;
  exists: boolean;
  identity: MemoryWorkspaceIdentity | null;
}

export interface MemoryDocument {
  scope: MemoryScope;
  path: string | null;
  content: string;
  exists: boolean;
  kind: MemoryDocumentKind;
  fileName: string | null;
  workspacePath?: string | null;
  sourceType?: MemoryDocumentSourceType;
}

export interface MemorySnapshot {
  global: MemoryDocument;
  project: MemoryDocument;
}

export interface MemorySearchResult {
  scope: MemoryScope;
  path: string | null;
  snippet: string;
  score: number;
  backend: MemoryQueryBackend;
  lineNumber: number;
  kind: MemoryDocumentKind;
  fileName: string | null;
}

export interface MemoryWorkspaceAudit {
  overInjectionLimit: boolean;
  injectedLineCount: number;
  totalLineCount: number;
  topicFiles: string[];
  indexedTopicFiles: string[];
  unindexedTopicFiles: string[];
  missingTopicFiles: string[];
}

export interface MemoryReadOptions {
  workspaceRoot?: string;
}

export interface MemoryQueryOptions {
  contexts?: MemoryContext[];
  maxResults?: number;
}

export interface MemorySearchOptions extends MemoryReadOptions, MemoryQueryOptions {
  scopes?: MemoryScope[];
}

export interface MemoryIndexRoute {
  fileName: string;
  lineNumber: number;
  rawLine: string;
  description?: string;
}

export interface ParsedMemoryIndex {
  routes: MemoryIndexRoute[];
  totalLineCount: number;
  injectedLineCount: number;
  injectedContent: string;
}
