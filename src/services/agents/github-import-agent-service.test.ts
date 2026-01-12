import { describe, expect, it, vi } from 'vitest';
import { importAgentFromGitHub, parseAgentMarkdown } from './github-import-agent-service';

const mockSimpleFetch = vi.fn();

vi.mock('@/lib/tauri-fetch', () => ({
  simpleFetch: (...args: unknown[]) => mockSimpleFetch(...args),
}));

describe('parseAgentMarkdown', () => {
  it('parses frontmatter and prompt content', () => {
    const content = `---
name: code-reviewer
description: Reviews code for quality and best practices
tools:
  - Read
  - Glob
  - Grep
model: sonnet
role: read
canBeSubagent: false
version: 1.0.0
---

You are a code reviewer.`;

    const parsed = parseAgentMarkdown(content);

    expect(parsed.frontmatter.name).toBe('code-reviewer');
    expect(parsed.frontmatter.description).toBe('Reviews code for quality and best practices');
    expect(parsed.frontmatter.tools).toEqual(['Read', 'Glob', 'Grep']);
    expect(parsed.frontmatter.model).toBe('sonnet');
    expect(parsed.frontmatter.role).toBe('read');
    expect(parsed.frontmatter.canBeSubagent).toBe(false);
    expect(parsed.frontmatter.version).toBe('1.0.0');
    expect(parsed.prompt).toBe('You are a code reviewer.');
  });
});

describe('importAgentFromGitHub', () => {
  it('imports multiple markdown agents from a directory listing', async () => {
    const html = `
      <a href="/vijaythecoder/awesome-claude-agents/blob/main/agents/core/code-archaeologist.md">file</a>
      <a href="/vijaythecoder/awesome-claude-agents/blob/main/agents/core/code-reviewer.md">file</a>
      <a href="/vijaythecoder/awesome-claude-agents/blob/main/agents/core/documentation-specialist.md">file</a>
      <a href="/vijaythecoder/awesome-claude-agents/blob/main/agents/core/performance-optimizer.md">file</a>
    `;

    const markdownByPath: Record<string, string> = {
      'agents/core/code-archaeologist.md': `---
name: code-archaeologist
description: Digs into legacy code
tools:
  - Read
  - Glob
model: sonnet
---

You are a code archaeologist.`,
      'agents/core/code-reviewer.md': `---
name: code-reviewer
description: Reviews code for quality and best practices
tools:
  - Read
  - Glob
  - Grep
model: sonnet
---

You are a code reviewer.`,
      'agents/core/documentation-specialist.md': `---
name: documentation-specialist
description: Writes docs
tools: Read, Write
model: sonnet
---

You are a documentation specialist.`,
      'agents/core/performance-optimizer.md': `---
name: performance-optimizer
description: Optimizes performance
tools:
  - Read
  - Grep
  - Bash
model: sonnet
---

You are a performance optimizer.`,
    };

    mockSimpleFetch.mockImplementation(async (url: string) => {
      if (url.includes('github.com') && url.includes('/tree/')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          text: async () => html,
        };
      }

      if (url.includes('raw.githubusercontent.com')) {
        const match = Object.keys(markdownByPath).find((path) => url.includes(path));
        if (match) {
          return {
            ok: true,
            status: 200,
            statusText: 'OK',
            text: async () => markdownByPath[match],
          };
        }
      }

      return {
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => '',
      };
    });

    const agents = await importAgentFromGitHub({
      repository: 'vijaythecoder/awesome-claude-agents',
      path: 'agents/core',
      agentId: 'core',
      branch: 'main',
    });

    expect(agents).toHaveLength(4);
    const names = agents.map((agent) => agent.name).sort();
    expect(names).toEqual([
      'code-archaeologist',
      'code-reviewer',
      'documentation-specialist',
      'performance-optimizer',
    ]);

    const reviewer = agents.find((agent) => agent.name === 'code-reviewer');
    expect(reviewer?.tools).toMatchObject({
      readFile: {},
      glob: {},
      codeSearch: {},
    });
  });
});
