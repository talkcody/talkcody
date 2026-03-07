import { describe, expect, it, vi } from 'vitest';
import {
  importAgentFromGitHub,
  parseAgentMarkdown,
  extractMarkdownPathsFromHtml,
} from './github-import-agent-service';

const mockSimpleFetch = vi.fn();

vi.mock('@/lib/tauri-fetch', () => ({
  simpleFetch: (...args: unknown[]) => mockSimpleFetch(...args),
}));

describe('parseAgentMarkdown', () => {
  it('extracts markdown paths from new GitHub JSON format', () => {
    const html = `
<!DOCTYPE html>
<html>
<head><title>Test</title></head>
<body>
<script type="application/json" data-target="react-app.embeddedData">
{"payload":{"tree":{"items":[
{"name":"code-archaeologist.md","path":"agents/core/code-archaeologist.md","contentType":"file"},
{"name":"code-reviewer.md","path":"agents/core/code-reviewer.md","contentType":"file"},
{"name":"documentation-specialist.md","path":"agents/core/documentation-specialist.md","contentType":"file"},
{"name":"performance-optimizer.md","path":"agents/core/performance-optimizer.md","contentType":"file"},
{"name":"README.md","path":"agents/core/README.md","contentType":"file"}
]}}}
</script>
</body>
</html>`;

    const paths = extractMarkdownPathsFromHtml(
      html,
      'vijaythecoder',
      'awesome-claude-agents',
      'main',
      'agents/core'
    );

    // Should return all 5 markdown files including README
    expect(paths).toHaveLength(5);
    expect(paths.sort()).toEqual([
      'agents/core/README.md',
      'agents/core/code-archaeologist.md',
      'agents/core/code-reviewer.md',
      'agents/core/documentation-specialist.md',
      'agents/core/performance-optimizer.md',
    ]);
  });

  it('extracts markdown paths from legacy anchor tag format (backward compatibility)', () => {
    const html = `
      <a href="/vijaythecoder/awesome-claude-agents/blob/main/agents/core/code-archaeologist.md">file</a>
      <a href="/vijaythecoder/awesome-claude-agents/blob/main/agents/core/code-reviewer.md">file</a>
    `;

    const paths = extractMarkdownPathsFromHtml(
      html,
      'vijaythecoder',
      'awesome-claude-agents',
      'main',
      'agents/core'
    );

    expect(paths).toHaveLength(2);
    expect(paths.sort()).toEqual([
      'agents/core/code-archaeologist.md',
      'agents/core/code-reviewer.md',
    ]);
  });

  it('returns empty array when no markdown files found', () => {
    const html = `
<script type="application/json" data-target="react-app.embeddedData">
{"payload":{"tree":{"items":[
{"name":"config.json","path":"agents/core/config.json","contentType":"file"},
{"name":"index.js","path":"agents/core/index.js","contentType":"file"}
]}}}
</script>`;

    const paths = extractMarkdownPathsFromHtml(
      html,
      'vijaythecoder',
      'awesome-claude-agents',
      'main',
      'agents/core'
    );

    expect(paths).toHaveLength(0);
  });

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
  it('imports multiple markdown agents from a directory listing (new JSON format)', async () => {
    // GitHub now uses JSON-embedded format for directory listings
    const html = `
<!DOCTYPE html>
<html>
<body>
<script type="application/json" data-target="react-app.embeddedData">
{"payload":{"tree":{"items":[
{"name":"code-archaeologist.md","path":"agents/core/code-archaeologist.md","contentType":"file"},
{"name":"code-reviewer.md","path":"agents/core/code-reviewer.md","contentType":"file"},
{"name":"documentation-specialist.md","path":"agents/core/documentation-specialist.md","contentType":"file"},
{"name":"performance-optimizer.md","path":"agents/core/performance-optimizer.md","contentType":"file"}
]}}}
</script>
</body>
</html>`;

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

  it('should set default dynamicPrompt with env and agents_md providers', async () => {
    const html = `
<!DOCTYPE html>
<html>
<body>
<script type="application/json" data-target="react-app.embeddedData">
{"payload":{"tree":{"items":[
{"name":"test-agent.md","path":"agents/test-agent.md","contentType":"file"}
]}}}
</script>
</body>
</html>`;

    const markdownContent = `---
name: test-agent
description: A test agent
tools:
  - Read
model: sonnet
---

You are a test agent.`;

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
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          text: async () => markdownContent,
        };
      }

      return {
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => '',
      };
    });

    const agents = await importAgentFromGitHub({
      repository: 'test/repo',
      path: 'agents',
      agentId: 'test-agent',
    });

    expect(agents).toHaveLength(1);
    const agent = agents[0];

    // Verify dynamicPrompt is set with default providers
    expect(agent.dynamicPrompt).toBeDefined();
    expect(agent.dynamicPrompt?.enabled).toBe(true);
    expect(agent.dynamicPrompt?.providers).toEqual([
      'env',
      'global_memory',
      'project_memory',
      'agents_md',
    ]);
    expect(agent.dynamicPrompt?.providerSettings).toEqual({
      agents_md: {
        maxChars: 8000,
        searchStrategy: 'hierarchical',
      },
    });
  });
});
