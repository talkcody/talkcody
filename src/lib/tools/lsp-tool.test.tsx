import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockExists = vi.hoisted(() => vi.fn());
const mockGetEffectiveWorkspaceRoot = vi.hoisted(() => vi.fn());
const mockReadFileWithCache = vi.hoisted(() => vi.fn());
const mockNormalizeFilePath = vi.hoisted(() => vi.fn());
const mockGetLanguageIdForPath = vi.hoisted(() => vi.fn());
const mockHasLspSupport = vi.hoisted(() => vi.fn());
const mockGetServerStatus = vi.hoisted(() => vi.fn());
const mockGetLanguageDisplayName = vi.hoisted(() => vi.fn());
const mockGetServerConfig = vi.hoisted(() => vi.fn());
const mockFindWorkspaceRoot = vi.hoisted(() => vi.fn());
const mockGetLspLanguageIdForPath = vi.hoisted(() => vi.fn());
const mockGetConnection = vi.hoisted(() => vi.fn());
const mockGetConnectionByRoot = vi.hoisted(() => vi.fn());
const mockInit = vi.hoisted(() => vi.fn());
const mockStartServer = vi.hoisted(() => vi.fn());
const mockOpenDocument = vi.hoisted(() => vi.fn());
const mockCloseDocument = vi.hoisted(() => vi.fn());
const mockDefinition = vi.hoisted(() => vi.fn());
const mockReferences = vi.hoisted(() => vi.fn());
const mockHover = vi.hoisted(() => vi.fn());
const mockDocumentSymbol = vi.hoisted(() => vi.fn());
const mockWorkspaceSymbol = vi.hoisted(() => vi.fn());
const mockImplementation = vi.hoisted(() => vi.fn());
const mockPrepareCallHierarchy = vi.hoisted(() => vi.fn());
const mockIncomingCalls = vi.hoisted(() => vi.fn());
const mockOutgoingCalls = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: mockExists,
}));

vi.mock('@/services/workspace-root-service', () => ({
  getEffectiveWorkspaceRoot: mockGetEffectiveWorkspaceRoot,
}));

vi.mock('@/services/repository-service', () => ({
  repositoryService: {
    readFileWithCache: mockReadFileWithCache,
  },
}));

vi.mock('@/services/repository-utils', () => ({
  normalizeFilePath: mockNormalizeFilePath,
  getRelativePath: vi.fn((fullPath: string, rootPath: string) => fullPath.replace(`${rootPath}/`, '')),
}));

vi.mock('@/services/lsp/lsp-servers', () => ({
  getLanguageIdForPath: mockGetLanguageIdForPath,
  hasLspSupport: mockHasLspSupport,
  getLanguageDisplayName: mockGetLanguageDisplayName,
  getServerConfig: mockGetServerConfig,
  findWorkspaceRoot: mockFindWorkspaceRoot,
  getLspLanguageIdForPath: mockGetLspLanguageIdForPath,
}));

vi.mock('@/services/lsp/lsp-connection-manager', () => ({
  lspConnectionManager: {
    getConnection: mockGetConnection,
    getConnectionByRoot: mockGetConnectionByRoot,
  },
}));

vi.mock('@/services/lsp/lsp-service', () => ({
  lspService: {
    init: mockInit,
    startServer: mockStartServer,
    openDocument: mockOpenDocument,
    closeDocument: mockCloseDocument,
    definition: mockDefinition,
    references: mockReferences,
    hover: mockHover,
    documentSymbol: mockDocumentSymbol,
    workspaceSymbol: mockWorkspaceSymbol,
    implementation: mockImplementation,
    prepareCallHierarchy: mockPrepareCallHierarchy,
    incomingCalls: mockIncomingCalls,
    outgoingCalls: mockOutgoingCalls,
    getServerStatus: mockGetServerStatus,
    decrementRefCount: vi.fn(),
  },
}));

const mockGetLocale = vi.hoisted(() => vi.fn());

vi.mock('@/locales', () => ({
  getLocale: mockGetLocale,
}));

vi.mock('@/stores/settings-store', () => ({
  useSettingsStore: {
    getState: () => ({ language: 'en' }),
  },
}));

import { lspTool } from './lsp-tool';

