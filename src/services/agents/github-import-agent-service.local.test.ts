import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockReadDir = vi.fn();
const mockReadTextFile = vi.fn();
const mockGet = vi.fn();
const mockForceRegister = vi.fn();

vi.mock('@tauri-apps/api/path', () => ({
  join: vi.fn((...parts: string[]) => Promise.resolve(parts.join('/'))),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  readDir: (...args: unknown[]) => mockReadDir(...args),
  readTextFile: (...args: unknown[]) => mockReadTextFile(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/lib/tauri-fetch', () => ({
  simpleFetch: vi.fn(),
}));

vi.mock('@/services/agents/tool-registry', () => ({
  getAvailableToolsForUISync: () => [{ id: 'readFile', ref: { kind: 'read-tool' } }],
}));

vi.mock('@/services/agents/agent-registry', () => ({
  agentRegistry: {
    get: (...args: unknown[]) => mockGet(...args),
    forceRegister: (...args: unknown[]) => mockForceRegister(...args),
  },
}));

describe('agent local import helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('imports local markdown agents from a selected directory', async () => {
    const { importAgentsFromLocalDirectory } = await import('./github-import-agent-service');

    mockReadDir.mockResolvedValue([
      { name: 'reviewer.md', isFile: true, isDirectory: false },
      { name: 'notes.txt', isFile: true, isDirectory: false },
    ]);
    mockReadTextFile.mockResolvedValue(`---
name: reviewer
description: Reviews pull requests
tools:
  - Read
model: sonnet
---

You are a reviewer.`);

    const result = await importAgentsFromLocalDirectory('/Users/demo/agents');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'reviewer',
      name: 'reviewer',
      category: 'local',
      githubPath: '/Users/demo/agents/reviewer.md',
      repository: 'local-import',
    });
  });

  it('registers imported agents with unique local ids', async () => {
    const { registerImportedAgents } = await import('./github-import-agent-service');

    mockGet.mockResolvedValueOnce({ id: 'reviewer' }).mockResolvedValueOnce(undefined);
    mockForceRegister.mockResolvedValue(undefined);

    const result = await registerImportedAgents(
      [
        {
          id: 'reviewer',
          name: 'Reviewer',
          description: 'Reviews pull requests',
          repository: 'local-import',
          githubPath: '/Users/demo/agents/reviewer.md',
          modelType: 'main_model',
          systemPrompt: 'Review code',
          tools: { readFile: {} },
        },
      ],
      'local-agent'
    );

    expect(result).toEqual({ succeeded: ['Reviewer'], failed: [] });
    expect(mockForceRegister).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'reviewer-1',
        name: 'Reviewer',
        systemPrompt: 'Review code',
        tools: { readFile: { kind: 'read-tool' } },
      })
    );
  });
});
