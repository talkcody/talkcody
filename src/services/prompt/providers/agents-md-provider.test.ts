import { describe, expect, it } from 'vitest';
import type { ResolveContext } from '@/types/prompt';
import { AgentsMdProvider } from './agents-md-provider';

type FilesMap = Record<string, string>;

type CtxOptions = {
  workspaceRoot?: string;
  currentWorkingDirectory?: string;
  recentFilePaths?: string[];
  files: FilesMap;
};

function createContext(options: CtxOptions): ResolveContext {
  const workspaceRoot = options.workspaceRoot ?? '/repo';

  return {
    workspaceRoot,
    currentWorkingDirectory: options.currentWorkingDirectory,
    recentFilePaths: options.recentFilePaths,
    taskId: undefined,
    agentId: 'test-agent',
    cache: new Map(),
    readFile: async (rootPath, filePath) => {
      if (rootPath !== workspaceRoot) {
        throw new Error(`Unexpected root path: ${rootPath}`);
      }
      const normalizedPath = filePath.replace(/\\/g, '/');
      const content = options.files[normalizedPath];
      if (content === undefined) {
        throw new Error(`Missing file: ${normalizedPath}`);
      }
      return content;
    },
  };
}

describe('AgentsMdProvider', () => {
  it('defaults to hierarchical search and merges root + subdirectory files', async () => {
    const provider = AgentsMdProvider();
    const ctx = createContext({
      currentWorkingDirectory: '/repo/apps/api',
      files: {
        'AGENTS.md': 'ROOT_CONTENT',
        'apps/AGENTS.md': 'APPS_CONTENT',
        'apps/api/AGENTS.md': 'API_CONTENT',
      },
    });

    const result = await provider.resolve('agents_md', ctx);
    expect(result).toBeTruthy();

    const content = result || '';
    const rootIndex = content.indexOf('ROOT_CONTENT');
    const appsIndex = content.indexOf('APPS_CONTENT');
    const apiIndex = content.indexOf('API_CONTENT');

    expect(rootIndex).toBeGreaterThan(-1);
    expect(appsIndex).toBeGreaterThan(-1);
    expect(apiIndex).toBeGreaterThan(-1);
    expect(rootIndex).toBeLessThan(appsIndex);
    expect(appsIndex).toBeLessThan(apiIndex);
  });

  it('prefers CLAUDE.md when AGENTS.md is missing in a directory', async () => {
    const provider = AgentsMdProvider();
    const ctx = createContext({
      currentWorkingDirectory: '/repo/apps',
      files: {
        'AGENTS.md': 'ROOT_CONTENT',
        'apps/CLAUDE.md': 'APPS_CLAUDE_CONTENT',
      },
    });

    const result = await provider.resolve('agents_md', ctx);
    expect(result).toBeTruthy();

    const content = result || '';
    expect(content).toContain('ROOT_CONTENT');
    expect(content).toContain('APPS_CLAUDE_CONTENT');
    expect(content).not.toContain('APPS_GEMINI_CONTENT');
  });

  it('respects maxDepth by limiting subdirectory lookup', async () => {
    const provider = AgentsMdProvider({ searchStrategy: 'hierarchical', maxDepth: 0 });
    const ctx = createContext({
      currentWorkingDirectory: '/repo/apps',
      files: {
        'AGENTS.md': 'ROOT_ONLY_CONTENT',
        'apps/AGENTS.md': 'APPS_CONTENT',
      },
    });

    const result = await provider.resolve('agents_md', ctx);
    expect(result).toBeTruthy();

    const content = result || '';
    expect(content).toContain('ROOT_ONLY_CONTENT');
    expect(content).not.toContain('APPS_CONTENT');
  });

  it('keeps instruction files intact now that memory is stored in separate workspaces', async () => {
    const provider = AgentsMdProvider();
    const ctx = createContext({
      currentWorkingDirectory: '/repo/apps',
      files: {
        'CLAUDE.md': ['# Root Instructions', '', '## Long-Term Memory', '', '- Secret memory'].join(
          '\n'
        ),
        'apps/AGENTS.md': ['# App Instructions', '', '- Keep nested instructions'].join('\n'),
      },
    });

    const result = await provider.resolve('agents_md', ctx);
    expect(result).toBeTruthy();

    const content = result || '';
    expect(content).toContain('# Root Instructions');
    expect(content).toContain('## Long-Term Memory');
    expect(content).toContain('- Secret memory');
    expect(content).toContain('# App Instructions');
  });
});