const baseTranslations = {
  projectRootNotSet: 'Project root path is not set.',
  fileNotFound: (path: string) => `File not found: ${path}`,
  noLspSupport: 'No LSP support for this file type.',
  serverNotInstalled: (language: string) => `LSP server for ${language} is not installed.`,
  serverNotAvailable: (command: string) => `LSP server not available: ${command}`,
  languageIdMissing: 'Unable to determine LSP language ID for this file.',
  positionRequired: (operation: string) => `Position required for ${operation}`,
  operationNotSupported: (operation: string) => `Unsupported LSP operation: ${operation}`,
  noResults: (operation: string) => `No results found for ${operation}`,
  success: (operation: string, location: string) => `LSP ${operation} completed for ${location}`,
  failed: (operation: string, message: string) => `Failed to run LSP ${operation}: ${message}`,
  unknownError: 'Unknown error',
};

const baseContext = { taskId: 'task-123' };

function setupBaseSuccessMocks() {
  mockGetLocale.mockReturnValue({ ToolMessages: { Lsp: baseTranslations } });
  mockGetEffectiveWorkspaceRoot.mockResolvedValue('/repo');
  mockNormalizeFilePath.mockResolvedValue('/repo/src/index.ts');
  mockExists.mockResolvedValue(true);
  mockGetLanguageIdForPath.mockReturnValue('typescript');
  mockHasLspSupport.mockReturnValue(true);
  mockGetServerStatus.mockResolvedValue({ available: true, canDownload: false });
  mockFindWorkspaceRoot.mockResolvedValue('/repo');
  mockGetLspLanguageIdForPath.mockReturnValue('typescript');
  mockStartServer.mockResolvedValue('server-1');
  mockGetConnection.mockReturnValue(null);
  mockGetConnectionByRoot.mockReturnValue(null);
}

describe('lspTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupBaseSuccessMocks();
  });

  it('passes workspaceSymbol query to lspService', async () => {
    mockWorkspaceSymbol.mockResolvedValue([{ name: 'TestSymbol' }]);

    const result = await lspTool.execute(
      {
        operation: 'workspaceSymbol',
        filePath: 'src/index.ts',
        query: 'TestSymbol',
      },
      baseContext
    );

    expect(mockWorkspaceSymbol).toHaveBeenCalledWith('server-1', 'TestSymbol');
    expect(result.success).toBe(true);
  });

  it('allows documentSymbol without line/character', async () => {
    mockDocumentSymbol.mockResolvedValue([{ name: 'Symbol' }]);

    const result = await lspTool.execute(
      {
        operation: 'documentSymbol',
        filePath: 'src/index.ts',
      },
      baseContext
    );

    expect(result.success).toBe(true);
  });

  it('returns error when position is required but missing', async () => {
    const result = await lspTool.execute(
      {
        operation: 'goToDefinition',
        filePath: 'src/index.ts',
      },
      baseContext
    );

    expect(result.success).toBe(false);
    expect(result.message).toBe(baseTranslations.positionRequired('goToDefinition'));
  });

  it('uses repo root workspace for findReferences by default', async () => {
    mockReferences.mockResolvedValue([{ uri: '/repo/src/other.ts', range: { start: 0, end: 1 } }]);
    mockFindWorkspaceRoot.mockResolvedValue('/repo/src');

    const result = await lspTool.execute(
      {
        operation: 'findReferences',
        filePath: 'src/index.ts',
        line: 1,
        character: 1,
      },
      baseContext
    );

    expect(mockFindWorkspaceRoot).not.toHaveBeenCalled();
    expect(mockGetConnectionByRoot).toHaveBeenCalledWith('/repo', 'typescript');
    expect(mockStartServer).toHaveBeenCalledWith('typescript', '/repo');
    expect(result.success).toBe(true);
  });

  it('treats empty results as success', async () => {
    mockDocumentSymbol.mockResolvedValue([]);

    const result = await lspTool.execute(
      {
        operation: 'documentSymbol',
        filePath: 'src/index.ts',
      },
      baseContext
    );

    expect(result.success).toBe(true);
    expect(result.message).toBe(baseTranslations.noResults('documentSymbol'));
  });
});
